# Testing

How to run each test layer. The strategy and every test case are in `docs/spec/testing.md` (Section N).

| Layer | Command | Runs against |
| --- | --- | --- |
| Unit | `npm run test:unit` | Pure functions, no I/O |
| Integration + API | `npm run test:integration` | Firebase emulators (project `demo-two-homes`), PayPal/Gemini/Resend/Cloudinary stubbed (`tests/helpers`) |
| Both | `npm test` | |
| E2E | `npm run test:e2e:build`, then `$env:E2E_SKIP_BUILD="1"; npm run test:e2e` | Production build in `.next-e2e` on :3100, emulators, dev outbox, Cloudinary stub. Phone (375 px) and desktop (1440 px) |
| Accessibility + themes | part of E2E (`tests/e2e/a11y.spec.ts`; run alone with `npx playwright test a11y`) | axe WCAG 2.1 A + AA on every screen, light and dark, phone and desktop; no sideways scroll; skip link. `$env:E2E_SHOTS_DIR="shots"` also saves a screenshot of each screen in both themes |
| SE-1 bundle check | `node scripts/check-bundle-secrets.mjs .next-e2e` | Client chunks of a build: no server secret names |
| Invariants | `npm run invariants` (`-- --family=<id>` for one family) | Read-only, the Firebase project in `.env.local` |
| Real PayPal sandbox | `npm run test:sandbox` | See below. Manual, never in CI |

Every automated layer reads only `.env.test` and never touches the real Firebase project. Vitest loads `.env.test` alone (`vitest.config.ts`). For E2E, `next build`/`next start` would also load `.env.local`, so `scripts/e2e-server.mjs` blanks every `.env.local` key that `.env.test` and its own overrides do not set; a local run therefore matches CI. E2E never calls Gemini, Cloudinary or PayPal: extraction uses the labelled demo-mode cache, receipt reading and quick add show their real "not configured" error states (asserted by the tests), and receipt storage is a local stub. CI (`.github/workflows/ci.yml`) runs typecheck, lint, unit, integration, E2E and SE-1 on every push to `main` and `phase-*` branches and on pull requests.

## Real PayPal sandbox journey (`@sandbox`)

Phase 4 completion criterion: three consecutive passing runs from a fresh reset, then `npm run invariants` with zero violations.

What one run does (`tests/sandbox/sandbox.spec.ts`):

1. Resets demo data (only families with `demo: true`) and seeds a family: owner "Sara Rivera" (the parent who is owed; payouts go to `SANDBOX_PAYOUT_EMAIL`), guest co-parent "Alex Rivera" (`SANDBOX_PAYER_EMAIL`), child Mia, the fixture agreement and a $120 dentist expense.
2. Signs in as the owner and subscribes to the Family plan on `/app/billing` with PayPal (the owner's sandbox account). Checks `subscriptions/{familyId}` is `ACTIVE`.
3. Uploads `fixtures/receipts/bright-smile-dental.jpg` (real Cloudinary + Gemini), checks the total read is $120.00, confirms it, and sends the $60.00 payment request.
4. Opens the emailed `/p/[token]` link as a guest, enters the emailed code, and pays with PayPal (the payer's sandbox account).
5. Waits for the capture (`payments/{expenseId}` COMPLETED, captured = owed + fee line), then for webhooks to move the claim to `SETTLED` (payout `SUCCESS`, one attempt). Checks `webhookEvents` has `PAYMENT.CAPTURE.COMPLETED` and `PAYMENT.PAYOUTS-ITEM.SUCCEEDED` (stored only after the signature check) and no event ended in `error`. Prints the PayPal fee and payout ids.
6. Checks the expense page and the ledger, then cancels the Family plan so sandbox subscriptions do not pile up.

Setup (Windows PowerShell):

```powershell
# Window 1: the app, with demo tooling and the dev outbox (process env only; .env.local is unchanged)
$env:DEMO_MODE="true"; $env:EMAIL_TRANSPORT="outbox"; npx next dev -p 3000

# Window 2: the tunnel PayPal webhooks are registered on (APP_URL)
ngrok http 3000 --url=<APP_URL host>

# Window 3: one run
npm run test:sandbox
```

`.env.local` needs `SANDBOX_PAYER_EMAIL` and `SANDBOX_PAYOUT_EMAIL` (two different sandbox personal accounts). With `SANDBOX_PAYER_PASSWORD` and `SANDBOX_PAYOUT_PASSWORD` as well, the run logs in to the PayPal popup by itself; without them, or when PayPal shows a CAPTCHA or security check, it prints `ACTION NEEDED` and waits up to 10 minutes for a person. Traces are off for this config because they would record the typed passwords. `SANDBOX_HEADLESS=1` hides the browser.

### Manual run (same checks, by hand)

On a low-memory machine the automated run can crash the dev server. The same criterion can be met by a person; each run uses a new owner account, which counts as a fresh reset.

1. Start `next dev` as above (`DEMO_MODE=true`, `EMAIL_TRANSPORT=outbox`) and ngrok. Emails and OTP codes are on `/dev/demo` (enter `DEV_SECRET`); sandbox `@personal.example.com` addresses are not real inboxes.
2. Sign up as the owner, paste `fixtures/agreement/demo-agreement.md`, confirm rules, add Mia, co-parent email = the payer sandbox email, PayPal step: "Use my PayPal email instead" = the receiver sandbox email.
3. `/app/billing`: subscribe with the receiver's sandbox login. Expect Family, Active, trial end date.
4. New expense: Dental, $120, purchased today. Expect Eligible, page 3 quote, other parent owes $60.00.
5. Receipt `bright-smile-dental.jpg`, date set to today. Expect $120.00 read, confirm, Ready to request.
6. Request $60.00. Expect "Payment request emailed", Waiting for payment.
7. Open the `/p/` link in a private window, enter the code. Expect share $60.00, fee $0.00 "Covered by the Family plan", total $60.00.
8. Pay with the payer's sandbox login. Expect Paid, then Settled within a few minutes.
9. Owner: expense page Settled with a payout batch id, ledger row settled. PayPal dashboard: payer -$60.00, receiver +$60.00.
10. Verify the data: capture COMPLETED, payout SUCCESS with one attempt, `webhookEvents` for the capture and payout item with no `error` outcome, then `npm run invariants` with zero violations.

Notes:

- "Three runs" means this same journey done three separate times in a row, each from a new owner account. It is a repeatability check, not three different scenarios. If a run fails, the count starts again.
- One-time codes: each "Email me a code" replaces the previous code for that link, and `/dev/demo` does not refresh by itself. Reload `/dev/demo` after asking for a code and use the newest code addressed to the payer. Old codes from earlier runs to the same sandbox address stay in the outbox (reset does not clear it).
- On an 8 GB machine `next dev` can run out of memory; close other apps first.
- The receipt fixtures are dated Nov 12, 2026; the run sets the receipt date to today.
- The platform business account needs a sandbox balance for payouts (captured funds count).
