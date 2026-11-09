import "server-only";
import type { Transaction } from "firebase-admin/firestore";
import { env } from "@/lib/env";
import { db, FieldValue } from "@/lib/firebase/admin";
import { sha256Hex } from "@/lib/ids";
import { log } from "@/lib/log";
import type { Actor } from "@/types/firestore";

// Append-only audit log (Section E.2 `auditLogs`). IPs are stored hashed with a pepper.

export type AuditEntry = {
  familyId: string | null;
  actor: Actor;
  action: string;
  target: string;
  ip?: string | null;
  userAgent?: string | null;
};

function toDoc(entry: AuditEntry) {
  return {
    familyId: entry.familyId,
    actor: { kind: entry.actor.kind, uid: entry.actor.uid, tokenHash: entry.actor.tokenHash },
    action: entry.action,
    target: entry.target,
    at: FieldValue.serverTimestamp(),
    ipHash: entry.ip ? sha256Hex(`${env().OTP_PEPPER}:ip:${entry.ip}`).slice(0, 32) : null,
    userAgent: entry.userAgent?.slice(0, 200) ?? null,
  };
}

export function auditInTx(tx: Transaction, entry: AuditEntry) {
  tx.create(db().collection("auditLogs").doc(), toDoc(entry));
}

/** Outside a transaction. A failed audit write is logged and rethrown (it surfaces as 503/500). */
export async function audit(entry: AuditEntry, requestId?: string) {
  try {
    await db().collection("auditLogs").add(toDoc(entry));
  } catch (err) {
    log.error("audit.write_failed", { requestId, action: entry.action, error: err });
    throw err;
  }
}

export function requestMeta(req: Request): { ip: string | null; userAgent: string | null } {
  const fwd = req.headers.get("x-forwarded-for");
  return { ip: fwd ? fwd.split(",")[0].trim() : req.headers.get("x-real-ip"), userAgent: req.headers.get("user-agent") };
}
