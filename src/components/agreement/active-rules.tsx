"use client";

import { cn } from "cn";
import { MessageSquareWarning, ThumbsUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ClauseCard } from "@/components/domain/clause-card";
import { SourceSheet, type SourceTarget } from "@/components/domain/source-sheet";
import { CATEGORY_META } from "@/components/domain/status-meta";
import type { RuleVersionView } from "@/types/views";
import { AgreementFlow } from "./agreement-flow";
import { ruleFacts } from "./rule-facts";

/** The confirmed rules, each with its quote and the other parent's answer. */
export function ActiveRules({ rv, coParentName }: { rv: RuleVersionView; coParentName: string }) {
  const [source, setSource] = useState<SourceTarget>(null);
  const rules = rv.rules.filter((r) => r.reviewState === "CONFIRMED" || r.reviewState === "EDITED");
  const ack = rv.coParentAck?.perRule ?? {};
  return (
    <>
      <ul className="grid gap-4 xl:grid-cols-2">
        {rules.map((r) => {
          const Cat = CATEGORY_META[r.category].icon;
          const answer = ack[r.id];
          return (
            <li key={r.id} className={cn("rounded-[14px] border bg-surface p-4 sm:p-5", answer === "disagree" ? "border-review/40" : "border-border")}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h3 className="flex items-center gap-2 font-medium">
                  <Cat aria-hidden className="size-[18px] text-muted-foreground" />
                  {r.label}
                </h3>
                {answer === "disagree" ? (
                  <span className="t-label inline-flex h-6 items-center gap-1 rounded-full bg-review-bg px-2.5 text-review">
                    <MessageSquareWarning aria-hidden className="size-3.5" /> {coParentName} disagrees
                  </span>
                ) : answer === "agree" ? (
                  <span className="t-label inline-flex h-6 items-center gap-1 rounded-full bg-eligible-bg px-2.5 text-eligible">
                    <ThumbsUp aria-hidden className="size-3.5" /> {coParentName} agrees
                  </span>
                ) : null}
              </div>
              <ClauseCard plain className="mt-3" quote={r.quote} page={r.page} match={r.quoteMatch} onOpenSource={() => setSource({ agreementId: rv.agreementId, page: r.page, quote: r.quote })} />
              <ul className="mt-3 flex flex-wrap gap-1.5">
                {ruleFacts(r).map((f) => (
                  <li key={f} className="t-label inline-flex h-7 items-center rounded-md bg-surface-2 px-2.5">
                    {f}
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
      <SourceSheet target={source} onClose={() => setSource(null)} />
    </>
  );
}

/** /app/agreement before any rules are active, and /app/agreement/review. */
export function AgreementSetup({ draft, pendingAgreementId, uploadTitle }: { draft: RuleVersionView | null; pendingAgreementId: string | null; uploadTitle?: string }) {
  const router = useRouter();
  return (
    <AgreementFlow
      draft={draft}
      pendingAgreementId={pendingAgreementId}
      uploadTitle={uploadTitle}
      onActivated={() => {
        router.push("/app/agreement");
        router.refresh();
      }}
    />
  );
}
