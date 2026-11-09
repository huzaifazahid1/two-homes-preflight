"use client";

import { Info } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ClauseCard } from "@/components/domain/clause-card";
import { DisputeThread } from "@/components/domain/dispute-thread";
import { Money } from "@/components/domain/money";
import { ReceiptViewButton } from "@/components/domain/receipt-view-button";
import { SettlementStatusBadge } from "@/components/domain/status-badge";
import { SuccessCheck } from "@/components/domain/success-check";
import { LinkGone, LinkMessage, LinkVerify } from "@/components/links/link-verify";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { RespondForm } from "@/components/domain/dispute-respond";
import { api, ApiError, errorMessage } from "@/hooks/api";
import { parseDollarsToCents } from "@/lib/money";
import { PAYMENT_METHODS } from "@/schemas/claims";
import type { LinkSummary, PaymentLinkSummary } from "@/types/views";

type Load = { kind: "loading" } | { kind: "ok"; s: PaymentLinkSummary } | { kind: "gone"; reason: string } | { kind: "invalid" } | { kind: "error"; message: string };

const day = (iso: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(iso));
const todayLocal = () => new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const WAITING = new Set(["EXTERNAL_PAYMENT_REPORTED", "DISPUTED"]);
const POLL_MS = 10_000;

export function PaymentLink() {
  const { token } = useParams<{ token: string }>();
  const [load, setLoad] = useState<Load>({ kind: "loading" });

  const fetchSummary = useCallback(
    () =>
      api<{ summary: LinkSummary }>(`/api/links/${token}`, { redirectOn401: false }).then(
        ({ summary }): Load => (summary.purpose === "payment" ? { kind: "ok", s: summary } : { kind: "invalid" }),
        (e: unknown): Load => {
          if (e instanceof ApiError && e.status === 410) return { kind: "gone", reason: String(e.details?.reason ?? "expired") };
          if (e instanceof ApiError && e.status === 404) return { kind: "invalid" };
          return { kind: "error", message: errorMessage(e) };
        },
      ),
    [token],
  );
  const refresh = useCallback(async () => setLoad(await fetchSummary()), [fetchSummary]);

  useEffect(() => {
    let active = true;
    void fetchSummary().then((l) => active && setLoad(l));
    return () => {
      active = false;
    };
  }, [fetchSummary]);

  // Guests have no Firebase session: poll while waiting for the other parent (Section E.8).
  const waiting = load.kind === "ok" && WAITING.has(load.s.state);
  useEffect(() => {
    if (!waiting) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void fetchSummary().then(setLoad);
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [waiting, fetchSummary]);

  if (load.kind === "loading") return <Skeleton className="h-72 w-full" />;
  if (load.kind === "gone") return <LinkGone reason={load.reason} what="payment request" />;
  if (load.kind === "invalid") return <LinkMessage title="This link is not valid" body="Check that you opened the whole link from the email." />;
  if (load.kind === "error") return <LinkMessage title="Could not load the payment request" body={load.message} action={<Button className="h-11" onClick={() => void refresh()}>Try again</Button>} />;

  const s = load.s;
  const receiver = s.receiverName.split(" ")[0];
  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <p className="t-small text-muted-foreground">
          {s.description} for {s.childName}
        </p>
        <h1 className="t-h1 text-balance">{receiver} asks for your share</h1>
        <div className="flex flex-wrap items-center gap-2">
          <SettlementStatusBadge state={s.state} overdue={s.overdue} dueSoon={s.dueSoon} />
          {s.dueAt && (s.state === "AWAITING_PAYMENT" || s.state === "PAYMENT_FAILED") ? <span className="t-small text-muted-foreground">Due {day(s.dueAt)}</span> : null}
        </div>
      </section>

      <section aria-label="The claim" className="space-y-4 rounded-[14px] border border-border bg-surface p-5">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="t-label text-muted-foreground">Your share{s.owedPct !== null ? ` (${s.owedPct}%)` : ""}</p>
            <Money cents={s.owedCents} size="big" />
          </div>
          {s.receiptTotalCents !== null ? (
            <p className="t-small text-right text-muted-foreground">
              Receipt total <Money cents={s.receiptTotalCents} />
              {s.approvedCents !== null && s.approvedCents < s.receiptTotalCents ? (
                <>
                  <br />
                  You approved <Money cents={s.approvedCents} />
                </>
              ) : null}
            </p>
          ) : null}
        </div>
        {s.clause ? <ClauseCard quote={s.clause.quote} page={s.clause.page} title={s.clause.label} /> : null}
        {s.dueClause && s.clause && s.dueClause.quote !== s.clause.quote ? <ClauseCard quote={s.dueClause.quote} page={s.dueClause.page} title="Reimbursement deadline" /> : null}
        {s.receipt && s.canAct ? <ReceiptViewButton receiptId={s.receipt.id} redirectOn401={false} /> : null}
      </section>

      {!s.canAct ? (
        <LinkVerify token={token} sentTo={s.sentTo} purpose="see the receipt or answer" onVerified={refresh} />
      ) : (
        <Actions s={s} token={token} onChanged={refresh} />
      )}
    </div>
  );
}

function Actions({ s, token, onChanged }: { s: PaymentLinkSummary; token: string; onChanged: () => Promise<void> }) {
  const receiver = s.receiverName.split(" ")[0];
  const names = { owner: receiver, coparent: "You" } as const;
  const myRole = s.dispute?.rounds[0]?.by ?? "coparent";
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={s.state} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.14 } }} transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }} className="space-y-6">
        {s.state === "AWAITING_PAYMENT" || s.state === "PAYMENT_FAILED" ? (
          <>
            <div className="flex gap-3 rounded-[10px] border border-border bg-surface-2 p-4">
              <Info aria-hidden className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
              <p className="t-small text-muted-foreground">Paying with PayPal here is part of the Family plan. You can pay {receiver} any way you both use, then tell them below.</p>
            </div>
            <ReportForm token={token} receiver={receiver} onDone={onChanged} />
          </>
        ) : null}

        {s.state === "EXTERNAL_PAYMENT_REPORTED" && s.externalReport ? (
          <section aria-live="polite" className="rounded-[14px] border border-border bg-surface p-5">
            <h2 className="t-h3">Waiting for {receiver} to confirm</h2>
            <p className="mt-2 text-muted-foreground">
              You said you paid by {s.externalReport.method}
              {s.externalReport.date ? ` on ${day(`${s.externalReport.date}T12:00:00Z`)}` : ""}. It counts as outstanding until {receiver} confirms. This page updates by itself.
            </p>
          </section>
        ) : null}

        {s.state === "SETTLED_EXTERNALLY" || s.state === "SETTLED" ? (
          <section aria-live="polite" className="space-y-3 rounded-[14px] border border-border bg-surface p-5">
            <SuccessCheck label="Settled" />
            <h2 className="t-h2">Settled</h2>
            <p className="text-muted-foreground">Nothing more is owed for this expense.{s.contestUntil && s.canDispute ? ` If you did not pay it, you can contest until ${day(s.contestUntil)}.` : ""}</p>
          </section>
        ) : null}

        {s.state === "WAIVED" ? <LinkMessage title="Nothing to pay" body={`${receiver} waived this claim.`} /> : null}

        {s.dispute ? (
          <section aria-labelledby="dispute-h" className="space-y-3">
            <h2 id="dispute-h" className="t-h3">{s.dispute.status === "UNRESOLVED" ? "Dispute closed without agreement" : s.dispute.status === "AGREED" ? "You agreed" : "Dispute"}</h2>
            <DisputeThread rounds={s.dispute.rounds} names={{ ...names, coparent: names.coparent }} me={myRole} />
            {s.dispute.status === "UNRESOLVED" ? <p className="t-small text-muted-foreground">After two rounds there was no agreement. Nothing can be paid in the app for this claim; the full record stays here.</p> : null}
            {s.dispute.yourTurn ? <RespondForm expenseId={s.expenseId} receiver={receiver} proposal={s.dispute.rounds[s.dispute.rounds.length - 1]?.proposedCents ?? null} onDone={onChanged} /> : s.dispute.status === "OPEN" ? <p className="t-small text-muted-foreground">Waiting for {receiver} to answer. This page updates by itself.</p> : null}
          </section>
        ) : null}

        {s.canDispute ? <DisputeForm expenseId={s.expenseId} owedCents={s.owedCents} onDone={onChanged} /> : null}
      </motion.div>
    </AnimatePresence>
  );
}

function Feedback({ error }: { error: string | null }) {
  return <div aria-live="polite">{error ? <p className="t-small rounded-md bg-danger-bg px-3 py-2 text-danger">{error}</p> : null}</div>;
}

function ReportForm({ token, receiver, onDone }: { token: string; receiver: string; onDone: () => Promise<void> }) {
  const [method, setMethod] = useState<(typeof PAYMENT_METHODS)[number]>("bank transfer");
  const [date, setDate] = useState(todayLocal());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/links/${token}/report-external`, { method: "POST", body: { method, date, ...(note.trim() ? { note: note.trim() } : {}) }, redirectOn401: false });
      await onDone();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }
  return (
    <form
      aria-labelledby="report-h"
      className="space-y-4 rounded-[14px] border border-border bg-surface p-5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <h2 id="report-h" className="t-h3">I already paid {receiver}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="method" className="text-sm font-medium">How</label>
          <select id="method" value={method} onChange={(e) => setMethod(e.target.value as typeof method)} className="h-11 w-full rounded-lg border border-input bg-surface px-3 text-base text-foreground">
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>{m[0].toUpperCase() + m.slice(1)}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="paid-on" className="text-sm font-medium">When</label>
          <Input id="paid-on" type="date" max={todayLocal()} className="h-11 text-base" value={date} onChange={(e) => setDate(e.target.value)} required />
        </div>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="note" className="text-sm font-medium">Note (optional)</label>
        <Input id="note" maxLength={300} className="h-11 text-base" value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: reference 4821…" autoComplete="off" name="note" />
      </div>
      <Feedback error={error} />
      <Button type="submit" className="h-12 w-full text-[15px] sm:w-auto sm:px-6" disabled={busy}>
        {busy ? "Sending…" : `Tell ${receiver} I paid`}
      </Button>
      <p className="t-small text-muted-foreground">It stays outstanding until {receiver} confirms they received it.</p>
    </form>
  );
}

function DisputeForm({ expenseId, owedCents, onDone }: { expenseId: string; owedCents: number; onDone: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open) {
    return (
      <Button variant="ghost" className="h-11 px-3 text-muted-foreground" onClick={() => setOpen(true)}>
        Something is wrong with this claim
      </Button>
    );
  }
  async function submit() {
    const cents = amount.trim() ? parseDollarsToCents(amount) : null;
    if (amount.trim() && (cents === null || cents <= 0 || cents >= owedCents)) return setError("A proposed amount must be more than $0 and less than the claim.");
    setBusy(true);
    setError(null);
    try {
      await api(`/api/expenses/${expenseId}/dispute`, { method: "POST", body: { reason: reason.trim(), ...(cents ? { proposedCents: cents } : {}) }, redirectOn401: false });
      await onDone();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }
  return (
    <form
      aria-labelledby="dispute-new-h"
      className="space-y-4 rounded-[14px] border border-border bg-surface p-5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <h2 id="dispute-new-h" className="t-h3">Dispute this claim</h2>
      <p className="t-small text-muted-foreground">You each get at most two answers. Without agreement the claim closes as unresolved, with the full record kept.</p>
      <div className="space-y-1.5">
        <label htmlFor="d-reason" className="text-sm font-medium">What is wrong</label>
        <Textarea id="d-reason" rows={3} maxLength={1000} className="text-base" value={reason} onChange={(e) => setReason(e.target.value)} required />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="d-amount" className="text-sm font-medium">What you think is fair (optional)</label>
        <Input id="d-amount" inputMode="decimal" className="h-11 font-mono text-base tabular-nums" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="30.00…" autoComplete="off" name="proposed" />
      </div>
      <Feedback error={error} />
      <div className="flex flex-wrap gap-3">
        <Button type="submit" className="h-11" disabled={busy || !reason.trim()}>
          {busy ? "Sending…" : "Send dispute"}
        </Button>
        <Button type="button" variant="ghost" className="h-11" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
