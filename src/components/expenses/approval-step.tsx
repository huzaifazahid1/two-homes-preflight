"use client";

import { AlertTriangle, Copy, Hourglass, Send, XCircle } from "lucide-react";
import { useState } from "react";
import { Money } from "@/components/domain/money";
import { SuccessCheck } from "@/components/domain/success-check";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { ExpenseView } from "@/types/views";
import { ActionError, useAction } from "./use-action";

// Approval part of the expense page (A.6.3): ask, wait, resend, cancel, and the decision.

type Sent = { sent: { link: string; email: { status: "sent" | "failed" }; expiresAt: string } };
const dayIn = (timeZone: string) => (iso: string) => new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric" }).format(new Date(iso));

export function ApprovalStep({ e, other, isBuyer, timeZone }: { e: ExpenseView; other: string; isBuyer: boolean; timeZone: string }) {
  const day = dayIn(timeZone);
  const { busy, error, run } = useAction();
  const [sent, setSent] = useState<Sent["sent"] | null>(null);
  const [copied, setCopied] = useState(false);
  const a = e.approval;

  async function ask() {
    const r = await run<Sent>("ask", `/api/expenses/${e.id}/approval-request`);
    if (r) setSent(r.sent);
  }
  async function copy(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const sentNote = sent ? (
    <div aria-live="polite" className="t-small mt-3 flex flex-wrap items-center gap-2 text-muted-foreground">
      {sent.email.status === "sent" ? `Email sent to ${other}.` : `The email to ${other} could not be sent. Copy the link and send it yourself.`}
      <Button type="button" variant="outline" size="sm" className="h-9" onClick={() => void copy(sent.link)}>
        <Copy aria-hidden /> {copied ? "Copied" : "Copy link"}
      </Button>
    </div>
  ) : null;

  if (a.state === "APPROVED" || a.state === "PARTIALLY_APPROVED") {
    return (
      <div className="flex items-start gap-3">
        <SuccessCheck key={a.state} label="Approved" className="size-10" />
        <div>
          <p className="font-medium">
            {a.state === "APPROVED" ? `${other} approved it` : <>{other} approved <Money cents={a.approvedCents ?? 0} /> of <Money cents={e.amountCents} /></>}
            {a.decidedAt ? <span className="font-normal text-muted-foreground">, {day(a.decidedAt)}</span> : null}
          </p>
          {a.reason ? <p className="t-small text-muted-foreground">&ldquo;{a.reason}&rdquo;</p> : null}
        </div>
      </div>
    );
  }

  if (a.state === "REQUESTED") {
    return (
      <div>
        <p className="flex items-start gap-2">
          <Hourglass aria-hidden className="mt-1 size-4 shrink-0 text-approval" />
          <span>
            {isBuyer ? `Waiting for ${other} to answer.` : "Waiting for your answer. Open the link in the email."} Nothing is approved on silence.
            {a.expiresAt ? <span className="text-muted-foreground"> The request ends {day(a.expiresAt)}.</span> : null}
          </span>
        </p>
        {isBuyer ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="outline" className="h-11" onClick={() => void ask()} disabled={Boolean(busy)}>
              <Send aria-hidden /> {busy === "ask" ? "Sending…" : "Send the link again"}
            </Button>
            <Dialog>
              <DialogTrigger render={<Button variant="ghost" className="h-11 text-muted-foreground" />}>Cancel request</DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Cancel the approval request?</DialogTitle>
                  <DialogDescription>The link in {other}&rsquo;s email stops working right away.</DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose render={<Button variant="outline" className="h-11" />}>Keep it</DialogClose>
                  <Button className="h-11" onClick={() => void run("cancel", `/api/expenses/${e.id}/approval-request`, { method: "DELETE" })} disabled={Boolean(busy)}>
                    {busy === "cancel" ? "Cancelling…" : "Cancel request"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        ) : null}
        {sentNote}
        <ActionError error={error} />
      </div>
    );
  }

  if (a.state === "DECLINED") {
    const blocked = a.blocked;
    return (
      <div>
        <p className="flex items-start gap-2">
          <XCircle aria-hidden className="mt-1 size-4 shrink-0 text-danger" />
          <span>
            {other} declined{a.decidedAt ? ` on ${day(a.decidedAt)}` : ""}.{a.reason ? <span className="text-muted-foreground"> &ldquo;{a.reason}&rdquo;</span> : null} No payment request is possible for it.
          </span>
        </p>
        {isBuyer ? (
          <Button variant="outline" className="mt-3 h-11" onClick={() => void ask()} disabled={Boolean(blocked) || Boolean(busy)}>
            {blocked && a.blockedUntil ? `You can ask again from ${day(a.blockedUntil)}` : busy === "ask" ? "Sending…" : "Ask again"}
          </Button>
        ) : null}
        {sentNote}
        <ActionError error={error} />
      </div>
    );
  }

  if (a.state === "REQUIRED" || a.state === "EXPIRED" || a.state === "CANCELLED") {
    const bought = e.mode === "purchased" || e.receiptId !== null;
    return (
      <div>
        <p className="text-muted-foreground">
          {a.state === "EXPIRED" ? `The request to ${other} expired without an answer.` : a.state === "CANCELLED" ? "You cancelled the approval request." : `${other} needs to approve this before it can be claimed.`}
        </p>
        {bought && isBuyer ? (
          <p className="t-small mt-2 flex gap-2 rounded-md bg-approval-bg px-3 py-2 text-approval">
            <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
            Approval was required before purchase. {other} will see that it was already bought, and may decline.
          </p>
        ) : null}
        {isBuyer && a.state !== "CANCELLED" ? (
          <Button className="mt-3 h-11 px-4" onClick={() => void ask()} disabled={Boolean(busy)}>
            <Send aria-hidden /> {busy === "ask" ? "Sending…" : a.state === "EXPIRED" ? `Ask ${other} again` : `Ask ${other} for approval`}
          </Button>
        ) : null}
        {sentNote}
        <ActionError error={error} />
      </div>
    );
  }
  return null;
}
