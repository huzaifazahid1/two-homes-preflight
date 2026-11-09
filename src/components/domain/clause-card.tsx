"use client";

import { cn } from "cn";
import { motion, useReducedMotion } from "motion/react";

// The signature component (P.9): a verbatim agreement quote in Source Serif 4 on a highlighter
// background, with the page it came from. The highlight sweeps in once when the card first appears.

export function ClauseCard({
  quote,
  page,
  title,
  children,
  className,
}: {
  quote: string;
  page: number;
  title?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <figure className={cn("rounded-[10px] border border-border bg-surface p-4", className)}>
      {title ? <figcaption className="t-label mb-2 text-muted-foreground">{title}</figcaption> : null}
      <blockquote className="t-quote relative isolate px-3 py-2 text-clause-ink">
        <motion.span
          aria-hidden
          className="absolute inset-0 -z-10 rounded-md bg-clause"
          initial={reduce ? false : { clipPath: "inset(0 100% 0 0 round 6px)" }}
          animate={{ clipPath: "inset(0 0% 0 0 round 6px)" }}
          transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1], delay: 0.05 }}
        />
        “{quote}”
      </blockquote>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="t-label inline-flex h-6 items-center rounded-md border border-border px-2 text-muted-foreground">
          Agreement, page {page}
        </span>
        {children}
      </div>
    </figure>
  );
}
