# Phase 3

Read `CLAUDE.md` first (always loaded). Then read only these before writing code:

- `docs/spec/product.md` (A.5.4, A.6.3, A.6.4)
- `docs/spec/data-model.md` (approvals, receipts, receiptHashes, expenses.settlement, notifications, E.8 listeners)
- `docs/spec/state-machine.md`
- `docs/spec/auth-and-links.md` (F.2, F.3)
- `docs/spec/receipts-cloudinary.md`
- `docs/spec/email-resend.md`
- `docs/spec/ui-design.md`
- `docs/spec/testing.md` (N.1 only)

Read other spec files only if a task in this phase needs them.

## Phase 3: Approvals, receipts and claims

1. **Objective:** complete the agreement loop without in-app money movement: approval by link, receipt in Cloudinary matched to the approval, claims with due dates, outstanding/overdue, manual resolution, real-time updates. After this phase a Free-plan family has a working product.
2. **Features:** approval request (14-day expiry, 3-day reminder, daily cap 5, 7-day decline block); `/a/[token]` with OTP and approve/partial/decline; purchased-before-approval path with pre-upload warning and banner; receipt upload to Cloudinary (Section I), hash duplicate check, Gemini parsing, confirmation, match (over approved, before approval date, merchant mismatch, late, possible duplicate by merchant+date+amount); claims (`payment-request` with `dueAt`, payment link token for Phase 4, email); outstanding/overdue derived; manual reminder (72 h); mark received outside; waive; payer report outside payment + confirm/reject; contest window 7 days; disputes (2 rounds, Should); daily job endpoint + GitHub Actions schedule (expire approvals, approval reminders; payment reminders gated to Family in Phase 4); Home dashboard (owed to you, you owe, overdue banner, needs your action) with server aggregation; `/app/money`; real-time listeners (expense detail, expense list, notifications); `GET /api/receipts/:id/url`.
3. **Files:** `src/lib/{approvals,claims,disputes}.ts`, `src/lib/receipts/*`, `src/lib/jobs/daily.ts`, `src/lib/data/dashboard.ts`, `src/hooks/*`, `src/app/a/[token]`, `src/app/(app)/app/{page,money,expenses/[id]/receipt}`, `src/app/api/{expenses,receipts,disputes,dashboard,jobs}/*`, `.github/workflows/daily-job.yml`.
4. **Endpoints:**

| Method and path | Purpose | Auth |
| --- | --- | --- |
| `POST /api/expenses/:id/approval-request` | Create/resend | buyer parent |
| `POST /api/links/:token/decision` | Approve / partial / decline | link + OTP |
| `POST /api/expenses/:id/receipts` | Upload (multipart) + parse | member |
| `POST /api/receipts/:id/confirm` | Confirm fields, run match | member |
| `GET /api/receipts/:id/url` | Short-lived view URL | member or payment link session |
| `POST /api/expenses/:id/payment-request` | `AWAITING_PAYMENT`, `dueAt` | owed parent |
| `POST /api/expenses/:id/remind` | Manual reminder | owed parent |
| `POST /api/expenses/:id/mark-received` | `SETTLED_EXTERNALLY` | owed parent |
| `POST /api/expenses/:id/waive` | `WAIVED` | owed parent |
| `POST /api/links/:token/report-external` | Payer reports outside payment | link + OTP |
| `POST /api/expenses/:id/external-report/:action` | confirm / reject | owed parent |
| `POST /api/expenses/:id/dispute`, `POST /api/disputes/:id/respond` | Disputes [Should] | payer (link/user), owed parent |
| `GET /api/dashboard` | Totals + action list | member |
| `POST /api/jobs/daily` | Job | `Authorization: Bearer JOB_SECRET` |

5. **Dependencies:** Phase 1 links/OTP/email, Phase 2 expenses/verdicts/`reimburseWithinDays`.
6. **Testing:** P3 tests in Section N, including fake-clock tests for expiry and overdue.
7. **Edge cases:** link after decision (read-only); second decision (409); payment request while approval `REQUESTED` (409); request for `NOT_COVERED` (409); receipt above `approvedCents`; receipt before approval date; same file twice (409); same merchant/date/amount different file (confirm); unreadable receipt (manual entry); Cloudinary down (502, compensation); owed parent marks received while payer report pending (auto-confirm, one event each); contest after 7 days (blocked); daily job twice or skipped (no duplicates, nothing missed); cancel after payment request (allowed before payment; token revoked); listener permission error (sign-out) and network loss (banner + refetch).
8. **Completion criteria:** demo steps 3 to 7 (Appendix 2) work end to end on a phone with real emails; invariants 1, 2, 6, 8, 10, 11 pass on seed data; fake-clock tests green; Free-plan loop closes a claim manually; README updated.

## Test cases for this phase

Full list with all phases: `docs/spec/testing.md`. Rows below are the ones this phase must make pass (rows marked for several phases are listed in each).

### Authorization and security
| ID | Scenario | Expected | Phase |
| --- | --- | --- | --- |
| AZ-1 | Every endpoint without session | 401 (generated matrix) | 1-4 |
| AZ-2 | User of family A reads/writes family B resource | 403, audit logged | 1-4 |
| AZ-4 | Payer tries mark-received / waive | 403 | 3 |
| SE-6 | Rate limits (OTP sends, quick add, uploads) | 429 with retry-after | 1-3 |

### Onboarding and family
| ID | Scenario | Expected | Phase |
| --- | --- | --- | --- |
| ON-1 | Complete all 6 steps | `onboardingStep = done`, `/app` reachable | 1-4 |

### Links and OTP
| ID | Scenario | Expected | Phase |
| --- | --- | --- | --- |
| LK-7 | Expired / used / revoked token | 410 page | 1-4 |

### Approvals
| ID | Scenario | Expected | Phase |
| --- | --- | --- | --- |
| AP-1 | Approve via link with OTP | `APPROVED`; requester sees it live | 3 |
| AP-2 | Partial approve $200 of $350 | `approvedCents` 20000; claim on $200 | 3 |
| AP-3 | Decline then request again within 7 days | 409 with date | 3 |
| AP-4 | No decision for 3 days | One reminder email | 3 |
| AP-5 | 15 days later | Effective `EXPIRED`; decision 410 | 3 |
| AP-6 | Second decision | 409; read-only result | 3 |
| AP-7 | 6th request in a day | 429 | 3 |
| AP-8 | Owner cancels pending request | Token 410; `CANCELLED` | 3 |
| AP-9 | Receipt uploaded while approval pending | Warning before upload; banner on approval page | 3 |

### Receipts and Cloudinary
| ID | Scenario | Expected | Phase |
| --- | --- | --- | --- |
| RC-1 | Upload JPEG 3 MB | Stored private in Cloudinary; publicId saved; no URL stored | 3 |
| RC-2 | HEIC from iPhone, PDF receipt | Accepted | 3 |
| RC-3 | 12 MB, GIF, renamed text file | 400 | 3 |
| RC-4 | Same file twice (also concurrently) | One succeeds; other 409 `DUPLICATE_RECEIPT` | 3 |
| RC-5 | Cloudinary 5xx/timeout | 502; hash doc removed; retry works | 3 |
| RC-6 | View URL | Expires after 5 minutes; non-member 403 | 3 |
| RC-7 | Gemini cannot read | Manual entry | 3 |
| RC-8 | Total above approved | Only approved claimable; issue shown | 3 |
| RC-9 | Purchase date before approval | `BEFORE_APPROVAL` flag | 3 |
| RC-10 | After receipt deadline | `LATE` verdict, approval required | 3 |
| RC-11 | Same merchant/date/amount, different file | Possible duplicate confirmation | 3 |

### Claims, outstanding, overdue
| ID | Scenario | Expected | Phase |
| --- | --- | --- | --- |
| CL-1 | Payment request with approval `REQUESTED` | 409 | 3 |
| CL-2 | `dueAt` from rule | Clause cited | 3 |
| CL-3 | Fake clock dueAt - 1 min / + 1 min | Not overdue / overdue | 3 |
| CL-4 | Dashboard totals | Equal sum of claims | 3 |
| CL-5 | Manual reminder twice within 72 h | 429 | 3 |
| CL-6 | Payer reports outside payment | Still outstanding until confirmed | 3 |
| CL-7 | Owed parent confirms / rejects report | `SETTLED_EXTERNALLY` / back to `AWAITING_PAYMENT` | 3 |
| CL-8 | Mark received, payer contests day 6 / day 8 | `DISPUTED` / 409 | 3 |
| CL-9 | Waive without reason | 400 | 3 |
| CL-10 | Daily job twice | Each reminder once | 3 |
| CL-11 | Dispute 2 rounds no agreement | `UNRESOLVED`, pay disabled | 3 |

### Firestore, listeners, network
| ID | Scenario | Expected | Phase |
| --- | --- | --- | --- |
| DB-3 | Listener permission-denied | Client signs out, redirect | 3 |
| DB-4 | Listener network loss | "Live updates paused" banner; refetch on reconnect | 3 |
| NW-1 | Browser offline during submit | Button disabled, retry message; no duplicate on resubmit (server idempotency where money is involved) | 1-4 |
| NW-2 | Gemini/Resend/Cloudinary/PayPal timeouts | Real error states with request id | 2-4 |

### UI and empty states
| ID | Scenario | Expected | Phase |
| --- | --- | --- | --- |
| UI-1 | Phone width 375 px | Bottom tabs, no horizontal scroll, touch targets >= 44 px | 1-4 |
| UI-2 | Desktop 1440 px | Sidebar, master-detail on expenses, grids | 1-4 |
| UI-5 | Empty ledger, empty money tab, no notifications | Friendly empty states | 2-4 |


## End of phase

1. All tests above green; `npm run typecheck` and `npm run lint` clean.
2. Run the app on phone width (375 px) and desktop (1440 px) and check every screen touched in this phase.
3. Run the `web-design-guidelines` skill on the UI files changed in this phase and fix real issues.
4. Update `README.md`, `docs/progress.md`, `docs/api.md`, `docs/decisions.md`.
5. Report to the owner and wait for approval before the next phase.
