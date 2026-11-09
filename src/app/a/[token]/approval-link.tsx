"use client";

import { AlertTriangle, XCircle } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ClauseCard } from "@/components/domain/clause-card";
import { Money } from "@/components/domain/money";
import { Segmented } from "@/components/domain/segmented";
import { SplitBar } from "@/components/domain/split-bar";
import { CATEGORY_META } from "@/components/domain/status-meta";
import { SuccessCheck } from "@/components/domain/success-check";
import { LinkGone, LinkMessage, LinkVerify } from "@/components/links/link-verify";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError, errorMessage } from "@/hooks/api";
import { formatCents, parseDollarsToCents } from "@/lib/money";
import type { ApprovalLinkSummary, LinkSummary } from "@/types/views";

type Load = { kind: "loading" } | { kind: "ok"; s: ApprovalLinkSummary } | { kind: "gone"; reason: string } | { kind: "invalid" } | { kind: "error"; message: string };

const day = (iso: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(iso));

export function ApprovalLink() {
  const { token } = useParams<{ token: string }>();
  const [load, setLoad] = useState<Load>({ kind: "loading" });

  const fetchSummary = useCallback(
    () =>
      api<{ summary: LinkSummary }>(`/api/links/${token}`, { redirectOn401: false }).then(
        ({ summary }): Load => (summary.purpose === "approval" ? { kind: "ok", s: summary } : { kind: "invalid" }),
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

  if (load.kind === "loading") return <Skeleton className="h-72 w-full" />;
  if (load.kind === "gone") return <LinkGone reason={load.reason} what="request" />;
  if (load.kind === "invalid") return <LinkMessage title="This link is not valid" body="Check that you opened the whole link from the email." />;
  if (load.kind === "error") return <LinkMessage title="Could not load the request" body={load.message} action={<Button className="h-11" onClick={() => void refresh()}>Try again</Button>} />;

  const s = load.s;
  const Cat = CATEGORY_META[s.category as keyof typeof CATEGORY_META]?.icon;
  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <p className="t-small flex items-center gap-1.5 text-muted-foreground">
          {Cat ? <Cat aria-hidden className="size-4" /> : null}
          {CATEGORY_META[s.category as keyof typeof CATEGORY_META]?.label ?? s.category} for {s.childName}
        </p>
        <h1 className="t-h1 text-balance">
          {s.requesterName} asks for your approval
        </h1>
        {s.purchasedBeforeApproval ? (
          <div role="note" className="flex gap-3 rounded-[10px] border border-danger/30 bg-danger-bg p-4 text-danger">
            <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0" />
            <div>
              <p className="font-medium">Purchased before approval</p>
              <p className="t-small mt-0.5">{s.requesterName.split(" ")[0]} already bought this before asking you. You can still approve it, approve part of it, or decline.</p>
            </div>
          </div>
        ) : null}
      </section>

      <section aria-label="The expense" className="space-y-5 rounded-[14px] border border-border bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium">{s.description}</p>
            {s.vendor ? <p className="t-small text-muted-foreground">{s.vendor}</p> : null}
          </div>
          <Money cents={s.amountCents} size="big" />
        </div>
        <SplitBar owedCents={s.owedShareCents} otherCents={s.amountCents - s.owedShareCents} owedLabel={`Your share${s.owedPct !== null ? ` (${s.owedPct}%)` : ""}`} otherLabel={s.requesterName.split(" ")[0]} />
        {s.clause ? (
          <ClauseCard quote={s.clause.quote} page={s.clause.page} title={s.clause.label}>
            {s.threshold ? (
              <span className="t-small text-muted-foreground">
                Written approval needed {s.threshold.operator === "gte" ? "from" : "above"} <Money cents={s.threshold.thresholdCents} />.
              </span>
            ) : null}
          </ClauseCard>
        ) : null}
        {!s.decision ? <p className="t-small text-muted-foreground">Nothing happens if you do not answer. This request ends on {day(s.expiresAt)}.</p> : null}
      </section>

      <AnimatePresence mode="wait" initial={false}>
        {s.decision ? (
          <motion.div key="done" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}>
            <Decided s={s} />
          </motion.div>
        ) : s.canAct ? (
          <motion.div key="act" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.14 } }} transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}>
            <DecisionForm s={s} token={token} onDone={refresh} />
          </motion.div>
        ) : (
          <motion.div key="verify" exit={{ opacity: 0, transition: { duration: 0.14 } }}>
            <LinkVerify token={token} sentTo={s.sentTo} purpose="answer" onVerified={refresh} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Decided({ s }: { s: ApprovalLinkSummary }) {
  const d = s.decision!;
  const declined = d.decision === "DECLINED";
  return (
    <section aria-live="polite" className="space-y-3 rounded-[14px] border border-border bg-surface p-5">
      {declined ? <XCircle aria-hidden className="size-12 text-danger" /> : <SuccessCheck label="Approved" />}
      <h2 className="t-h2">
        {declined ? "You declined this" : d.decision === "PARTIALLY_APPROVED" ? `You approved ${formatCents(d.approvedCents ?? 0)}` : "You approved this"}
      </h2>
      <p className="text-muted-foreground">
        {declined
          ? `${s.requesterName.split(" ")[0]} was told. A new request for this expense is possible 7 days after the decline.`
          : `${s.requesterName.split(" ")[0]} was told. After the purchase you will get the receipt and a payment request for your share.`}
      </p>
      {d.reason ? <p className="t-small text-muted-foreground">Your note: &ldquo;{d.reason}&rdquo;</p> : null}
      <p className="t-small text-muted-foreground">Answered {day(d.decidedAt)}. The first answer is final. You can close this page.</p>
    </section>
  );
}

type Choice = "APPROVED" | "PARTIALLY_APPROVED" | "DECLINED";

function DecisionForm({ s, token, onDone }: { s: ApprovalLinkSummary; token: string; onDone: () => Promise<void> }) {
  const [choice, setChoice] = useState<Choice>("APPROVED");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const partialCents = parseDollarsToCents(amount);
  const partialInvalid = choice === "PARTIALLY_APPROVED" && (partialCents === null || partialCents <= 0 || partialCents >= s.amountCents);

  async function submit() {
    if (partialInvalid) return setError(`Enter an amount between $0.01 and ${formatCents(s.amountCents - 1)}.`);
    setBusy(true);
    setError(null);
    try {
      const body = choice === "PARTIALLY_APPROVED" ? { decision: choice, approvedCents: partialCents!, ...(reason.trim() ? { reason: reason.trim() } : {}) } : { decision: choice, ...(reason.trim() ? { reason: reason.trim() } : {}) };
      await api(`/api/links/${token}/decision`, { method: "POST", body, redirectOn401: false });
      await onDone();
    } catch (e) {
      setError(errorMessage(e));
      if (e instanceof ApiError && (e.status === 409 || e.status === 410)) await onDone();
      setBusy(false);
    }
  }

  const label = choice === "APPROVED" ? `Approve ${formatCents(s.amountCents)}` : choice === "PARTIALLY_APPROVED" ? `Approve ${partialCents && !partialInvalid ? formatCents(partialCents) : "part"}` : "Decline";
  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Segmented<Choice>
        name="decision"
        legend="Your answer"
        value={choice}
        onChange={(v) => {
          setChoice(v);
          setError(null);
        }}
        options={[
          { value: "APPROVED", label: "Approve" },
          { value: "PARTIALLY_APPROVED", label: "Approve part" },
          { value: "DECLINED", label: "Decline" },
        ]}
      />
      {choice === "PARTIALLY_APPROVED" ? (
        <div className="space-y-1.5">
          <label htmlFor="approved" className="text-sm font-medium">Amount you approve</label>
          <div className="relative">
            <span aria-hidden className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted-foreground">$</span>
            <Input id="approved" inputMode="decimal" autoComplete="off" className="h-11 pl-7 font-mono text-base tabular-nums" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="200…" aria-invalid={Boolean(error) && partialInvalid} />
          </div>
          <p className="t-small text-muted-foreground">Less than {formatCents(s.amountCents)}. Your share is worked out on this amount.</p>
        </div>
      ) : null}
      <div className="space-y-1.5">
        <label htmlFor="reason" className="text-sm font-medium">Note to {s.requesterName.split(" ")[0]} (optional)</label>
        <Textarea id="reason" rows={3} maxLength={500} className="text-base" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={choice === "DECLINED" ? "For example: we agreed on one camp this summer…" : ""} />
      </div>
      <div aria-live="polite">{error ? <p className="t-small rounded-md bg-danger-bg px-3 py-2 text-danger">{error}</p> : null}</div>
      <div className="sticky bottom-0 -mx-4 border-t border-border bg-background/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
        <Button type="submit" className={`h-12 w-full text-[15px] sm:w-auto sm:px-6 ${choice === "DECLINED" ? "bg-danger text-white hover:bg-danger/90" : ""}`} disabled={busy}>
          {busy ? "Saving…" : label}
        </Button>
      </div>
      <p className="t-small text-muted-foreground">Your answer is final. Changing it needs a new request.</p>
    </form>
  );
}
