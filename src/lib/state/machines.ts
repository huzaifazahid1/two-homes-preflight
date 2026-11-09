// Approval and settlement transition tables (Section E.6.1, E.6.2) as data.
// Pure: no Firestore, no clock. `transition()` is the only caller that writes the result.

import { AppError } from "@/lib/errors";
import type { ApprovalState, SettlementState, VerdictCode } from "@/types/firestore";
import { isBefore } from "./effective";

export type Machine = "approval" | "settlement";

export const APPROVAL_STATES: readonly ApprovalState[] = [
  "NOT_REQUIRED", "REQUIRED", "REQUESTED", "APPROVED", "PARTIALLY_APPROVED", "DECLINED", "EXPIRED", "CANCELLED",
];

export const SETTLEMENT_STATES: readonly SettlementState[] = [
  "NONE", "RECEIPT_SUBMITTED", "READY", "RECEIPT_ISSUE", "AWAITING_PAYMENT", "PAID", "PAYMENT_FAILED",
  "PAYOUT_PROCESSING", "SETTLED", "PAYOUT_UNCLAIMED", "PAYOUT_FAILED", "REFUNDED", "EXTERNAL_PAYMENT_REPORTED",
  "SETTLED_EXTERNALLY", "WAIVED", "DISPUTED", "UNRESOLVED", "CANCELLED",
];

export const SETTLEMENT_TERMINAL: ReadonlySet<SettlementState> = new Set(["SETTLED", "REFUNDED", "WAIVED", "UNRESOLVED", "CANCELLED"]);

export type ApprovalEvent =
  | "SEND_REQUEST"
  | "APPROVE"
  | "PARTIAL_APPROVE"
  | "DECLINE"
  | "EXPIRE"
  | "CANCEL"
  | "RESEND"
  | "AMOUNT_RAISED"
  | "VERDICT_REQUIRES_APPROVAL";

export type SettlementEvent =
  | "RECEIPT_UPLOADED"
  | "MATCH_OK"
  | "MATCH_ISSUES"
  | "ISSUE_RESOLVED"
  | "SEND_PAYMENT_REQUEST"
  | "CAPTURE_COMPLETED"
  | "CAPTURE_FAILED"
  | "RETRY_PAYMENT"
  | "PAYOUT_CREATED"
  | "PAYOUT_SUCCESS"
  | "PAYOUT_UNCLAIMED"
  | "PAYOUT_FAILED"
  | "RETRY_PAYOUT"
  | "REFUND_PAYER"
  | "REPORT_EXTERNAL_PAYMENT"
  | "CONFIRM_EXTERNAL"
  | "REJECT_EXTERNAL"
  | "MARK_RECEIVED"
  | "WAIVE"
  | "DISPUTE"
  | "DISPUTE_AGREED"
  | "DISPUTE_UNRESOLVED"
  | "CANCEL_EXPENSE";

export type MachineEvent<M extends Machine> = M extends "approval" ? ApprovalEvent : SettlementEvent;
export type MachineState<M extends Machine> = M extends "approval" ? ApprovalState : SettlementState;

/** What a guard and an effect can see. Facts that need queries are loaded by the caller inside the transaction. */
export type TransitionInput = {
  now: Date;
  expense: {
    amountCents: number;
    verdictCode: VerdictCode;
    approval: { state: ApprovalState; approvedCents?: number; blockedUntil?: unknown; expiresAt?: unknown };
    settlement: { state: SettlementState; owedCents?: number; contestUntil?: unknown };
  };
  payload: TransitionPayload;
  facts: TransitionFacts;
};

export type TransitionPayload = {
  requestId?: string;
  expiresAt?: Date;
  approvedCents?: number;
  newAmountCents?: number;
  reason?: string;
  owedCents?: number;
  dueAt?: Date;
  externalReport?: { by: "owner" | "coparent"; method: string; date: Date; note?: string };
  revisedOwedCents?: number;
  /** Extra timeline data for the events row (e.g. receipt match issues). Not used by guards. */
  extra?: Record<string, string | number | boolean | string[]>;
};

export type TransitionFacts = {
  /** Approval requests created by this family in the last 24 hours. */
  dailyRequestCount?: number;
  /** Family entitled to the Family plan (effective.isEntitled). */
  entitled?: boolean;
  /** A payout already exists for this claim. */
  payoutExists?: boolean;
  /** Dispute rounds recorded so far. */
  disputeRounds?: number;
};

export const DAILY_REQUEST_CAP = 5;
export const DECLINE_BLOCK_DAYS = 7;
export const CONTEST_DAYS = 7;
const DAY = 86_400_000;

type Guard = (input: TransitionInput) => AppError | null;
/** Field patch for the machine's sub-object (approval.* or settlement.*). Dates become Timestamps on write. */
export type Patch = Record<string, unknown>;
type Effect = (input: TransitionInput) => Patch;

export type Row<M extends Machine> = {
  from: readonly MachineState<M>[];
  event: MachineEvent<M>;
  to: MachineState<M>;
  guard?: Guard;
  effect?: Effect;
};

// ---------- Guards ----------

const BLOCKING_VERDICTS: ReadonlySet<VerdictCode> = new Set(["NOT_COVERED", "NEEDS_REVIEW"]);

const verdictAllowsAction: Guard = ({ expense }) =>
  BLOCKING_VERDICTS.has(expense.verdictCode)
    ? new AppError("STATE_CONFLICT", "This expense needs review or is not covered, so it cannot be sent yet.")
    : null;

const withinDailyCap: Guard = ({ facts }) =>
  (facts.dailyRequestCount ?? 0) >= DAILY_REQUEST_CAP
    ? new AppError("RATE_LIMITED", "Your family has sent the maximum of 5 approval requests today.", { retryAfterSeconds: 3600 })
    : null;

const notInDeclineBlock: Guard = ({ expense, now }) =>
  isBefore(now, expense.approval.blockedUntil as never)
    ? new AppError("STATE_CONFLICT", "This expense was declined. A new request is possible 7 days after the decline.")
    : null;

const requestedApprovalOk: Guard = (input) =>
  verdictAllowsAction(input) ?? withinDailyCap(input) ?? notInDeclineBlock(input) ?? requireRequestPayload(input);

const requireRequestPayload: Guard = ({ payload }) =>
  !payload.requestId || !payload.expiresAt ? new AppError("INVALID", "Missing request id or expiry.") : null;

const partialAmountOk: Guard = ({ payload, expense }) => {
  const a = payload.approvedCents;
  return typeof a === "number" && Number.isSafeInteger(a) && a > 0 && a < expense.amountCents
    ? null
    : new AppError("INVALID", "A partial approval must be more than $0 and less than the full amount.");
};

const amountRaisedAboveApproved: Guard = ({ payload, expense }) => {
  const n = payload.newAmountCents;
  const approved = expense.approval.approvedCents ?? expense.amountCents;
  return typeof n === "number" && n > approved ? null : new AppError("STATE_CONFLICT", "The amount is not above the approved amount.");
};

const PRE_PAYMENT_REQUEST: ReadonlySet<SettlementState> = new Set(["NONE", "RECEIPT_SUBMITTED", "READY", "RECEIPT_ISSUE"]);

const beforePaymentRequest: Guard = ({ expense }) =>
  PRE_PAYMENT_REQUEST.has(expense.settlement.state)
    ? null
    : new AppError("STATE_CONFLICT", "A payment request was already sent for this expense.");

const APPROVAL_OK_FOR_CLAIM: ReadonlySet<ApprovalState> = new Set(["NOT_REQUIRED", "APPROVED", "PARTIALLY_APPROVED"]);

const claimAllowed: Guard = (input) => {
  if (!APPROVAL_OK_FOR_CLAIM.has(input.expense.approval.state)) {
    return new AppError("STATE_CONFLICT", "The expense needs approval before a payment request can be sent.");
  }
  const blocked = verdictAllowsAction(input);
  if (blocked) return blocked;
  const { owedCents, dueAt } = input.payload;
  if (typeof owedCents !== "number" || !Number.isSafeInteger(owedCents) || owedCents <= 0 || !(dueAt instanceof Date)) {
    return new AppError("INVALID", "A payment request needs a positive owed amount and a due date.");
  }
  return null;
};

const entitled: Guard = ({ facts }) =>
  facts.entitled ? null : new AppError("PLAN_REQUIRED", "In-app settlement needs the Family plan.");

const noPayoutYet: Guard = ({ facts }) =>
  facts.payoutExists ? new AppError("DUPLICATE", "A payout already exists for this claim.") : null;

const reasonRequired: Guard = ({ payload }) =>
  payload.reason && payload.reason.trim().length > 0 ? null : new AppError("INVALID", "A reason is required.");

const externalReportRequired: Guard = ({ payload }) =>
  payload.externalReport?.method ? null : new AppError("INVALID", "Say how and when it was paid.");

const disputeWindowOpen: Guard = ({ expense, now }) => {
  if (expense.settlement.state !== "SETTLED_EXTERNALLY") return null;
  return isBefore(now, expense.settlement.contestUntil as never)
    ? null
    : new AppError("STATE_CONFLICT", "The 7-day window to contest this has passed.");
};

const twoRoundsReached: Guard = ({ facts }) =>
  (facts.disputeRounds ?? 0) >= 2 ? null : new AppError("STATE_CONFLICT", "The dispute has not had 2 rounds yet.");

const revisedOwedOk: Guard = ({ payload, expense }) => {
  const r = payload.revisedOwedCents;
  if (r === undefined) return null;
  const max = expense.settlement.owedCents ?? Number.MAX_SAFE_INTEGER;
  return Number.isSafeInteger(r) && r > 0 && r <= max ? null : new AppError("INVALID", "The agreed amount must be positive and not above the original claim.");
};

// ---------- Tables ----------

export const APPROVAL_TABLE: readonly Row<"approval">[] = [
  {
    from: ["REQUIRED"], event: "SEND_REQUEST", to: "REQUESTED", guard: requestedApprovalOk,
    effect: ({ payload }) => ({ currentRequestId: payload.requestId, expiresAt: payload.expiresAt, approvedCents: null, decidedAt: null, reason: null }),
  },
  {
    from: ["REQUESTED"], event: "APPROVE", to: "APPROVED",
    effect: ({ now, expense }) => ({ approvedCents: expense.amountCents, decidedAt: now }),
  },
  {
    from: ["REQUESTED"], event: "PARTIAL_APPROVE", to: "PARTIALLY_APPROVED", guard: partialAmountOk,
    effect: ({ now, payload }) => ({ approvedCents: payload.approvedCents, decidedAt: now, reason: payload.reason ?? null }),
  },
  {
    from: ["REQUESTED"], event: "DECLINE", to: "DECLINED",
    effect: ({ now, payload }) => ({ decidedAt: now, reason: payload.reason ?? null, blockedUntil: new Date(now.getTime() + DECLINE_BLOCK_DAYS * DAY) }),
  },
  { from: ["REQUESTED"], event: "EXPIRE", to: "EXPIRED" },
  { from: ["REQUESTED"], event: "CANCEL", to: "CANCELLED" },
  {
    from: ["EXPIRED", "DECLINED"], event: "RESEND", to: "REQUESTED", guard: requestedApprovalOk,
    effect: ({ payload }) => ({ currentRequestId: payload.requestId, expiresAt: payload.expiresAt, approvedCents: null, decidedAt: null, reason: null }),
  },
  {
    from: ["APPROVED", "PARTIALLY_APPROVED"], event: "AMOUNT_RAISED", to: "REQUIRED", guard: amountRaisedAboveApproved,
  },
  { from: ["NOT_REQUIRED"], event: "VERDICT_REQUIRES_APPROVAL", to: "REQUIRED", guard: beforePaymentRequest },
];

const BEFORE_PAID: readonly SettlementState[] = ["NONE", "RECEIPT_SUBMITTED", "RECEIPT_ISSUE", "READY", "AWAITING_PAYMENT", "PAYMENT_FAILED"];

export const SETTLEMENT_TABLE: readonly Row<"settlement">[] = [
  { from: ["NONE"], event: "RECEIPT_UPLOADED", to: "RECEIPT_SUBMITTED" },
  { from: ["RECEIPT_SUBMITTED"], event: "MATCH_OK", to: "READY" },
  { from: ["RECEIPT_SUBMITTED"], event: "MATCH_ISSUES", to: "RECEIPT_ISSUE" },
  { from: ["RECEIPT_ISSUE"], event: "ISSUE_RESOLVED", to: "READY" },
  {
    from: ["READY"], event: "SEND_PAYMENT_REQUEST", to: "AWAITING_PAYMENT", guard: claimAllowed,
    effect: ({ now, payload }) => ({ owedCents: payload.owedCents, dueAt: payload.dueAt, requestSentAt: now }),
  },
  { from: ["AWAITING_PAYMENT"], event: "CAPTURE_COMPLETED", to: "PAID", guard: entitled },
  { from: ["AWAITING_PAYMENT"], event: "CAPTURE_FAILED", to: "PAYMENT_FAILED" },
  { from: ["PAYMENT_FAILED"], event: "RETRY_PAYMENT", to: "AWAITING_PAYMENT" },
  { from: ["PAID"], event: "PAYOUT_CREATED", to: "PAYOUT_PROCESSING", guard: noPayoutYet },
  { from: ["PAYOUT_PROCESSING"], event: "PAYOUT_SUCCESS", to: "SETTLED", effect: ({ now }) => ({ settledAt: now }) },
  { from: ["PAYOUT_PROCESSING"], event: "PAYOUT_UNCLAIMED", to: "PAYOUT_UNCLAIMED" },
  { from: ["PAYOUT_PROCESSING", "PAYOUT_UNCLAIMED"], event: "PAYOUT_FAILED", to: "PAYOUT_FAILED" },
  { from: ["PAYOUT_UNCLAIMED"], event: "PAYOUT_SUCCESS", to: "SETTLED", effect: ({ now }) => ({ settledAt: now }) },
  { from: ["PAYOUT_FAILED"], event: "RETRY_PAYOUT", to: "PAYOUT_PROCESSING" },
  { from: ["PAYOUT_FAILED"], event: "REFUND_PAYER", to: "REFUNDED" },
  {
    from: ["AWAITING_PAYMENT"], event: "REPORT_EXTERNAL_PAYMENT", to: "EXTERNAL_PAYMENT_REPORTED", guard: externalReportRequired,
    effect: ({ now, payload }) => ({ externalReport: { ...payload.externalReport, at: now } }),
  },
  {
    from: ["EXTERNAL_PAYMENT_REPORTED"], event: "CONFIRM_EXTERNAL", to: "SETTLED_EXTERNALLY",
    effect: ({ now }) => ({ settledAt: now, contestUntil: new Date(now.getTime() + CONTEST_DAYS * DAY) }),
  },
  { from: ["EXTERNAL_PAYMENT_REPORTED"], event: "REJECT_EXTERNAL", to: "AWAITING_PAYMENT" },
  {
    from: ["AWAITING_PAYMENT", "PAYMENT_FAILED"], event: "MARK_RECEIVED", to: "SETTLED_EXTERNALLY",
    effect: ({ now }) => ({ settledAt: now, contestUntil: new Date(now.getTime() + CONTEST_DAYS * DAY) }),
  },
  {
    from: ["AWAITING_PAYMENT", "PAYMENT_FAILED"], event: "WAIVE", to: "WAIVED", guard: reasonRequired,
    effect: ({ now, payload }) => ({ waiver: { reason: payload.reason?.trim(), at: now } }),
  },
  { from: ["READY", "AWAITING_PAYMENT", "SETTLED_EXTERNALLY"], event: "DISPUTE", to: "DISPUTED", guard: disputeWindowOpen },
  {
    from: ["DISPUTED"], event: "DISPUTE_AGREED", to: "AWAITING_PAYMENT", guard: revisedOwedOk,
    effect: ({ payload }) => (payload.revisedOwedCents !== undefined ? { owedCents: payload.revisedOwedCents } : {}),
  },
  { from: ["DISPUTED"], event: "DISPUTE_UNRESOLVED", to: "UNRESOLVED", guard: twoRoundsReached },
  { from: BEFORE_PAID, event: "CANCEL_EXPENSE", to: "CANCELLED" },
];

/**
 * States in which an event counts as "already happened" (recorded as noop, not applied twice).
 * Default: the row's own target state. Events that external systems can replay late (webhooks,
 * capture responses) also list the states that come after their target.
 */
const ALREADY_APPLIED_IN: Partial<Record<SettlementEvent, readonly SettlementState[]>> = {
  CAPTURE_COMPLETED: ["PAID", "PAYOUT_PROCESSING", "PAYOUT_UNCLAIMED", "PAYOUT_FAILED", "SETTLED", "REFUNDED"],
  PAYOUT_CREATED: ["PAYOUT_PROCESSING", "PAYOUT_UNCLAIMED", "PAYOUT_FAILED", "SETTLED", "REFUNDED"],
  PAYOUT_SUCCESS: ["SETTLED"],
  PAYOUT_UNCLAIMED: ["PAYOUT_UNCLAIMED", "SETTLED"],
  PAYOUT_FAILED: ["PAYOUT_FAILED", "REFUNDED"],
};

export function tableFor<M extends Machine>(machine: M): readonly Row<M>[] {
  return (machine === "approval" ? APPROVAL_TABLE : SETTLEMENT_TABLE) as readonly Row<M>[];
}

export type Decision<M extends Machine> =
  | { kind: "apply"; row: Row<M>; from: MachineState<M>; to: MachineState<M>; patch: Patch }
  | { kind: "noop"; from: MachineState<M> };

/**
 * Looks up the row for (state, event), checks the guard and computes the patch.
 * Throws AppError: STATE_CONFLICT (409) for disallowed pairs, or the guard's error.
 */
export function decide<M extends Machine>(machine: M, state: MachineState<M>, event: MachineEvent<M>, input: TransitionInput): Decision<M> {
  const rows = tableFor(machine);
  const row = rows.find((r) => r.event === event && (r.from as readonly string[]).includes(state));
  if (!row) {
    const applied =
      machine === "settlement" && ALREADY_APPLIED_IN[event as SettlementEvent]
        ? (ALREADY_APPLIED_IN[event as SettlementEvent] as readonly string[]).includes(state)
        : rows.some((r) => r.event === event && r.to === state);
    if (applied) return { kind: "noop", from: state };
    throw new AppError("STATE_CONFLICT", `This action is not possible right now (${machine} is ${state}).`, {
      details: { machine, state, event },
    });
  }
  const failure = row.guard?.(input);
  if (failure) throw failure;
  return { kind: "apply", row, from: state, to: row.to, patch: row.effect?.(input) ?? {} };
}

/** Initial approval state from the first verdict (E.6.1 "(new)" rows). */
export function initialApprovalState(verdict: VerdictCode): ApprovalState {
  return verdict === "NEEDS_APPROVAL" || verdict === "LATE" ? "REQUIRED" : "NOT_REQUIRED";
}

export function allEvents<M extends Machine>(machine: M): MachineEvent<M>[] {
  return [...new Set(tableFor(machine).map((r) => r.event))] as MachineEvent<M>[];
}

export function allStates<M extends Machine>(machine: M): MachineState<M>[] {
  return (machine === "approval" ? [...APPROVAL_STATES] : [...SETTLEMENT_STATES]) as MachineState<M>[];
}
