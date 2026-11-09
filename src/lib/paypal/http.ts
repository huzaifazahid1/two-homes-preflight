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

/** Tests only. */
export function resetPayPalTokenCache() {
  appToken = null;
}
