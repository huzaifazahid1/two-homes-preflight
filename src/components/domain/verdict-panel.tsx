"use client";

import { cn } from "cn";
import { AnimatePresence, motion } from "motion/react";
import { ScanSearch } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { VerdictCode } from "@/types/firestore";
import { ClauseCard } from "./clause-card";
import { SplitBar } from "./split-bar";
import { VERDICT_META, type Tone } from "./status-meta";

// The preflight verdict (A.5.3 step 2): verdict, the reason in plain words, the clause it comes
// from and the split. The verdict block swaps with a short cross-fade when the result changes.

const RAIL: Record<Tone, string> = {
  eligible: "bg-eligible",
  approval: "bg-approval",
  evidence: "bg-evidence",
  neutral: "bg-neutral-st",
  danger: "bg-danger",
  review: "bg-review",
};
const INK: Record<Tone, string> = {
  eligible: "text-eligible bg-eligible-bg",
  approval: "text-approval bg-approval-bg",
  evidence: "text-evidence bg-evidence-bg",
  neutral: "text-neutral-st bg-neutral-st-bg",
  danger: "text-danger bg-danger-bg",
  review: "text-review bg-review-bg",
};

export type VerdictData = {
  verdict: VerdictCode;
  explanation: string;
  citations: { quote: string; page: number }[];
  owedShareCents: number;
  otherShareCents: number;
  quoteMatch?: "exact" | "exact_other_page" | "fuzzy" | "none";
};

export function VerdictPanel({
  data,
  status,
  error,
  owedLabel,
  otherLabel,
  onOpenSource,
  footer,
  className,
}: {
  data: VerdictData | null;
  status: "idle" | "loading" | "ready" | "error";
  error?: string | null;
  owedLabel: string;
  otherLabel: string;
  onOpenSource?: (c: { page: number; quote: string }) => void;
  footer?: React.ReactNode;
  className?: string;
}) {
  const meta = data ? VERDICT_META[data.verdict] : null;
  const Icon = meta?.icon;
  return (
    <section aria-labelledby="verdict-h" className={cn("relative overflow-hidden rounded-[14px] border border-border bg-surface", className)}>
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1 transition-colors duration-200", meta ? RAIL[meta.tone] : "bg-border")} />
      <div className="space-y-4 p-5 pl-6">
        <div className="flex items-center justify-between gap-3">
          <h2 id="verdict-h" className="t-label text-muted-foreground">Preflight check</h2>
          {status === "loading" && data ? <span className="t-label text-muted-foreground" aria-live="polite">Checking…</span> : null}
        </div>

        <div aria-live="polite" aria-busy={status === "loading"}>
          {status === "error" ? (
            <p className="t-small rounded-md bg-danger-bg px-3 py-2 text-danger">{error}</p>
          ) : !data ? (
            status === "loading" ? (
              <div className="space-y-3">
                <Skeleton className="h-9 w-48" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-20 w-full" />
              </div>
            ) : (
              <div className="flex gap-3 text-muted-foreground">
                <ScanSearch aria-hidden className="mt-0.5 size-5 shrink-0" />
                <p>Choose the child, the kind of expense and the amount. The check runs against your agreement as you type.</p>
              </div>
            )
          ) : (
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.div
                key={`${data.verdict}:${data.citations[0]?.page ?? 0}`}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, transition: { duration: 0.14 } }}
                transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
                className={cn("space-y-4", status === "loading" && "opacity-60")}
              >
                <div className="flex items-start gap-3">
                  <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-full", INK[meta!.tone])}>
                    {Icon ? <Icon aria-hidden className="size-5" /> : null}
                  </span>
                  <div className="min-w-0">
                    <p className="t-h2">{meta!.label}</p>
                    <p className="mt-1 text-pretty text-muted-foreground">{data.explanation}</p>
                  </div>
                </div>
                {data.citations.slice(0, 2).map((c, i) => (
                  <ClauseCard
                    key={`${c.page}-${i}`}
                    plain
                    quote={c.quote}
                    page={c.page}
                    match={i === 0 ? data.quoteMatch : "exact"}
                    onOpenSource={onOpenSource ? () => onOpenSource(c) : undefined}
                  />
                ))}
                {data.verdict !== "NOT_COVERED" && data.owedShareCents + data.otherShareCents > 0 ? (
                  <SplitBar owedCents={data.owedShareCents} otherCents={data.otherShareCents} owedLabel={owedLabel} otherLabel={otherLabel} />
                ) : null}
              </motion.div>
            </AnimatePresence>
          )}
        </div>
        {footer}
      </div>
    </section>
  );
}
