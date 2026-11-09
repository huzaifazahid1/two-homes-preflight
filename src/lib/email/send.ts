import "server-only";
import { Resend } from "resend";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { writeOutbox } from "./outbox";
import type { RenderedEmail } from "./templates/layout";

// Email transport (Section H.2, H.4). Retries up to 3 attempts with backoff for 429 and 5xx;
// 4xx validation errors are not retried. Never throws: the caller records the outcome, because
// an email failure must never block a state change.

export type SendResult = { ok: true; providerId: string; attempts: number } | { ok: false; error: string; attempts: number };

let client: Resend | null = null;
function resend(): Resend {
  if (!client) client = new Resend(env().RESEND_API_KEY);
  return client;
}

const MAX_ATTEMPTS = 3;

export async function sendEmail(input: { to: string; replyTo?: string; email: RenderedEmail; requestId?: string }): Promise<SendResult> {
  const e = env();
  if (e.EMAIL_TRANSPORT === "outbox") {
    if (e.NODE_ENV === "production" && !e.DEMO_MODE) {
      return { ok: false, error: "outbox transport is disabled in production", attempts: 0 };
    }
    try {
      const id = await writeOutbox({ to: input.to, from: e.EMAIL_FROM, replyTo: input.replyTo, ...input.email });
      return { ok: true, providerId: id, attempts: 1 };
    } catch (err) {
      log.error("email.outbox_failed", { requestId: input.requestId, error: err });
      return { ok: false, error: "outbox write failed", attempts: 1 };
    }
  }

  let lastError = "unknown error";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const { data, error } = await resend().emails.send({
        from: e.EMAIL_FROM,
        to: input.to,
        replyTo: input.replyTo,
        subject: input.email.subject,
        html: input.email.html,
        text: input.email.text,
      });
      if (data && !error) {
        log.info("email.sent", { requestId: input.requestId, to: input.to, attempt });
        return { ok: true, providerId: data.id, attempts: attempt };
      }
      lastError = error ? `${error.name} (${error.statusCode ?? "no status"})` : "empty response";
      const status = error?.statusCode ?? 0;
      const retryable = status === 429 || status >= 500 || status === 0;
      log.warn("email.send_failed", { requestId: input.requestId, attempt, errorCode: error?.name, statusCode: status, retryable });
      if (!retryable) return { ok: false, error: lastError, attempts: attempt };
    } catch (err) {
      lastError = "network error";
      log.warn("email.send_threw", { requestId: input.requestId, attempt, error: err });
    }
    if (attempt < MAX_ATTEMPTS) await sleep(250 * 2 ** (attempt - 1));
  }
  log.error("email.gave_up", { requestId: input.requestId, error: lastError });
  return { ok: false, error: lastError, attempts: MAX_ATTEMPTS };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
