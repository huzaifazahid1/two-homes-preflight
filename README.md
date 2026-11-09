# Two Homes Preflight

**Check the agreement before you spend.** A co-parenting expense app that reads your parenting agreement, tells you before a purchase whether it is covered (with the exact clause cited), gets the other parent's approval through a no-install link, matches the receipt, and settles the share through PayPal.

Built for the PayPal AI Hackathon 2026. All money is USD, all payments run in the PayPal sandbox, and all demo data is synthetic.

Demo video: _coming in Phase 4_

## 1. Features

| Phase | Status | Features |
| --- | --- | --- |
| 0. Verify setup | Done | Toolchain verified, test and script wiring, project docs |
| 1. Foundation | Done | Design system, email/password + Google sign-in, onboarding wizard, family and children, co-parent invite with hashed link tokens and email one-time codes, Resend email + dev outbox, live notification bell, Connect PayPal (Log in with PayPal + email fallback), approval/settlement state machines with `transition()` |
| 2. Agreement and preflight | Done | Agreement upload (PDF or pasted text, scanned-PDF detection), Gemini rule extraction with verbatim quotes, quote verification (exact, other page, fuzzy >= 0.9, none), value-in-quote check against prompt injection, rule review (confirm, edit with original kept, reject, manual entry), source view with the quote highlighted, rule versions (DRAFT, ACTIVE, SUPERSEDED in one transaction), deterministic rules engine with clause-cited verdicts, expenses (create, edit, cancel, list, detail with timeline), live preflight, AI quick add, duplicate check, co-parent per-rule agree/disagree, family prefill from the agreement, labelled demo mode |
| 3. Approvals and claims | Done (awaiting review) | Approval by link with email code (approve, approve part, decline; 14-day expiry, 3-day reminder, 5 requests/day, 7-day block after a decline, cancel), purchased-before-approval warning and banner, receipts to Cloudinary (private, magic-byte check, duplicate hash, compensation on failure), Gemini receipt reading with manual fallback, receipt match (over approved, before approval, store mismatch, late, possible duplicate), payment requests with a clause-cited due date, outstanding and overdue (derived), manual reminder (72 h), mark received, waive, payer reports outside payment, 7-day contest, disputes (2 rounds), daily job + GitHub Actions schedule, Home totals and "needs your action", Money tab, real-time listeners, `/a/[token]` and `/p/[token]` pages, invariant checker |
| 4. Money, billing, launch | Not started | PayPal capture + payout, webhooks, subscriptions, ledger, hardening |

Screenshots are added in Phase 4.

## 2. Architecture

Next.js 16 (App Router) on Render, Firebase Auth + Cloud Firestore, Gemini for extraction, Cloudinary for receipts, Resend for email, PayPal sandbox for payments. The rules engine that gives verdicts is deterministic code, never AI.

See [`docs/architecture.md`](docs/architecture.md) for the Mermaid diagrams (system, invite and link flow, Connect PayPal).

## 3. Setup

### Prerequisites

- Node 24, npm 11
- Java 21 (for the Firebase emulators used by tests)
- Firebase CLI via `npx firebase` (installed as a dev dependency) and `npx firebase login`
- Accounts (free tiers only): Firebase, Google AI Studio, PayPal Developer (sandbox), Resend, Cloudinary, Render

### Install

```powershell
npm install
Copy-Item .env.example .env.local   # then fill in real values
```

### Environment variables

All variables are listed with placeholders in `.env.example` and documented in `docs/spec/env.md`. They are validated at startup by `src/lib/env.ts`.

| Group | Variables |
| --- | --- |
| App | `APP_URL`, `NEXT_PUBLIC_APP_URL`, `DEMO_MODE`, `DEV_SECRET`, `JOB_SECRET`, `LINK_SESSION_SECRET`, `OTP_PEPPER` |
| Firebase client | `NEXT_PUBLIC_FIREBASE_*` (API key, auth domain, project id, app id, sender id) |
| Firebase server | `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` |
| Gemini | `GEMINI_API_KEY`, `GEMINI_MODEL` |
| PayPal | `PAYPAL_ENV`, `PAYPAL_API_BASE`, `PAYPAL_CLIENT_ID`, `NEXT_PUBLIC_PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, `PAYPAL_FAMILY_PLAN_ID`, `NEXT_PUBLIC_PAYPAL_FAMILY_PLAN_ID`, `PAYPAL_CONNECT_RETURN_URL`, `PLAN_COVERED_VOLUME_CENTS`, `FEE_PERCENT_BPS`, `FEE_FIXED_CENTS` |
| Resend | `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_TRANSPORT` |
| Cloudinary | `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `CLOUDINARY_FOLDER_PREFIX` (`CLOUDINARY_API_BASE` and `CLOUDINARY_TIMEOUT_MS` have safe defaults; the base is overridden only by tests) |

Never put `FIRESTORE_EMULATOR_HOST` or `FIREBASE_AUTH_EMULATOR_HOST` in `.env.local`. They live only in `.env.test`.

### Run

```powershell
npm run dev          # http://localhost:3000, uses the real Firebase project
```

Emulators are used only by automated tests (see Testing). ngrok setup for PayPal webhooks is documented in Phase 4.

## 4. API endpoints

Phase 3 adds approvals (`/api/expenses/:id/approval-request`, `/api/links/:token/decision`), receipts (`/api/expenses/:id/receipts`, `/api/receipts/:id`, `/confirm`, `/url`), claims (`/api/expenses/:id/payment-request`, `/remind`, `/mark-received`, `/waive`, `/external-report/:action`, `/api/links/:token/report-external`), disputes (`/api/expenses/:id/dispute`, `/api/disputes/:id/respond`), `/api/dashboard` and the daily job `/api/jobs/daily` (bearer `JOB_SECRET`).

Phase 2 adds agreements (`/api/agreements/*`), rule review and activation (`/api/rule-versions/*`), co-parent answers (`/api/links/:token/rules-ack`), quick add (`/api/ai/expense-parse`) and expenses with preflight (`/api/expenses/*`).

Phase 1 endpoints: session (`/api/auth/session`), profile and onboarding (`/api/me`), family, children and invites (`/api/family/*`), links and one-time codes (`/api/links/:token/*`), Connect PayPal (`/api/paypal/connect/*`), notifications (`/api/notifications/read`). Full reference with auth and error codes: [`docs/api.md`](docs/api.md).

## 5. Integrations

- **PayPal (sandbox):** pass-through model. The paying parent pays the platform (Orders v2) and the platform pays the receiving parent (Payouts). Family plan via Subscriptions. Log in with PayPal to connect the receiving account. Webhooks are verified before processing. Built with the PayPal Context Plugin (APIMatic).
- **Gemini (`@google/genai`):** extracts agreement rules and the named parents and children (structured JSON output, temperature 0, low thinking level), and fills the expense form from a short note. Every quote is verified against the stored page text; every percentage, dollar amount and day count must appear in its quote; a person confirms every rule. AI never gives a verdict. One retry, then a real error with manual entry. `npm run ai:check-extraction` runs the real model three times on the fixture agreement.
- **Demo mode:** with `DEMO_MODE=true`, if Gemini fails on the fixture agreement, the recorded extraction in `fixtures/ai/` is used and labelled "Demo mode: cached extraction". It never applies to other documents.
- **Cloudinary:** receipts only, uploaded through our server (type by magic bytes, size, duplicate hash first) as `type: private`. Only the `publicId` and metadata are stored; viewing returns a 5-minute signed download URL. Requests are signed with the SDK's own helpers and sent with `fetch` so each has a timeout. A failed upload releases the duplicate hash; a failed database write after upload deletes the asset. Enable "Allow delivery of PDF and ZIP files" in Cloudinary Security settings for PDF receipts.
- **Gemini receipt reading:** merchant, date, total and line items from the photo or PDF; the parent always confirms the values before the match runs. If reading fails, the parent types them. Free plan: 10 readings per month.
- **Daily job:** `.github/workflows/daily-job.yml` calls `POST /api/jobs/daily` every day at 14:00 UTC. Needs repository secrets `APP_URL` and `JOB_SECRET`.
- **Resend:** transactional email from `mail.huzaifalabs.site`; a dev outbox is used in development and tests.
- **AG Grid Community:** ledger and expense tables.

_Details are filled in as each integration is built._

## 6. Testing

| Command | What it runs |
| --- | --- |
| `npm run test:unit` | Vitest unit tests (`tests/unit`) |
| `npm run test:integration` | Vitest integration + API tests inside the Firebase emulators (project `demo-two-homes`) |
| `npm test` | Unit, then integration |
| `npm run test:e2e` | Playwright, phone (375 px) and desktop (1440 px) projects. Starts the emulators and `scripts/e2e-server.mjs` (production build in `.next-e2e`, port 3100, `.env.test` values, dev outbox). `E2E_SKIP_BUILD=1` reuses the last build. Receipt uploads go to a Cloudinary stub inside `scripts/e2e-server.mjs` (tests only) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run ai:check-extraction` | Real Gemini (key from `.env.local`) on the synthetic fixture, three runs; add `-- --record` to save the answer to `fixtures/ai/recorded-extraction.json` |
| `npm run invariants` | Read-only invariant checker (Section E.7: 1, 2, 6, 7, 8, 10, 11 now; money invariants in Phase 4) against the project in `.env.local`. `-- --family=<id>` limits it to one family |

Tests read only `.env.test` and never touch the real Firebase project. Integration tests mock PayPal, Resend, Gemini and Cloudinary with a local stub server (`tests/helpers/stub-server.ts`). If `next build` runs out of memory, use `$env:NODE_OPTIONS="--max-old-space-size=3072"` and close other apps.

## 7. Demo

Sandbox test credentials and `/dev/demo` usage are added in a later phase. In local development emails go to the `devOutbox` Firestore collection unless `EMAIL_TRANSPORT=resend`. The synthetic agreement is `fixtures/agreement/demo-agreement.md` (paste it as-is, or make the PDF as described in `fixtures/agreement/README.md`). With it, a $350 soccer camp is Needs approval citing page 4 (the other parent owes $140) and a $120 dentist visit is Eligible. `npm run seed` and `npm run reset` load and clear the synthetic demo family (scripts added in a later phase).

## 8. Known limitations and open items

- Pass-through settlement (collecting from one parent and paying another) is money transmission in most US states. A real launch needs PayPal approval for this model and legal review. This build runs in the PayPal sandbox only.
- The app does not give legal advice; it shows what the agreement text says, with quotes.
- Demo data is synthetic.
- In-app PayPal payment is Phase 4. On the Free plan claims are settled outside the app and confirmed in it; the payment page says so instead of showing a fake button.
- A late receipt on an expense that was already approved has no way to get a new approval (the state machine has no row from APPROVED back to REQUESTED). Owner decision pending.
- After an approval request is cancelled there is no way to request again (no row from CANCELLED); the expense can be cancelled. Owner decision pending.
- Seed and reset scripts and `/dev/demo` come in Phase 4; Phase 3 invariants were checked on data made by the real flows in the integration tests.
- `gemini-3.8-flash` timed out or was overloaded on every call on 2026-11-09; `gemini-2.5-flash` passed the three-run check. The model is set by `GEMINI_MODEL`.
- Once an expense needs approval it stays that way when its amount is lowered (the state machine has no way back).

Open [Confirm] items (defaults in use):

| # | Item | Default |
| --- | --- | --- |
| 1 | Family plan price, trial, covered volume | $7.99/month, 14 days, $200/month (illustrative) |
| 2 | Fee-line constants | Read from a real sandbox capture |
| 3 | Default due days | 30 |
| 4 | Log in with PayPal availability on the sandbox app | Code ready; owner to enable it on the sandbox app and test. Email fallback works |
| 5 | Log in with PayPal endpoints and userinfo field names | Verify in sandbox |
| 6 | Payouts duplicate `sender_batch_id` error shape, unclaimed period, sandbox fee | Test in sandbox |
| 7 | TypeScript 7 compatibility | Stay on 6.0.3 |
| 9 | AG Grid sponsor prize proof requirements | README section either way |

## 9. Changelog

- **Phase 3 (2026-11-09):** Approvals by link + code, receipts (Cloudinary + Gemini + match), claims with due dates, outstanding/overdue, reminders, manual resolution, disputes, daily job, dashboard totals by aggregation, Money tab, live listeners, invariant checker. 167 unit, 180 integration and 6 E2E runs (3 journeys on phone and desktop).
- **Phase 0 (2026-11-09):** Verified toolchain (Node 24, Java 21, Firebase CLI + emulators), build, typecheck and lint. Added npm scripts, Vitest and Playwright configs, and project docs. Allowed `.env.test` to be committed.
- **Phase 2 (2026-11-09):** Agreement upload and extraction, quote verification, rule review and versions, rules engine, expenses with live preflight and timeline, quick add, co-parent rule answers, family prefill, demo mode, fixtures. UI: verdict panel, source sheet, split bar, timeline, empty states, full-screen forms on phones, `N` shortcut. 149 unit, 120 integration and 4 E2E runs (2 journeys on phone and desktop).
- **Phase 1 (2026-11-09):** Foundation: core lib and `route()` wrapper, state machines and `transition()`, session auth, onboarding wizard, family and invites, link tokens + OTP, Resend + outbox, notifications bell, Connect PayPal, Firestore rules and indexes, design system and app shell. 95 unit, 74 integration and 2 E2E tests.
