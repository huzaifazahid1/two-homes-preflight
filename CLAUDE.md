# CLAUDE.md: Two Homes Preflight

Instructions for Claude Code when working on **Two Homes Preflight**. This file is loaded in every session and holds the product summary, architecture rules, folder structure, packages and engineering standards. Public reference docs live in `docs/` (see the map below).

- Built for the PayPal AI Hackathon 2026.
- All money is **USD**. All environments are **PayPal sandbox**. All demo data is **synthetic** (no real agreements, no real children).
- **Zero-purchase policy:** nothing in this project may require paying for anything. Only free tiers, free trials that need no card, and open-source packages.

## Non-negotiable rules

1. Work in phases. Do not start new work until the previous step's tests pass.
2. Do not add dependencies that are not listed in Section D. If you believe one is needed, ask first.
3. Never hardcode secrets. All configuration comes from `src/lib/env.ts` (zod-validated). Never commit `.env.local`.
4. Never fake an integration. If PayPal, Gemini, Resend or Cloudinary is unavailable, show a real error state. The only allowed fallbacks are the clearly labelled **demo mode** for AI extraction and the **dev email outbox** in development and tests.
5. Never silently swallow errors. Every caught error is either handled with a user-visible state or rethrown, and always logged with the request id.
6. All state changes to expenses go through `transition()` (`src/lib/state/transition.ts`). No route writes `approval.state` or `settlement.state` directly.
7. Money is integer cents everywhere. No floats for money, ever.
8. Do not mark a task complete until its tests pass and you have run the app and checked the behaviour (phone and desktop width for UI work).
9. Update `README.md` and `docs/` at the end of every phase (Section Q).
10. If something is unclear, ask the maintainer before making an architectural decision. Small implementation details you may decide yourself; write them down in `docs/decisions.md`.
11. The maintainer works on **Windows** (PowerShell) with Claude Code in VS Code. Every command and npm script must work in Windows PowerShell; do not write bash-only syntax (`&&` chains with env assignments, `rm -rf`, `export`). Put environment differences in `.env.*` files or small Node scripts.
12. Write all code, comments, commit messages and docs in English. Do not use em-dashes in user-facing copy.

## Documentation map

| File | Contents |
| --- | --- |
| `README.md` | Product, features, architecture summary, setup, testing, limitations |
| `docs/architecture.md` | Mermaid diagrams of the main flows |
| `docs/api.md` | Endpoint reference (kept in sync with `src/app/api`) |
| `docs/testing.md` | How to run each test layer |
| `docs/decisions.md` | Implementation decisions, with reasons |

## Product in one paragraph

Two Homes Preflight is a co-parenting expense app built around one idea: **check the agreement before you spend.** A parent uploads the parenting agreement; Gemini extracts expense rules, each with a verbatim quote and page that is verified against the text and confirmed by a human. Before a purchase, a deterministic rules engine (never AI) gives a clause-cited verdict (Eligible, Needs approval, Missing evidence, Not covered, Late, Needs review). The other parent approves through a no-install link protected by an email one-time code. The receipt goes to Cloudinary, is read by AI, confirmed and matched to the approval. The claim is settled through PayPal with the **pass-through model**: the paying parent pays the platform (Orders v2) and the platform pays the receiving parent (Payouts) to the PayPal account they connected once with Log in with PayPal. Free plan = full agreement loop with settlement recorded outside the app; Family plan (PayPal Subscriptions) = in-app settlement, fees covered up to a monthly volume, automatic reminders. Roles: owner (account required), co-parent (guest via links, optional account later), children (profiles only), platform (PayPal business sandbox account). Vocabulary is strict: "purchased" = paid the vendor; "paid/settled" = co-parent's share reimbursed.

## Stack in one line

Next.js 16.4.5 (App Router, TypeScript 6.0.3, Node 24), Tailwind 4 + shadcn/ui + Motion, Firebase Auth + Cloud Firestore (no Storage, no Realtime Database), Cloudinary (receipts), Gemini via `@google/genai` 2.32.0, PayPal sandbox (Orders v2, Payouts, Subscriptions, Log in with PayPal, Webhooks), Resend (`mail.huzaifalabs.site`), AG Grid Community, Render free hosting, GitHub Actions, Vitest + Playwright + MSW + Firebase emulators (tests only).

---

# C. Folder structure

```
two-homes-preflight/
├─ CLAUDE.md                     # this file
├─ README.md                     # maintained every phase (Section Q)
├─ .env.example                  # placeholders only
├─ .env.local                    # real values, never committed (no emulator variables)
├─ .env.test                     # emulator settings for tests only, committed
├─ firebase.json                 # emulator config
├─ firestore.rules               # security rules
├─ firestore.indexes.json        # composite indexes
├─ next.config.ts
├─ vitest.config.ts
├─ playwright.config.ts
├─ components.json               # shadcn config
├─ .claude/skills/               # project skills (design, React, motion, PayPal SDK)
├─ .github/workflows/
│  ├─ ci.yml                     # typecheck, lint, unit, integration, e2e
│  └─ daily-job.yml              # scheduled POST /api/jobs/daily
├─ docs/
│  ├─ api.md                     # endpoint reference (kept in sync with src/app/api)
│  ├─ architecture.md            # diagram + flows (Mermaid)
│  ├─ decisions.md               # implementation decisions, with reasons
│  └─ testing.md                 # how to run each test layer
├─ scripts/
│  ├─ setup-paypal-plans.ts      # creates PayPal catalog product + Family plan (sandbox)
│  ├─ seed-demo.ts               # synthetic family, agreement text, expenses
│  ├─ reset-demo.ts
│  └─ check-invariants.ts        # state and money invariants
├─ fixtures/
│  ├─ agreement/demo-agreement.pdf   # synthetic, written by us
│  ├─ receipts/*.jpg|pdf             # synthetic receipts
│  └─ ai/*.json                      # recorded Gemini responses for tests and demo mode
├─ tests/
│  ├─ unit/                      # pure logic
│  ├─ integration/               # route handlers against emulators + MSW
│  ├─ api/                       # auth matrix, validation
│  ├─ e2e/                       # Playwright (projects: phone, desktop; @sandbox tag)
│  └─ helpers/                   # emulator reset, fake clock, factories, msw handlers
└─ src/
   ├─ proxy.ts                   # redirects signed-out users from /app and /onboarding (no authorization here)
   ├─ app/
   │  ├─ (public)/               # /, /pricing, /legal/*, /login, /signup, /verify-email
   │  ├─ onboarding/             # wizard
   │  ├─ (app)/app/              # dashboard, expenses, money, ledger, agreement, billing, settings
   │  ├─ r/[token]/  a/[token]/  p/[token]/   # link pages
   │  ├─ connect/paypal/callback/
   │  ├─ dev/demo/               # only when DEMO_MODE=true
   │  └─ api/                    # Route Handlers (see docs/api.md)
   │     ├─ auth/  me/  family/  links/  agreements/  rule-versions/  ai/
   │     ├─ expenses/  receipts/  disputes/  dashboard/  ledger/  billing/
   │     ├─ paypal/connect/      # start + callback exchange
   │     ├─ webhooks/paypal/
   │     ├─ jobs/daily/
   │     └─ dev/                 # seed/reset, guarded
   ├─ components/
   │  ├─ ui/                     # shadcn components (owned code)
   │  ├─ layout/                 # AppShell, BottomTabs, Sidebar, TopBar
   │  ├─ domain/                 # ClauseCard, VerdictBadge, StatusBadge, Money, SplitBar, Timeline, OtpInput
   │  └─ grid/                   # AG Grid wrappers, theme, cell renderers
   ├─ hooks/                     # client hooks (useExpenseListener, useNotifications)
   ├─ lib/
   │  ├─ env.ts                  # zod-validated env (server) + publicEnv (client)
   │  ├─ clock.ts                # now(); overridable in tests
   │  ├─ money.ts                # cents helpers, formatting (USD only)
   │  ├─ ids.ts                  # token and id generation
   │  ├─ route.ts                # route() wrapper: auth, zod, rate limit, errors, request id
   │  ├─ errors.ts               # AppError codes -> HTTP status
   │  ├─ log.ts                  # structured logging, redaction
   │  ├─ rate-limit.ts
   │  ├─ audit.ts
   │  ├─ firebase/admin.ts       # Admin SDK (server only)
   │  ├─ firebase/client.ts      # client SDK (auth + read-only listeners)
   │  ├─ auth/session.ts         # session cookie create/verify, requireUser, requireFamily, requireOwner
   │  ├─ links/tokens.ts         # create/resolve/revoke link tokens
   │  ├─ links/otp.ts            # OTP challenge and verification
   │  ├─ links/session.ts        # HMAC-signed link session cookie
   │  ├─ state/machines.ts       # approval + settlement transition tables
   │  ├─ state/effective.ts      # time-derived states (expiry, overdue, link usable, entitlement)
   │  ├─ state/transition.ts     # the only writer of approval/settlement state
   │  ├─ rules-engine.ts         # evaluate()
   │  ├─ quote-verify.ts
   │  ├─ pdf.ts                  # unpdf per-page text
   │  ├─ ai/gemini.ts  ai/prompts.ts  ai/schemas.ts  ai/demo-mode.ts
   │  ├─ receipts/upload.ts  receipts/match.ts  receipts/cloudinary.ts
   │  ├─ claims.ts  approvals.ts  disputes.ts
   │  ├─ paypal/http.ts          # OAuth token cache + typed fetch (Payouts, webhooks verify, identity, catalog)
   │  ├─ paypal/sdk.ts           # Server SDK client
   │  ├─ paypal/orders.ts  paypal/payouts.ts  paypal/subscriptions.ts
   │  ├─ paypal/connect.ts       # Log in with PayPal
   │  ├─ paypal/webhooks.ts      # verify + dispatch
   │  ├─ settlement.ts           # capture -> payout orchestration, reconcile
   │  ├─ entitlement.ts
   │  ├─ email/send.ts  email/templates/*.ts  email/outbox.ts
   │  ├─ notifications.ts        # writes notifications docs + email
   │  ├─ jobs/daily.ts
   │  └─ data/                   # server-only read functions for Server Components
   ├─ schemas/                   # zod schemas shared by client forms and API
   └─ types/                     # shared TypeScript types (Firestore document types)
```

Rules for the structure:
- Anything importing `firebase-admin`, secrets, PayPal, Gemini, Cloudinary or Resend starts with `import 'server-only'`.
- Client components never import from `src/lib/*` except `money.ts`, `schemas/`, `types/` and `firebase/client.ts`.
- Route Handlers stay thin: parse with `route()`, call a `lib` function, return. Business logic lives in `lib`.

---

# D. Packages

Check `package.json` first and do not reinstall anything already present.

| Package | Version | Purpose | Where |
| --- | --- | --- | --- |
| `next`, `react`, `react-dom` | 16.4.5, 19.3.1, 19.3.1 | Framework | all |
| `typescript`, `@types/node`, `@types/react`, `@types/react-dom` | 6.0.3, 24.19.2, 19.3.0, 19.3.0 | Types | all |
| `tailwindcss`, `@tailwindcss/postcss` | 4.3.5 | Styling | all |
| `eslint`, `eslint-config-next` | from create-next-app | Lint | all |
| shadcn init + base components | CLI 4.23.0 | UI primitives (adds `class-variance-authority`, `clsx`, `tailwind-merge`, Radix packages, `sonner`, `vaul` as needed) | `src/components/ui` |
| `firebase` | 13.2.0 | Client sign-in + listeners | `lib/firebase/client.ts` |
| `firebase-admin` | 14.5.0 | Server Firestore/Auth | `lib/firebase/admin.ts` |
| `zod` | 4.6.7 | Validation | everywhere |
| `server-only` | 0.0.1 | Prevents server modules in client bundles | server modules |
| `@google/genai` | 2.32.0 | Gemini | `lib/ai` |
| `@paypal/paypal-server-sdk` | 2.5.0 | Orders, refunds, subscriptions | `lib/paypal` |
| `@paypal/react-paypal-js` | 10.6.1 | Buttons | payment, billing pages |
| `cloudinary` | 2.11.0 | Receipt storage (server SDK) | `lib/receipts/cloudinary.ts` |
| `resend` | 6.37.0 | Email | `lib/email` |
| `ag-grid-community`, `ag-grid-react` | 36.3.0 | Tables | `components/grid` |
| `unpdf` | 2.1.0 | PDF text | `lib/pdf.ts` |
| `geist` | 1.9.2 | Fonts | `app/layout.tsx` |
| `lucide-react` | 1.70.0 | Icons | UI |
| `next-themes` | 0.4.6 | Light/dark toggle | layout |
| `motion` | 14.10.1 | Animations and micro-interactions (Motion for React, formerly Framer Motion) | client components |
| `vitest`, `@vitest/coverage-v8` | 5.1.0 | Tests | `tests/` |
| `@playwright/test` | 1.65.0 | E2E | `tests/e2e` |
| `msw` | 3.0.4 | Mock external APIs in tests | `tests/helpers` |
| `firebase-tools` | 15.35.0 | Emulators, rules deploy | dev |
| `tsx` | 4.23.15 | Run `scripts/*.ts` | scripts |

**May be added only if needed:** `@axe-core/playwright` (accessibility checks in E2E). Nothing else without asking.

**Deliberately not used:** date libraries (use `Intl` and UTC timestamps), form libraries (native forms + zod), Levenshtein packages (own small function), email template libraries (HTML string templates in TS), state libraries.

---

# P. Security and engineering standards

1. **Validation:** every request body, query and route param parsed with zod in `route()`. Shared schemas in `src/schemas` are used by forms and handlers. AI outputs and PayPal responses are parsed with zod too.
2. **Errors:** `AppError(code, httpStatus, safeMessage)`. Response shape `{ "error": { "code": "STATE_CONFLICT", "message": "...", "requestId": "..." } }`. Statuses: 400 invalid, 401 unauthenticated, 402 plan required, 403 forbidden, 404 not found, 409 state conflict / duplicate, 410 link gone, 423 locked, 429 rate limited, 502 upstream failed, 503 database unavailable. Never leak stack traces or provider messages to users.
3. **Logging:** JSON logs with `requestId`, route, familyId, outcome, duration. Redact emails (keep domain), tokens, codes, secrets, agreement text, receipt contents. Log PayPal `debug_id`.
4. **Secrets:** only in env; `server-only` on modules that use them; never sent to the client; never in logs; `.env.local` in `.gitignore`.
5. **Authentication checks** on every handler via `route({ auth })`; authorization in the `lib` function, not only in the UI.
6. **Webhooks:** signature verified before any processing.
7. **Rate limits:** OTP sends 3/hour/token, OTP attempts 5, quick add 30/hour/family, uploads 20/hour/family, approval requests 5/day/family, manual reminders 1/72 h/claim, AI extraction per plan.
8. **Consistency:** state only through `transition()`; uniqueness through deterministic ids and `create()`; totals through aggregation; time through `clock.ts` and `effective.ts`.
9. **Design system and UI quality:** use the tokens in `src/app/globals.css` and the shared components in `src/components`; no one-off colours, sizes or shadows.
10. **Accessibility:** semantic HTML, labels on every input, focus states, `aria-live` for status changes, colour never the only signal.
11. **Performance:** Server Components for reads; client components only where interactive; listeners limited; images via `next/image` only for static assets (receipts load from short-lived URLs); avoid loading the PayPal SDK except on payment and billing pages.
12. **Maintainability:** thin handlers, logic in `lib`, shared types in `src/types`, no duplicated money/status logic in the UI, reusable domain components, small files (split at ~300 lines).

---

# Q. README and documentation maintenance

`README.md` is updated at the end of every phase, not at the end of the project. Keep these sections current:

1. What it is and the demo video link
2. Features implemented, with screenshots
3. Architecture overview (link to `docs/architecture.md`)
4. Setup: prerequisites, install, env variables (referencing `.env.example`), emulators, ngrok, running the app
5. API endpoints (summary; full list in `docs/api.md`)
6. Integrations: PayPal (sandbox, pass-through model, events), Gemini, Cloudinary, Resend, AG Grid features used, APIMatic
7. Testing: unit, integration, E2E, sandbox E2E, invariant checker
8. Demo: sandbox test credentials, `/dev/demo` usage
9. Known limitations and honesty notes
10. Changelog

Also after each phase: update `docs/api.md` and `docs/decisions.md`.

---

# R. Claude Code development rules

1. Follow the finalized architecture. Record technical deviations with reasons in `docs/decisions.md` and ask if they affect behaviour.
2. Do not introduce dependencies outside Section D.
3. Do not skip tests. Do not mark a feature complete without running it and its tests.
4. No fake integrations, no mocked production behaviour. Mocks exist only in tests. Demo mode and dev outbox are the only labelled exceptions.
5. No hardcoded credentials, ids or URLs; everything from env.
6. Never silently ignore errors.
7. Keep frontend, API, schemas and Firestore types consistent: one zod schema per contract, types inferred from it.
8. Ask before any significant architectural decision not covered here. For PayPal behaviour you are unsure about, check the APIMatic context plugin or PayPal docs first, then ask.
9. Work in small commits with clear messages. Do not push to the default branch without the maintainer's go-ahead; use feature branches per phase.
