"use client";

import { AlertTriangle, BellRing, Camera, Copy, HandCoins, Receipt } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ConfirmSheet } from "@/components/domain/confirm-sheet";
import { DisputeThread } from "@/components/domain/dispute-thread";
import { PendingLabel } from "@/components/domain/pending-label";
import { RespondForm } from "@/components/domain/dispute-respond";
import { Money } from "@/components/domain/money";
import { ReceiptViewButton } from "@/components/domain/receipt-view-button";
import { SettlementStatusBadge } from "@/components/domain/status-badge";
import { ISSUE_TEXT } from "@/components/domain/status-meta";
import { SuccessCheck } from "@/components/domain/success-check";
import { Button, buttonVariants } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { Role } from "@/types/firestore";
import type { DisputeView, ExpenseView, MoneyStatus, ReceiptView } from "@/types/views";
import { PayoutPanel } from "./payout-panel";
import { ActionError, useAction } from "./use-action";

// Receipt and claim part of the expense page (A.6.4): add/confirm the receipt, send the payment
// request, remind, mark received, waive, confirm a payer's report, disputes.

// Dates use the user's time zone from the server, so server and client render the same text.
const dayIn = (timeZone: string) => (iso: string) => new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric", year: "numeric" }).format(new Date(iso));
const APPROVAL_OK = new Set(["NOT_REQUIRED", "APPROVED", "PARTIALLY_APPROVED"]);

type Props = {
  e: ExpenseView;
  receipt: ReceiptView | null;
  dispute: DisputeView | null;
  me: Role;
  names: Record<Role, string>;
  timeZone: string;
  dueTerms: { days: number; clause: { quote: string; page: number } | null; source: "rule" | "default"; previewDueAt: string };
  money?: MoneyStatus | null;
  isOwner?: boolean;
};

export function ReceiptStep({ e, receipt, me, timeZone }: Pick<Props, "e" | "receipt" | "me" | "timeZone">) {
  const day = dayIn(timeZone);
  const s = e.settlement.state;
  const isBuyer = e.paidByRole === me;
  if (s === "NONE") {
    if (!isBuyer) return <p className="text-muted-foreground">No receipt yet.</p>;
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Link href={`/app/expenses/${e.id}/receipt`} className={buttonVariants({ variant: APPROVAL_OK.has(e.approval.state) ? "default" : "outline", className: "h-11 px-4" })}>
          <Camera aria-hidden /> Add the receipt
        </Link>
        <span className="t-small text-muted-foreground">Upload it after you bought it. A photo or a PDF.</span>
      </div>
    );
  }
  if (!receipt) return null;
  const open = receipt.match?.open ?? [];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2">
          <Receipt aria-hidden className="size-4 text-muted-foreground" />
          {receipt.confirmed ? (
            <span>
              {receipt.confirmed.merchant}, {receipt.confirmed.date ? day(`${receipt.confirmed.date}T12:00:00Z`) : ""}, <Money cents={receipt.confirmed.totalCents} />
            </span>
          ) : (
            <span className="text-muted-foreground">Receipt uploaded, not checked yet</span>
          )}
        </p>
        <ReceiptViewButton receiptId={receipt.id} />
      </div>
      {s === "RECEIPT_SUBMITTED" && isBuyer ? (
        <Link href={`/app/expenses/${e.id}/receipt`} className={buttonVariants({ className: "h-11 px-4" })}>
          Check the receipt
        </Link>
      ) : null}
      {s === "RECEIPT_ISSUE" ? (
        <div className="space-y-2">
          <ul className="space-y-2">
            {open.map((i) => (
              <li key={i} className="flex gap-2 rounded-md bg-approval-bg px-3 py-2 text-approval">
                <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
                <span className="t-small">
                  <span className="font-medium">{ISSUE_TEXT[i].title}.</span> {ISSUE_TEXT[i].body}
                </span>
              </li>
            ))}
          </ul>
          {isBuyer ? (
            <Link href={`/app/expenses/${e.id}/receipt`} className={buttonVariants({ variant: "outline", className: "h-11 px-4" })}>
              Look at the receipt issues
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function ClaimStep({ e, dispute, me, names, dueTerms, timeZone, money, isOwner }: Omit<Props, "receipt">) {
  const day = dayIn(timeZone);
  const { busy, error, run, refresh } = useAction();
  const [sentLink, setSentLink] = useState<{ link: string; email: "sent" | "failed" } | null>(null);
  const [copied, setCopied] = useState(false);
  const [reason, setReason] = useState("");
  const st = e.settlement;
  const isBuyer = e.paidByRole === me;
  const payer = names[e.owedByRole];
  const receiver = names[e.paidByRole];
  const blocked = e.verdict.code === "NOT_COVERED" || e.verdict.code === "NEEDS_REVIEW";

  if (st.state === "READY") {
    if (!isBuyer) return <p className="text-muted-foreground">{receiver} can now send you the payment request.</p>;
    if (blocked || !APPROVAL_OK.has(e.approval.state)) return <p className="text-muted-foreground">The receipt is checked. A payment request is possible once the approval is settled.</p>;
    const due = dueTerms.previewDueAt;
    return (
      <div>
        <p className="text-muted-foreground">
          {payer} owes <Money cents={e.verdict.owedShareCents} className="text-foreground" />. Due {day(due)}
          {dueTerms.clause ? `, ${dueTerms.days} days as the agreement says (p. ${dueTerms.clause.page}).` : `, the default ${dueTerms.days} days.`}
        </p>
        <Button
          className="mt-3 h-12 w-full px-5 text-[15px] sm:w-auto"
          disabled={Boolean(busy)}
          onClick={async () => {
            const r = await run<{ claim: { link: string; email: { status: "sent" | "failed" } } }>("request", `/api/expenses/${e.id}/payment-request`);
            if (r) setSentLink({ link: r.claim.link, email: r.claim.email.status });
          }}
        >
          <PendingLabel pending={busy === "request"} busy="Sending…" idle={<><HandCoins aria-hidden /> Request <Money cents={e.verdict.owedShareCents} /> from {payer}, due {day(due).replace(/, \d{4}$/, "")}</>} />
        </Button>
        <ActionError error={error} />
      </div>
    );
  }

  const openClaim = st.state === "AWAITING_PAYMENT" || st.state === "PAYMENT_FAILED";
  const canRemind = st.nextReminderAt === null;

  return (
    <div className="space-y-4">
      {st.owedCents !== null ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="t-label text-muted-foreground">{isBuyer ? `${payer} owes you` : `You owe ${receiver}`}</p>
            <Money cents={st.owedCents} size="big" />
          </div>
          <div className="flex flex-col items-end gap-1">
            <SettlementStatusBadge state={st.state} overdue={st.overdue} dueSoon={st.dueSoon} />
            {st.dueAt && openClaim ? <span className="t-small text-muted-foreground">Due {day(st.dueAt)}</span> : null}
          </div>
        </div>
      ) : null}

      {sentLink ? (
        <p aria-live="polite" className="t-small flex flex-wrap items-center gap-2 text-muted-foreground">
          {sentLink.email === "sent" ? `Payment request emailed to ${payer}.` : `The email to ${payer} could not be sent. Copy the link and send it yourself.`}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9"
            onClick={() => navigator.clipboard.writeText(sentLink.link).then(() => setCopied(true), () => setCopied(false))}
          >
            <Copy aria-hidden /> {copied ? "Copied" : "Copy link"}
          </Button>
        </p>
      ) : null}

      {openClaim && isBuyer ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="h-11" disabled={!canRemind || Boolean(busy)} onClick={() => void run("remind", `/api/expenses/${e.id}/remind`)}>
            <PendingLabel pending={busy === "remind"} busy="Sending…" idle={<><BellRing aria-hidden /> {canRemind ? "Send a reminder" : `Next reminder ${day(st.nextReminderAt!)}`}</>} />
          </Button>
          <ConfirmSheet
            trigger={<Button variant="outline" className="h-11">Mark received</Button>}
            title={`Did ${payer} pay you outside the app?`}
            description={`It is recorded as settled. ${payer} is told and can contest it within 7 days.`}
            cancelLabel="Not yet"
            confirmLabel="Yes, I received it"
            pendingLabel="Saving…"
            onConfirm={async () => (await run("received", `/api/expenses/${e.id}/mark-received`)) !== null}
          />
          <ConfirmSheet
            trigger={<Button variant="ghost" className="h-11 text-muted-foreground">Waive it</Button>}
            title={`Waive ${payer}’s share?`}
            description="Nothing will be owed for this expense. Say why, for your shared record."
            cancelLabel="Keep the claim"
            confirmLabel="Waive"
            pendingLabel="Saving…"
            canConfirm={reason.trim().length > 0}
            onConfirm={async () => (await run("waive", `/api/expenses/${e.id}/waive`, { body: { reason } })) !== null}
          >
            <div className="space-y-1.5 pb-2">
              <label htmlFor="waive-reason" className="text-sm font-medium">Reason</label>
              <Textarea id="waive-reason" rows={3} maxLength={500} className="text-base" value={reason} onChange={(ev) => setReason(ev.target.value)} />
            </div>
          </ConfirmSheet>
        </div>
      ) : null}
      {openClaim && !isBuyer ? <p className="text-muted-foreground">Use the link in the email from {receiver} to pay with PayPal (Family plan), see the receipt, or say you paid outside the app.</p> : null}

      {money ? <PayoutPanel e={e} money={money} isBuyer={isBuyer} isOwner={Boolean(isOwner)} payer={payer} receiver={receiver} /> : null}

      {st.state === "EXTERNAL_PAYMENT_REPORTED" && st.externalReport ? (
        <div className="rounded-[10px] border border-review/30 bg-review-bg p-4">
          <p className="font-medium text-review">
            {isBuyer ? `${payer} says they paid you` : "You said you paid"} by {st.externalReport.method}
            {st.externalReport.date ? ` on ${day(`${st.externalReport.date}T12:00:00Z`)}` : ""}.
          </p>
          {st.externalReport.note ? <p className="t-small mt-1 text-review">&ldquo;{st.externalReport.note}&rdquo;</p> : null}
          <p className="t-small mt-1 text-muted-foreground">It stays outstanding until {isBuyer ? "you confirm" : `${receiver} confirms`}.</p>
          {isBuyer ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button className="h-11" onClick={() => void run("confirm", `/api/expenses/${e.id}/external-report/confirm`)} disabled={Boolean(busy)}>
                <PendingLabel pending={busy === "confirm"} busy="Saving…" idle="I received it" />
              </Button>
              <Button variant="outline" className="h-11" onClick={() => void run("reject", `/api/expenses/${e.id}/external-report/reject`)} disabled={Boolean(busy)}>
                <PendingLabel pending={busy === "reject"} busy="Saving…" idle="I did not receive it" />
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {st.state === "SETTLED_EXTERNALLY" || st.state === "SETTLED" ? (
        <div className="flex items-start gap-3">
          <SuccessCheck key={st.state} label="Settled" className="size-10" />
          <div>
            <p className="font-medium">Settled{st.state === "SETTLED_EXTERNALLY" ? " outside the app" : ""}{st.settledAt ? `, ${day(st.settledAt)}` : ""}</p>
            {st.contestUntil && st.contestOpen ? <p className="t-small text-muted-foreground">{payer} can contest it until {day(st.contestUntil)}.</p> : null}
          </div>
        </div>
      ) : null}

      {st.state === "WAIVED" ? <p className="text-muted-foreground">Waived{st.waiverReason ? <>: &ldquo;{st.waiverReason}&rdquo;</> : ""}. Nothing is owed.</p> : null}

      {dispute ? (
        <section aria-labelledby="disp-h" className="space-y-3">
          <h3 id="disp-h" className="t-h3">{dispute.status === "UNRESOLVED" ? "Dispute closed without agreement" : dispute.status === "AGREED" ? "Dispute agreed" : "Dispute"}</h3>
          <DisputeThread rounds={dispute.rounds} names={names} me={me} />
          {dispute.status === "OPEN" && st.state === "DISPUTED" && dispute.rounds[dispute.rounds.length - 1]?.by !== me ? (
            <RespondForm expenseId={e.id} receiver={names[dispute.rounds[dispute.rounds.length - 1].by]} proposal={dispute.rounds[dispute.rounds.length - 1]?.proposedCents ?? null} onDone={refresh} redirectOn401 />
          ) : dispute.status === "OPEN" ? (
            <p className="t-small text-muted-foreground">Waiting for the other parent to answer.</p>
          ) : null}
          {dispute.status === "UNRESOLVED" ? <p className="t-small text-muted-foreground">After two rounds there was no agreement. The claim is closed and the record stays here.</p> : null}
        </section>
      ) : null}
      <ActionError error={error} />
    </div>
  );
}
