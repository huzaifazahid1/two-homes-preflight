# Phase 4

Read `CLAUDE.md` first (always loaded). Then read only these before writing code:

- `docs/spec/product.md` (A.6.5, A.10)
- `docs/spec/state-machine.md`
- `docs/spec/paypal-and-webhooks.md`
- `docs/spec/data-model.md` (payments, payouts, subscriptions, usage, webhookEvents)
- `docs/spec/ag-grid.md`
- `docs/spec/email-resend.md`
- `docs/spec/env.md`
- `docs/spec/ui-design.md`
- `docs/demo-script.md`
- `docs/spec/testing.md` (N.1, N.3)

Read other spec files only if a task in this phase needs them.

## Phase 4: Money, billing and launch

1. **Objective:** move sandbox money safely (Orders v2 capture to platform, Payouts to receiver), sell the Family plan with Subscriptions, ship the ledger, then harden, record and submit.
2. **Split:** Nov 11: payments, payouts, webhooks, reconcile, subscriptions. Nov 12: ledger (morning), landing + pricing, hardening, dark mode check, video by mid-afternoon, submission by 9 PM PKT.
3. **Features:** `/p/[token]` with OTP, breakdown, PayPal Buttons; server order creation and capture (Section G); payout orchestration; webhook endpoint with verification and dedupe; reconcile endpoint + daily job sweep; covered-volume usage and fee line; `scripts/setup-paypal-plans.ts`; `/app/billing` (subscribe, status, covered-volume bar, cancel); entitlement gating (in-app settlement, auto reminders, unlimited receipt AI, amendments); settlement/unclaimed/failed emails; payout retry after reconnect; refund on failed payout [Should]; AG Grid ledger + desktop tables (Section K); landing and pricing pages; onboarding plan step; `/dev/demo` + seed/reset; `scripts/check-invariants.ts`; warm-up; accessibility pass; README final; `docs/demo-script.md`.
4. **Files:** `src/lib/paypal/{sdk,orders,payouts,subscriptions,webhooks}.ts`, `src/lib/{settlement,entitlement}.ts`, `src/app/p/[token]/*`, `src/app/(app)/app/{billing,ledger}`, `src/app/(public)/{page,pricing}`, `src/app/api/{links/[token]/orders,webhooks/paypal,billing,ledger,dev}/*`, `src/components/grid/*`, `scripts/*`.
5. **Endpoints:**

| Method and path | Purpose | Auth |
| --- | --- | --- |
| `POST /api/links/:token/orders` | Create order | link + OTP |
| `POST /api/links/:token/orders/:orderId/capture` | Capture, then payout | link + OTP |
| `POST /api/webhooks/paypal` | Events | PayPal signature |
| `POST /api/expenses/:id/reconcile` | Re-sync | member or job |
| `POST /api/expenses/:id/payout/retry` | After reconnect | owed parent |
| `POST /api/expenses/:id/refund` | Refund payer after failed payout [Should] | owner |
| `GET /api/billing`, `POST /api/billing/subscription`, `POST /api/billing/cancel` | Billing | owner |
| `GET /api/ledger` | Rows + totals | member |
| `POST /api/dev/seed`, `POST /api/dev/reset` | Demo | `DEMO_MODE=true` + `DEV_SECRET` |

6. **Dependencies:** Phase 3 claims in `AWAITING_PAYMENT` with payment tokens; Phase 1 PayPal connection; entitlement rule (E.6.3).
7. **Testing:** P4 tests in Section N, plus manual `@sandbox` E2E three times from a fresh reset.
8. **Edge cases:** client sends amount (ignored); checkout cancelled; double click / refresh on capture; capture `PENDING`; webhook before capture response; payout network failure; payout `UNCLAIMED`; payout `FAILED`; receiver not connected; insufficient platform balance; subscription cancelled (entitled until `paidThrough`); `SUSPENDED` (402 on order creation); trial end; webhook signature failure; sandbox slow (reconcile); Render cold start (warm-up).
9. **Completion criteria:** full demo in sandbox three times in a row from reset; `check-invariants` reports zero violations; phone layout and dark mode checked on every screen; video recorded; Devpost submitted with README, architecture diagram, test credentials and honesty notes.

## Test cases for this phase

Full list with all phases: `docs/spec/testing.md`. Rows below are the ones this phase must make pass (rows marked for several phases are listed in each).

### Authorization and security
| ID | Scenario | Expected | Phase |
| --- | --- | --- | --- |
| AZ-1 | Every endpoint without session | 401 (generated matrix) | 1-4 |
| AZ-2 | User of family A reads/writes family B resource | 403, audit logged | 1-4 |
| AZ-3 | Joined co-parent calls owner-only route (agreement, billing) | 403 | 2,4 |
| SE-1 | Secret names in client bundle | None found | 1,4 |
| SE-3 | Webhook with invalid signature | 400, no state change | 4 |
| SE-7 | `/dev/*` routes in production without `DEMO_MODE` | 404 | 4 |

### Onboarding and family
| ID | Scenario | Expected | Phase |
| --- | --- | --- | --- |
| ON-1 | Complete all 6 steps | `onboardingStep = done`, `/app` reachable | 1-4 |

### Links and OTP
| ID | Scenario | Expected | Phase |
| --- | --- | --- | --- |
| LK-7 | Expired / used / revoked token | 410 page | 1-4 |

### PayPal connection
| ID | Scenario | Expected | Phase |
| --- | --- | --- | --- |
| PC-5 | Disconnect while payout processing | 409 | 4 |
| PC-6 | Co-parent owed money without connection | Claim stays `PAID`, banner + email; connect triggers payout | 4 |

### Payments, payouts, webhooks
| ID | Scenario | Expected | Phase |
| --- | --- | --- | --- |
| PY-1 | Happy path sandbox | `PAID` then `PAYOUT_PROCESSING` then `SETTLED` | 4 |
| PY-2 | Body includes `amount` | Ignored | 4 |
| PY-3 | Order for non-entitled family | 402 | 4 |
| PY-4 | Order for `DISPUTED` claim | 409 | 4 |
| PY-5 | Capture called twice concurrently | One capture, one payout | 4 |
| PY-6 | Checkout cancelled | Still `AWAITING_PAYMENT`; nothing recorded | 4 |
| PY-7 | Instrument declined | `PAYMENT_FAILED`, retry allowed | 4 |
| PY-8 | Capture `PENDING`, then webhook COMPLETED | Payout only after webhook | 4 |
| PY-9 | Webhook arrives before capture response | One transition, other noop | 4 |
| PY-10 | Same webhook 3 times | Processed once | 4 |
| PY-11 | Payout timeout then reconcile | One payout, same batch id | 4 |
| PY-12 | Payout UNCLAIMED then SUCCEEDED | `PAYOUT_UNCLAIMED` then `SETTLED` | 4 |
| PY-13 | Payout FAILED, receiver reconnects, retry | New attempt, `SETTLED` | 4 |
| PY-14 | Insufficient platform balance | Stays `PAID`, alert; reconcile after funding | 4 |
| PY-15 | Above covered volume | Fee line shown and charged; payout = owed | 4 |
| PY-16 | Refund after failed payout [Should] | `REFUNDED` | 4 |
| PY-17 | Webhook unknown resource | 200, `ignored_unknown` | 4 |
| PY-18 | Webhook handler throws | 500; reprocessed on retry | 4 |

### Subscriptions
| ID | Scenario | Expected | Phase |
| --- | --- | --- | --- |
| SB-1 | Subscribe in sandbox | ACTIVE after server GET verification | 4 |
| SB-2 | Client posts someone else's subscription id | `custom_id` mismatch, 400 | 4 |
| SB-3 | Cancel | Entitled until `paidThrough`, then not | 4 |
| SB-4 | SUSPENDED webhook | Order creation 402; banner | 4 |
| SB-5 | Missed webhook | Re-sync after 1 h on billing page | 4 |
| SB-6 | Cancel with captured claims | Payouts still sent | 4 |

### Firestore, listeners, network
| ID | Scenario | Expected | Phase |
| --- | --- | --- | --- |
| NW-1 | Browser offline during submit | Button disabled, retry message; no duplicate on resubmit (server idempotency where money is involved) | 1-4 |
| NW-2 | Gemini/Resend/Cloudinary/PayPal timeouts | Real error states with request id | 2-4 |

### UI and empty states
| ID | Scenario | Expected | Phase |
| --- | --- | --- | --- |
| UI-1 | Phone width 375 px | Bottom tabs, no horizontal scroll, touch targets >= 44 px | 1-4 |
| UI-2 | Desktop 1440 px | Sidebar, master-detail on expenses, grids | 1-4 |
| UI-3 | Dark mode | All text passes contrast; grids themed | 4 |
| UI-4 | Keyboard only | All actions reachable, focus visible | 4 |
| UI-5 | Empty ledger, empty money tab, no notifications | Friendly empty states | 2-4 |


## End of phase

1. All tests above green; `npm run typecheck` and `npm run lint` clean.
2. Run the app on phone width (375 px) and desktop (1440 px) and check every screen touched in this phase.
3. Run the `web-design-guidelines` skill on the UI files changed in this phase and fix real issues.
4. Update `README.md`, `docs/progress.md`, `docs/api.md`, `docs/decisions.md`.
5. Report to the owner and wait for approval before the next phase.
