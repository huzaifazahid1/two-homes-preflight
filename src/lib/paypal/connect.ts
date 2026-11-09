import "server-only";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { auditInTx } from "@/lib/audit";
import { MINUTE_MS, now, nowMs } from "@/lib/clock";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { db, FieldValue, Timestamp } from "@/lib/firebase/admin";
import { safeEqual } from "@/lib/ids";
import { signPayload, verifyPayload } from "@/lib/links/session";
import { log } from "@/lib/log";
import { ensurePayout } from "@/lib/settlement";
import type { ExpenseDoc, Role } from "@/types/firestore";
import { exchangeAuthorizationCode, paypalGet } from "./http";

// "Connect your PayPal account" (Section F.4). Log in with PayPal is used only to learn which
// PayPal account receives payouts. It never signs anyone in to our app. The PayPal access token
// is discarded right after reading userinfo.

export const PP_STATE_COOKIE = "thp_pp_state";
const STATE_TTL_MS = 10 * MINUTE_MS;
const SCOPES = "openid email https://uri.paypal.com/services/paypalattributes";

type StatePayload = { s: string; r: Role; f: string; u?: string; th?: string; rt: string; exp: number };

function stateSecret() {
  // Separate key derivation so a link session cookie can never be replayed as a state cookie.
  return `${env().LINK_SESSION_SECRET}:paypal-state`;
}

/** Web host for the authorize page. PAYPAL_ENV only allows "sandbox" (CLAUDE.md: sandbox everywhere). */
export function authorizeBase(): string {
  return env().PAYPAL_ENV === "sandbox" ? "https://www.sandbox.paypal.com" : "https://www.paypal.com";
}

export function buildAuthorizeUrl(state: string): string {
  const e = env();
  const q = new URLSearchParams({
    flowEntry: "static",
    client_id: e.PAYPAL_CLIENT_ID,
    response_type: "code",
    scope: SCOPES,
    redirect_uri: e.PAYPAL_CONNECT_RETURN_URL,
    state,
  });
  return `${authorizeBase()}/connect?${q.toString()}`;
}

export function startConnect(input: { role: Role; familyId: string; uid?: string; tokenHash?: string; returnTo: string }): { url: string; cookie: string; maxAgeSeconds: number } {
  const state = randomBytes(24).toString("base64url");
  const payload: StatePayload = { s: state, r: input.role, f: input.familyId, u: input.uid, th: input.tokenHash, rt: input.returnTo, exp: nowMs() + STATE_TTL_MS };
  return { url: buildAuthorizeUrl(state), cookie: signPayload(stateSecret(), payload), maxAgeSeconds: STATE_TTL_MS / 1000 };
}

export function readStateCookie(value: string | undefined | null): StatePayload | null {
  const p = verifyPayload<StatePayload>(stateSecret(), value);
  if (!p || nowMs() > p.exp) return null;
  return p;
}

// Userinfo (schema=paypalv1.1). Tolerant: PayPal has returned booleans and strings for the flags.
const flag = z.union([z.boolean(), z.enum(["true", "false"])]).transform((v) => v === true || v === "true");
const userInfoSchema = z.object({
  user_id: z.string().optional(),
  payer_id: z.string().optional(),
  email: z.string().optional(),
  emails: z.array(z.object({ value: z.string(), primary: flag.optional(), confirmed: flag.optional() })).optional(),
  verified_account: flag.optional(),
  email_verified: flag.optional(),
});

export type ParsedUserInfo = { payerId?: string; email: string; verifiedAccount: boolean };

export function parseUserInfo(raw: z.infer<typeof userInfoSchema>): ParsedUserInfo {
  const email = (raw.emails?.find((e) => e.primary)?.value ?? raw.emails?.[0]?.value ?? raw.email ?? "").toLowerCase();
  if (!email) throw new AppError("UPSTREAM_FAILED", "PayPal did not share an email address for this account.");
  return { payerId: raw.payer_id, email, verifiedAccount: raw.verified_account ?? false };
}

export type ConnectOutcome =
  | { status: "connected"; returnTo: string; email: string; verifiedAccount: boolean }
  | { status: "cancelled"; returnTo: string };

let loggedRawOnce = false;

/**
 * Completes the flow. `who` is the authenticated caller now (session user or link session),
 * which must match the identity recorded when the flow started.
 */
export async function completeConnect(
  input: { code?: string; state: string; error?: string },
  stateCookie: string | undefined,
  who: { uid?: string; tokenHash?: string },
  meta: { requestId: string; ip?: string | null; userAgent?: string | null },
): Promise<ConnectOutcome> {
  const st = readStateCookie(stateCookie);
  if (!st || !safeEqual(st.s, input.state)) {
    throw new AppError("PAYPAL_STATE_MISMATCH", "This PayPal sign-in did not start here or has expired. Please try connecting again.");
  }
  const sameCaller = st.u ? who.uid === st.u : st.th ? who.tokenHash === st.th : false;
  if (!sameCaller) throw new AppError("PAYPAL_STATE_MISMATCH", "Please start connecting PayPal again from the same browser session.");

  if (input.error || !input.code) {
    log.info("paypal.connect_cancelled", { requestId: meta.requestId, familyId: st.f });
    return { status: "cancelled", returnTo: st.rt };
  }

  const accessToken = await exchangeAuthorizationCode(input.code, meta.requestId);
  const { data, debugId } = await paypalGet("/v1/identity/oauth2/userinfo?schema=paypalv1.1", userInfoSchema, { bearer: accessToken, requestId: meta.requestId });
  if (env().NODE_ENV === "development" && !loggedRawOnce) {
    // [Confirm] item 5: record the real field names once in development (no tokens; emails redacted by the logger).
    loggedRawOnce = true;
    log.info("paypal.userinfo_shape", { requestId: meta.requestId, debug_id: debugId, keys: Object.keys(data), sample: data });
  }
  const info = parseUserInfo(data);

  await saveConnection(st.f, st.r, { method: "login_with_paypal", ...info }, { kind: st.r, uid: st.u, tokenHash: st.th }, meta);
  return { status: "connected", returnTo: st.rt, email: info.email, verifiedAccount: info.verifiedAccount };
}

export async function saveConnection(
  familyId: string,
  role: Role,
  conn: { method: "login_with_paypal" | "email"; payerId?: string; email: string; verifiedAccount?: boolean },
  actor: { kind: Role; uid?: string; tokenHash?: string },
  meta: { ip?: string | null; userAgent?: string | null },
) {
  const ref = db().collection("families").doc(familyId);
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new AppError("NOT_FOUND", "Family not found.");
    tx.update(ref, {
      [`payout.${role}`]: {
        method: conn.method,
        email: conn.email,
        ...(conn.payerId ? { payerId: conn.payerId } : {}),
        ...(conn.verifiedAccount !== undefined ? { verifiedAccount: conn.verifiedAccount } : {}),
        connectedAt: Timestamp.fromDate(now()),
      },
      updatedAt: FieldValue.serverTimestamp(),
    });
    auditInTx(tx, { familyId, actor, action: `paypal.connect.${conn.method}`, target: `families/${familyId}/payout/${role}`, ...meta });
  });
  await sendWaitingPayouts(familyId, role);
}

/** PC-6: claims already paid to this parent were waiting for a PayPal connection. Never throws. */
async function sendWaitingPayouts(familyId: string, role: Role) {
  const waiting = await db().collection("expenses").where("familyId", "==", familyId).where("settlement.state", "==", "PAID").get();
  for (const d of waiting.docs) {
    if ((d.data() as ExpenseDoc).paidByRole !== role) continue;
    await ensurePayout(d.id).catch((err: unknown) => log.error("paypal.connect.payout_failed", { expenseId: d.id, error: err }));
  }
}

/** DELETE /api/paypal/connect. Blocked while a payout to this family is processing. */
export async function disconnect(familyId: string, role: Role, actor: { uid: string }, meta: { ip?: string | null; userAgent?: string | null }) {
  const ref = db().collection("families").doc(familyId);
  await db().runTransaction(async (tx) => {
    const processing = await tx.get(
      db().collection("expenses").where("familyId", "==", familyId).where("settlement.state", "in", ["PAYOUT_PROCESSING", "PAYOUT_UNCLAIMED"]).where("paidByRole", "==", role).limit(1),
    );
    if (!processing.empty) throw new AppError("STATE_CONFLICT", "A payout is being processed. You can disconnect PayPal after it finishes.");
    tx.update(ref, { [`payout.${role}`]: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() });
    auditInTx(tx, { familyId, actor: { kind: role, uid: actor.uid }, action: "paypal.disconnect", target: `families/${familyId}/payout/${role}`, ...meta });
  });
}
