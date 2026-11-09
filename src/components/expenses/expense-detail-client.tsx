"use client";

import { Pencil, XCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { SourceSheet, type SourceTarget } from "@/components/domain/source-sheet";
import { VerdictPanel } from "@/components/domain/verdict-panel";
import { Button, buttonVariants } from "@/components/ui/button";
import { ConfirmSheet } from "@/components/domain/confirm-sheet";
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

const CANCELLABLE = new Set(["NONE", "RECEIPT_SUBMITTED", "RECEIPT_ISSUE", "READY", "AWAITING_PAYMENT", "PAYMENT_FAILED"]);

export function ExpenseActions({ expense }: { expense: ExpenseView }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const closed = expense.settlement.state !== "NONE";
  const editable = !closed && expense.approval.state !== "REQUESTED";
  // E.6.2: cancelling is possible for any state before the share is paid.
  const cancellable = CANCELLABLE.has(expense.settlement.state);

  async function cancel(): Promise<boolean> {
    setError(null);
    try {
      await api(`/api/expenses/${expense.id}/cancel`, { method: "POST" });
      router.refresh();
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    }
  }

  if (!cancellable && !editable) return null;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {editable ? (
          <Link href={`/app/expenses/${expense.id}/edit`} className={buttonVariants({ variant: "outline", className: "h-11 px-4" })}>
            <Pencil aria-hidden /> Edit
          </Link>
        ) : null}
        {cancellable ? (
          <ConfirmSheet
            trigger={
              <Button variant="ghost" className="h-11 px-4 text-danger hover:bg-danger-bg hover:text-danger">
                <XCircle aria-hidden /> Cancel expense
              </Button>
            }
            title="Cancel this expense?"
            description="It stays in the history as cancelled. Open approval and payment links stop working, and nobody can request approval or payment for it after this."
            cancelLabel="Keep it"
            confirmLabel="Cancel expense"
            pendingLabel="Cancelling…"
            destructive
            onConfirm={cancel}
          />
        ) : null}
      </div>
      <div aria-live="polite">{error ? <p className="t-small rounded-md bg-danger-bg px-3 py-2 text-danger">{error}</p> : null}</div>
    </div>
  );
}
