import "server-only";
import { APPROVAL_REMINDER_AFTER_MS, APPROVAL_TTL_MS, approvalsCol, sendApprovalReminder } from "@/lib/approvals";
import { issueReminder } from "@/lib/claims";
import { DAY_MS, now } from "@/lib/clock";
import { OVERDUE_STATES } from "@/lib/data/dashboard";
import { familyEntitledFresh } from "@/lib/entitlement";
import { reconcileExpense } from "@/lib/settlement";
import { expensesCol } from "@/lib/expenses";
import { db, FieldValue, Timestamp } from "@/lib/firebase/admin";
import { log } from "@/lib/log";
import { party } from "@/lib/parties";
import { isDueSoon, toMs } from "@/lib/state/effective";
import { transition } from "@/lib/state/transition";
import type { ApprovalDoc, ExpenseDoc, FamilyDoc, ReminderKind, SettlementState, UserDoc } from "@/types/firestore";

// Daily job (POST /api/jobs/daily, GitHub Actions schedule). Safe to run twice or after a skipped
// day (CL-10): every email has a dedupe key and every reminder kind is sent at most once.
// 1. Persist expired approvals. 2. Approval reminder after 3 days. 3. Payment reminders for
// Family-plan families: due soon (3 days before), overdue on day 1, 8 and 15; max 4 per claim.

export const DAILY_EMAIL_CAP = 60;
const MAX_AUTOMATIC = 4;

export type DailySummary = { day: string; expiredApprovals: number; approvalReminders: number; paymentReminders: number; skippedForCap: number; payoutsChecked: number; errors: string[] };

/** Claims waiting on PayPal longer than this are re-synced (Section G.9). */
export const RECONCILE_AFTER_MS = 10 * 60_000;
const IN_FLIGHT: SettlementState[] = ["PAID", "PAYOUT_PROCESSING", "PAYOUT_UNCLAIMED"];

/** Which automatic payment reminder is due now, if any (pure). */
export function paymentReminderKind(settlement: Pick<ExpenseDoc["settlement"], "state" | "dueAt" | "reminders">, at: Date): Exclude<ReminderKind, "manual"> | null {
  if (!OVERDUE_STATES.includes(settlement.state) || !settlement.dueAt) return null;
  const sent = new Set((settlement.reminders ?? []).map((r) => r.kind));
  if ((settlement.reminders ?? []).filter((r) => r.kind !== "manual").length >= MAX_AUTOMATIC) return null;
  const due = settlement.dueAt.toMillis();
  const t = at.getTime();
  let kind: Exclude<ReminderKind, "manual"> | null = null;
  if (t > due) {
    const day = Math.floor((t - due) / DAY_MS) + 1;
    kind = day >= 15 ? "overdue_15" : day >= 8 ? "overdue_8" : "overdue_1";
  } else if (isDueSoon(settlement, at)) {
    kind = "due_soon";
  }
  // After a skipped day the latest applicable reminder is sent; an earlier one is never sent late.
  return kind && !sent.has(kind) ? kind : null;
}

export async function runDailyJob(meta: { requestId?: string } = {}): Promise<DailySummary> {
  const at = now();
  const day = at.toISOString().slice(0, 10);
  const runRef = db().collection("jobRuns").doc(day);
  const prior = (await runRef.get()).data() as { remindersSent?: number } | undefined;
  await runRef.set({ startedAt: Timestamp.fromDate(at), runs: FieldValue.increment(1) }, { merge: true });
  const summary: DailySummary = { day, expiredApprovals: 0, approvalReminders: 0, paymentReminders: 0, skippedForCap: 0, payoutsChecked: 0, errors: [] };
  let sentToday = prior?.remindersSent ?? 0;
  const fail = (step: string, id: string, err: unknown) => {
    summary.errors.push(`${step}:${id}`);
    log.error("job.daily.item_failed", { requestId: meta.requestId, step, id, error: err });
  };

  // 1. Expired approvals: the stored state catches up with the derived one (E.6.3).
  const expired = await expensesCol().where("approval.state", "==", "REQUESTED").where("approval.expiresAt", "<", Timestamp.fromDate(at)).limit(200).get();
  for (const d of expired.docs) {
    try {
      await transition({ expenseId: d.id, machine: "approval", event: "EXPIRE", actor: { kind: "system" }, requestId: meta.requestId });
      summary.expiredApprovals++;
    } catch (err) {
      fail("expire", d.id, err);
    }
  }

  // 2. Approval reminders (all plans), once, 3 days after the request.
  const reminderWindow = await approvalsCol()
    .where("requestedAt", "<=", Timestamp.fromMillis(at.getTime() - APPROVAL_REMINDER_AFTER_MS))
    .where("requestedAt", ">", Timestamp.fromMillis(at.getTime() - APPROVAL_TTL_MS))
    .limit(200)
    .get();
  for (const d of reminderWindow.docs) {
    const a = d.data() as ApprovalDoc & { cancelledAt?: unknown };
    if (a.decision || a.reminderSentAt || a.cancelledAt) continue;
    if (sentToday >= DAILY_EMAIL_CAP) {
      summary.skippedForCap++;
      continue;
    }
    try {
      if (await sendApprovalReminder(d.id, meta)) {
        summary.approvalReminders++;
        sentToday++;
      }
    } catch (err) {
      fail("approval_reminder", d.id, err);
    }
  }

  // 3. Payment reminders: Family plan only (A.6.5).
  const open = await expensesCol().where("settlement.state", "in", OVERDUE_STATES).where("settlement.dueAt", "<=", Timestamp.fromMillis(at.getTime() + 3 * DAY_MS)).limit(300).get();
  const entitled = new Map<string, boolean>();
  for (const d of open.docs) {
    const e = d.data() as ExpenseDoc;
    const kind = paymentReminderKind(e.settlement, at);
    if (!kind) continue;
    try {
      if (!entitled.has(e.familyId)) entitled.set(e.familyId, await familyEntitledFresh(e.familyId, meta.requestId));
      if (!entitled.get(e.familyId)) continue;
      if (!(await wantsReminders(e))) continue;
      if (sentToday >= DAILY_EMAIL_CAP) {
        summary.skippedForCap++;
        continue;
      }
      const family = (await db().collection("families").doc(e.familyId).get()).data() as FamilyDoc;
      const r = await issueReminder(d.id, { kind, actor: { kind: "system" }, createdBy: family.ownerUid, requestId: meta.requestId });
      if (r) {
        summary.paymentReminders++;
        sentToday++;
      }
    } catch (err) {
      fail("payment_reminder", d.id, err);
    }
  }

  // 4. Money in flight: missed webhooks, sandbox slowness, an unfunded platform (PY-11, PY-14).
  const inFlight = await expensesCol().where("settlement.state", "in", IN_FLIGHT).limit(200).get();
  for (const d of inFlight.docs) {
    const e = d.data() as ExpenseDoc;
    if (at.getTime() - (toMs(e.updatedAt) ?? 0) < RECONCILE_AFTER_MS) continue;
    try {
      await reconcileExpense(d.id, meta);
      summary.payoutsChecked++;
    } catch (err) {
      fail("reconcile", d.id, err);
    }
  }

  if (summary.skippedForCap > 0) log.warn("job.daily.email_cap_reached", { requestId: meta.requestId, skipped: summary.skippedForCap });
  await runRef.set(
    {
      finishedAt: Timestamp.fromDate(now()),
      remindersSent: FieldValue.increment(summary.approvalReminders + summary.paymentReminders),
      expiredApprovals: FieldValue.increment(summary.expiredApprovals),
      payoutsChecked: FieldValue.increment(summary.payoutsChecked),
      ...(summary.errors.length ? { errors: FieldValue.arrayUnion(...summary.errors) } : {}),
    },
    { merge: true },
  );
  log.info("job.daily.done", { requestId: meta.requestId, ...summary, errors: summary.errors.length });
  return summary;
}

/** notificationPrefs.reminders is respected for members; guests always get them (H.4). */
async function wantsReminders(e: ExpenseDoc): Promise<boolean> {
  const family = (await db().collection("families").doc(e.familyId).get()).data() as FamilyDoc;
  const payer = party(family, e.owedByRole);
  if (!payer.uid) return true;
  const u = (await db().collection("users").doc(payer.uid).get()).data() as UserDoc | undefined;
  return u?.notificationPrefs?.reminders !== false;
}
