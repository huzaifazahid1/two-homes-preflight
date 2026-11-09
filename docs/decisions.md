# Decisions

Small implementation decisions made by Claude Code, with reasons. Architectural or behaviour changes are never recorded here without owner approval.

## Phase 0

| # | Decision | Reason |
| --- | --- | --- |
| 0.1 | Keep the shadcn "base-nova" scaffold as installed: `@base-ui/react` primitives and the `cn` package (by shadcn, `github.com/shadcn-ui/cn`) instead of `clsx` + `tailwind-merge`. | Installed by the owner via shadcn CLI 4.23; Section D allows packages shadcn adds. Not reinstalled. |
| 0.2 | Tailwind runs through `@tailwindcss/turbopack` (configured in `next.config.ts`) rather than `@tailwindcss/postcss`. | That is what the owner's scaffold uses and the build passes. No change. |
| 0.3 | Set `turbopack.root` to the project folder in `next.config.ts`. | A `package-lock.json` in the parent `D:\projects` folder caused a root-detection warning on every build. |
| 0.4 | Added `!.env.test` to `.gitignore`. | The create-next-app rule `.env*` ignored it, but Section O says `.env.test` is committed. It holds no secrets. |
| 0.5 | Vitest reads `.env.test` with Node's built-in `util.parseEnv` and never reads `.env.local`. | Guarantees tests cannot reach the real Firebase project or real providers. No extra dependency. |
| 0.6 | Vitest projects: `unit` = `tests/unit`; `integration` = `tests/integration` + `tests/api` (run one file at a time). `test:integration` wraps the run in `firebase emulators:exec --project demo-two-homes`. | API tests hit route handlers that need the emulators; one shared emulator means files must not run in parallel. |
| 0.7 | `passWithNoTests` (Vitest) and `--pass-with-no-tests` (Playwright) are on for now. | No tests exist yet in Phase 0. Remove the Playwright flag once the first E2E test lands in Phase 1. |
| 0.8 | `seed`, `reset`, `invariants` run with `tsx --env-file=.env.local`. | Cross-platform env loading in PowerShell without `dotenv` or shell syntax. |
| 0.9 | Playwright config is minimal (testDir, phone 375 px, desktop 1440 px). Web server and emulator wiring are deferred to Phase 1. | Avoid building test infrastructure before there is an app to test. |
| 0.10 | Installed motion skills `animate`, `choreograph`, `review-animations` from `emilkowalski/skills` (MIT, commit `5206a95`), copied into `.claude/skills`. Skipped the repo's iOS/Expo/Swift skills, `emil-design-eng` (overlaps `frontend-design`), `improve-animations` / `find-animation-opportunities` (overlap `review-animations` and push for more motion than the spec allows), `gestures` (Base UI drawer already handles drag), `animation-performance` (covered by the composite-only rule). No Remotion, Lottie, GSAP, Three.js or video skills: the spec uses only `motion`. | The spec (P.9) asks for a small, fixed set of purposeful UI animations with Motion for React. No official Motion skill exists; third-party Motion API skills had unverified sources. |
| 0.11 | Added project skill `two-homes-motion`. It maps P.9 to rules and overrides generic skill values (some recipes use 400 to 600 ms; the spec caps at 400 ms). Default ease-out `[0.23, 1, 0.32, 1]`; reduced motion via `MotionConfig reducedMotion="user"` plus `useReducedMotion()`. | Keeps installed third-party skills unmodified so they can be updated, while the project rules always win. |
| 0.12 | PayPal Server SDK context plugin: copied only its 8 `typescript-*` skills from `~/.context-plugins/vscode/paypal` into `.claude/skills`. | The installer found no `claude` CLI on PATH (Claude Code runs only as the VS Code extension), so it installed for VS Code chat only. The plugin has skills only, no MCP server, so it never appears in `/mcp`. Other languages are irrelevant to this TypeScript project. |

## Phase 1

| # | Decision | Reason |
| --- | --- | --- |
| 1.1 | `src/lib/env.ts` (server, `server-only`) and `src/lib/public-env.ts` (client) are two files instead of one. | If the server schema lived in a client-importable file, secret variable names would end up in the browser bundle (SE-1). |
| 1.2 | The agreement step (Phase 2) can be passed only when `NODE_ENV !== "production"` or `DEMO_MODE=true`, with "coming in this build" copy. The plan step offers Free for real; Family is shown as not ready yet. | Phase 1 file: placeholders only in development. `DEMO_MODE` lets the Phase 1 Render deploy be walked end to end. **Owner: confirm this is acceptable for the Phase 1 deploy.** |
| 1.3 | The family shell (owner only, no co-parent) is created when the profile step completes. `POST /api/family` is create-or-update and sets the co-parent's name and email. | Phase 2 agreement upload (step 2) needs a `familyId` before the family step (step 3). |
| 1.4 | `GET /api/paypal/connect/start` returns `{ url }` JSON and sets the state cookie; the page then navigates to PayPal. | Errors (401/403/400) can be shown inline instead of on a raw JSON page after a redirect. Same behaviour otherwise. |
| 1.5 | `DELETE /api/auth/session` has auth `none`: it always clears the cookie and revokes refresh tokens only if the session is still valid. | A user with an expired session must still be able to sign out cleanly (AU-6). |
| 1.6 | Cookie names: `thp_session` (5 days), `thp_link` (30 min), `thp_pp_state` (10 min). All httpOnly, SameSite=Lax, Secure when `APP_URL` is https. | Section F naming was open. |
| 1.7 | `CANCEL_EXPENSE` is allowed from NONE, RECEIPT_SUBMITTED, RECEIPT_ISSUE, READY, AWAITING_PAYMENT, PAYMENT_FAILED. Not from EXTERNAL_PAYMENT_REPORTED or DISPUTED. | "Any non-terminal before PAID": once a payment was reported or disputed, cancelling would hide that record. |
| 1.8 | No-op rule: an event whose target equals the current state is recorded as a `note` events row and not applied. Webhook-replayable events (`CAPTURE_COMPLETED`, `PAYOUT_*`) are also no-ops in later states. Every other disallowed pair is 409. | Section E.6.4 "already happened is recorded as noop". Late webhooks must not 409. |
| 1.9 | A derived expiry persisted by the next write gets its own events row stamped with `expiresAt`, and version increases by 2. | Invariant 11 (every state change has one events row) and correct timeline order. |
| 1.10 | Integration tests mock PayPal and Resend with a small local HTTP stub (`tests/helpers/stub-server.ts`) pointed to by `PAYPAL_API_BASE` / `RESEND_BASE_URL`, not MSW. `msw` stays installed for later unit tests. | MSW's Node interceptors stall the Admin SDK's gRPC (HTTP/2) channel to the Firestore emulator; Firestore REST mode needs real credentials. |
| 1.11 | The Playwright `phone` project uses the iPhone 13 profile on Chromium. | Only Chromium is installed; WebKit would be an extra download on a memory-limited machine. Viewport, touch and mobile UA are kept. |
| 1.12 | E2E runs `scripts/e2e-server.mjs`: `.env.test` in the process env (wins over `.env.local`), `E2E=true`, `DEMO_MODE=true`, build to `.next-e2e`, start on port 3100. `env.ts` refuses emulator variables in production unless `E2E=true`. | Section N.1 asks for `next build && next start` with emulators and outbox. Port 3100 avoids clashing with `npm run dev`. |
| 1.13 | `.env.test` has test-only dummy values (secrets, Firebase web config, PayPal ids). | `env.ts` validates them; they are not real secrets. |
| 1.14 | Added `POST /api/notifications/read` (own notifications only). | Clients cannot write Firestore, and the bell needs to clear unread items. |
| 1.15 | A second `POST /api/family/invite` while an invite is active is 409; `POST /api/family/invite/resend` is the explicit action that revokes and replaces. Invite sends are limited to 10/hour/user. | Prevents accidental double emails; LK-9 semantics stay explicit. |
| 1.16 | OTP codes are single use (cleared on success); the 5th wrong code clears the code and sets a 15-minute lock (423). A new code resets attempts. | Section F.3. 423 chosen over 429 for the lock so the UI can tell it apart from the send limit. |
| 1.17 | Changing the co-parent's email after an invite was sent revokes the active invite and resets the status to `not_sent`. After acceptance it is refused (409). | The old link would otherwise send codes to the old address. |
| 1.18 | The "invite accepted" notification is in-app only (`email.status = skipped`). | No email template for it in Section H.3. |
| 1.19 | Every `/app` page calls `requireOnboarded()` itself, not only the layout. `getMe()` calls `connection()` first. | Layouts and pages render in parallel, so a page cannot rely on the layout's redirect. Firebase session verification reads the clock, which is not allowed in a runtime prerender. |
| 1.20 | The Admin Firestore instance is cached on `globalThis`. | Next bundles route handlers and pages separately; `settings()` can only be called once per shared instance. |
| 1.21 | Status metadata (`VERDICT_META`, `INVITE_STATUS`) lives in `status-meta.ts` without `"use client"`. | Plain objects exported from a client module are client references in Server Components. |
| 1.22 | The type scale (`t-h1`, `t-amount`, ...) is defined with Tailwind `@utility`. | Allows responsive variants such as `sm:t-display`. |
| 1.23 | Sign-out, 401 redirects and `permission-denied` use `window.location.assign` (full reload). | Drops all client state and Firestore listeners after auth changes. Lint rule disabled on those lines with the reason. |
| 1.24 | `src/components/ui/drawer.tsx` durations lowered from 450 ms to 300 ms; `button.tsx` transitions list properties instead of `transition-all`. | Motion cap (P.9) and the web interface guidelines review. |
| 1.25 | Log in with PayPal authorize URL: `https://www.sandbox.paypal.com/connect?flowEntry=static&...`; userinfo `GET /v1/identity/oauth2/userinfo?schema=paypalv1.1`, parsed tolerantly (`payer_id`, `emails[]`/`email`, `verified_account` as boolean or string). Field names are logged once in development. | [Confirm] items 4 and 5: must be verified in the sandbox by the owner. |
