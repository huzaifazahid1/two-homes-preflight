"use client";

import { Pencil, XCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { SourceSheet, type SourceTarget } from "@/components/domain/source-sheet";
import { VerdictPanel } from "@/components/domain/verdict-panel";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { api, errorMessage } from "@/hooks/api";
import type { ExpenseView } from "@/types/views";

export function ExpenseVerdict({ expense, agreementId, owedLabel, otherLabel }: { expense: ExpenseView; agreementId: string | null; owedLabel: string; otherLabel: string }) {
  const [source, setSource] = useState<SourceTarget>(null);
  return (
    <>
      <VerdictPanel
        status="ready"
        data={{
          verdict: expense.verdict.code,
          explanation: expense.verdict.explanation,
          citations: expense.verdict.citations,
          owedShareCents: expense.verdict.owedShareCents,
          otherShareCents: expense.amountCents - expense.verdict.owedShareCents,
          quoteMatch: expense.rule?.quoteMatch,
        }}
        owedLabel={owedLabel}
        otherLabel={otherLabel}
        onOpenSource={agreementId ? (c) => setSource({ agreementId, page: c.page, quote: c.quote }) : undefined}
      />
      <SourceSheet target={source} onClose={() => setSource(null)} />
    </>
  );
}

export function ExpenseActions({ expense }: { expense: ExpenseView }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closed = expense.settlement.state !== "NONE";
  const editable = !closed && expense.approval.state !== "REQUESTED";

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/expenses/${expense.id}/cancel`, { method: "POST" });
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
    }
    setBusy(false);
  }

  if (expense.settlement.state === "CANCELLED") return null;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {editable ? (
          <Link href={`/app/expenses/${expense.id}/edit`} className={buttonVariants({ variant: "outline", className: "h-11 px-4" })}>
            <Pencil aria-hidden /> Edit
          </Link>
        ) : null}
        <Dialog>
          <DialogTrigger render={<Button variant="ghost" className="h-11 px-4 text-danger hover:bg-danger-bg hover:text-danger" />}>
            <XCircle aria-hidden /> Cancel expense
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Cancel this expense?</DialogTitle>
              <DialogDescription>It stays in the history as cancelled. Nobody can request approval or payment for it after this.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose render={<Button variant="outline" className="h-11" />}>Keep it</DialogClose>
              <Button className="h-11 bg-danger text-white hover:bg-danger/90" onClick={() => void cancel()} disabled={busy}>
                {busy ? "Cancelling…" : "Cancel expense"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <div aria-live="polite">{error ? <p className="t-small rounded-md bg-danger-bg px-3 py-2 text-danger">{error}</p> : null}</div>
    </div>
  );
}
