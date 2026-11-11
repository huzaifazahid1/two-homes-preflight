# Phase 5: UI/UX Upgrade and Modern SaaS Polish

## Objective

Elevate the existing Two Homes Preflight interface to a polished, distinctive, production-quality modern SaaS experience.

This phase is a **visual and interaction-quality upgrade, not a product redesign**. The application is already implemented and its existing visual identity, product flows, functionality, and architecture must be preserved.

The current UI is clean, minimal, and reasonably good. However, parts of the experience still feel basic or generic compared with well-crafted modern SaaS products. The goal is to improve visual hierarchy, composition, component quality, interaction details, motion, consistency, and responsive behavior so the product feels intentionally designed rather than assembled from generic dashboard patterns.

Do not interpret "modern SaaS" as adding gradients, glassmorphism, glow effects, 3D elements, or animations everywhere. Use these techniques selectively and only when they improve the product.

---

## 1. Mandatory first steps

### 1.1 Read the project instructions and relevant specifications

Read in this order:

1. `CLAUDE.md` (always read first).
2. `docs/phases/phase-5-ui-upgrade.md` (this file).
3. `docs/spec/ui-design.md`.
4. `docs/spec/product.md` (only the product vocabulary, roles, journeys, pages/routes, and relevant interaction requirements needed for this UI phase).
5. `docs/spec/stack.md` (only if needed to verify the existing UI/animation stack and its constraints).
6. `docs/progress.md`, `docs/decisions.md`, and `README.md` to understand the completed phases, existing decisions, and current project state.

Do not load every specification file. Read other specs only if a concrete UI task requires them.

Inspect the actual codebase and installed packages before making assumptions. The code and current implementation are the source of truth for what is already built.

### 1.2 Verify the previous phases

- Confirm that Phases 0–4 are completed according to `docs/progress.md`.
- Identify any known UI issues, incomplete screens, or outstanding items carried over from earlier phases.
- Do not silently reopen or change an agreed product, architecture, payment, data, or security decision.
- If a pre-existing defect blocks this phase, document it and ask the owner before expanding scope.

### 1.3 Create the Phase 5 feature branch (mandatory)

Before modifying any source code:

1. Inspect `git status`, the current branch, and recent commits.
2. Preserve all existing uncommitted work. Never discard, reset, overwrite, or silently include unrelated owner changes.
3. Create and switch to a dedicated feature branch:

   `phase-5-ui-upgrade`

4. If that branch already exists, inspect it and determine whether it is the intended Phase 5 branch before reusing it. Do not overwrite it or force-create it.
5. Do all Phase 5 implementation and commits on this branch.
6. Do not push or merge into the default branch without the owner's explicit approval.

If the working tree contains unrelated changes that make safe branch creation or implementation uncertain, stop and ask the owner.

---

## 2. Non-negotiable design boundaries

### 2.1 Preserve the existing visual identity

The current project already has an established theme and visual direction. Preserve:

- Existing brand identity and overall visual character.
- Existing primary/accent color choices and established color relationships.
- Existing font family and typography identity.
- Existing light/dark theme behavior and theme switching.
- Existing visual conventions that are already working well.

Do not replace the color palette, introduce a completely different font, or impose a new template/theme on the application.

You may refine how the existing colors, fonts, spacing, weights, surfaces, borders, shadows, and typography hierarchy are used. Improve consistency and polish without changing the product's identity.

Before changing any design token, inspect `docs/spec/ui-design.md`, global styles, theme variables, `app/layout.tsx`, `components.json`, and existing shared components. Record the current values and intended refinements.

### 2.2 Preserve product behavior and architecture

This phase must not change:

- Product requirements, business rules, terminology, or user journeys.
- API contracts, route handlers, request/response schemas, or server-side behavior.
- Firebase authentication, Firestore data, security rules, listeners, or authorization.
- Agreement extraction, quote verification, rule evaluation, or preflight verdict logic.
- Approval, claim, receipt matching, dispute, or settlement state machines.
- PayPal Orders, Payouts, Subscriptions, webhooks, fees, or idempotency behavior.
- Gemini prompts, AI schemas, demo-mode rules, or integration behavior.
- Email sending, link tokens, OTP behavior, or permissions.
- Money calculations, integer-cent handling, or date/time semantics.

Do not use UI changes as a reason to refactor unrelated backend or domain code. Do not create fake data, fake integrations, decorative controls that do nothing, or interactions that imply an action succeeded when it did not.

Existing functional behavior must remain intact. If a visual improvement requires a behavior change, stop and ask the owner instead of making that change silently.

### 2.3 Avoid generic AI-generated dashboard design

Do not produce a generic collection of:

- Repeated statistic cards.
- Unnecessary rounded containers around every element.
- Excessive gradients, purple accents, glowing borders, or glass effects.
- Oversized headings and empty decorative hero sections.
- Random animations with no interaction purpose.
- Unnecessary charts, icons, labels, or decorative elements.
- Identical layouts for pages that have different user tasks.

Each screen should have a clear information hierarchy and a layout appropriate to its actual purpose.

The result should feel cohesive, refined, trustworthy, and product-specific.

---

## 3. Phase 5: UI audit and design direction

Complete the audit before implementing visual changes.

### 3.1 Inspect the complete UI

Inspect the implemented application routes and shared UI, including where present:

- Public landing page and pricing.
- Login, signup, and email verification.
- Onboarding wizard.
- Application shell, sidebar, bottom navigation, top bar, and responsive navigation.
- Dashboard.
- Expenses and quick-add flows.
- Agreement upload, document viewing, extracted rules, and rule review.
- Preflight evaluation and verdict details.
- Approvals and guest link/OTP pages.
- Receipt upload, receipt review, and claims.
- Money, settlement, transaction history, and ledger.
- Billing and PayPal-related screens.
- Settings and family-related screens.
- Disputes or manual-resolution screens.
- Loading, empty, error, success, confirmation, and disabled states.

Only include routes that actually exist. Do not invent new pages or product capabilities.

Inspect shared components in `src/components/ui`, `src/components/layout`, `src/components/domain`, and `src/components/grid`, as well as page-specific components.

### 3.2 Establish a baseline

Before implementation:

- Run the application.
- Capture representative screenshots of the existing UI.
- Record the current design tokens and shared component patterns.
- Check the application at 375px and 1440px widths.
- Identify inconsistent spacing, alignment, typography, component sizing, visual hierarchy, responsive issues, and interaction states.
- Identify screens that already look good and should receive little or no change.

Create a concise audit in `docs/ui-audit.md` (or an equivalent clearly organized section in the Phase 5 progress documentation). For each issue, include the affected route/component, the observed problem, the proposed improvement, and priority.

Do not begin by replacing all page layouts. First establish what genuinely needs improvement.

### 3.3 Define the visual direction

Use the following references for design inspiration, not as templates to copy:

- **Linear:** refined minimalism, typography, spacing, navigation, and well-composed application surfaces. https://linear.app/
- **Stripe:** trust, financial information hierarchy, payment interfaces, and clarity of transaction states. https://stripe.com/
- **21st.dev:** high-quality React component inspiration and selectively reusable patterns. https://21st.dev/
- **React Bits:** purposeful motion, text effects, interactive elements, and selected visual effects. https://reactbits.dev/
- **Magic UI:** refined animated components, number tickers, borders, and subtle interaction patterns. https://magicui.design/
- **Aceternity UI:** selected advanced interactive and visual components. https://ui.aceternity.com/

The visual direction should combine the clarity and restraint of a premium productivity SaaS with the trust and information clarity expected from a financial/workflow product.

Do not clone any reference website. Do not add a component simply because it looks impressive in a showcase. Select components based on the actual user task, existing theme, accessibility, performance, and consistency.

---

## 4. Design system refinement

Use the existing design system as the foundation. Refine it rather than replacing it.

Audit and standardize:

1. **Color:** existing brand/accent colors, semantic status colors, surfaces, borders, muted text, hover states, and focus states.
2. **Typography:** existing font, heading hierarchy, body text, metadata, labels, numbers, and line heights.
3. **Spacing:** a consistent spacing scale and predictable page/container spacing.
4. **Layout:** content width, page headers, section grouping, alignment, responsive behavior, and density.
5. **Surfaces:** cards, panels, tables, dialogs, dropdowns, popovers, and document surfaces.
6. **Shape:** consistent border radii and control dimensions.
7. **Elevation:** restrained, consistent shadows and layering.
8. **Controls:** buttons, inputs, selects, tabs, checkboxes, badges, tooltips, and interactive states.
9. **Status language:** consistent presentation of Eligible, Needs approval, Missing evidence, Not covered, Late, Needs review, and actual approval/settlement states. Preserve the existing domain terminology.
10. **Focus and accessibility:** keyboard focus, labels, contrast, and visible interaction states.

Prefer shared tokens and reusable components over page-specific CSS patches. Avoid duplicating styles or creating competing design systems.

Any token changes must be documented in `docs/decisions.md` with the reason and scope. Do not change the established brand palette or font identity.

---

## 5. Screen-specific upgrade priorities

Prioritize the screens according to their importance to the core product journey. The audit may adjust implementation order, but must not silently remove a core screen from the scope.

### 5.1 Application shell and navigation

Improve:

- Sidebar structure, spacing, active navigation, icons, and hover/focus states.
- Top bar hierarchy and account/family context.
- Mobile navigation and bottom tabs where applicable.
- Page headers, breadcrumbs where useful, and content alignment.
- Sidebar collapse/expand behavior only if supported by the existing product and implementation.

Navigation must remain intuitive and must not hide important functionality.

### 5.2 Dashboard

Improve the dashboard's information hierarchy and composition.

- Make the most important family/expense/preflight information immediately understandable.
- Refine summary metrics without turning every value into a separate generic card.
- Improve recent activity and actionable items.
- Use charts only when the underlying data and user task justify them.
- Improve empty, loading, and error states.
- Use subtle data transitions only where they add clarity.

Do not invent metrics or change how dashboard data is calculated.

### 5.3 Agreement and rule management

This is a core differentiator of Two Homes Preflight.

Improve:

- Agreement upload and processing feedback.
- Document preview and reading experience.
- Clause and source-quote presentation.
- Page references and verified source context.
- Extracted rule review and confirmation.
- Clear distinction between AI-suggested information and human-confirmed rules.
- Empty, processing, failure, and success states.

Do not change extraction, verification, or confirmation logic. Never make an unverified quote look verified.

### 5.4 Preflight results and verdict experience

Give this screen special attention because it communicates the product's main value.

Improve:

- Verdict hierarchy and immediate readability.
- Clear visual differentiation between Eligible, Needs approval, Missing evidence, Not covered, Late, and Needs review.
- Amount, expense details, relevant clause, evidence, and next action.
- Source references and supporting context.
- Approval requirements and current status.
- Loading and transition states when a verdict is produced.

For example, a "Needs approval" result should communicate why approval is required, which agreement clause supports the decision, and what action the user can take. It must not imply that an approval has already happened.

Color must never be the only way a verdict or state is communicated. Preserve the deterministic rules-engine result and all existing wording/semantics.

### 5.5 Approvals, guest links, and OTP

Improve:

- The approval request's clarity and trust.
- Guest-facing layouts, including phone-sized screens.
- OTP input usability, validation feedback, and focus behavior.
- Agreement context and expense summary.
- Approve/decline action hierarchy and confirmation feedback.
- Expired, invalid, revoked, and already-used link states.

Do not weaken OTP, authorization, token, or link security to make the interface simpler.

### 5.6 Receipts, claims, and disputes

Improve:

- Receipt upload and preview.
- Processing and matching progress.
- Receipt evidence versus extracted information.
- Claim details and outstanding/overdue presentation.
- Dispute and manual-resolution clarity.
- Empty, failed, and successful states.

Do not change receipt matching, claim transitions, or dispute behavior.

### 5.7 Money, settlement, and ledger

Treat financial information with particular care.

Improve:

- Transaction and settlement status hierarchy.
- Payment progress and timeline presentation.
- Amounts, fees, and recipient/payer context.
- Receipt/claim references.
- Ledger table readability, density, alignment, and responsive behavior.
- Filters and available AG Grid interactions.
- Success, pending, failure, and reconciliation states.

Preserve AG Grid Community and its existing configuration. Do not introduce paid features or change money calculations. Continue using the existing money formatting helpers and integer-cent rules.

### 5.8 Billing, settings, and remaining screens

Apply the same design language to billing, settings, family-related pages, and other implemented screens. Keep controls and information appropriate to each page rather than forcing every page into the same layout.

---

## 6. Motion and interaction polish

The project already includes the `motion` package. Use the installed Motion for React APIs and existing project conventions. Do not install another animation library.

Use animation to communicate state, continuity, and feedback, not merely to decorate.

Recommended opportunities:

| Area | Recommended treatment |
| --- | --- |
| Page content | Restrained entrance transitions where they improve continuity |
| Navigation | Smooth active-state and supported collapse transitions |
| Cards and controls | Subtle hover, press, and focus feedback |
| Dialogs and popovers | Refined entrance/exit transitions |
| Tabs | Smooth indicator movement where appropriate |
| Dashboard values | Small number transitions when values update |
| Preflight results | Clear, restrained reveal of verdict and supporting details |
| Processing | Meaningful progress/loading feedback |
| Payment timeline | State-aware transitions that reflect actual state changes |
| Toasts | Consistent entrance, exit, and readable feedback |

Motion features such as `AnimatePresence`, layout animations, and shared layout transitions may be used when appropriate. Inspect the installed Motion version and use APIs supported by that version.

Rules:

- Keep transitions short and purposeful.
- Avoid animating large parts of every page on every render.
- Avoid layout shifts and animation that delays user actions.
- Do not use animation to imply that a server-side operation succeeded before confirmation.
- Respect `prefers-reduced-motion`.
- Keep interactions usable with keyboard and touch.
- Avoid heavy continuous animations, unnecessary parallax, and expensive background effects.
- Test animation behavior on both desktop and mobile.

---

## 7. Component research and implementation rules

### 7.1 Existing stack first

Use the project's existing technologies and installed components:

- Next.js App Router.
- Tailwind CSS 4.
- shadcn/ui and the existing owned UI components.
- Existing `motion` package.
- Existing Geist font setup.
- Existing `lucide-react` icons.
- Existing AG Grid Community integration.

Before implementing a new component, inspect whether an existing shared component already provides the required behavior.

### 7.2 External component references

Use these sites selectively:

- 21st.dev: https://21st.dev/
- React Bits: https://reactbits.dev/
- Magic UI: https://magicui.design/
- Aceternity UI: https://ui.aceternity.com/

For each selected reference:

1. Identify the actual UI problem it solves.
2. Check whether it fits the current brand, theme, and component architecture.
3. Check its implementation requirements, dependencies, responsiveness, accessibility, and performance.
4. Prefer adapting the pattern to existing project components over importing an entire component system.
5. Keep component code owned and maintainable within the project.
6. Record meaningful component/design decisions in `docs/decisions.md`.

**Dependency restriction:** `CLAUDE.md` Section D is authoritative. Do not install new npm packages, icon libraries, animation libraries, component registries, or other dependencies without the owner's approval. A component showcase is a reference, not permission to add its dependencies. If a selected component cannot be implemented within the approved stack, choose an existing-stack alternative or ask the owner.

Do not add external scripts, remote runtime dependencies, or unverified assets just to reproduce a showcase effect.

---

## 8. Required Claude Code skills

Inspect `.claude/skills/` and read the actual `SKILL.md` instructions for relevant installed skills before invoking them. Skill names and capabilities must be verified from the repository; do not assume an uninstalled skill exists.

Use these skills where available and relevant:

### Required

1. **`frontend-design`**
   - Use for the overall visual direction, composition, typography, spacing, and distinctive page-level design.
   - Avoid generic AI-generated dashboard patterns.
   - Use it during design planning and implementation review.

2. **`react-best-practices`**
   - Use for React/Next.js component structure, rendering behavior, client/server boundaries, performance, and maintainability.
   - Ensure visual work does not introduce unnecessary client components or expensive rendering.

3. **`web-design-guidelines`**
   - Use to review the changed UI for accessibility, responsive behavior, interaction states, semantics, and general web design quality.
   - Run it on the UI files changed in this phase and fix genuine issues.

### Additional skills

If an animation/Motion-specific skill, component-design skill, or other relevant skill is already installed, inspect it and use it when it provides concrete value. Do not install skills or tools without owner approval. Do not invoke skills merely to increase the number of skills used.

Follow each skill's own invocation instructions. The skills guide the work; they do not override `CLAUDE.md`, approved architecture, or this phase's scope.

---

## 9. Implementation sequence

Work incrementally. Do not attempt a blind full-app rewrite.

### Step 1: Audit and plan

- Complete the route/component inventory.
- Capture baseline screenshots.
- Identify high-impact visual issues.
- Produce the audit and proposed implementation order.
- Confirm the existing design identity and tokens.

### Step 2: Refine shared design foundations

- Refine tokens and global styles only where justified.
- Improve shared controls and layout primitives.
- Establish consistent focus, hover, disabled, loading, and error states.
- Verify the existing light/dark themes.

### Step 3: Upgrade the application shell

- Improve sidebar, top bar, navigation, page headers, and responsive shell.
- Verify navigation behavior and all existing routes.

### Step 4: Upgrade core product journeys

Work through agreement/rule review, preflight results, approvals, receipts/claims, and money/ledger. Prioritize the most important user-facing flows and preserve their existing behavior.

### Step 5: Upgrade remaining screens

Apply the refined design system to public pages, onboarding, billing, settings, and other implemented routes.

### Step 6: Motion and interaction pass

Add purposeful motion and micro-interactions after the underlying layouts and states are stable. Avoid using animation to conceal layout or usability problems.

### Step 7: Responsive and visual QA

Compare before/after screenshots, test all touched screens, run the relevant skills, and fix issues before declaring the phase complete.

Commit in small, logically grouped commits on `phase-5-ui-upgrade`. Use clear English commit messages. Do not push or merge without owner approval.

---

## 10. Testing and quality requirements

### 10.1 Automated checks

Run the project's existing checks and relevant tests. At minimum:

- `npm run typecheck`
- `npm run lint`
- `npm run test`
- `npm run test:unit`
- `npm run test:integration`
- `npm run test:e2e`
- `npm run build`

Use the actual scripts defined in `package.json`. If a script does not exist or a command is not applicable, report that accurately rather than pretending it passed.

Run relevant existing tests for authentication, authorization, agreements, preflight verdicts, approvals, claims, receipts, settlement, ledger, and billing if UI changes touch their interaction paths. Add or update tests only where necessary to protect changed UI behavior. Do not weaken, delete, or bypass existing tests to get a green result.

### 10.2 Manual browser checks

Run the application and inspect:

- **375px phone width**
- **1440px desktop width**

Check every screen touched in this phase, including relevant loading, empty, error, success, modal, dropdown, and form states.

Verify:

- No horizontal overflow or clipped content.
- Navigation and controls work with touch and keyboard.
- Text remains readable and hierarchy is clear.
- Tables and financial values remain usable on smaller screens.
- Modals, menus, and popovers fit the viewport.
- No broken images, missing icons, hydration warnings, or console errors.
- No layout shifts or distracting animation.
- Reduced-motion preference is respected.
- Existing light/dark theme behavior remains correct.

Capture final screenshots for the key product journeys and include or link them in the project documentation where practical.

### 10.3 Regression protection

Verify that the visual upgrade has not changed:

- Existing API requests and responses.
- Existing routes and navigation destinations.
- Form validation and submission behavior.
- Authentication and guest access behavior.
- Preflight verdicts and clause evidence.
- Approval and claim transitions.
- Receipt processing and matching.
- Payment, payout, billing, and ledger behavior.

A visual improvement is not complete if an existing workflow has regressed.

### 10.4 Design skill review

Run the `web-design-guidelines` skill against the UI files changed in this phase. Fix genuine issues and report any finding that cannot be fixed without changing approved behavior.

Also apply the relevant `frontend-design` and `react-best-practices` guidance during the final review.

---

## 11. Documentation updates

At the end of this phase, update:

1. `README.md`
   - Add Phase 5 UI/UX improvements to the changelog/features.
   - Update screenshots if available.
   - Keep existing setup, architecture, integrations, and testing information accurate.

2. `docs/progress.md`
   - Mark Phase 5 tasks as done, in progress, next, or blocked accurately.
   - Record remaining visual issues and blockers.

3. `docs/decisions.md`
   - Record meaningful design-system refinements, component choices, animation decisions, and reasons.
   - Record any approved deviations.
   - Do not record routine trivial styling changes individually.

4. `docs/api.md`
   - Confirm whether any API documentation changes are needed.
   - Since this is a UI-only phase, API contracts should remain unchanged. Do not modify them merely to create a documentation diff.

5. `docs/ui-audit.md`
   - Keep the baseline audit and final resolution status.
   - Identify improvements completed, issues intentionally left unchanged, and any remaining limitations.

6. `CLAUDE.md` and `docs/spec/*`
   - Do not modify these without owner approval.
   - Do not change established product or architecture decisions.

---

## 12. Scope exclusions

Unless the owner explicitly approves a separate change, do not:

- Redesign the product from scratch.
- Change the brand palette, font identity, or established theme.
- Add new product features or routes.
- Change copy or product terminology in ways that alter meaning.
- Change business logic, backend, database, API contracts, or integrations.
- Replace shadcn/ui, Motion, AG Grid, or the existing component architecture.
- Install unapproved npm packages or skills.
- Add decorative charts or fake metrics.
- Add heavy 3D scenes, continuous background effects, or excessive animations.
- Remove existing functionality to simplify the design.
- Push, merge, or deploy without the required owner approval.

---

## 13. Deliverables

At the end of Phase 5, provide:

1. A concise summary of the visual improvements made.
2. The feature branch name and commit list.
3. A list of routes/screens upgraded.
4. Before/after screenshots of key screens and journeys.
5. A summary of design-system refinements.
6. A summary of selected external component references and how they were adapted.
7. A summary of Motion/interaction improvements.
8. Automated test results, with exact pass/fail status.
9. Manual verification results at 375px and 1440px.
10. Results of the required design skill review.
11. Any regressions, known issues, or intentionally deferred improvements.
12. Documentation files updated.

Be precise. Do not claim a screen, test, interaction, or responsive state was verified unless it was actually checked.

---

## 14. End-of-phase gate

Phase 5 is complete only when:

- All approved UI work is implemented on `phase-5-ui-upgrade`.
- Existing product identity and functionality are preserved.
- Relevant automated tests and build checks pass, or any pre-existing/environmental failures are clearly documented.
- Every touched screen has been manually checked at 375px and 1440px.
- The `web-design-guidelines` skill has been run on changed UI files and genuine issues have been addressed.
- Relevant installed frontend and React skills have been applied.
- Documentation and screenshots are updated as appropriate.
- No unapproved dependencies, architecture changes, or business behavior changes have been introduced.

### Final owner report and approval

Provide the deliverables report to the owner. Clearly separate completed work, test evidence, known issues, and any decisions requiring confirmation.

**Stop after reporting. Do not start another phase, merge the feature branch, push changes, or deploy without the owner's explicit approval.**
