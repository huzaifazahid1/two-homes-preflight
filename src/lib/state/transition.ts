import "server-only";
import type { DocumentReference, Transaction } from "firebase-admin/firestore";
import { auditInTx } from "@/lib/audit";
import { now as clockNow } from "@/lib/clock";
import { AppError } from "@/lib/errors";
import { db, FieldValue, Timestamp } from "@/lib/firebase/admin";
import { log } from "@/lib/log";
import { filterNewNotifications, writeNotifications, type NotificationInput } from "@/lib/notifications";
import type { Actor, ExpenseDoc } from "@/types/firestore";
import { effectiveApprovalState } from "./effective";
import { decide, type Machine, type MachineEvent, type MachineState, type Patch, type TransitionFacts, type TransitionPayload } from "./machines";

// The only writer of approval.state and settlement.state (Section E.6.4, CLAUDE.md rule 7).
// One Firestore transaction: read the expense, apply time-derived rules, look up the table row,
// check the guard, write the new state with version + 1, append one events row, write the audit
// log and create notification docs. Emails are sent by the caller after commit.

export type TransitionResult<M extends Machine> = {
  outcome: "applied" | "noop";
  from: MachineState<M>;
  to: MachineState<M>;
  version: number;
  /** Dedupe keys of notifications created in this transaction (send their emails after commit). */
  notifications: NotificationInput[];
};

export type TransitionArgs<M extends Machine> = {
  expenseId: string;
  machine: M;
  event: MachineEvent<M>;
  actor: Actor;
  payload?: TransitionPayload;
  requestId?: string;
  ip?: string | null;
  userAgent?: string | null;
  /** Reads inside the transaction for guard facts (daily cap, entitlement, payout exists). Reads only. */
  loadFacts?: (tx: Transaction, expense: ExpenseDoc) => Promise<TransitionFacts>;
  /** Notifications to create when the transition applies. Deduped by doc id. */
  notify?: (ctx: { expense: ExpenseDoc; from: MachineState<M>; to: MachineState<M>; version: number }) => NotificationInput[];
  /** Extra writes in the same transaction when it applies (e.g. revoke a token). Writes only. */
  extraWrites?: (tx: Transaction, ctx: { expense: ExpenseDoc; expenseRef: DocumentReference; to: MachineState<M>; version: number }) => void;
};

function toFirestore(value: unknown): unknown {
  if (value === null) return FieldValue.delete();
  if (value instanceof Date) return Timestamp.fromDate(value);
  if (Array.isArray(value)) return value.map(toFirestoreNested);
  if (value && typeof value === "object" && !(value instanceof Timestamp)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toFirestoreNested(v)]));
  }
  return value;
}

// Inside nested objects a null means "absent" too, but FieldValue.delete() is only valid at the top level.
function toFirestoreNested(value: unknown): unknown {
  if (value instanceof Date) return Timestamp.fromDate(value);
  if (value === null) return undefined;
  if (Array.isArray(value)) return value.map(toFirestoreNested);
  if (value && typeof value === "object" && !(value instanceof Timestamp)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toFirestoreNested(v)]));
  }
  return value;
}

function flattenPatch(machine: Machine, patch: Patch): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    out[`${machine}.${k}`] = toFirestore(v);
  }
  return out;
}

function eventData(event: string, payload: TransitionPayload): Record<string, unknown> {
  const data: Record<string, unknown> = { event };
  if (payload.approvedCents !== undefined) data.approvedCents = payload.approvedCents;
  if (payload.newAmountCents !== undefined) data.newAmountCents = payload.newAmountCents;
  if (payload.owedCents !== undefined) data.owedCents = payload.owedCents;
  if (payload.revisedOwedCents !== undefined) data.revisedOwedCents = payload.revisedOwedCents;
  if (payload.reason) data.reason = payload.reason.slice(0, 500);
  if (payload.dueAt) data.dueAt = Timestamp.fromDate(payload.dueAt);
  if (payload.requestId) data.requestId = payload.requestId;
  return data;
}

export async function transition<M extends Machine>(args: TransitionArgs<M>): Promise<TransitionResult<M>> {
  const { expenseId, machine, event, actor } = args;
  const payload = args.payload ?? {};
  const expenseRef = db().collection("expenses").doc(expenseId);
  const eventsCol = expenseRef.collection("events");

  const result = await db().runTransaction(async (tx) => {
    // ---- Read phase ----
    const snap = await tx.get(expenseRef);
    if (!snap.exists) throw new AppError("NOT_FOUND", "Expense not found.");
    const expense = snap.data() as ExpenseDoc;
    const now = clockNow();
    const nowTs = Timestamp.fromDate(now);

    // Time-derived approval expiry (E.6.3): the next write persists it.
    const storedApproval = expense.approval.state;
    const effectiveApproval = effectiveApprovalState(expense.approval, now);
    const persistExpiry = storedApproval !== effectiveApproval;
    // The expiry row carries the time it actually expired, so the timeline orders it before this write.
    const expiredAt = persistExpiry ? (expense.approval.expiresAt as Timestamp) : nowTs;

    const facts = (await args.loadFacts?.(tx, expense)) ?? {};
    const currentState = (machine === "approval" ? effectiveApproval : expense.settlement.state) as MachineState<M>;

    const decision = decide(machine, currentState, event, {
      now,
      payload,
      facts,
      expense: {
        amountCents: expense.amountCents,
        verdictCode: expense.verdict.code,
        approval: { ...expense.approval, state: effectiveApproval },
        settlement: expense.settlement,
      },
    });

    let version = expense.version;
    const actorForEvent = { kind: actor.kind, uid: actor.uid };

    if (decision.kind === "noop") {
      // Already happened: record it once in the timeline as noop data, apply nothing.
      if (persistExpiry) {
        version += 1;
        tx.update(expenseRef, { "approval.state": "EXPIRED", version, updatedAt: nowTs });
        tx.create(eventsCol.doc(), {
          type: `approval.${storedApproval}->EXPIRED`, machine: "approval", from: storedApproval, to: "EXPIRED",
          actor: { kind: "system" }, data: { event: "EXPIRE", derived: true }, at: expiredAt,
        });
      }
      tx.create(eventsCol.doc(), {
        type: `${machine}.${String(event)}.noop`, machine: "note", from: currentState, to: currentState,
        actor: actorForEvent, data: { ...eventData(String(event), payload), noop: true }, at: nowTs,
      });
      return { outcome: "noop" as const, from: currentState, to: currentState, version, notifications: [] };
    }

    const nextVersion = version + (persistExpiry ? 2 : 1);
    const candidates = args.notify?.({ expense, from: decision.from, to: decision.to, version: nextVersion }) ?? [];
    const newNotifications = await filterNewNotifications(tx, candidates);

    // ---- Write phase ----
    const updates: Record<string, unknown> = {};
    if (persistExpiry) {
      updates["approval.state"] = "EXPIRED";
      tx.create(eventsCol.doc(), {
        type: `approval.${storedApproval}->EXPIRED`, machine: "approval", from: storedApproval, to: "EXPIRED",
        actor: { kind: "system" }, data: { event: "EXPIRE", derived: true }, at: expiredAt,
      });
    }
    Object.assign(updates, flattenPatch(machine, decision.patch));
    updates[`${machine}.state`] = decision.to;
    updates.version = nextVersion;
    updates.updatedAt = nowTs;
    tx.update(expenseRef, updates);

    tx.create(eventsCol.doc(), {
      type: `${machine}.${decision.from}->${decision.to}`, machine, from: decision.from, to: decision.to,
      actor: actorForEvent, data: eventData(String(event), payload), at: nowTs,
    });

    auditInTx(tx, {
      familyId: expense.familyId,
      actor,
      action: `${machine}.${String(event)}`,
      target: `expenses/${expenseId}`,
      ip: args.ip,
      userAgent: args.userAgent,
    });

    args.extraWrites?.(tx, { expense, expenseRef, to: decision.to, version: nextVersion });
    writeNotifications(tx, newNotifications);

    return { outcome: "applied" as const, from: decision.from, to: decision.to, version: nextVersion, notifications: newNotifications };
  });

  log.info("state.transition", {
    requestId: args.requestId, machine, event: String(event), from: result.from, to: result.to, outcome: result.outcome,
  });
  return result;
}
