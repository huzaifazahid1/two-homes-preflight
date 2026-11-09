"use client";

import { cn } from "cn";
import { BookOpenText } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import type { QuoteMatch } from "@/types/firestore";

// The signature component (P.9): a verbatim agreement quote in Source Serif 4 on a highlighter
// background, with the page it came from. The highlight sweeps in once when the card first appears.
// The page chip opens the source sheet when `onOpenSource` is given.

const MATCH: Record<Exclude<QuoteMatch, "exact">, { label: string; className: string }> = {
  exact_other_page: { label: "Found on another page", className: "text-approval bg-approval-bg" },
  fuzzy: { label: "Close match", className: "text-review bg-review-bg" },
  none: { label: "Not found in agreement", className: "text-danger bg-danger-bg" },
};

export function ClauseCard({
  quote,
  page,
  title,
  match = "exact",
  onOpenSource,
  children,
  className,
  plain = false,
}: {
  quote: string;
  page: number;
  title?: React.ReactNode;
  match?: QuoteMatch;
  onOpenSource?: () => void;
  children?: React.ReactNode;
  className?: string;
  /** Without the outer card (when nested inside another surface). */
  plain?: boolean;
}) {
  const reduce = useReducedMotion();
  const unverified = match === "none";
  const chip = (
    <>
      <BookOpenText aria-hidden className="size-3.5" />
      Page {page}
    </>
  );
  return (
    <figure className={cn(!plain && "rounded-[10px] border border-border bg-surface p-4", className)}>
      {title ? <figcaption className="mb-2 font-medium">{title}</figcaption> : null}
      <blockquote className={cn("t-quote relative isolate px-3 py-2 text-clause-ink", unverified && "text-muted-foreground line-through decoration-danger/60")}>
        {!unverified ? (
          <motion.span
            aria-hidden
            className="absolute inset-0 -z-10 rounded-md bg-clause"
            initial={reduce ? false : { clipPath: "inset(0 100% 0 0 round 6px)" }}
            animate={{ clipPath: "inset(0 0% 0 0 round 6px)" }}
            transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1], delay: 0.05 }}
          />
        ) : (
          <span aria-hidden className="absolute inset-0 -z-10 rounded-md border border-dashed border-danger/40" />
        )}
        <span className="sr-only">{unverified ? "Unverified quote: " : "Quote from the agreement: "}</span>“{quote}”
      </blockquote>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {onOpenSource ? (
          <button
            type="button"
            onClick={onOpenSource}
            className="t-label inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-foreground transition-colors hover:border-primary/40 hover:bg-primary-soft focus-visible:outline-2"
            aria-label={`Open page ${page} of the agreement`}
          >
            {chip}
          </button>
        ) : (
          <span className="t-label inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-muted-foreground">{chip}</span>
        )}
        {match !== "exact" ? <span className={cn("t-label inline-flex h-6 items-center rounded-full px-2.5", MATCH[match].className)}>{MATCH[match].label}</span> : null}
        {children}
      </div>
    </figure>
  );
}
