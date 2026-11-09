"use client";

import { cn } from "cn";
import { AnimatePresence, motion } from "motion/react";
import { Children, isValidElement, type ReactNode } from "react";

// Lists that change under the user through live updates (Money tab, Home, expense list).
// Choreography (docs/decisions.md 3.22): rows on screen at load do not animate (initial={false});
// a row that appears fades + rises 6 px in 220 ms; a row that leaves fades in 150 ms and drops
// out of the layout at once (popLayout) while its siblings slide into the gap together (layout).
// No stagger: these lists are opened many times a day. Reduced motion: MotionConfig makes the
// moves instant and keeps the fades.
const EASE = [0.23, 1, 0.32, 1] as const;

export function LiveList({ children, className }: { children: ReactNode; className?: string }) {
  const rows = Children.toArray(children).filter(isValidElement);
  return (
    <ul className={cn("relative", className)}>
      <AnimatePresence initial={false} mode="popLayout">
        {rows.map((row) => (
          <motion.li
            key={row.key}
            layout="position"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.15, ease: EASE } }}
            transition={{ duration: 0.22, ease: EASE, layout: { duration: 0.25, ease: EASE } }}
          >
            {row}
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}
