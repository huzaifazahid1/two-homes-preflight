import "server-only";
import type { Transaction } from "firebase-admin/firestore";
import { db, FieldValue } from "@/lib/firebase/admin";
import { log } from "@/lib/log";
import { sendEmail } from "@/lib/email/send";
import type { RenderedEmail } from "@/lib/email/templates/layout";
import type { NotificationDoc, NotificationType } from "@/types/firestore";

// Notifications (Section E.2, H.4). The doc id is the dedupe key `${type}:${entityId}:${version}`.
// The doc is created inside the state-change transaction; the email is sent after commit and
// the outcome is written to `email.status`. A doc that already exists means "already sent".
// Never store a plain link token in a notification (SE-2): `link` holds only token-free paths.

export type NotificationInput = {
  dedupeKey: string;
  familyId: string;
  toUid?: string;
  toEmail: string;
  type: NotificationType;
  expenseId?: string;
  title: string;
  body: string;
  link?: string;
  /** false = in-app only (email.status 'skipped'). */
  sendEmail: boolean;
};

export function dedupeKey(type: NotificationType, entityId: string, version: number | string): string {
  return `${type}:${entityId}:${version}`.replace(/\//g, "_");
}

function ref(key: string) {
  return db().collection("notifications").doc(key);
}

/**
 * Must be called in the read phase of a transaction (before any write): returns the inputs whose
 * dedupe key does not exist yet. Then call `writeNotifications` in the write phase.
 */
export async function filterNewNotifications(tx: Transaction, inputs: NotificationInput[]): Promise<NotificationInput[]> {
  if (inputs.length === 0) return [];
  const snaps = await tx.getAll(...inputs.map((n) => ref(n.dedupeKey)));
  return inputs.filter((_, i) => !snaps[i].exists);
}

export function writeNotifications(tx: Transaction, inputs: NotificationInput[]) {
  for (const n of inputs) {
    const doc: Omit<NotificationDoc, "createdAt"> & { createdAt: FieldValue } = {
      familyId: n.familyId,
      toUid: n.toUid,
      toEmail: n.toEmail,
      type: n.type,
      expenseId: n.expenseId,
      title: n.title,
      body: n.body,
      link: n.link,
      read: false,
      email: { status: n.sendEmail ? "pending" : "skipped", attempts: 0 },
      createdAt: FieldValue.serverTimestamp(),
    };
    tx.create(ref(n.dedupeKey), doc);
  }
}

/** After commit: send the email for a pending notification and record the outcome. Never throws. */
export async function deliverNotificationEmail(input: {
  dedupeKey: string;
  to: string;
  replyTo?: string;
  email: RenderedEmail;
  requestId?: string;
}): Promise<{ ok: boolean }> {
  const result = await sendEmail({ to: input.to, replyTo: input.replyTo, email: input.email, requestId: input.requestId });
  try {
    await ref(input.dedupeKey).update(
      result.ok
        ? { "email.status": "sent", "email.providerId": result.providerId, "email.attempts": result.attempts, "email.error": FieldValue.delete() }
        : { "email.status": "failed", "email.error": result.error, "email.attempts": result.attempts },
    );
  } catch (err) {
    log.error("notification.status_update_failed", { requestId: input.requestId, error: err });
  }
  return { ok: result.ok };
}
