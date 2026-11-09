"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorMessage } from "@/hooks/api";
import { useMediaQuery } from "@/hooks/use-media-query";
import { locateQuote } from "@/lib/quote-verify";

// Source view (Phase 2): the agreement page text with the quote highlighted, so a parent can
// check a rule against the document itself. Bottom sheet on phones, side sheet on desktop.

export type SourceTarget = { agreementId: string; page: number; quote?: string } | null;

type PageData = { page: number; text: string; pageCount: number };

export function SourceSheet({ target, onClose }: { target: SourceTarget; onClose: () => void }) {
  const desktop = useMediaQuery("(min-width: 1024px)");
  const [page, setPage] = useState(target?.page ?? 1);
  const [data, setData] = useState<PageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const markRef = useRef<HTMLElement>(null);
  const [lastTarget, setLastTarget] = useState(target);

  // Reset to the target's page whenever a new quote is opened.
  if (target !== lastTarget) {
    setLastTarget(target);
    if (target) setPage(target.page);
  }

  const agreementId = target?.agreementId;
  useEffect(() => {
    if (!agreementId) return;
    let active = true;
    api<{ page: PageData }>(`/api/agreements/${agreementId}/pages/${page}`).then(
      (r) => active && (setData(r.page), setError(null)),
      (e) => active && (setData(null), setError(errorMessage(e))),
    );
    return () => {
      active = false;
    };
  }, [agreementId, page]);

  const shown = data && data.page === page ? data : null;
  const range = shown && target?.quote ? locateQuote(target.quote, shown.text) : null;

  const rangeStart = range?.start ?? -1;
  useEffect(() => {
    if (rangeStart >= 0) markRef.current?.scrollIntoView({ block: "center" });
  }, [rangeStart, shown?.page]);

  return (
    <Sheet open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side={desktop ? "right" : "bottom"} className="max-h-[88dvh] gap-0 sm:max-w-lg data-[side=right]:sm:max-w-lg">
        <SheetHeader className="border-b border-border pr-12">
          <SheetTitle className="t-h3">Agreement, page {page}</SheetTitle>
          <SheetDescription>
            {target?.quote ? (range ? "The highlighted text is the quote this rule is based on." : shown ? "The quote was not found on this page." : "Loading the page text.") : "The text of the agreement page."}
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
          {error ? (
            <p role="alert" className="t-small rounded-md bg-danger-bg px-3 py-2 text-danger">{error}</p>
          ) : !shown ? (
            <div className="space-y-2" aria-busy>
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-11/12" />
              <Skeleton className="h-4 w-4/5" />
            </div>
          ) : (
            <p className="t-quote whitespace-pre-wrap break-words text-[15px] leading-[26px]">
              {range ? (
                <>
                  {shown.text.slice(0, range.start)}
                  <mark ref={markRef} className="rounded-sm bg-clause px-0.5 text-clause-ink ring-2 ring-clause">
                    {shown.text.slice(range.start, range.end)}
                  </mark>
                  {shown.text.slice(range.end)}
                </>
              ) : (
                shown.text
              )}
            </p>
          )}
        </div>
        {shown ? (
          <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-3 pb-[max(12px,env(safe-area-inset-bottom))]">
            <Button variant="outline" className="h-11" onClick={() => setPage((p) => p - 1)} disabled={page <= 1}>
              <ChevronLeft aria-hidden /> Previous
            </Button>
            <span className="t-small tabular text-muted-foreground">
              {page} of {shown.pageCount}
            </span>
            <Button variant="outline" className="h-11" onClick={() => setPage((p) => p + 1)} disabled={page >= shown.pageCount}>
              Next <ChevronRight aria-hidden />
            </Button>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
