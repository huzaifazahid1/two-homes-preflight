import { resetEnvCache } from "@/lib/env";
import type { StubResponse, StubServer } from "./stub-server";

// Points the Gemini SDK at the local stub server (GEMINI_BASE_URL) for one test.

export const GEMINI_MODEL = "gemini-test";
export const GEMINI_PATH = `/v1beta/models/${GEMINI_MODEL}:generateContent`;

export function geminiText(text: string): StubResponse {
  return { json: { candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP", index: 0 }] } };
}

export function geminiJson(value: unknown): StubResponse {
  return geminiText(JSON.stringify(value));
}

export async function withGemini<T>(stub: StubServer, fn: () => Promise<T>, opts: { timeoutMs?: number } = {}): Promise<T> {
  process.env.GEMINI_API_KEY = "test-gemini-key";
  process.env.GEMINI_MODEL = GEMINI_MODEL;
  process.env.GEMINI_BASE_URL = stub.url;
  process.env.GEMINI_TIMEOUT_MS = String(opts.timeoutMs ?? 5000);
  resetEnvCache();
  try {
    return await fn();
  } finally {
    for (const k of ["GEMINI_API_KEY", "GEMINI_MODEL", "GEMINI_BASE_URL", "GEMINI_TIMEOUT_MS"]) delete process.env[k];
    resetEnvCache();
  }
}
