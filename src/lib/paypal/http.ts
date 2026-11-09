import "server-only";
import { z } from "zod";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { log } from "@/lib/log";

// Typed fetch for PayPal REST endpoints the Server SDK does not cover (identity, payouts,
// webhook verification, catalog). Logs PayPal's debug_id, never tokens or bodies.

type TokenCache = { value: string; expiresAt: number } | null;
let appToken: TokenCache = null;

function basicAuth(): string {
  const e = env();
  return `Basic ${Buffer.from(`${e.PAYPAL_CLIENT_ID}:${e.PAYPAL_CLIENT_SECRET}`).toString("base64")}`;
}

const tokenResponse = z.object({ access_token: z.string().min(1), expires_in: z.number().optional() });

export type PayPalCallResult<T> = { status: number; data: T; debugId: string | null };

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    // Non-JSON from PayPal (rare HTML error page): surface as an upstream failure below.
    return { non_json: true };
  }
}

function debugIdOf(res: Response, body: unknown): string | null {
  return res.headers.get("paypal-debug-id") ?? ((body as { debug_id?: string })?.debug_id ?? null);
}

/** Client-credentials token for the platform app, cached until 60 s before expiry. */
export async function appAccessToken(requestId?: string): Promise<string> {
  if (appToken && Date.now() < appToken.expiresAt) return appToken.value;
  const res = await fetch(`${env().PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: basicAuth(), "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });
  const body = await readBody(res);
  const parsed = tokenResponse.safeParse(body);
  if (!res.ok || !parsed.success) {
    log.error("paypal.token_failed", { requestId, status: res.status, debug_id: debugIdOf(res, body) });
    throw new AppError("UPSTREAM_FAILED", "PayPal is not responding right now. Please try again.");
  }
  appToken = { value: parsed.data.access_token, expiresAt: Date.now() + ((parsed.data.expires_in ?? 300) - 60) * 1000 };
  return appToken.value;
}

/** Exchanges a Log in with PayPal authorization code for a user access token (Basic auth). */
export async function exchangeAuthorizationCode(code: string, requestId?: string): Promise<string> {
  const res = await fetch(`${env().PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: basicAuth(), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code }).toString(),
    cache: "no-store",
  });
  const body = await readBody(res);
  const parsed = tokenResponse.safeParse(body);
  if (!res.ok || !parsed.success) {
    const error = (body as { error?: string })?.error;
    log.warn("paypal.code_exchange_failed", { requestId, status: res.status, errorCode: error, debug_id: debugIdOf(res, body) });
    if (res.status === 400 || res.status === 401) {
      // invalid_grant: code reused, expired or not ours (PC-3).
      throw new AppError("PAYPAL_STATE_MISMATCH", "This PayPal sign-in could not be used. Please try connecting again.");
    }
    throw new AppError("UPSTREAM_FAILED", "PayPal is not responding right now. Please try again.");
  }
  return parsed.data.access_token;
}

export async function paypalGet<T>(path: string, schema: z.ZodType<T>, opts: { bearer: string; requestId?: string }): Promise<PayPalCallResult<T>> {
  const res = await fetch(`${env().PAYPAL_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${opts.bearer}`, Accept: "application/json" },
    cache: "no-store",
  });
  const body = await readBody(res);
  const debugId = debugIdOf(res, body);
  if (!res.ok) {
    log.error("paypal.request_failed", { requestId: opts.requestId, path, status: res.status, debug_id: debugId });
    throw new AppError("UPSTREAM_FAILED", "PayPal returned an error. Please try again.");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    log.error("paypal.unexpected_response", { requestId: opts.requestId, path, debug_id: debugId, issues: parsed.error.issues.map((i) => i.path.join(".")) });
    throw new AppError("UPSTREAM_FAILED", "PayPal returned an unexpected response.");
  }
  return { status: res.status, data: parsed.data, debugId };
}

// ---------- App-token calls (Payouts, webhook verification, catalog) ----------

/**
 * A PayPal 4xx/5xx or network failure, with what we need to decide (Section G.10). Internal only:
 * callers map it to an AppError with a safe message; `name`/`issues` never reach the user.
 */
export class PayPalError extends Error {
  constructor(
    readonly status: number,
    readonly paypalName: string | null,
    readonly issues: string[],
    readonly debugId: string | null,
    readonly links: string[] = [],
    readonly network = false,
  ) {
    super(`PayPal ${status} ${paypalName ?? ""}`.trim());
    this.name = "PayPalError";
  }
  has(issue: string) {
    return this.paypalName === issue || this.issues.includes(issue);
  }
}

const errorBody = z
  .object({
    name: z.string().optional(),
    error: z.string().optional(),
    debug_id: z.string().optional(),
    details: z.array(z.object({ issue: z.string().optional(), link: z.array(z.object({ href: z.string() })).optional() }).loose()).optional(),
    links: z.array(z.object({ href: z.string() }).loose()).optional(),
  })
  .loose();

function toPayPalError(status: number, body: unknown, debugId: string | null): PayPalError {
  const b = errorBody.safeParse(body);
  const d = b.success ? b.data : {};
  const issues = (d.details ?? []).map((x) => x.issue).filter((x): x is string => Boolean(x));
  const links = [...(d.details ?? []).flatMap((x) => (x.link ?? []).map((l) => l.href)), ...(d.links ?? []).map((l) => l.href)];
  return new PayPalError(status, d.name ?? d.error ?? null, issues, debugId, links);
}

export type PayPalRequest = {
  method: "GET" | "POST";
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
  requestId?: string;
  /** Safe to repeat (keyed by PayPal-Request-Id or sender_batch_id): 5xx and timeouts are retried twice. */
  idempotent: boolean;
};

const RETRY_DELAYS_MS = [300, 1200];

/** Typed fetch with the app token, a timeout, idempotent retries and one token refresh on 401. */
export async function paypalRequest<T>(req: PayPalRequest, schema: z.ZodType<T>): Promise<PayPalCallResult<T>> {
  let refreshed = false;
  for (let attempt = 0; ; attempt++) {
    const started = Date.now();
    let res: Response;
    try {
      const token = await appAccessToken(req.requestId);
      res = await fetch(`${env().PAYPAL_API_BASE}${req.path}`, {
        method: req.method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(req.body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...(req.headers ?? {}),
        },
        body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
        cache: "no-store",
        signal: AbortSignal.timeout(env().PAYPAL_TIMEOUT_MS),
      });
    } catch (err) {
      if (err instanceof AppError) throw err;
      // Network failure or timeout: the request may or may not have reached PayPal.
      log.warn("paypal.network_error", { requestId: req.requestId, path: req.path, attempt, durationMs: Date.now() - started, error: err });
      if (req.idempotent && attempt < RETRY_DELAYS_MS.length) {
        await sleep(RETRY_DELAYS_MS[attempt]);
        continue;
      }
      throw new PayPalError(0, null, [], null, [], true);
    }
    const body = await readBody(res);
    const debugId = debugIdOf(res, body);
    if (res.status === 401 && !refreshed) {
      refreshed = true;
      appToken = null;
      attempt--;
      continue;
    }
    if (res.status >= 500 && req.idempotent && attempt < RETRY_DELAYS_MS.length) {
      log.warn("paypal.retry", { requestId: req.requestId, path: req.path, status: res.status, debug_id: debugId, attempt });
      await sleep(RETRY_DELAYS_MS[attempt]);
      continue;
    }
    if (!res.ok) {
      const e = toPayPalError(res.status, body, debugId);
      log.warn("paypal.request_failed", { requestId: req.requestId, path: req.path, status: res.status, paypalName: e.paypalName, issues: e.issues, debug_id: debugId });
      throw e;
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      log.error("paypal.unexpected_response", { requestId: req.requestId, path: req.path, debug_id: debugId, issues: parsed.error.issues.map((i) => i.path.join(".")) });
      throw new AppError("UPSTREAM_FAILED", "PayPal returned an unexpected response.");
    }
    log.info("paypal.request", { requestId: req.requestId, path: req.path, status: res.status, debug_id: debugId, durationMs: Date.now() - started });
    return { status: res.status, data: parsed.data, debugId };
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Maps a PayPal failure to a safe AppError (Section G.10). */
export function paypalAppError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  if (e instanceof PayPalError) {
    if (e.network || e.status >= 500) return new AppError("UPSTREAM_FAILED", "PayPal is not responding right now. Nothing was changed. Please try again.", { cause: e });
    if (e.status === 401 || e.status === 403) return new AppError("PAYPAL_AUTH", "The app could not sign in to PayPal. Please try again later.", { cause: e });
    if (e.has("INSTRUMENT_DECLINED") || e.has("PAYER_ACTION_REQUIRED")) return new AppError("PAYPAL_DECLINED", "PayPal declined this payment method. Choose another way to pay.", { cause: e, details: { restart: true } });
    if (e.has("DUPLICATE_INVOICE_ID") || e.has("DUPLICATE_REQUEST_ID")) return new AppError("PAYPAL_DUPLICATE", "This payment was already started. Refresh the page.", { cause: e });
    return new AppError("PAYPAL_VALIDATION", "PayPal could not process this request.", { cause: e });
  }
  return new AppError("UPSTREAM_FAILED", "PayPal is not responding right now. Please try again.", { cause: e });
}

/** Tests only. */
export function resetPayPalTokenCache() {
  appToken = null;
}
