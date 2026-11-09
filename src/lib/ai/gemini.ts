import "server-only";
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import type { z } from "zod";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { log } from "@/lib/log";

// Gemini via @google/genai (Section B). Structured output, temperature 0, zod validation of every
// response. One retry on timeout or invalid output, then a real error (AG-8, NW-2). The caller
// decides what to show (manual entry, demo mode).

export type AiFailure = "not_configured" | "timeout" | "invalid_output" | "unavailable" | "blocked";

export class AiError extends AppError {
  constructor(
    readonly reason: AiFailure,
    message: string,
    cause?: unknown,
  ) {
    super("UPSTREAM_FAILED", message, { details: { reason }, cause });
  }
}

let cached: { key: string; client: GoogleGenAI } | null = null;
const RETRY_DELAY_MS = process.env.VITEST ? 0 : 2000;

function client(): { ai: GoogleGenAI; model: string; timeout: number } {
  const e = env();
  if (!e.GEMINI_API_KEY || !e.GEMINI_MODEL) throw new AiError("not_configured", "The AI service is not configured on this server.");
  const key = `${e.GEMINI_API_KEY}|${e.GEMINI_BASE_URL ?? ""}`;
  if (!cached || cached.key !== key) {
    cached = {
      key,
      client: new GoogleGenAI({
        apiKey: e.GEMINI_API_KEY,
        // Retries are ours (one, on invalid output or timeout), so the SDK does not retry on its own.
        httpOptions: { timeout: e.GEMINI_TIMEOUT_MS, retryOptions: { attempts: 1 }, ...(e.GEMINI_BASE_URL ? { baseUrl: e.GEMINI_BASE_URL } : {}) },
      }),
    };
  }
  return { ai: cached.client, model: e.GEMINI_MODEL, timeout: e.GEMINI_TIMEOUT_MS };
}

function classify(err: unknown): AiFailure {
  const name = (err as { name?: string } | null)?.name ?? "";
  const message = String((err as { message?: string } | null)?.message ?? "");
  if (name === "AbortError" || name === "TimeoutError" || /timed? ?out|aborted/i.test(message)) return "timeout";
  return "unavailable";
}

const BUDGET = { MINIMAL: 0, LOW: 1024, MEDIUM: 4096 } as const;

/** Gemini 3+ takes a thinking level; 2.x models reject it and take a token budget instead. */
export function thinkingConfig(model: string, level: keyof typeof BUDGET) {
  const major = Number(/^gemini-(\d+)/.exec(model)?.[1] ?? 3);
  return major >= 3 ? { thinkingLevel: ThinkingLevel[level] } : { thinkingBudget: BUDGET[level] };
}

export type GenerateArgs<S extends z.ZodType> = {
  label: "extraction" | "quick_add" | "receipt";
  system: string;
  prompt: string;
  jsonSchema: unknown;
  schema: S;
  requestId?: string;
  maxOutputTokens?: number;
  /** Gemini 3 thinks by default; long thinking made extraction time out (docs/decisions.md 2.21). */
  thinking?: "MINIMAL" | "LOW" | "MEDIUM";
};

/** Calls Gemini and returns validated JSON. Throws AiError after one retry. */
export async function generateJson<S extends z.ZodType>(args: GenerateArgs<S>): Promise<{ data: z.infer<S>; model: string; attempts: number }> {
  const { ai, model, timeout } = client();
  let last: { reason: AiFailure; err: unknown } | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const started = Date.now();
    try {
      const res = await ai.models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text: args.prompt }] }],
        config: {
          systemInstruction: args.system,
          temperature: 0,
          responseMimeType: "application/json",
          responseJsonSchema: args.jsonSchema,
          // The SDK's httpOptions.timeout is not enforced on every path, so abort explicitly.
          abortSignal: AbortSignal.timeout(timeout),
          ...(args.maxOutputTokens ? { maxOutputTokens: args.maxOutputTokens } : {}),
          ...(args.thinking ? { thinkingConfig: thinkingConfig(model, args.thinking) } : {}),
        },
      });
      const text = res.text;
      if (!text) {
        const blocked = res.promptFeedback?.blockReason;
        last = { reason: blocked ? "blocked" : "invalid_output", err: new Error(blocked ? `blocked: ${blocked}` : "empty response") };
      } else {
        let json: unknown;
        try {
          json = JSON.parse(text);
        } catch (err) {
          last = { reason: "invalid_output", err };
          json = undefined;
        }
        if (json !== undefined) {
          const parsed = args.schema.safeParse(json);
          if (parsed.success) {
            log.info("ai.ok", { requestId: args.requestId, label: args.label, model, attempt, durationMs: Date.now() - started });
            return { data: parsed.data, model, attempts: attempt };
          }
          last = { reason: "invalid_output", err: new Error(parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")) };
        }
      }
    } catch (err) {
      last = { reason: classify(err), err };
    }
    log.warn("ai.attempt_failed", { requestId: args.requestId, label: args.label, model, attempt, reason: last?.reason, error: last?.err, durationMs: Date.now() - started });
    if (last?.reason === "blocked") break;
    // Provider overload (503/429) usually clears in seconds: wait briefly before the one retry.
    if (attempt === 1 && last?.reason === "unavailable") await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
  }
  const reason = last?.reason ?? "unavailable";
  const message =
    reason === "timeout"
      ? "The AI service took too long to answer."
      : reason === "invalid_output"
        ? "The AI service returned an answer we could not use."
        : reason === "blocked"
          ? "The AI service refused to read this text."
          : "The AI service is unavailable right now.";
  throw new AiError(reason, message, last?.err);
}
