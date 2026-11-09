# CLAUDE.md: Two Homes Preflight

This file plus `docs/spec/*` and `docs/phases/*` are the single source of truth for building **Two Homes Preflight**. This file holds what every session needs; details live in the spec files and are read on demand. Every decision here was already discussed and approved with the project owner (Huzaifa). Do not re-open a decision unless the code proves it impossible; if that happens, stop and ask.

- Hackathon: PayPal AI Hackathon 2026 (Devpost). Deadline: **Thu Nov 12, 2026, 12:00 PM PT = Fri Nov 13, 1:00 AM PKT**. Internal submission target: **Thu Nov 12, 9:00 PM PKT**.
- Judging criteria (equal weight): Technological Implementation, Design, Potential Impact, Innovation/Idea, Presentation. Judges may judge only from the video and description, so every important behaviour must be visible on screen.
- All money is **USD**. All environments are **PayPal sandbox**. All demo data is **synthetic** (no real agreements, no real children).
- **Zero-purchase policy:** nothing in this project may require paying for anything. Only free tiers, free trials that need no card, and open-source packages.

## Decision labels used in this file

| Label | Meaning |
| --- | --- |
| **[Agreed]** | Decided with the owner. Do not change. |
| **[Recommended]** | Technical decision taken during planning. Follow it; change only with a written reason in `docs/decisions.md` and only if it does not affect product behaviour. |
| **[Confirm]** | Open item. Use the stated default, and list it in the README "Open items" section. Ask the owner before changing user-visible behaviour. |

## Read this first: non-negotiable rules for Claude Code

1. This file is loaded in every session. Before each phase, read that phase's file in `docs/phases/` and only the spec files it lists. Do not read all of `docs/spec/` at once.
2. Follow the phases in Section M in order. Do not start a phase until the previous phase meets its completion criteria.
3. Do not add dependencies that are not listed in Section D. If you believe one is needed, ask first.
4. Never hardcode secrets. All configuration comes from `src/lib/env.ts` (zod-validated). Never commit `.env.local`.
5. Never fake an integration. If PayPal, Gemini, Resend or Cloudinary is unavailable, show a real error state. The only allowed fallback is the clearly labelled **demo mode** for AI extraction defined in Section G/Phase 2, and the **dev email outbox** in development and tests.
6. Never silently swallow errors. Every caught error is either handled with a user-visible state or rethrown, and always logged with the request id.
7. All state changes to expenses go through `transition()` (Section E.6). No route writes `approval.state` or `settlement.state` directly.
8. Money is integer cents everywhere. No floats for money, ever.
9. Do not mark a task complete until its tests pass and you have run the app and checked the behaviour (phone and desktop width for UI work).
10. Update `README.md` and `docs/` at the end of every phase (Section Q). Keep `docs/progress.md` current: done, in progress, next, blocked.
11. If something is unclear and not answered here, ask the owner before making an architectural decision. Small implementation details you may decide yourself; write them down in `docs/decisions.md`.
12. The owner works on **Windows** (PowerShell) with Claude Code in VS Code. Every command and npm script must work in Windows PowerShell; do not write bash-only syntax (`&&` chains with env assignments, `rm -rf`, `export`). Put environment differences in `.env.*` files or small Node scripts.
13. The owner communicates in Roman Urdu and English. Write all code, comments, commit messages and docs in English. Do not use em-dashes in user-facing copy.

## Documentation map (section letters used across all files)

| Section | File | Contents |
| --- | --- | --- |
| A | `docs/spec/product.md` | Problem, roles, vocabulary, user journeys, business logic, plans, pages and routes, out of scope, honesty notes |
| B | `docs/spec/stack.md` | Every technology: why, where, limits, free tier |
| C, D | this file | Folder structure, packages |
| E.1 to E.5, E.8 | `docs/spec/data-model.md` | Collections, fields, rules, indexes, listeners (plus L.6 Firebase local vs remote) |
| E.6, E.7 | `docs/spec/state-machine.md` | Verdict, approval and settlement machines, time-derived states, `transition()`, invariants |
| F | `docs/spec/auth-and-links.md` | App auth, authorization matrix, link tokens + OTP, Connect PayPal |
| G, J, L.1 to L.5 | `docs/spec/paypal-and-webhooks.md` | Orders, payouts, subscriptions, fees, idempotency, webhooks, ngrok, APIMatic plugin |
| H | `docs/spec/email-resend.md` | Resend setup, templates, sending rules |
| I | `docs/spec/receipts-cloudinary.md` | Receipt upload, private delivery, viewing |
| K | `docs/spec/ag-grid.md` | Grids, columns, Community features |
| M | `docs/phases/phase-0-verify-setup.md` to `phase-4-money-billing-launch.md` | One file per phase with its read list, tasks, endpoints, edge cases, tests, completion criteria |
| N | `docs/spec/testing.md` | Test strategy and every test case |
| O | `docs/spec/env.md` | Environment variables, `.env.example`, `.env.test` |
| P.9 | `docs/spec/ui-design.md` | Design tokens, typography, layout, animation |
| Appendix 2 | `docs/demo-script.md` | Demo video script and pre-demo checklist |

When a file says "Section X", open the file for X from this table.

## Product in one paragraph

Two Homes Preflight is a co-parenting expense app built around one idea: **check the agreement before you spend.** A parent uploads the parenting agreement; Gemini extracts expense rules, each with a verbatim quote and page that is verified against the text and confirmed by a human. Before a purchase, a deterministic rules engine (never AI) gives a clause-cited verdict (Eligible, Needs approval, Missing evidence, Not covered, Late, Needs review). The other parent approves through a no-install link protected by an email one-time code. The receipt goes to Cloudinary, is read by AI, confirmed and matched to the approval. The claim is settled through PayPal with the **pass-through model**: the paying parent pays the platform (Orders v2) and the platform pays the receiving parent (Payouts) to the PayPal account they connected once with Log in with PayPal. Free plan = full agreement loop with settlement recorded outside the app; Family plan (PayPal Subscriptions) = in-app settlement, fees covered up to a monthly volume, automatic reminders. Roles: owner (account required), co-parent (guest via links, optional account later), children (profiles only), platform (PayPal business sandbox account). Vocabulary is strict: "purchased" = paid the vendor; "paid/settled" = co-parent's share reimbursed. Full detail: `docs/spec/product.md`.

## Stack in one line

Next.js 16.4.5 (App Router, TypeScript 6.0.3, Node 24), Tailwind 4 + shadcn/ui + Motion, Firebase Auth + Cloud Firestore (no Storage, no Realtime Database), Cloudinary (receipts), Gemini via `@google/genai` 2.32.0, PayPal sandbox (Orders v2, Payouts, Subscriptions, Log in with PayPal, Webhooks), Resend (`mail.huzaifalabs.site`), AG Grid Community, Render free hosting, GitHub Actions, Vitest + Playwright + MSW + Firebase emulators (tests only). Details: `docs/spec/stack.md`.

---

# M. Phases (index)

| Phase | Target dates (PKT) | Outcome |
| --- | --- | --- |
| 0. Verify setup | Nov 8 evening (30 min) | Owner's setup verified, nothing reinstalled |
| 1. Foundation | Nov 8 night to Nov 9 morning | Design system, auth, onboarding shell, family, secure links + OTP, email, PayPal connect, state core |
| 2. Agreement and preflight | Nov 9 | Extraction, quote verification, rule review, rules engine, expenses, quick add |
| 3. Approvals and claims | Nov 10 | Approvals, receipts (Cloudinary), claims, outstanding/overdue, manual resolution, real-time UI |
| 4. Money, billing, launch | Nov 11 to Nov 12 | PayPal capture + payout, webhooks, subscriptions, AG Grid ledger, hardening, demo |

Each phase ends deployed on Render with its tests green. If time runs out, cut in this order and never further: (1) joined mode co-parent, (2) disputes, (3) PDF export, (4) annual caps, line items, child-specific rules, (5) refunds. **Never cut:** quote verification, preflight with citation, approval link with OTP, receipt match, capture + payout with idempotency, webhook verification, ledger, tests for state and money.

Phase files: `docs/phases/phase-0-verify-setup.md`, `phase-1-foundation.md`, `phase-2-agreement-preflight.md`, `phase-3-approvals-claims.md`, `phase-4-money-billing-launch.md`.

---

# C. Folder structure

```
two-homes-preflight/
├─ CLAUDE.md                     # this file (do not delete; update only with owner approval)
├─ README.md                     # maintained every phase (Section Q)
├─ SETUP_GUIDE.md                # owner's setup guide (do not edit unless asked)
├─ .env.example                  # placeholders only (Section O)
├─ .env.local                    # real values, never committed (no emulator variables)
├─ .env.test                     # emulator settings for tests only, committed (Section O)
├─ firebase.json                 # emulator config
├─ firestore.rules               # security rules (Section E.4)
├─ firestore.indexes.json        # composite indexes (Section E.5)
├─ next.config.ts
├─ vitest.config.ts
├─ playwright.config.ts
├─ components.json               # shadcn config
├─ .claude/skills/               # frontend-design, react-best-practices, web-design-guidelines (owner installs)
├─ .github/workflows/
│  ├─ ci.yml                     # typecheck, lint, unit, integration, e2e
│  └─ daily-job.yml              # scheduled POST /api/jobs/daily
├─ docs/
│  ├─ spec/                      # reference specs split from the blueprint (read on demand)
│  ├─ phases/                    # one file per phase (read the current one)
│  ├─ progress.md                # done / in progress / next / blocked
│  ├─ decisions.md               # small decisions Claude Code made, with reasons
│  ├─ api.md                     # endpoint reference (kept in sync with src/app/api)
│  ├─ architecture.md            # diagram + flows (Mermaid)
│  ├─ testing.md                 # how to run each test layer
│  └─ demo-script.md             # the video script and pre-demo checklist
├─ scripts/
│  ├─ setup-paypal-plans.ts      # creates PayPal catalog product + Family plan (sandbox)
│  ├─ seed-demo.ts               # synthetic family, agreement text, expenses
│  ├─ reset-demo.ts
│  └─ check-invariants.ts        # Section E.7
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
   │  └─ api/                    # Route Handlers (Section G/E endpoints; see docs/api.md)
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

**Installed by the owner before Claude Code starts** (per SETUP_GUIDE.md). Claude Code must check `package.json` first and not reinstall.

| Package | Version | Purpose | Where | When |
| --- | --- | --- | --- | --- |
| `next`, `react`, `react-dom` | 16.4.5, 19.3.1, 19.3.1 | Framework | all | Owner (create-next-app) |
| `typescript`, `@types/node`, `@types/react`, `@types/react-dom` | 6.0.3, 24.19.2, 19.3.0, 19.3.0 | Types | all | Owner |
| `tailwindcss`, `@tailwindcss/postcss` | 4.3.5 | Styling | all | Owner (create-next-app) |
| `eslint`, `eslint-config-next` | from create-next-app | Lint | all | Owner |
| shadcn init + base components | CLI 4.23.0 | UI primitives (adds `class-variance-authority`, `clsx`, `tailwind-merge`, Radix packages, `sonner`, `vaul` as needed) | `src/components/ui` | Owner |
| `firebase` | 13.2.0 | Client sign-in + listeners | `lib/firebase/client.ts` | Owner |
| `firebase-admin` | 14.5.0 | Server Firestore/Auth | `lib/firebase/admin.ts` | Owner |
| `zod` | 4.6.7 | Validation | everywhere | Owner |
| `server-only` | 0.0.1 | Prevents server modules in client bundles | server modules | Owner |
| `@google/genai` | 2.32.0 | Gemini | `lib/ai` | Owner |
| `@paypal/paypal-server-sdk` | 2.5.0 | Orders, refunds, subscriptions | `lib/paypal` | Owner |
| `@paypal/react-paypal-js` | 10.6.1 | Buttons | payment, billing pages | Owner |
| `cloudinary` | 2.11.0 | Receipt storage (server SDK) | `lib/receipts/cloudinary.ts` | Owner |
| `resend` | 6.37.0 | Email | `lib/email` | Owner |
| `ag-grid-community`, `ag-grid-react` | 36.3.0 | Tables | `components/grid` | Owner |
| `unpdf` | 2.1.0 | PDF text | `lib/pdf.ts` | Owner |
| `geist` | 1.9.2 | Fonts | `app/layout.tsx` | Owner |
| `lucide-react` | 1.70.0 | Icons | UI | Owner (shadcn may add it) |
| `next-themes` | 0.4.6 | Light/dark toggle | layout | Owner |
| `motion` | 14.10.1 | Animations and micro-interactions (Motion for React, formerly Framer Motion) | client components | Owner |
| `vitest`, `@vitest/coverage-v8` | 5.1.0 | Tests | `tests/` | Owner (dev) |
| `@playwright/test` | 1.65.0 | E2E | `tests/e2e` | Owner (dev) |
| `msw` | 3.0.4 | Mock external APIs in tests | `tests/helpers` | Owner (dev) |
| `firebase-tools` | 15.35.0 | Emulators, rules deploy | dev | Owner (dev) |
| `tsx` | 4.23.15 | Run `scripts/*.ts` | scripts | Owner (dev) |

**Claude Code may add later only if needed and listed here:** `@axe-core/playwright` (accessibility checks in E2E, Phase 4, optional). Nothing else without asking.

**Deliberately not used:** date libraries (use `Intl` and UTC timestamps), form libraries (native forms + zod), Levenshtein packages (own small function), email template libraries (HTML string templates in TS), state libraries.

---

# P. Security and engineering standards

1. **Validation:** every request body, query and route param parsed with zod in `route()`. Shared schemas in `src/schemas` are used by forms and handlers. AI outputs and PayPal responses are parsed with zod too.
2. **Errors:** `AppError(code, httpStatus, safeMessage)`. Response shape `{ "error": { "code": "STATE_CONFLICT", "message": "...", "requestId": "..." } }`. Statuses: 400 invalid, 401 unauthenticated, 402 plan required, 403 forbidden, 404 not found, 409 state conflict / duplicate, 410 link gone, 423 locked, 429 rate limited, 502 upstream failed, 503 database unavailable. Never leak stack traces or provider messages to users.
3. **Logging:** JSON logs with `requestId`, route, familyId, outcome, duration. Redact emails (keep domain), tokens, codes, secrets, agreement text, receipt contents. Log PayPal `debug_id`.
4. **Secrets:** only in env; `server-only` on modules that use them; never sent to the client; never in logs; `.env.local` in `.gitignore`.
5. **Authentication checks** on every handler via `route({ auth })`; authorization per Section F.2 in the `lib` function, not only in the UI.
6. **Webhooks:** signature verified before any processing (Section L).
7. **Rate limits:** OTP sends 3/hour/token, OTP attempts 5, quick add 30/hour/family, uploads 20/hour/family, approval requests 5/day/family, manual reminders 1/72 h/claim, AI extraction per plan.
8. **Consistency:** state only through `transition()`; uniqueness through deterministic ids and `create()`; totals through aggregation; time through `clock.ts` and `effective.ts`.
9. **Design system and UI quality:** see `docs/spec/ui-design.md`.
10. **Accessibility:** semantic HTML, labels on every input, focus states, `aria-live` for status changes, colour never the only signal.
11. **Performance:** Server Components for reads; client components only where interactive; listeners limited; images via `next/image` only for static assets (receipts load from short-lived URLs); avoid loading the PayPal SDK except on payment and billing pages.
12. **Maintainability:** thin handlers, logic in `lib`, shared types in `src/types`, no duplicated money/status logic in the UI, reusable domain components, small files (split at ~300 lines).

---

# Q. README and documentation maintenance (mandatory)

Claude Code creates `README.md` in Phase 0 and updates it at the end of **every** phase, not at the end of the project. Each update must keep these sections current:

1. What it is (positioning statement) and the demo video link (placeholder until recorded)
2. Features implemented so far (by phase), with screenshots added in Phase 4
3. Architecture overview (link to `docs/architecture.md` with a Mermaid diagram of the flow: client, Next.js, Firestore, Gemini, Cloudinary, Resend, PayPal)
4. Setup: prerequisites, install, env variables (table referencing `.env.example`), running emulators, running ngrok, running the app
5. API endpoints (summary; full list in `docs/api.md`)
6. Integrations: PayPal (sandbox, pass-through model, events), Gemini, Cloudinary, Resend, AG Grid features used, "Built with the PayPal Context Plugin (APIMatic)"
7. Testing: how to run unit, integration, E2E, sandbox E2E, invariant checker
8. Demo: test credentials (sandbox only), `/dev/demo` usage
9. Known limitations and honesty notes (Section A.10), open [Confirm] items
10. Changelog per phase

Also after each phase: update `docs/progress.md`, `docs/api.md`, `docs/decisions.md`, and this file or any `docs/spec/*` file only if the owner approved a change.

---

# R. Claude Code development rules

1. Read this file, then the current phase file and the spec files it lists. Do not load all specs at once.
2. Follow the finalized architecture. Do not change [Agreed] decisions. Record [Recommended] deviations with reasons and ask if they affect behaviour.
3. Do not introduce dependencies outside Section D.
4. Do not skip phases or their tests. Do not mark a feature complete without running it and its tests.
5. No fake integrations, no mocked production behaviour. Mocks exist only in tests. Demo mode and dev outbox are the only labelled exceptions.
6. No hardcoded credentials, ids or URLs; everything from env.
7. Never silently ignore errors.
8. Keep frontend, API, schemas and Firestore types consistent: one zod schema per contract, types inferred from it.
9. Update README and docs after every phase (Section Q). Keep `docs/progress.md` current with done, in progress, next, blocked.
10. Ask the owner before any significant architectural decision not covered here. For PayPal behaviour you are unsure about, check the APIMatic context plugin or PayPal docs first, then ask.
11. Work in small commits with clear messages. Do not push to the default branch without the owner's go-ahead; use feature branches per phase.
12. At the end of each phase, report: what was built, test results, what was verified manually (phone and desktop), open issues, [Confirm] items needing the owner.

---

# Appendix 1. Open items [Confirm]

| # | Item | Default |
| --- | --- | --- |
| 1 | Family plan price, trial, covered volume | $7.99/month, 14 days, $200/month (illustrative) |
| 2 | Fee-line constants | Read from a real sandbox capture |
| 3 | Default due days | 30 |
| 4 | Log in with PayPal availability on the sandbox app | Test Phase 1 hour 1; fallback email |
| 5 | Exact Log in with PayPal endpoints and userinfo field names | Verify in sandbox, log raw response once |
| 6 | Payouts duplicate `sender_batch_id` error shape; unclaimed return period; sandbox payout fee | Test in sandbox |
| 7 | TypeScript 7 compatibility | Stay on 6.0.3 unless `next build` passes cleanly |
| 9 | AG Grid sponsor prize proof requirements | README section either way |
