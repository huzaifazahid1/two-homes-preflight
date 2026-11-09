# Progress

Last updated: 2026-11-09 (Phase 3)

## Done

- **Phase 0: Verify setup** (see git history and `docs/decisions.md` 0.x).
- **Phase 1: Foundation** (branch `phase-1-foundation`)
  - Core lib: zod env (server + public), clock, money (integer cents), ids, errors, structured logging with redaction, Firestore rate limiter, audit log, `route()` wrapper.
  - State core: approval + settlement transition tables, time-derived states (`effective.ts`), `transition()` with events, audit, notifications and no-op handling.
  - Auth: email/password and Google (client), httpOnly session cookie, verify-email screen with live re-check, sign-out with token revocation, proxy redirects.
  - Onboarding wizard: profile, agreement (placeholder), family, invite, PayPal, plan (Free). Server-checked step order and resume.
  - Family and children; co-parent invite with hashed tokens, resend/revoke, copy link when the email fails.
  - Links: read-only summary, OTP (hashed, 10 min, 5 attempts then 15 min lock, 3 sends/hour), 30-minute link session, invite acceptance with per-rule acknowledgement.
  - Email: Resend transport with retries + dev outbox; `invite` and `otp` templates.
  - Notifications collection with dedupe keys; live in-app bell (Firestore listener).
  - Log in with PayPal (state cookie, code exchange, userinfo parse) + email fallback; disconnect.
  - Design system tokens (light/dark), Geist + Source Serif 4, AppShell (bottom tabs < 1024 px, sidebar >= 1024 px), Money, StatusBadge/VerdictBadge, OtpInput, ClauseCard.
  - Pages: landing, pricing, terms, privacy, login, signup, verify-email, onboarding, `/app`, `/app/settings`, `/app/expenses` and `/app/money` (empty states), `/r/[token]`, `/connect/paypal/callback`.
  - Firestore rules and indexes per E.4/E.5 (in repo; not yet deployed).
  - Tests: 95 unit, 74 integration (emulators: auth, onboarding, links/OTP, PayPal connect, state, rules, generated auth matrix), 2 E2E (phone + desktop). SE-1 bundle check clean.

- **Phase 2: Agreement and preflight** (branch `phase-2-agreement-preflight`)
  - `pdf.ts` (unpdf per-page text, 10 MB / 50 pages / magic bytes, scanned detection), pasted text with page markers.
  - Gemini extraction (`src/lib/ai/*`): structured output, temperature 0, one retry, zod validation; quote verification (`quote-verify.ts`); review analysis (`rules-review.ts`): value-in-quote check, conflicts, duplicate merge, vague terms.
  - Rule versions: confirm / edit / reject / undo / manual entry; activation supersedes in one transaction; Free limits (3 runs, 1 agreement).
  - Rules engine (`rules-engine.ts`) per A.6.1; expenses create / edit / cancel / list / detail with timeline; preflight dry run; duplicate check; quick add.
  - Co-parent per-rule answers (`rules-ack`) with re-check of affected expenses; family step prefill from the agreement.
  - UI: onboarding agreement step, `/app/agreement`, `/app/agreement/review`, `/app/expenses`, `/new`, `/[id]`, `/[id]/edit`, Home dashboard; VerdictPanel, SourceSheet, SplitBar, Timeline, ClauseCard page chip.
  - Fixtures: `fixtures/agreement/demo-agreement.md` (6 pages), `fixtures/ai/demo-agreement-extraction.json` (demo mode), `fixtures/ai/recorded-extraction.json` (real Gemini answer).
  - Tests: 149 unit, 120 integration, 4 E2E runs green. Real Gemini three-run check passed on `gemini-2.5-flash`.

- **Phase 3: Approvals and claims** (branch `phase-3-approvals-claims`)
  - Approvals (`src/lib/approvals.ts`): request, fresh link for an open request, cancel, decision by link + code (approve, part, decline), 3-day reminder, daily cap, decline block, purchased-before-approval flag; `/a/[token]`.
  - Receipts (`src/lib/receipts/*`): magic-byte check, size and PDF pages, duplicate hash, Cloudinary private upload with compensation, Gemini reading, confirm + match, 5-minute view URL; `/app/expenses/[id]/receipt`.
  - Claims (`src/lib/claims.ts`): payment request with clause-cited `dueAt`, manual reminder (72 h), mark received, waive, payer report + confirm/reject, 7-day contest; `/p/[token]`. Disputes (`src/lib/disputes.ts`).
  - Daily job (`src/lib/jobs/daily.ts`, `POST /api/jobs/daily`, `.github/workflows/daily-job.yml`).
  - Dashboard totals by aggregation + "needs your action" (`src/lib/data/dashboard.ts`, `GET /api/dashboard`), Home and Money tab, live listeners with paused banner.
  - Invariant checker (`src/lib/invariants.ts`, `npm run invariants`).
  - Tests: 167 unit, 180 integration (emulators), 6 E2E runs (3 journeys x phone and desktop) green. Invariants: zero violations on Phase 3 flow data.

## In progress

- Nothing. Waiting for the owner's review of Phase 3.

## Next

- Owner items below, then Phase 4: Money, billing, launch.

## Blocked / owner items

- **"On a phone with real emails" (Phase 3 criterion):** needs `EMAIL_TRANSPORT=resend` and one real Cloudinary upload (keys are in `.env.local`; enable "Allow delivery of PDF and ZIP files" in Cloudinary Security). Verified so far with the dev outbox and a Cloudinary stub.
- **Deploy the new indexes** with the rules (`npm run firebase:deploy-rules`, owner approval). Without them the daily job and overdue totals fail on the real project.
- **GitHub secrets** `APP_URL` and `JOB_SECRET` for the daily job workflow.
- **Owner decisions (state machine gaps):** (a) after a cancelled approval request, allow asking again (add CANCELLED to the RESEND row)? (b) a late receipt on an already approved expense has no path to a new approval. Default: spec unchanged.
- **Demo receipts:** the 3 synthetic receipts in `fixtures/receipts/` are still to be made.

- **Gemini model:** `gemini-3.8-flash` (current `.env.local`) returned 504 / 503 on every extraction call today; `gemini-2.5-flash` works (about 10 s per run). Decide `GEMINI_MODEL` (decision 2.21).

- **Deploy Firestore rules and indexes** with `npm run firebase:deploy-rules` (needs owner approval, Section L.6).
- **Render deploy**: needs the owner's Render account. Set all Section O variables in Render. For a walk-through of onboarding before Phase 2, `DEMO_MODE=true` is needed (decision 1.2).
- **Real invite email** from `mail.huzaifalabs.site` to a second inbox: set `EMAIL_TRANSPORT=resend` locally or on Render and send one invite (completion criterion).
- **Log in with PayPal in sandbox** ([Confirm] 4 and 5): enable Log in with PayPal on the sandbox app, add Return URL `{APP_URL}/connect/paypal/callback`, tick Email, Account verification status and PayPal account ID. Then connect once from onboarding; the userinfo field names are logged once in development. The email fallback works either way.
- `PAYPAL_FAMILY_PLAN_ID` placeholders remain (Phase 4).
- GitHub Actions `ci.yml` is not added yet (planned with Phase 4 hardening; tests run locally with `npm test` and `npm run test:e2e`).
- Machine memory: `next build` crashed once with a segfault; it passes with `NODE_OPTIONS=--max-old-space-size=3072` and other apps closed.
