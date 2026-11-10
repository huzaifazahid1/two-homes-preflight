# Progress

Last updated: 2026-11-11 (Phase 4)

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
  - Firestore rules and indexes per E.4/E.5 (in repo).
  - Tests: 95 unit, 74 integration, 2 E2E (phone + desktop). SE-1 bundle check clean.

- **Phase 2: Agreement and preflight** (branch `phase-2-agreement-preflight`)
  - `pdf.ts`, Gemini extraction, quote verification, review analysis, rule versions, rules engine, expenses, quick add, co-parent per-rule answers, family prefill; agreement, review, expenses UI and Home; fixtures.
  - Tests: 149 unit, 120 integration, 4 E2E runs green. Real Gemini three-run check passed on `gemini-2.5-flash`.

- **Phase 3: Approvals and claims** (branch `phase-3-approvals-claims`)
  - Approvals, receipts (Cloudinary + Gemini + match), claims, disputes, daily job, dashboard totals by aggregation, Money tab, live listeners, invariant checker, motion pass, demo receipts.
  - Tests: 167 unit, 180 integration, 6 E2E runs green. Invariants: zero violations on Phase 3 flow data.

## In progress

- **Phase 4: Money, billing and launch** (branch `phase-4-money-billing-launch`, local only, not pushed yet).
  - Code done: PayPal transport (`paypal/http.ts`, `sdk.ts`, `orders.ts`, `payouts.ts`, `subscriptions.ts`, `webhooks.ts`, `webhook-dispatch.ts`), `checkout.ts`, `settlement.ts`, `fees.ts`, `entitlement.ts`, `billing.ts`, settlement/billing emails; all Phase 4 routes; PayPal Buttons on `/p/[token]` and `/app/billing` (with a load-failure state), payout panel, `/app/ledger` (AG Grid + phone cards), onboarding Family choice, `/dev/demo`, daily job reconcile sweep, money invariants, `npm run paypal:setup-plans`, `seed`, `reset`, landing refresh, skip link.
  - Tests: 178 unit and 221 integration green (2026-11-11, on commit `30f6fcb`). E2E 8/8 green on the owner's machine (2026-11-11). Typecheck and lint clean.
  - Real PayPal sandbox journey: run by the owner from fresh owner accounts (subscription, real Gemini receipt read, real Cloudinary upload, claim, OTP, capture, payout, webhooks, Firestore and PayPal dashboard checks) and reported successful. `npm run invariants` on 2026-11-11: 5 families, 9 expenses, 13 link tokens, **no violations**.
  - CI: `.github/workflows/ci.yml` (typecheck, lint, unit, integration, E2E, SE-1) committed; runs once the branch is pushed.
  - Web interface guidelines review of the Phase 4 UI done (decisions 4.26, 4.27); accessibility and dark-mode pass written as `tests/e2e/a11y.spec.ts` (decision 4.28). **Waiting for the owner's E2E run** (the E2E build ran out of memory on this machine with VS Code open); any violations it reports get fixed next.

## Next

1. Owner: `npm run test:e2e:build`, then `$env:E2E_SKIP_BUILD="1"; npm run test:e2e` (add `$env:E2E_SHOTS_DIR="shots"` for screenshots). Fix what `a11y.spec.ts` reports, then commit.
2. Owner go-ahead to push `phase-4-money-billing-launch`; CI green on GitHub.
3. Deploy Firestore rules and indexes (`npm run firebase:deploy-rules`, owner approval).
4. Render deploy (see Blocked), warm up, record the video, Devpost submission by Nov 12, 9 PM PKT.
5. README screenshots from the E2E screenshot run, video link, final changelog.

## Blocked / owner items

- **Render deploy:** needs the owner's Render account. Set every Section O variable, `DEMO_MODE=true` + `DEV_SECRET` for `/dev/demo`, `GEMINI_MODEL` (decision 2.21: `gemini-2.5-flash` passed; `gemini-3.8-flash` timed out on 2026-11-09), and the **prod** sandbox app's `PAYPAL_CLIENT_ID`/`SECRET`, `PAYPAL_FAMILY_PLAN_ID` (run `npm run paypal:setup-plans` against it) and a webhook on `https://<service>.onrender.com/api/webhooks/paypal` (`PAYPAL_WEBHOOK_ID`).
- **GitHub secrets** `APP_URL` and `JOB_SECRET` for the daily job workflow.
- **[Confirm] 2 and 6** from the owner's real sandbox data: the `paypal_fee` stored on a real capture (`payments/{expenseId}`), and the duplicate `sender_batch_id` error shape if one was seen.
- **[Confirm] 4 and 5** Log in with PayPal on the sandbox app (email fallback works either way).
- **"On a phone with real emails" (Phase 3 criterion):** one run with `EMAIL_TRANSPORT=resend`.
- **Owner decisions (state machine gaps):** (a) after a cancelled approval request, allow asking again? (b) a late receipt on an already approved expense has no path to a new approval. Default: spec unchanged.
- Machine memory: `next build` needs about 3 GB free; close VS Code windows and Chrome before `npm run test:e2e:build`, with `$env:NODE_OPTIONS="--max-old-space-size=3072"`.
