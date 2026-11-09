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
