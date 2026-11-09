# Progress

Last updated: 2026-11-09 (Phase 0)

## Done

- **Phase 0: Verify setup**
  - Node 24.14.0, npm 11.12.0, Java (Temurin) 21.0.13, firebase-tools 15.35.0 verified.
  - Firebase CLI logged in; current project `two-homes-preflight`.
  - Emulators (Auth + Firestore) start and run a script with project `demo-two-homes`.
  - `npm run build`, `typecheck`, `lint` pass on the scaffold.
  - `.env.local` has every Section O variable; no emulator variables present.
  - Skills present in `.claude/skills`: frontend-design, react-best-practices, web-design-guidelines (plus Firebase skills).
  - npm scripts added: `test`, `test:unit`, `test:integration`, `test:e2e`, `typecheck`, `lint`, `firebase:deploy-rules`, `seed`, `reset`, `invariants`.
  - Minimal `vitest.config.ts` (unit + integration projects, loads `.env.test` only) and `playwright.config.ts` (phone 375 px, desktop 1440 px).
  - `.env.test` un-ignored so it can be committed (Section O says it is committed).
  - Docs created: `progress.md`, `decisions.md`, `api.md`, `README.md`.
  - Skills added: PayPal Server SDK `typescript-*` skills (8), motion skills `animate`, `choreograph`, `review-animations`, and project skill `two-homes-motion` (decisions 0.10 to 0.12).

## In progress

- Nothing. Waiting for owner confirmation to start Phase 1.

## Next

- Phase 1: Foundation (`docs/phases/phase-1-foundation.md`).

## Blocked / owner items

- `PAYPAL_FAMILY_PLAN_ID` and `NEXT_PUBLIC_PAYPAL_FAMILY_PLAN_ID` are placeholders (expected; filled by `scripts/setup-paypal-plans.ts` in Phase 4).
- Machine memory is tight (7.5 GB RAM, under 1 GB commit free during checks). One build crashed with `VirtualAlloc failed` while other apps were open; it passed on retry. Running emulators + dev server + Playwright together may need other apps closed.
- `seed`, `reset`, `invariants` scripts point to files that are created in later phases; they fail until then.
- First `npm run firebase:deploy-rules` needs owner approval (Section L.6).
- `src/components/ui/drawer.tsx` uses `duration-450`, over the 400 ms motion cap. Fix when the bottom sheet is built in Phase 1.
