# Product spec

Part of the Two Homes Preflight spec. Source sections: A. Read `CLAUDE.md` first; it maps section letters to files.

# A. Project overview

## A.1 Problem

Separated parents share child expenses (medical, school, activities) under a parenting agreement or court order. The agreement says who pays what percentage, which expenses need the other parent's written approval first (often above a dollar threshold, e.g. $200), deadlines for sharing receipts, and deadlines for reimbursement. In practice:

- Parents spend first and argue later about whether the agreement covered it.
- Approval happens in scattered texts, so nobody can prove it later.
- Receipts arrive late or never; reimbursement gets chased for weeks.
- Existing co-parenting apps track expenses and split them, but none of them check a planned expense **against the family's own agreement before the money is spent**, with the exact clause cited.

## A.2 Solution

Two Homes Preflight is a co-parenting expense app built around one idea: **check the agreement before you spend.**

1. A parent uploads the parenting agreement (PDF). AI (Gemini) extracts the expense rules. Every rule carries a **verbatim quote and page number**, and the quote is verified against the document text. A human confirms each rule. Nothing the AI cannot quote becomes a rule.
2. Before a purchase, the parent runs a **preflight**: a deterministic rules engine (not AI) returns a verdict with the clause cited: Eligible, Needs approval, Missing evidence, Not covered, Late, or Needs review.
3. If approval is needed, the other parent approves or declines through a **no-install secure link** (email + one-time code).
4. After purchase, the receipt is uploaded. AI reads it, the parent confirms the numbers, and it is matched to the approval.
5. The claim is settled through **PayPal**: the paying parent pays the platform (PayPal Orders v2), and the platform immediately pays the receiving parent (PayPal Payouts). This is the **pass-through settlement** model. [Agreed]
6. Everything lands in a clause-cited ledger that either parent can export.

Positioning statement (use in README and UI copy): "Two Homes Preflight checks every child expense against your own parenting agreement before you spend, gets the other parent's approval with one link, and settles the share through PayPal." Do not claim to be the first or only product of its kind. Never claim the app gives legal advice or interprets law; it shows what the agreement text says.

## A.3 Users and roles

| Role | Account | What they do |
| --- | --- | --- |
| **Owner (initiating parent)** | Required (Firebase Auth) | Creates the family, uploads the agreement, confirms rules, invites the co-parent, creates expenses, pays the subscription |
| **Co-parent, guest mode** | None [Agreed, Must] | Acts only through secure links: accepts invite and acknowledges rules, approves or declines, pays, receives payouts, disputes. Each action needs an email one-time code |
| **Co-parent, joined mode** | Optional account via email-link sign-in [Should, first to cut] | Same as owner for expenses and ledger, cannot change billing or agreement |
| **Child** | Never a user | Beneficiary profile only: first name, optional birth year |
| **Platform (Two Homes Preflight)** | PayPal **business** sandbox account | Receives the payer's money and pays it out to the receiving parent |

Payer and receiver are not hardcoded. Each expense stores `paidByRole` (who bought it from the vendor) and `owedByRole` (who owes a share), with values `owner` or `coparent`. Either parent can be owed.

One user belongs to exactly one family in the MVP.

## A.4 Core vocabulary (use exactly these words in code and UI)

| Term | Meaning |
| --- | --- |
| **Preflight** | Checking a planned purchase against the rules before anyone spends. No receipt. Amount may be an estimate |
| **Purchased** | The parent paid the vendor. Proven by a receipt. The UI never calls this "paid" |
| **Claim** | A request to the other parent for their share of a purchase. Requires a receipt |
| **Paid / Settled** | Only about the co-parent's reimbursement. "Paid" = capture completed; "Settled" = payout succeeded or settled outside the app |
| **Verdict** | Output of the rules engine for an expense |
| **Rule version** | An immutable confirmed set of rules from one agreement upload |

A receipt upload always means "I already bought it". It never means the co-parent paid.

## A.5 User journeys

### A.5.1 Onboarding (owner) [Agreed: all steps mandatory, not skippable]

A step indicator shows progress. The user can leave and resume at `users.onboardingStep`. They cannot reach `/app` until all steps are complete.

1. **Profile:** display name; email comes from the auth account and must be verified (Firebase email verification) before step 4 can send an invite.
2. **Agreement:** upload the PDF (or paste text if the PDF is scanned and has no text layer). Extraction runs. The user reviews every rule (confirm, edit, reject) and activates the rule version. The extraction also proposes the children and parents named in the agreement (prefill for step 3).
3. **Family:** children (first name, optional birth year; prefilled from step 2 when found) and the co-parent's name and email (prefilled when found).
4. **Invite:** send the co-parent invite (email + copyable link). Sending is required; acceptance is not.
5. **Connect PayPal:** "Connect your PayPal account" via Log in with PayPal (Section F.4). Fallback if Log in with PayPal is unavailable: enter PayPal email twice and confirm. Required for every owner, so upgrading later needs no re-onboarding.
6. **Plan:** choose Free or Family. Free is a valid choice. Family starts a PayPal subscription (Section G.6).

Order note: the agreement comes before family details so its names can prefill the family step.

### A.5.2 Co-parent invite (guest)

Email from `Two Homes Preflight <notifications@mail.huzaifalabs.site>` with Reply-To = owner's email. Link `/r/[token]` shows a read-only summary: who invited them, the children's first names, and the confirmed rules (category, split, approval threshold, each with its quote). To act, the co-parent requests a 6-digit code sent to the invited email, enters it, then: accepts the invitation, and for each rule (or all at once) marks "Agree" or "Disagree". Disagreed rules put affected expenses into `NEEDS_REVIEW`. The co-parent can also connect PayPal here (optional now; required the first time they are owed money).

### A.5.3 Main flow (planned purchase)

1. Owner opens **New expense** (or Quick add: "Mia soccer camp $350 next Saturday at Riverside FC").
2. Form fields: child, category, description, vendor, amount, planned date, who is buying (`paidByRole`). The preflight verdict appears live with the clause card.
3. Verdict **Needs approval** ("Extracurricular above $200 requires written approval, p. 4"). Owner taps **Request approval**.
4. Co-parent gets email, opens `/a/[token]`, enters code, approves, partially approves (enters an amount) or declines (optional reason).
5. Owner sees the decision in real time (Firestore listener).
6. Owner buys and uploads the receipt (camera on phone). AI reads merchant, date, total, line items. Owner confirms. Match runs against the approval.
7. Owner taps **Send payment request** ("Request $140 from Sara, due Dec 10"). Due date comes from the agreement's reimbursement deadline if present, else the family default (30 days).
8. Co-parent opens `/p/[token]`, enters code, pays with PayPal. On capture COMPLETED the platform pays the owner via Payouts.
9. Timeline: Paid, Payout processing, Settled. Ledger row updated.

### A.5.4 Alternate paths

- **Eligible small expense:** verdict Eligible, no approval step at all; receipt, then claim.
- **Purchased first (receipt first):** rules run with the purchase date. If approval was required and none exists, verdict shows "Approval was required before purchase". Owner may request retroactive approval; the co-parent sees a red "Purchased before approval" banner and may approve or decline (decline is clause-backed and closes the claim). Before uploading, the owner sees a warning explaining this.
- **Receipt uploaded while approval is still pending:** same as above; `purchasedBeforeApproval = true` is shown on the approval page.
- **Not covered:** no request button. The parent can still record the expense privately.
- **Declined:** a new request for the same expense is blocked for 7 days.
- **Approval expires (14 days):** `EXPIRED`; owner can resend.
- **Unpaid claim:** outstanding, then overdue after `dueAt` (Section A.6.4).
- **Paid outside the app:** recorded with confirmation (Section A.6.4).
- **Dispute:** co-parent disputes a claim; up to 2 rounds of responses; then `UNRESOLVED` with an exportable record. [Should, cut if late]

## A.6 Business logic

### A.6.1 Rules engine (deterministic, no AI)

`evaluate(expenseInput, ruleVersion, now) -> { verdict, ruleId, citations[], explanation, shares }`

Order of checks:
1. Currency must be USD; amount must be a positive integer number of cents. Otherwise validation error (not a verdict).
2. Find rules for the category, filtered by `childIds` if the rule is child-specific. None: `NOT_COVERED`.
3. A matched rule with `reviewState` = `NEEDS_REVIEW`, or more than one conflicting matched rule, or a co-parent "Disagree" on it: `NEEDS_REVIEW`.
4. Receipt deadline: if the rule has `receiptDeadlineDays` and the receipt is submitted after purchaseDate + deadline: `LATE` (which requires approval as an exception, Section E.6).
5. Approval: if the rule requires approval and the amount meets the threshold (`gt` means strictly greater, `gte` means greater or equal): `NEEDS_APPROVAL`.
6. Required evidence (e.g. rule says receipt required and none exists at claim time): `MISSING_EVIDENCE`.
7. Otherwise `ELIGIBLE`.

Shares: `owedShareCents = round(amountCents * owedPct / 100)` using integer math (`Math.round` on an integer product divided by 100), and the other share is `amountCents - owedShareCents`, so the two always sum exactly to the total. When partially approved, compute on `min(receiptTotal, approvedCents)`.

Annual caps (`cap`) and threshold-splitting warnings (same category and vendor, 30 days, sum crosses threshold) are [Should].

### A.6.2 AI usage boundaries [Agreed]

- AI extracts rules (with quotes), proposes family names, reads receipts, and fills the expense form from text. That is all.
- AI never decides a verdict, never approves, never moves money.
- Every AI output is validated with zod. Every extracted rule value must trace to a verified quote, otherwise `NEEDS_REVIEW` and the confirm button is disabled.
- Quote verification: normalise both texts (lowercase, collapse whitespace, straight quotes, remove soft hyphens), exact substring match on the claimed page, else exact on any page (warn), else fuzzy similarity of at least 0.9 (Levenshtein ratio over a sliding window, implemented in `src/lib/quote-verify.ts`, no dependency), else `none`.

### A.6.3 Approval rules

- Request expiry 14 days. One automatic reminder after 3 days. Daily cap of 5 requests per family. 7-day block after a decline for the same expense.
- No auto-approval on silence, ever (unless an agreement clause explicitly says so; not implemented in MVP).
- First decision is final. Changing it requires a new request.
- Raising an approved expense amount above `approvedCents` sends approval back to `REQUIRED` for the difference.

### A.6.4 Claims, outstanding and overdue [Agreed]

- `dueAt` = request time + `reimburseWithinDays` from the matched rule (clause cited) or the family default (30 days) [Confirm default].
- Overdue is **derived**, never stored: settlement state in (`AWAITING_PAYMENT`, `PAYMENT_FAILED`) and `now > dueAt`.
- Automatic reminders (Family plan): due-soon 3 days before `dueAt`, overdue on day 1, 8 and 15. Max 4 automatic emails per claim. Sent by the daily job with dedupe keys.
- Manual reminder (all plans): at most once every 72 hours.
- Owed parent actions: wait; send reminder; **mark received outside the app** (`SETTLED_EXTERNALLY`, payer notified, payer may contest within 7 days which moves it to `DISPUTED`); **waive** (`WAIVED`, reason required); export record (Family, Should).
- Paying parent actions: pay in app (Family); **report paid outside the app** (moves to `EXTERNAL_PAYMENT_REPORTED`; still outstanding until the owed parent confirms or rejects).
- Dashboard totals are computed by server aggregation queries on every load, never from stored counters.
- Partial payments are out of scope: one claim, one full payment. A smaller amount is reached through partial approval or a dispute, never by paying less.

### A.6.5 Plans [Agreed structure; prices are Confirm]

| Feature | Free | Family (paid by owner; co-parent always free) |
| --- | --- | --- |
| Agreement upload + extraction | 1 agreement, up to 3 extraction runs | Unlimited runs + amendments (new rule versions) |
| Preflight, approval links, receipts, claims | Yes | Yes |
| AI receipt reading | 10 per month | Unlimited (fair-use rate limit) |
| Outstanding/overdue tracking, manual reminder | Yes | Yes |
| Settlement | Record only (paid outside the app, with confirmation) | In-app PayPal settlement (capture + payout) |
| Processing fees | n/a | Covered by the plan up to a monthly covered volume; above it, a fee line is added to the payer's order and shown before checkout |
| Automatic reminders | No | Yes |
| PDF record export | No | Yes [Should] |

Price, trial length and covered volume: defaults `$7.99/month`, `14-day trial`, `$200/month covered volume`, all [Confirm]. Label prices on the pricing page "Illustrative sandbox pricing". The final price must satisfy: `price >= covered volume x (capture fee % + payout fee %) + fixed fees + AI and email cost`. The owner's own sandbox test showed a capture fee of about 3.6% ($150 became $144.60).

Entitlement (who may use Family features) is derived (Section E.6.3). Free and Family are the only plans.

## A.7 Main modules

1. Auth and session
2. Onboarding wizard
3. Family and invites
4. Secure links and OTP
5. Agreement upload, extraction, quote verification, rule review, rule versions
6. Rules engine and preflight
7. Expenses (manual + AI quick add)
8. Approvals
9. Receipts (Cloudinary + AI reading + matching + duplicate detection)
10. Claims, reminders, manual resolution, disputes
11. PayPal: connect (Log in with PayPal), orders, captures, payouts, subscriptions, webhooks, reconcile
12. Billing and entitlement
13. Notifications (email + in-app real-time feed)
14. Dashboard, Money tab, Ledger (AG Grid on desktop)
15. Settings
16. Daily job
17. Demo tooling (seed, reset, invariant checker)

## A.8 Pages and routes [Agreed]

| Route | Access | Purpose |
| --- | --- | --- |
| `/` | public | Landing page |
| `/pricing` | public | Plans (illustrative prices) |
| `/legal/terms`, `/legal/privacy` | public | Short plain-language pages; "not legal advice" |
| `/signup`, `/login`, `/verify-email` | public | Auth |
| `/onboarding` | signed in, onboarding incomplete | 6-step wizard |
| `/app` | owner/joined co-parent | Home dashboard |
| `/app/expenses`, `/app/expenses/new`, `/app/expenses/[id]`, `/app/expenses/[id]/receipt` | signed in | Expenses |
| `/app/money` | signed in | Outstanding, overdue, closed claims (mobile-first list) |
| `/app/ledger` | signed in | AG Grid ledger (desktop); card list on phone |
| `/app/agreement`, `/app/agreement/review` | owner | Agreement and rules |
| `/app/billing` | owner | Plan and subscription (separate page because the PayPal JS SDK loads differently for subscriptions) |
| `/app/settings` | signed in | Profile, PayPal connection, notification preferences, theme |
| `/r/[token]` | link | Co-parent invite + rule acknowledgement |
| `/a/[token]` | link | Approval decision |
| `/p/[token]`, `/p/[token]/done` | link | Payment and result |
| `/connect/paypal/callback` | signed in or link session | Log in with PayPal return URL |
| `/dev/demo` | only when `DEMO_MODE=true` | Seed/reset helpers for judges and the demo |

## A.9 Out of scope (do not build)

Calendar/custody schedules, messaging/chat, multiple families per user, non-USD currencies, partial payments, recurring approvals, merchant refund reversal of claims, insurance claims, native mobile apps, live (production) PayPal, Gmail or any user mailbox integration, Partner Referrals / multiparty seller onboarding, PayPal Invoicing, Firebase Storage, Firebase Realtime Database.

## A.10 Honesty notes for README and Devpost

- Pass-through settlement (collecting from one parent and paying another) is money transmission in most US states. A real launch needs PayPal approval for this model and legal review. The hackathon build runs in sandbox only.
- The app does not give legal advice; it shows what the agreement text says, with quotes.
- Demo data is synthetic.
