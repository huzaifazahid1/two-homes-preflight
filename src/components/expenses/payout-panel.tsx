"use client";

import { AlertTriangle, ArrowRightLeft, RefreshCw } from "lucide-react";
import Link from "next/link";
import { ConfirmSheet } from "@/components/domain/confirm-sheet";
import { Money } from "@/components/domain/money";
import { PendingLabel } from "@/components/domain/pending-label";
import { Button, buttonVariants } from "@/components/ui/button";
import type { ExpenseView, MoneyStatus } from "@/types/views";
import { ActionError, useAction } from "./use-action";

// In-app settlement on the expense page (Section G.4, G.5): where the money is after the payer
// paid with PayPal, and what the owed parent can do (connect, retry payout, refund, re-check).

export function PayoutPanel({ e, money, isBuyer, isOwner, payer, receiver }: { e: ExpenseView; money: MoneyStatus; isBuyer: boolean; isOwner: boolean; payer: string; receiver: string }) {
  const { busy, error, run } = useAction();
  const s = e.settlement.state;
  const you = isBuyer ? "you" : receiver;

  const line =
    s === "PAID" && money.waiting === "connection"
      ? isBuyer
        ? `${payer} paid. Connect your PayPal account to receive it; it is sent as soon as you connect.`
        : `You paid. It goes to ${receiver} once they connect PayPal.`
      : s === "PAID"
        ? `${payer} paid. The payout to ${you} is waiting for PayPal; it is retried automatically.`
        : s === "PAYOUT_PROCESSING"
          ? `${payer} paid. PayPal is sending it to ${you}.`
          : s === "PAYOUT_UNCLAIMED"
            ? `PayPal is holding the money until ${you === "you" ? "you claim" : `${receiver} claims`} it${money.payout?.receiver && money.payout.receiver !== "PayPal account" ? ` (${money.payout.receiver})` : ""}.`
            : s === "PAYOUT_FAILED"
              ? `PayPal could not deliver the money to ${you}.`
              : s === "REFUNDED"
                ? `The payment was refunded to ${payer}.`
                : `Paid with PayPal and sent to ${you}.`;

  return (
    <section aria-labelledby="payout-h" className="space-y-3 rounded-[10px] border border-border bg-surface-2 p-4">
      <h3 id="payout-h" className="flex items-center gap-2 font-medium">
        {s === "PAYOUT_FAILED" ? <AlertTriangle aria-hidden className="size-4 text-danger" /> : <ArrowRightLeft aria-hidden className="size-4 text-muted-foreground" />}
        Paid in the app
      </h3>
      <p aria-live="polite" className="text-muted-foreground">{line}</p>
      <dl className="t-small grid gap-x-6 gap-y-1 text-muted-foreground sm:grid-cols-2">
        {money.captured ? (
          <div className="flex gap-1">
            <dt>Captured</dt>
            <dd><Money cents={money.captured.cents} />{money.captured.feeLineCents > 0 ? <> (incl. <Money cents={money.captured.feeLineCents} /> fee line)</> : null}</dd>
          </div>
        ) : null}
        {money.payout?.batchId ? (
          <div className="flex min-w-0 gap-1">
            <dt>Payout batch</dt>
            <dd className="truncate font-mono">{money.payout.batchId}{money.payout.attempt > 1 ? ` (attempt ${money.payout.attempt})` : ""}</dd>
          </div>
        ) : null}
      </dl>

      <div className="flex flex-wrap gap-2">
        {isBuyer && (money.waiting === "connection" || s === "PAYOUT_FAILED") ? (
          <Link href="/app/settings#paypal" className={buttonVariants({ variant: s === "PAYOUT_FAILED" ? "outline" : "default", className: "h-11" })}>
            {money.receiverConnected ? "Change PayPal account" : "Connect PayPal"}
          </Link>
        ) : null}
        {isBuyer && s === "PAYOUT_FAILED" && money.receiverConnected ? (
          <Button className="h-11" disabled={Boolean(busy)} onClick={() => void run("retry", `/api/expenses/${e.id}/payout/retry`)}>
            <PendingLabel pending={busy === "retry"} busy="Sending…" idle="Retry payout" />
          </Button>
        ) : null}
        {s === "PAID" || s === "PAYOUT_PROCESSING" || s === "PAYOUT_UNCLAIMED" ? (
          <Button variant="ghost" className="h-11 text-muted-foreground" disabled={Boolean(busy)} onClick={() => void run("reconcile", `/api/expenses/${e.id}/reconcile`)}>
            <PendingLabel pending={busy === "reconcile"} busy="Checking…" idle={<><RefreshCw aria-hidden /> Check with PayPal</>} />
          </Button>
        ) : null}
        {isOwner && s === "PAYOUT_FAILED" ? (
          <ConfirmSheet
            trigger={<Button variant="ghost" className="h-11 text-muted-foreground">Refund {isBuyer ? payer : "me"}</Button>}
            title={`Refund ${payer}'s payment?`}
            description="The money goes back to the PayPal account it came from, and this claim closes as refunded. Use this only if the payout cannot be fixed."
            confirmLabel="Refund"
            pendingLabel="Refunding…"
            cancelLabel="Not now"
            destructive
            onConfirm={async () => (await run("refund", `/api/expenses/${e.id}/refund`)) !== null}
          />
        ) : null}
      </div>
      <ActionError error={error} />
    </section>
  );
}
