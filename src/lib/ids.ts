import "server-only";
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

/** 32 random bytes, base64url (Section F.3). */
export function newLinkToken(): string {
  return randomBytes(32).toString("base64url");
}

export function sha256Hex(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

export function hmacSha256(secret: string, input: string): Buffer {
  return createHmac("sha256", secret).update(input).digest();
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** 20-char random id, same shape as Firestore auto ids. */
export function newId(length = 20): string {
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

/** 6-digit numeric code with leading zeros, uniformly random. */
export function newOtpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function newRequestId(): string {
  return randomBytes(8).toString("hex");
}

/** Constant-time comparison of two hex or base64 strings. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
