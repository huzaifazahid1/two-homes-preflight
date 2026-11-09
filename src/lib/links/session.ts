import "server-only";
import { nowMs, MINUTE_MS } from "@/lib/clock";
import { env } from "@/lib/env";
import { hmacSha256, safeEqual } from "@/lib/ids";

// Link session cookie (Section F.3): HMAC-SHA256 signed, httpOnly, Secure, SameSite=Lax,
// 30 minutes, containing the token hash and expiry. Format: base64url(json).base64url(hmac).

export const LINK_SESSION_COOKIE = "thp_link";
export const LINK_SESSION_TTL_MS = 30 * MINUTE_MS;

type Payload = { th: string; exp: number };

export function signPayload(secret: string, payload: object): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = hmacSha256(secret, body).toString("base64url");
  return `${body}.${sig}`;
}

export function verifyPayload<T>(secret: string, value: string | undefined | null): T | null {
  if (!value) return null;
  const dot = value.indexOf(".");
  if (dot <= 0) return null;
  const body = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const expected = hmacSha256(secret, body).toString("base64url");
  if (!safeEqual(sig, expected)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
  } catch {
    // A body that passed the HMAC but is not JSON cannot come from us; treat as no session.
    return null;
  }
}

export function createLinkSession(tokenHash: string): { value: string; expiresAt: number } {
  const exp = nowMs() + LINK_SESSION_TTL_MS;
  return { value: signPayload(env().LINK_SESSION_SECRET, { th: tokenHash, exp } satisfies Payload), expiresAt: exp };
}

/** Returns the token hash if the cookie is valid and unexpired, else null. */
export function readLinkSession(cookieValue: string | undefined | null): { tokenHash: string; expiresAt: number } | null {
  const p = verifyPayload<Payload>(env().LINK_SESSION_SECRET, cookieValue);
  if (!p || typeof p.th !== "string" || typeof p.exp !== "number") return null;
  if (nowMs() > p.exp) return null;
  return { tokenHash: p.th, expiresAt: p.exp };
}

export function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: env().APP_URL.startsWith("https://"),
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}
