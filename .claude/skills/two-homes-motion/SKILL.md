---
name: two-homes-motion
description: Project motion rules for Two Homes Preflight. Load before adding, changing or reviewing any animation, transition, Motion (`motion/react`) code, AnimatePresence, layout animation, skeleton, count-up or success check in this repo. These rules override the generic animate, choreograph and review-animations skills wherever they disagree (durations, what may animate, reduced motion).
---

# Two Homes Preflight motion rules

Source of truth: `docs/spec/ui-design.md` (Section P.9). This skill turns that section into working rules. If this file and the spec disagree, the spec wins; tell the owner.

## How the motion skills fit together

| Task | Skill | Note |
| --- | --- | --- |
| Build one animation (badge, check, chip, sheet) | `animate` | Then clamp values with the budget below |
| Several elements moving together (list enter, reorder, dashboard first load, step flow) | `choreograph` | Total sequence still under 400 ms |
| Review motion at the end of a phase | `review-animations` (user-invoked) | Run together with `web-design-guidelines` |
| Visual direction of a new screen | `frontend-design` | Tokens in ui-design.md win |
| React/Next.js correctness and performance | `vercel-react-best-practices` | |

## Hard budget (non-negotiable)

- Durations 150 to 300 ms. Nothing over 400 ms, including the total length of a staggered sequence.
- Stagger step 30 to 50 ms, at most 6 animated items; the rest appear with the last step.
- Generic skills sometimes suggest 400 to 600 ms (drawers, hero entrances, springs with `duration: 0.5`). Do not copy those values here. Use `duration: 0.3` or less for springs.
- Default ease-out curve: `[0.23, 1, 0.32, 1]`. Exits are faster than entrances (about 70 percent of the enter time).
- Animate only `transform` and `opacity` (plus `clip-path` for the clause highlight sweep). Never animate width, height, top or left; use `layout` instead.
- No parallax, no animated backgrounds, no looping decoration, no motion on scroll. Purposeful only.

## The only animations the spec asks for

| Element | Motion | Notes |
| --- | --- | --- |
| `VerdictBadge` | Animates in when the preflight result changes | Key the element by verdict so `AnimatePresence` swaps it; icon + words stay readable at every frame |
| `ClauseCard` | Highlight sweeps once on first appear | `clip-path` or `scaleX` on a highlight layer behind the quote; never re-run on re-render |
| Bottom sheets, dialogs | Spring in | Base UI `Drawer`/`Dialog` and shadcn `sheet` already animate via `data-starting-style`/`data-ending-style`. Tune their classes; do not wrap them in a second Motion animation |
| List items | Fade/slide on enter, `layout` on reorder | `AnimatePresence initial={false}` so existing items do not animate on page load |
| Status chips | Cross-fade on real-time updates | `AnimatePresence mode="popLayout"`, keyed by status. Add `aria-live="polite"` on the container |
| Dashboard totals | Count up on first load only | Use `useMotionValue` + `animate`, render with Geist Mono tabular figures, final value in the DOM for screen readers |
| Approved, Settled | Short success check | SVG path draw, under 400 ms, once per state change |
| Tab bar indicator | Slides | Shared `layoutId` inside a `LayoutGroup` |
| Loading | Skeletons | shadcn `Skeleton`; no spinners for page loads |

Anything not in this table needs a reason in `docs/decisions.md` before it is added.

## Reduced motion

- Wrap the app once in `<MotionConfig reducedMotion="user">` (client provider in the root layout). This turns transform and layout animations into instant changes when the OS asks for reduced motion.
- For anything `MotionConfig` does not cover (count-up, success check, highlight sweep, CSS transitions), check `useReducedMotion()` and render the final state directly.
- Tailwind classes on primitives: add `motion-reduce:transition-none` / `motion-reduce:animate-none` where the primitive animates.

## Motion v14 in this repo

- Package `motion` 14.10.1. Import from `motion/react` in client components (`"use client"`). Never import `framer-motion`.
- In Server Components, import `motion` from `motion/react-client` to get client-ready `motion.*` elements without marking the whole file as a client component.
- Exports verified in this version: `motion`, `AnimatePresence`, `MotionConfig`, `LayoutGroup`, `useReducedMotion`, `useAnimate`, `useMotionValue`, `useSpring`, `useTransform`, `animate`, `stagger`, `LazyMotion`, `domAnimation`, `m`. If you need anything else, check `node_modules/motion` first.
- Keep Motion out of the PayPal button and AG Grid internals.

## Known issues to fix when the component is first used

- `src/components/ui/drawer.tsx` uses `duration-450` (over the 400 ms cap). Lower to 300 ms or less when the bottom sheet is built in Phase 1.

## Check before marking UI work done

1. Every animation is in the table above and within the budget.
2. With OS reduced motion turned on, the screen works and shows final states.
3. Phone (375 px) and desktop (1440 px) both checked; no layout shift from animations.
4. Colour and motion are never the only signal of a status change.
