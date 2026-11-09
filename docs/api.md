# API reference

Kept in sync with `src/app/api`. Every handler uses `route()` (`src/lib/route.ts`): request id, auth, zod validation of body/query/params, rate limit, error mapping. Error shape:

```json
{ "error": { "code": "STATE_CONFLICT", "message": "...", "requestId": "...", "details": {} } }
```

Statuses: 400 `INVALID` / `OTP_INVALID` / `OTP_EXPIRED` / `PAYPAL_STATE_MISMATCH`, 401 `UNAUTHENTICATED` / `LINK_SESSION_REQUIRED`, 402 `PLAN_REQUIRED`, 403 `FORBIDDEN` / `EMAIL_NOT_VERIFIED`, 404 `NOT_FOUND`, 409 `STATE_CONFLICT` / `DUPLICATE` / `DUPLICATE_RECEIPT`, 410 `LINK_GONE`, 423 `LOCKED`, 429 `RATE_LIMITED` (with `retry-after`), 502 `UPSTREAM_FAILED` / `UPLOAD_FAILED`, 503 `DB_UNAVAILABLE`.

Auth column: **user** = session cookie `thp_session` (checkRevoked). **link** = possession of the link token; action endpoints also need the `thp_link` session from a correct OTP. **user or link** = either.

## Endpoints

| Method | Path | Auth | Purpose | Phase |
| --- | --- | --- | --- | --- |
| POST | `/api/auth/session` | none | Body `{ idToken, timeZone? }`. Verifies a fresh Firebase ID token, sets the 5-day session cookie, creates the profile on first sign-in. Returns `{ me }` | 1 |
| DELETE | `/api/auth/session` | none | Clears the cookie; revokes refresh tokens when the session is still valid | 1 |
| GET | `/api/me` | user | Profile, family view, onboarding step. Re-checks email verification live | 1 |
| PATCH | `/api/me` | user | `{ displayName?, timeZone?, notificationPrefs?, theme?, completeStep?, plan? }`. `completeStep` checks the step's prerequisites and advances (409 with `details.onboardingStep` otherwise) | 1 |
| POST | `/api/family` | user (verified) | Create the family if missing; set co-parent `{ name, email }` (400 if equal to the owner's email) | 1 |
| POST | `/api/family/children` | owner | `{ firstName, birthYear? }` (max 10 children) | 1 |
| PATCH | `/api/family/children/:id` | owner | Edit a child | 1 |
| DELETE | `/api/family/children/:id` | owner | Remove a child (409 once it has expenses) | 1 |
| POST | `/api/family/invite` | owner (verified) | Create the invite token and email it. Returns `{ link, expiresAt, email: { status } }`. 409 if an invite is already active. 10/hour/user | 1 |
| POST | `/api/family/invite/resend` | owner (verified) | Revoke the active invite and send a new one in one transaction | 1 |
| DELETE | `/api/family/invite` | owner | Revoke the active invite | 1 |
| GET | `/api/links/:token` | user or link | Read-only summary for invite, approval and payment links (`summary.purpose`). PayPal details only with a link session; `canAct` says whether the caller may act. 404 unknown, 410 expired/revoked (and used invites). A used approval link stays readable and shows the decision | 1, 3 |
| POST | `/api/links/:token/otp` | link | Email a 6-digit code to the invited address. 3/hour/token (429); 423 while locked | 1 |
| POST | `/api/links/:token/otp/verify` | link | `{ code }`. Sets the 30-minute `thp_link` cookie. 5 wrong codes lock for 15 minutes (423) | 1 |
| POST | `/api/links/:token/accept` | link + OTP | `{ perRule? }`. Accepts the invite, records rule acknowledgements, marks the token used, notifies the owner in-app | 1 |
| GET | `/api/paypal/connect/start` | user or link | Query `{ for, returnTo, token? }`. Returns `{ url }` (PayPal authorize) and sets the signed `thp_pp_state` cookie | 1 |
| POST | `/api/paypal/connect/callback` | user or link | `{ code?, state, error? }`. Verifies state + caller, exchanges the code, reads userinfo, saves `families.payout.{role}`, discards the token. Cancel returns `{ status: "cancelled" }` and saves nothing | 1 |
| POST | `/api/paypal/connect/email` | user or link | Fallback `{ for, email, confirmEmail, token? }` (emails must match) | 1 |
| DELETE | `/api/paypal/connect` | user | Disconnect your own PayPal (409 while a payout is processing) | 1 |
| POST | `/api/notifications/read` | user | `{ ids }`. Marks your own notifications read | 1 |
| POST | `/api/links/:token/rules-ack` | link + OTP | `{ perRule: { [ruleId]: "agree" \| "disagree" } }`. Saves the co-parent's answers on the active rules before acceptance; changed answers re-check affected expenses (AG-12). Returns `{ saved, disagreed, recomputed }`. 410 once the invite is used | 2 |
| POST | `/api/agreements` | owner | Multipart field `file` (PDF, <= 10 MB, <= 50 pages, `%PDF-` magic bytes) or JSON `{ text, fileName? }`. Stores page text only. 400 `details.reason = "scanned"` for PDFs without text; 402 for a second agreement on Free. 20/hour | 2 |
| GET | `/api/agreements/:id` | owner | `{ agreement, draft, runsLeft }` (`runsLeft` null on Family) | 2 |
| POST | `/api/agreements/:id/extract` | owner | `{ mode?: "ai" \| "manual" }`. AI: Gemini extraction, quote verification, DRAFT version (counts toward the plan, AG-11 402). Gemini failure: 502 `details.manualEntry` (or labelled demo mode when `DEMO_MODE=true`). Manual: empty DRAFT, no AI. 409 while running. 10/hour | 2 |
| GET | `/api/agreements/:id/pages/:n` | family member | `{ page: { page, text, pageCount } }` for the source view | 2 |
| PATCH | `/api/rule-versions/:id/rules/:ruleId` | owner | `{ action: "confirm" \| "reject" \| "undo" }` or `{ action: "edit", changes }` (original kept in `editedFrom`; a changed quote must be in the text). Confirm is 409 while the rule has a blocking issue. DRAFT only (409 otherwise, AG-10) | 2 |
| POST | `/api/rule-versions/:id/rules` | owner | Manual rule `{ category, label, owedPct, approval?, receiptDeadlineDays?, reimburseWithinDays?, childNames?, quote, page }`; 400 if the quote is not in the agreement | 2 |
| POST | `/api/rule-versions/:id/activate` | owner | Every rule decided and at least one kept. DRAFT to ACTIVE, previous ACTIVE to SUPERSEDED, family pointer moved, all in one transaction (AG-9). 402 for an amendment on Free | 2 |
| POST | `/api/ai/expense-parse` | family member | `{ text }`. Returns `{ fields: { childId, category, amountCents, date, vendor, description, mode } }`; values the note does not contain are null. 30/hour (429); 502 with a request id when AI fails | 2 |
| POST | `/api/expenses/preflight` | family member | Expense fields. Returns `{ preflight: { verdict, explanation, citations, shares, approval, rule, owedByRole } }`. Writes nothing | 2 |
| POST | `/api/expenses` | family member | `{ childId, category, description, vendor?, amountCents, currency: "USD", mode, date?, paidByRole, confirmDuplicate? }`. 400 for amount <= 0, > $100,000, non-integer cents, non-USD, future purchase date. 409 `DUPLICATE` with `details.possibleDuplicateOf` for the same child, description and amount within 24 h unless `confirmDuplicate` | 2 |
| GET | `/api/expenses` | family member | Query `{ limit?, before? }`. Newest first | 2 |
| GET | `/api/expenses/:id` | family member | `{ expense, events, agreementId, ruleVersion, receipt, dispute, dueTerms, me }` | 2, 3 |
| PATCH | `/api/expenses/:id` | family member | Changed fields + `version` (409 if stale). Re-checks with the pinned rule version; raising above an approved amount or a new approval need goes through `transition()`. 409 while a request is open, after a receipt or after cancel | 2 |
| POST | `/api/expenses/:id/cancel` | family member | Settlement `CANCEL_EXPENSE` (any state before `PAID`); open approval and payment links are revoked in the same transaction; repeat is a no-op | 2, 3 |
| POST | `/api/expenses/:id/approval-request` | buyer parent | `REQUIRED` to `REQUESTED` (or `EXPIRED`/`DECLINED` to `REQUESTED`). Emails the approver a 14-day `/a/[token]` link. While a request is open it sends a fresh link instead (old one revoked, 3/day/expense). 409 with `details.blockedUntil` inside the 7-day decline block; 429 for the 6th request of the family in 24 h; 409 for `NOT_COVERED`/`NEEDS_REVIEW`. Returns `{ sent: { link, expiresAt, email: { status } }, ...detail }` | 3 |
| DELETE | `/api/expenses/:id/approval-request` | buyer parent | `REQUESTED` to `CANCELLED`; the link is revoked in the same transaction | 3 |
| POST | `/api/links/:token/decision` | link + OTP (or the signed-in approver) | `{ decision: "APPROVED" }`, `{ decision: "PARTIALLY_APPROVED", approvedCents }` (0 < amount < total) or `{ decision: "DECLINED" }`, each with optional `reason`. First answer is final: a second one is 409 `details.alreadyDecided`. 410 expired/revoked/replaced. Emails the requester; a receipt waiting in `RECEIPT_ISSUE` is matched again | 3 |
| POST | `/api/expenses/:id/receipts` | family member | Multipart field `file`: JPEG, PNG, WEBP, HEIC or PDF by magic bytes, <= 10 MB, PDF <= 5 pages (400 otherwise). Settlement must be `NONE` or `RECEIPT_ISSUE`. Same file again 409 `DUPLICATE_RECEIPT` with `details.link`. Cloudinary private upload; failure 502 `UPLOAD_FAILED` and the hash is released. Then Gemini reads it (`parseStatus` parsed / failed / skipped). 20/hour/family. Returns 201 `{ receipt }` | 3 |
| GET | `/api/receipts/:id` | family member | `{ receipt }` with parsed values, confirmed values and match | 3 |
| POST | `/api/receipts/:id/confirm` | family member | `{ merchant, date, totalCents, acknowledge? }`. Re-checks the verdict with the receipt and matches it: `READY` or `RECEIPT_ISSUE` with issues `OVER_APPROVED`, `BEFORE_APPROVAL`, `MERCHANT_MISMATCH`, `LATE`, `POSSIBLE_DUPLICATE`. `acknowledge` accepts the first, third and fifth. Future date 400 | 3 |
| GET | `/api/receipts/:id/url` | family member, or payer link session | `{ url, expiresAt, mimeType }`: a 5-minute Cloudinary private download URL. 403 for other families | 3 |
| POST | `/api/expenses/:id/payment-request` | owed parent (verified) | `READY` to `AWAITING_PAYMENT`. `owedCents` = the share on min(receipt, approved); `dueAt` = now + the rule's reimbursement days (clause cited) or the family default (30). Emails a 14-day `/p/[token]` link. 409 while approval is not settled or the verdict blocks. Returns `{ claim: { link, dueAt, owedCents, dueClause, email }, ...detail }` | 3 |
| POST | `/api/expenses/:id/remind` | owed parent | Manual reminder with a fresh payment link; once every 72 hours (429 with `retry-after`) | 3 |
| POST | `/api/expenses/:id/mark-received` | owed parent | `SETTLED_EXTERNALLY` (`contestUntil` = now + 7 days). While the payer's report is pending it confirms that report instead (one event) | 3 |
| POST | `/api/expenses/:id/waive` | owed parent | `{ reason }` (400 if empty). `WAIVED`; payment links revoked | 3 |
| POST | `/api/links/:token/report-external` | payment link + OTP | `{ method, date, note? }`. `EXTERNAL_PAYMENT_REPORTED`; still outstanding until confirmed. 10/hour/token | 3 |
| POST | `/api/expenses/:id/external-report/:action` | owed parent | `action` = `confirm` (`SETTLED_EXTERNALLY`) or `reject` (back to `AWAITING_PAYMENT`) | 3 |
| POST | `/api/expenses/:id/dispute` | paying parent (user or payment link session) | `{ reason, proposedCents? }`. `DISPUTED` from `READY`, `AWAITING_PAYMENT`, or `SETTLED_EXTERNALLY` within 7 days (409 after) | 3 |
| POST | `/api/disputes/:id/respond` | either parent, in turn | `:id` is the expense id. `{ action: "agree" }` reopens the claim at the other parent's latest proposal; `{ action: "counter", reason, proposedCents? }` answers. The second answer without agreement closes it `UNRESOLVED` | 3 |
| GET | `/api/dashboard` | family member | `{ me, totals: { owedToYou, youOwe, overdueToYou, overdueYouOwe }, actions[] }`. Totals by aggregation queries on every call | 3 |
| POST | `/api/jobs/daily` | `Authorization: Bearer JOB_SECRET` | Persist expired approvals, approval reminder after 3 days, payment reminders (Family plan: due soon, overdue day 1/8/15, max 4). Safe to run twice. Returns `{ summary }` | 3 |
