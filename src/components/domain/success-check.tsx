"use client";

import { cn } from "cn";
import { motion, useReducedMotion } from "motion/react";

// Short success check for Approved and Settled (P.9): the ring scales in, then the tick draws.
// Total 340 ms, once per mount (the caller keys it by state). Reduced motion shows the final frame.
export function SuccessCheck({ className, label }: { className?: string; label: string }) {
  const reduce = useReducedMotion();
  return (
    <span role="img" aria-label={label} className={cn("inline-flex size-12 items-center justify-center rounded-full bg-eligible-bg text-eligible", className)}>
      <motion.svg viewBox="0 0 24 24" className="size-7" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <motion.circle
          cx="12" cy="12" r="10"
          initial={reduce ? false : { scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
          style={{ transformOrigin: "12px 12px" }}
          strokeWidth={1.6}
          opacity={0.35}
        />
        <motion.path
          d="M7.5 12.5l3 3 6-6.5"
          initial={reduce ? false : { pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.22, delay: 0.12, ease: [0.23, 1, 0.32, 1] }}
        />
      </motion.svg>
    </span>
  );
}
