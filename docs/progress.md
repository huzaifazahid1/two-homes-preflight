# Progress

Last updated: 2026-11-09 (Phase 2)

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

## In progress

- Nothing. Waiting for the owner's review of Phase 2.

## Next

- Owner items below, then Phase 3: Approvals and claims.

## Blocked / owner items

- **Gemini model:** `gemini-3.8-flash` (current `.env.local`) returned 504 / 503 on every extraction call today; `gemini-2.5-flash` works (about 10 s per run). Decide `GEMINI_MODEL` (decision 2.21).
- **Demo PDF and receipts (owner):** make `fixtures/agreement/demo-agreement.pdf` from `demo-agreement.md` (steps in `fixtures/agreement/README.md`) and the 3 synthetic receipts in `fixtures/receipts/` (needed in Phase 3).

- **Deploy Firestore rules and indexes** with `npm run firebase:deploy-rules` (needs owner approval, Section L.6).
- **Render deploy**: needs the owner's Render account. Set all Section O variables in Render. For a walk-through of onboarding before Phase 2, `DEMO_MODE=true` is needed (decision 1.2).
- **Real invite email** from `mail.huzaifalabs.site` to a second inbox: set `EMAIL_TRANSPORT=resend` locally or on Render and send one invite (completion criterion).
- **Log in with PayPal in sandbox** ([Confirm] 4 and 5): enable Log in with PayPal on the sandbox app, add Return URL `{APP_URL}/connect/paypal/callback`, tick Email, Account verification status and PayPal account ID. Then connect once from onboarding; the userinfo field names are logged once in development. The email fallback works either way.
- `PAYPAL_FAMILY_PLAN_ID` placeholders remain (Phase 4).
- GitHub Actions `ci.yml` is not added yet (planned with Phase 4 hardening; tests run locally with `npm test` and `npm run test:e2e`).
- Machine memory: `next build` crashed once with a segfault; it passes with `NODE_OPTIONS=--max-old-space-size=3072` and other apps closed.
