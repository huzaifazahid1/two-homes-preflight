import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import {
  allEvents,
  allStates,
  APPROVAL_TABLE,
  decide,
  initialApprovalState,
  SETTLEMENT_TABLE,
  type Machine,
  type MachineEvent,
  type MachineState,
  type TransitionInput,
} from "@/lib/state/machines";

const NOW = new Date("2026-11-10T12:00:00Z");
const DAY = 86_400_000;

// An input that satisfies every guard, so each allowed row can be exercised on its own.
function okInput(overrides: Partial<TransitionInput> = {}): TransitionInput {
  return {
    now: NOW,
    expense: {
      amountCents: 35_000,
      verdictCode: "NEEDS_APPROVAL",
      approval: { state: "APPROVED", approvedCents: 30_000 },
      settlement: { state: "READY", owedCents: 17_500, contestUntil: new Date(NOW.getTime() + DAY) },
    },
    payload: {
      requestId: "req1",
      expiresAt: new Date(NOW.getTime() + 14 * DAY),
      approvedCents: 20_000,
      newAmountCents: 40_000,
      reason: "Too expensive",
      owedCents: 17_500,
      dueAt: new Date(NOW.getTime() + 30 * DAY),
      externalReport: { by: "coparent", method: "Bank transfer", date: NOW },
      revisedOwedCents: 10_000,
    },
    facts: { dailyRequestCount: 0, entitled: true, payoutExists: false, disputeRounds: 2 },
    ...overrides,
  };
}

function inputFor(machine: Machine, state: string): TransitionInput {
  const base = okInput();
  if (machine === "approval") {
    base.expense.approval = { ...base.expense.approval, state: state as never };
    // DECLINE_BLOCK guard: no block in the default fixture.
  } else {
    base.expense.settlement = { ...base.expense.settlement, state: state as never };
  }
  return base;
}

function noopFor(machine: Machine, state: string, event: string): boolean {
  try {
    return decide(machine as never, state as never, event as never, inputFor(machine, state)).kind === "noop";
  } catch {
    return false;
  }
}

describe.each([
  ["approval", APPROVAL_TABLE],
  ["settlement", SETTLEMENT_TABLE],
] as const)("%s machine", (machine, table) => {
  // 100% of transition rows (Section N.1).
  for (const row of table) {
    for (const from of row.from) {
      it(`${from} --${row.event}--> ${row.to}`, () => {
        const d = decide(machine as never, from as never, row.event as never, inputFor(machine, from));
        expect(d.kind).toBe("apply");
        if (d.kind === "apply") expect(d.to).toBe(row.to);
      });
    }
  }

  // Every disallowed (state, event) pair returns 409 STATE_CONFLICT, except recorded no-ops.
  it("rejects every disallowed pair with 409 STATE_CONFLICT", () => {
    const states = allStates(machine) as MachineState<typeof machine>[];
    const events = allEvents(machine) as MachineEvent<typeof machine>[];
    let checked = 0;
    for (const state of states) {
      for (const event of events) {
        const allowed = table.some((r) => r.event === event && (r.from as readonly string[]).includes(state));
        if (allowed || noopFor(machine, state, event)) continue;
        checked++;
        try {
          decide(machine as never, state as never, event as never, inputFor(machine, state));
          throw new Error(`expected 409 for ${state} + ${event}`);
        } catch (e) {
          expect(e).toBeInstanceOf(AppError);
          expect((e as AppError).status).toBe(409);
          expect((e as AppError).code).toBe("STATE_CONFLICT");
        }
      }
    }
    expect(checked).toBeGreaterThan(20);
  });
});

describe("no-ops (event already applied)", () => {
  it("approve twice is a noop, not a second decision", () => {
    expect(decide("approval", "APPROVED", "APPROVE", okInput()).kind).toBe("noop");
  });
  it("first decision is final: approve after decline is 409", () => {
    expect(() => decide("approval", "DECLINED", "APPROVE", okInput())).toThrowError(/not possible/);
  });
  it("a late capture webhook after payout started is a noop", () => {
    for (const s of ["PAID", "PAYOUT_PROCESSING", "SETTLED"] as const) {
      expect(decide("settlement", s, "CAPTURE_COMPLETED", okInput()).kind).toBe("noop");
    }
  });
  it("payout success twice is a noop", () => {
    expect(decide("settlement", "SETTLED", "PAYOUT_SUCCESS", okInput()).kind).toBe("noop");
  });
});

describe("guards", () => {
  it("SEND_REQUEST is blocked at the daily cap of 5 (429)", () => {
    const input = okInput({ facts: { dailyRequestCount: 5 } });
    expect(() => decide("approval", "REQUIRED", "SEND_REQUEST", input)).toThrowError(expect.objectContaining({ status: 429 }));
  });

  it("RESEND after decline is blocked for 7 days, allowed after", () => {
    const declined = decide("approval", "REQUESTED", "DECLINE", okInput());
    if (declined.kind !== "apply") throw new Error("expected apply");
    const blockedUntil = declined.patch.blockedUntil as Date;
    expect(blockedUntil.getTime()).toBe(NOW.getTime() + 7 * DAY);

    const inside = okInput();
    inside.expense.approval = { state: "DECLINED", blockedUntil };
    inside.now = new Date(NOW.getTime() + 6 * DAY);
    expect(() => decide("approval", "DECLINED", "RESEND", inside)).toThrowError(expect.objectContaining({ status: 409 }));

    const after = okInput();
    after.expense.approval = { state: "DECLINED", blockedUntil };
    after.now = new Date(NOW.getTime() + 7 * DAY + 1);
    expect(decide("approval", "DECLINED", "RESEND", after).kind).toBe("apply");
  });

  it("SEND_REQUEST is blocked when the verdict is NOT_COVERED or NEEDS_REVIEW", () => {
    for (const v of ["NOT_COVERED", "NEEDS_REVIEW"] as const) {
      const input = okInput();
      input.expense.verdictCode = v;
      expect(() => decide("approval", "REQUIRED", "SEND_REQUEST", input)).toThrowError(expect.objectContaining({ status: 409 }));
    }
  });

  it("partial approval must be strictly between 0 and the amount", () => {
    for (const bad of [0, 35_000, 40_000, -1, 1.5]) {
      const input = okInput();
      input.payload.approvedCents = bad;
      expect(() => decide("approval", "REQUESTED", "PARTIAL_APPROVE", input)).toThrowError(expect.objectContaining({ status: 400 }));
    }
  });

  it("raising the amount above approvedCents sends approval back to REQUIRED; not raising is refused", () => {
    expect(decide("approval", "APPROVED", "AMOUNT_RAISED", okInput()).kind).toBe("apply");
    const input = okInput();
    input.payload.newAmountCents = 30_000;
    expect(() => decide("approval", "APPROVED", "AMOUNT_RAISED", input)).toThrowError(expect.objectContaining({ status: 409 }));
  });

  it("NOT_REQUIRED -> REQUIRED only before a payment request", () => {
    const input = okInput();
    input.expense.settlement.state = "AWAITING_PAYMENT";
    expect(() => decide("approval", "NOT_REQUIRED", "VERDICT_REQUIRES_APPROVAL", input)).toThrowError(expect.objectContaining({ status: 409 }));
  });

  it("payment request needs approval NOT_REQUIRED/APPROVED/PARTIALLY_APPROVED (invariant 1)", () => {
    for (const a of ["REQUIRED", "REQUESTED", "DECLINED", "EXPIRED", "CANCELLED"] as const) {
      const input = okInput();
      input.expense.approval.state = a;
      expect(() => decide("settlement", "READY", "SEND_PAYMENT_REQUEST", input)).toThrowError(expect.objectContaining({ status: 409 }));
    }
  });

  it("payment request sets dueAt and owedCents", () => {
    const d = decide("settlement", "READY", "SEND_PAYMENT_REQUEST", okInput());
    if (d.kind !== "apply") throw new Error("expected apply");
    expect(d.patch.owedCents).toBe(17_500);
    expect(d.patch.dueAt).toEqual(new Date(NOW.getTime() + 30 * DAY));
    expect(d.patch.requestSentAt).toEqual(NOW);
  });

  it("capture needs an entitled family (402)", () => {
    expect(() => decide("settlement", "AWAITING_PAYMENT", "CAPTURE_COMPLETED", okInput({ facts: { entitled: false } }))).toThrowError(
      expect.objectContaining({ status: 402 }),
    );
  });

  it("one payout per claim", () => {
    expect(() => decide("settlement", "PAID", "PAYOUT_CREATED", okInput({ facts: { payoutExists: true } }))).toThrowError(
      expect.objectContaining({ status: 409, code: "DUPLICATE" }),
    );
  });

  it("waive needs a reason", () => {
    const input = okInput();
    input.payload.reason = "   ";
    expect(() => decide("settlement", "AWAITING_PAYMENT", "WAIVE", input)).toThrowError(expect.objectContaining({ status: 400 }));
  });

  it("mark received sets a 7-day contest window; dispute after it closes is refused", () => {
    const d = decide("settlement", "AWAITING_PAYMENT", "MARK_RECEIVED", okInput());
    if (d.kind !== "apply") throw new Error("expected apply");
    expect((d.patch.contestUntil as Date).getTime()).toBe(NOW.getTime() + 7 * DAY);

    const late = okInput();
    late.expense.settlement = { state: "SETTLED_EXTERNALLY", contestUntil: new Date(NOW.getTime() - 1) };
    expect(() => decide("settlement", "SETTLED_EXTERNALLY", "DISPUTE", late)).toThrowError(expect.objectContaining({ status: 409 }));
  });

  it("unresolved only after 2 rounds", () => {
    expect(() => decide("settlement", "DISPUTED", "DISPUTE_UNRESOLVED", okInput({ facts: { disputeRounds: 1 } }))).toThrowError(
      expect.objectContaining({ status: 409 }),
    );
  });

  it("cannot cancel the expense once paid", () => {
    for (const s of ["PAID", "PAYOUT_PROCESSING", "SETTLED"] as const) {
      expect(() => decide("settlement", s, "CANCEL_EXPENSE", okInput())).toThrowError(expect.objectContaining({ status: 409 }));
    }
  });
});

describe("initial approval state", () => {
  it("maps verdicts per E.6.1", () => {
    expect(initialApprovalState("ELIGIBLE")).toBe("NOT_REQUIRED");
    expect(initialApprovalState("NEEDS_APPROVAL")).toBe("REQUIRED");
    expect(initialApprovalState("LATE")).toBe("REQUIRED");
  });
});
