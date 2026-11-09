# Two Homes Preflight

**Check the agreement before you spend.** A co-parenting expense app that reads your parenting agreement, tells you before a purchase whether it is covered (with the exact clause cited), gets the other parent's approval through a no-install link, matches the receipt, and settles the share through PayPal.

Built for the PayPal AI Hackathon 2026. All money is USD, all payments run in the PayPal sandbox, and all demo data is synthetic.

Demo video: _coming in Phase 4_

## 1. Features

| Phase | Status | Features |
| --- | --- | --- |
| 0. Verify setup | Done | Toolchain verified, test and script wiring, project docs |
| 1. Foundation | Not started | Design system, auth, onboarding, family, secure links + OTP, email, Connect PayPal, state core |
| 2. Agreement and preflight | Not started | AI rule extraction, quote verification, rule review, rules engine, expenses, quick add |
| 3. Approvals and claims | Not started | Approvals, receipts, claims, overdue, manual resolution, real-time UI |
| 4. Money, billing, launch | Not started | PayPal capture + payout, webhooks, subscriptions, ledger, hardening |

Screenshots are added in Phase 4.

## 2. Architecture

Next.js 16 (App Router) on Render, Firebase Auth + Cloud Firestore, Gemini for extraction, Cloudinary for receipts, Resend for email, PayPal sandbox for payments. The rules engine that gives verdicts is deterministic code, never AI.

See `docs/architecture.md` (diagram added in Phase 1).

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
| Cloudinary | `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `CLOUDINARY_FOLDER_PREFIX` |

Never put `FIRESTORE_EMULATOR_HOST` or `FIREBASE_AUTH_EMULATOR_HOST` in `.env.local`. They live only in `.env.test`.

### Run

```powershell
npm run dev          # http://localhost:3000, uses the real Firebase project
```

Emulators are used only by automated tests (see Testing). ngrok setup for PayPal webhooks is documented in Phase 4.

## 4. API endpoints

None yet. Full reference: `docs/api.md`.

## 5. Integrations

- **PayPal (sandbox):** pass-through model. The paying parent pays the platform (Orders v2) and the platform pays the receiving parent (Payouts). Family plan via Subscriptions. Log in with PayPal to connect the receiving account. Webhooks are verified before processing. Built with the PayPal Context Plugin (APIMatic).
- **Gemini:** extracts agreement rules with verbatim quotes and reads receipts. Quotes are verified against the PDF text, and a person confirms every rule.
- **Cloudinary:** private receipt storage with short-lived delivery URLs.
- **Resend:** transactional email from `mail.huzaifalabs.site`; a dev outbox is used in development and tests.
- **AG Grid Community:** ledger and expense tables.

_Details are filled in as each integration is built._

## 6. Testing

| Command | What it runs |
| --- | --- |
| `npm run test:unit` | Vitest unit tests (`tests/unit`) |
| `npm run test:integration` | Vitest integration + API tests inside the Firebase emulators (project `demo-two-homes`) |
| `npm test` | Unit, then integration |
| `npm run test:e2e` | Playwright, phone (375 px) and desktop (1440 px) projects |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run invariants` | Invariant checker (Section E.7; added in a later phase) |

Tests read only `.env.test` and never touch the real Firebase project.

## 7. Demo

Sandbox test credentials and `/dev/demo` usage are added in a later phase. `npm run seed` and `npm run reset` load and clear the synthetic demo family (scripts added in a later phase).

## 8. Known limitations and open items

Honesty notes from the product spec are added as features land.

Open [Confirm] items (defaults in use):

| # | Item | Default |
| --- | --- | --- |
| 1 | Family plan price, trial, covered volume | $7.99/month, 14 days, $200/month (illustrative) |
| 2 | Fee-line constants | Read from a real sandbox capture |
| 3 | Default due days | 30 |
| 4 | Log in with PayPal availability on the sandbox app | Test in Phase 1; fallback email |
| 5 | Log in with PayPal endpoints and userinfo field names | Verify in sandbox |
| 6 | Payouts duplicate `sender_batch_id` error shape, unclaimed period, sandbox fee | Test in sandbox |
| 7 | TypeScript 7 compatibility | Stay on 6.0.3 |
| 9 | AG Grid sponsor prize proof requirements | README section either way |

## 9. Changelog

- **Phase 0 (2026-11-09):** Verified toolchain (Node 24, Java 21, Firebase CLI + emulators), build, typecheck and lint. Added npm scripts, Vitest and Playwright configs, and project docs. Allowed `.env.test` to be committed.
