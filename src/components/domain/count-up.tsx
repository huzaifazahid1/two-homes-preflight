"use client";

import { cn } from "cn";
import { animate, useReducedMotion } from "motion/react";
import { useEffect, useRef } from "react";
import { formatCents } from "@/lib/money";

// Dashboard totals count up on first load only (P.9), 300 ms. The final value is in the DOM from
// the first render (screen readers and no-JS read it); only the visible text is animated. Later
// value changes (live refetch) update directly without counting.
export function CountUpMoney({ cents, className }: { cents: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const played = useRef(false);
  const reduce = useReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (played.current || reduce || cents === 0) {
      el.textContent = formatCents(cents);
      played.current = true;
      return;
    }
    played.current = true;
    const controls = animate(0, cents, {
      duration: 0.3,
      ease: [0.23, 1, 0.32, 1],
      onUpdate: (v) => {
        el.textContent = formatCents(Math.round(v));
      },
    });
    return () => controls.stop();
  }, [cents, reduce]);

  return (
    <span className={cn("font-mono tabular-nums", className)}>
      <span ref={ref} aria-hidden>
        {formatCents(cents)}
      </span>
      <span className="sr-only">{formatCents(cents)}</span>
    </span>
  );
}
