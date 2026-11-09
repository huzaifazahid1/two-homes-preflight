# Phase 0

Read `CLAUDE.md` first (always loaded). Then read only these before writing code:

- `CLAUDE.md`
- `docs/spec/env.md`

Read other spec files only if a task in this phase needs them.

## Phase 0: Verify setup (Claude Code)

1. Read `CLAUDE.md`, this file, `package.json`, `.env.example`.
2. Check: Node version, `npm run build` works on the scaffold, `.env.local` has every variable from Section O (report missing names, never print values) and contains **no** emulator variables, `npx firebase --version` works and the owner is logged in (`npx firebase projects:list`), Java is installed (`java -version`) and `npx firebase emulators:exec --only firestore,auth "node -e 0"` succeeds, `firebase.json`/`firestore.rules` exist, the skills in `.claude/skills` are present.
3. Add npm scripts (cross-platform, they must run in Windows PowerShell): `test`, `test:unit`, `test:integration` (wrapped in `firebase emulators:exec`), `test:e2e`, `typecheck`, `lint`, `firebase:deploy-rules`, `seed`, `reset`, `invariants`.
4. Create `docs/progress.md`, `docs/decisions.md`, `docs/api.md`, initial `README.md`.
5. Deliverable: a short report of what is ready and what is missing. Do not start Phase 1 until the owner confirms missing items.

## End of phase

1. All tests above green; `npm run typecheck` and `npm run lint` clean.
2. Run the app on phone width (375 px) and desktop (1440 px) and check every screen touched in this phase.
3. Run the `web-design-guidelines` skill on the UI files changed in this phase and fix real issues.
4. Update `README.md`, `docs/progress.md`, `docs/api.md`, `docs/decisions.md`.
5. Report to the owner and wait for approval before the next phase.
