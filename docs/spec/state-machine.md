# State machines and invariants

Part of the Two Homes Preflight spec. Source sections: E.6, E.7. Read `CLAUDE.md` first; it maps section letters to files.

## E.6 State model [Agreed]

Each expense has one **verdict** (snapshot) and two **state machines**: `approval` and `settlement`.

### E.6.1 Approval machine
| From | Event | To | Guard |
| --- | --- | --- | --- |
| (new) | verdict computed | `NOT_REQUIRED` | verdict `ELIGIBLE` |
| (new) | verdict computed | `REQUIRED` | verdict `NEEDS_APPROVAL` or `LATE` |
| `REQUIRED` | send request | `REQUESTED` | daily cap; not inside 7-day decline block |
| `REQUESTED` | approve | `APPROVED` | valid token + OTP session |
| `REQUESTED` | partial approve | `PARTIALLY_APPROVED` | 0 < `approvedCents` < amount |
| `REQUESTED` | decline | `DECLINED` | |
| `REQUESTED` | time passes | `EXPIRED` | derived (E.6.3) |
| `REQUESTED` | owner cancels | `CANCELLED` | token revoked in same transaction |
| `EXPIRED`, `DECLINED` | resend | `REQUESTED` | decline: only after 7 days |
| `APPROVED`, `PARTIALLY_APPROVED` | amount raised above `approvedCents` | `REQUIRED` | |
| `NOT_REQUIRED` | verdict recomputed to `NEEDS_APPROVAL`/`LATE` | `REQUIRED` | before any payment request |

Verdict `NOT_COVERED` or `NEEDS_REVIEW` keeps approval at its current state but blocks requests and claims.

### E.6.2 Settlement machine
| From | Event | To | Guard |
| --- | --- | --- | --- |
| `NONE` | receipt uploaded | `RECEIPT_SUBMITTED` | |
| `RECEIPT_SUBMITTED` | confirm + match OK | `READY` | |
| `RECEIPT_SUBMITTED` | match issues | `RECEIPT_ISSUE` | |
| `RECEIPT_ISSUE` | issue resolved (re-upload, new approval, user confirms duplicate is not one) | `READY` | |
| `READY` | send payment request | `AWAITING_PAYMENT` | approval in (`NOT_REQUIRED`,`APPROVED`,`PARTIALLY_APPROVED`); verdict not `NOT_COVERED`/`NEEDS_REVIEW`; sets `dueAt`, `owedCents` |
| `AWAITING_PAYMENT` | capture COMPLETED | `PAID` | family entitled |
| `AWAITING_PAYMENT` | capture failed/declined | `PAYMENT_FAILED` | |
| `PAYMENT_FAILED` | retry | `AWAITING_PAYMENT` | |
| `PAID` | payout created | `PAYOUT_PROCESSING` | one payout per claim |
| `PAYOUT_PROCESSING` | payout SUCCESS | `SETTLED` | terminal |
| `PAYOUT_PROCESSING` | payout UNCLAIMED | `PAYOUT_UNCLAIMED` | |
| `PAYOUT_PROCESSING`, `PAYOUT_UNCLAIMED` | payout FAILED / RETURNED / BLOCKED / DENIED | `PAYOUT_FAILED` | |
| `PAYOUT_UNCLAIMED` | claimed (SUCCESS) | `SETTLED` | |
| `PAYOUT_FAILED` | retry after receiver fixes PayPal connection | `PAYOUT_PROCESSING` | new attempt |
| `PAYOUT_FAILED` | refund payer | `REFUNDED` | Should; terminal |
| `AWAITING_PAYMENT` | payer reports outside payment | `EXTERNAL_PAYMENT_REPORTED` | |
| `EXTERNAL_PAYMENT_REPORTED` | receiver confirms | `SETTLED_EXTERNALLY` | |
| `EXTERNAL_PAYMENT_REPORTED` | receiver rejects | `AWAITING_PAYMENT` | |
| `AWAITING_PAYMENT`, `PAYMENT_FAILED` | receiver marks received | `SETTLED_EXTERNALLY` | `contestUntil` = now + 7 days |
| `AWAITING_PAYMENT`, `PAYMENT_FAILED` | receiver waives | `WAIVED` | reason required; terminal |
| `READY`, `AWAITING_PAYMENT`, `SETTLED_EXTERNALLY` | payer disputes | `DISPUTED` | for `SETTLED_EXTERNALLY` only before `contestUntil` |
| `DISPUTED` | agreed (maybe revised `owedCents`) | `AWAITING_PAYMENT` | |
| `DISPUTED` | 2 rounds without agreement | `UNRESOLVED` | terminal |
| any non-terminal before `PAID` | owner cancels expense | `CANCELLED` | revoke tokens; terminal |

Disallowed (state, event) pairs return HTTP 409 `STATE_CONFLICT`.

### E.6.3 Time-derived states (`src/lib/state/effective.ts`)

| Concept | Stored facts | Effective rule |
| --- | --- | --- |
| Approval expired | `approval.state = REQUESTED`, `expiresAt` | `now > expiresAt` means `EXPIRED`; the next write persists it |
| Link usable | `expiresAt`, `usedAt`, `revokedAt` | not expired, not used, not revoked |
| Claim overdue | settlement in (`AWAITING_PAYMENT`,`PAYMENT_FAILED`), `dueAt` | `now > dueAt` |
| Due soon | same | `dueAt - 3 days <= now <= dueAt` |
| OTP valid | `expiresAt`, `attempts`, `lockedUntil` | not expired, attempts < 5, not locked |
| Entitled to Family | subscription `status`, `paidThrough`, `trialEndsAt` | `ACTIVE`; or `CANCELLED` with `paidThrough > now`. `SUSPENDED`, `EXPIRED`, `APPROVAL_PENDING` are not entitled |

UI, API guards, the daily job and tests all call these functions. Never compare dates elsewhere.

### E.6.4 `transition(expenseRef, machine, event, actor, payload)`

Inside one Firestore transaction: read the expense; apply E.6.3 rules; look up the row in the table; check the guard; write the new state with `version + 1`; append one `events` row; write the audit log; enqueue notifications (create `notifications` docs in the same transaction; the email send happens after commit and updates `email.status`). PayPal webhooks, capture responses, reconcile, the daily job and user actions all call `transition()`. An event for a transition that already happened is recorded in `events` as `noop` data and not applied twice.

## E.7 Invariants (`scripts/check-invariants.ts` and tests)

1. Settlement at `AWAITING_PAYMENT` or later implies approval in (`NOT_REQUIRED`,`APPROVED`,`PARTIALLY_APPROVED`).
2. Approval `NOT_REQUIRED` implies no open approval token and no "waiting for approval" in the UI.
3. `payments.captureStatus = COMPLETED` implies settlement not in (`AWAITING_PAYMENT`,`PAYMENT_FAILED`).
4. Settlement at `PAYOUT_PROCESSING` or later (except external/waived) implies a completed capture with `capturedCents = owedCents + feeLineCents`.
5. At most one successful payout per claim, and payout amount = `owedCents`.
6. `owedCents` <= owed share of `approvedCents` when partially approved.
7. Shares sum exactly to the total.
8. Expired, used or revoked tokens get HTTP 410 on every action endpoint.
9. A family not entitled cannot create a PayPal order (HTTP 402).
10. Dashboard outstanding and overdue totals equal the sums over matching claims.
11. Every state change has exactly one matching `events` row.
12. No `notifications` doc has `email.status = 'sent'` twice for the same dedupe key (guaranteed by doc id).
