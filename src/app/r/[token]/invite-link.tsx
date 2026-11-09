"use client";

import { CheckCircle2, Clock3, LinkIcon } from "lucide-react";
import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ClauseCard } from "@/components/domain/clause-card";
import { Money } from "@/components/domain/money";
import { OtpInput } from "@/components/domain/otp-input";
import { PayPalConnect } from "@/components/domain/paypal-connect";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiError, errorMessage } from "@/hooks/api";
import type { InviteSummary } from "@/types/views";

type Load = { kind: "loading" } | { kind: "ok"; s: InviteSummary } | { kind: "gone"; reason: string } | { kind: "invalid" } | { kind: "error"; message: string };

const CATEGORY: Record<string, string> = {
  medical: "Medical", dental: "Dental", education: "Education", school_supplies: "School supplies", extracurricular: "Extracurricular",
  childcare: "Childcare", clothing: "Clothing", travel: "Travel", other: "Other",
};

export function InviteLink() {
  const { token } = useParams<{ token: string }>();
  const search = useSearchParams();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [accepted, setAccepted] = useState(false);

  const fetchSummary = useCallback(
    () =>
      api<{ summary: InviteSummary }>(`/api/links/${token}`, { redirectOn401: false }).then(
        ({ summary }): Load => ({ kind: "ok", s: summary }),
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
    fetchSummary().then((l) => {
      if (active) setLoad(l);
    });
    return () => {
      active = false;
    };
  }, [fetchSummary]);

  if (accepted) return <Accepted />;
  if (load.kind === "loading") return <Skeleton className="h-72 w-full" />;
  if (load.kind === "gone") return <Gone reason={load.reason} />;
  if (load.kind === "invalid") return <Message title="This link is not valid" body="Check that you opened the whole link from the email." />;
  if (load.kind === "error") return <Message title="Could not load the invitation" body={load.message} action={<Button className="h-11" onClick={() => void refresh()}>Try again</Button>} />;

  const s = load.s;
  return (
    <div className="space-y-8">
      <section>
        <h1 className="t-h1 text-balance">{s.ownerName} invited you to Two Homes Preflight</h1>
        <p className="mt-3 text-muted-foreground">
          Hi {s.coParentName.split(" ")[0]}. {s.ownerName} uses this app to check expenses for {joinNames(s.childNames)} against your parenting agreement
          before anyone spends. Below are the expense rules from the agreement, each with its exact quote.
        </p>
      </section>

      <section aria-labelledby="rules-h" className="space-y-3">
        <h2 id="rules-h" className="t-h3">Expense rules</h2>
        {s.rules.length === 0 ? (
          <p className="rounded-[10px] border border-dashed border-border bg-surface p-4 text-muted-foreground">
            {s.ownerName} has not confirmed any rules from the agreement yet. You can accept now and review the rules when they are added.
          </p>
        ) : (
          s.rules.map((r) => (
            <ClauseCard key={r.id} quote={r.quote} page={r.page} title={`${CATEGORY[r.category] ?? r.category}: ${r.label}`}>
              <span className="t-small text-muted-foreground">
                You pay {r.owedPct}% when {s.ownerName} buys
                {r.approval?.required ? (
                  <>
                    , and approval is needed {r.approval.operator === "gte" ? "from" : "above"} <Money cents={r.approval.thresholdCents} />
                  </>
                ) : null}
              </span>
            </ClauseCard>
          ))
        )}
      </section>

      {s.session.active ? <Act s={s} token={token} paypalNotice={search.get("paypal")} onAccepted={() => setAccepted(true)} onChanged={refresh} /> : <Verify s={s} token={token} onVerified={refresh} />}
    </div>
  );
}

function Verify({ s, token, onVerified }: { s: InviteSummary; token: string; onVerified: () => Promise<void> }) {
  const [sent, setSent] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ sentTo: string }>(`/api/links/${token}/otp`, { method: "POST", redirectOn401: false });
      setSent(r.sentTo);
      setCode("");
    } catch (e) {
      setError(errorMessage(e));
    }
    setBusy(false);
  }

  async function verify(value: string) {
    if (value.length !== 6) return setError("Enter the 6-digit code.");
    setBusy(true);
    setError(null);
    try {
      await api(`/api/links/${token}/otp/verify`, { method: "POST", body: { code: value }, redirectOn401: false });
      await onVerified();
    } catch (e) {
      setError(errorMessage(e));
      setCode("");
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="verify-h" className="rounded-[14px] border border-border bg-surface p-5">
      <h2 id="verify-h" className="t-h3">Confirm it is you</h2>
      {!sent ? (
        <>
          <p className="mt-2 text-muted-foreground">To accept, we will email a 6-digit code to {s.sentTo}, the address this invite was sent to.</p>
          <div aria-live="polite" className="mt-3">{error ? <p className="t-small rounded-md bg-danger-bg px-3 py-2 text-danger">{error}</p> : null}</div>
          <Button className="mt-3 h-11 text-[15px]" onClick={() => void send()} disabled={busy}>
            {busy ? "Sending…" : "Email me a code"}
          </Button>
        </>
      ) : (
        <form
          className="mt-2 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void verify(code);
          }}
        >
          <p className="text-muted-foreground">We sent a code to {sent}. It expires in 10 minutes.</p>
          <label htmlFor="otp" className="t-label block">One-time code</label>
          <OtpInput value={code} onChange={setCode} onComplete={(v) => void verify(v)} disabled={busy} invalid={Boolean(error)} />
          <div aria-live="polite">{error ? <p className="t-small rounded-md bg-danger-bg px-3 py-2 text-danger">{error}</p> : null}</div>
          <div className="flex flex-wrap gap-3">
            <Button type="submit" className="h-11 text-[15px]" disabled={busy || code.length !== 6}>
              {busy ? "Checking…" : "Confirm code"}
            </Button>
            <Button type="button" variant="ghost" className="h-11" onClick={() => void send()} disabled={busy}>
              Send a new code
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

function Act({ s, token, paypalNotice, onAccepted, onChanged }: { s: InviteSummary; token: string; paypalNotice: string | null; onAccepted: () => void; onChanged: () => Promise<void> }) {
  const [perRule, setPerRule] = useState<Record<string, "agree" | "disagree">>(() => Object.fromEntries(s.rules.map((r) => [r.id, "agree" as const])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pp = s.paypal;

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/links/${token}/accept`, { method: "POST", body: { perRule }, redirectOn401: false });
      onAccepted();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {s.rules.length > 0 ? (
        <section aria-labelledby="ack-h" className="space-y-3">
          <h2 id="ack-h" className="t-h3">Do you agree with each rule?</h2>
          <p className="t-small text-muted-foreground">If you disagree with a rule, expenses under it are marked for review instead of being checked automatically.</p>
          {s.rules.map((r) => (
            <fieldset key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-border bg-surface px-4 py-2">
              <legend className="sr-only">{r.label}</legend>
              <span>{r.label}</span>
              <div className="flex gap-1">
                {(["agree", "disagree"] as const).map((v) => (
                  <label key={v} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-3 text-sm ${perRule[r.id] === v ? "bg-primary-soft font-medium text-primary" : "text-muted-foreground"}`}>
                    <input type="radio" name={`rule-${r.id}`} value={v} checked={perRule[r.id] === v} onChange={() => setPerRule((p) => ({ ...p, [r.id]: v }))} className="accent-[var(--primary)]" />
                    {v === "agree" ? "Agree" : "Disagree"}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </section>
      ) : null}

      <section aria-labelledby="pp-h" className="space-y-3">
        <h2 id="pp-h" className="t-h3">Where should your reimbursements go? (optional)</h2>
        <p className="t-small text-muted-foreground">
          Connect your PayPal account now, or later the first time {s.ownerName} owes you money. This does not create an account here.
        </p>
        <PayPalConnect
          role="coparent"
          token={token}
          returnTo={`/r/${token}`}
          notice={paypalNotice as "connected" | "cancelled" | "error" | null}
          connection={pp?.connected ? { method: pp.method ?? "email", email: pp.email ?? "", verifiedAccount: pp.verifiedAccount } : null}
          onConnected={() => void onChanged()}
        />
      </section>

      <div aria-live="polite">{error ? <p className="t-small rounded-md bg-danger-bg px-3 py-2 text-danger">{error}</p> : null}</div>
      <Button className="h-12 w-full text-[15px] sm:w-auto sm:px-6" onClick={() => void accept()} disabled={busy}>
        {busy ? "Accepting…" : "Accept the invitation"}
      </Button>
      <p className="t-small text-muted-foreground">Your code session lasts 30 minutes. After that, ask for a new code.</p>
    </div>
  );
}

function Accepted() {
  return (
    <div className="space-y-3 py-8">
      <CheckCircle2 aria-hidden className="size-10 text-eligible" />
      <h1 className="t-h1">You are connected</h1>
      <p className="text-muted-foreground">
        When an expense needs your approval or your share, you will get an email with a link. Each action asks for a fresh code. You can
        close this page.
      </p>
    </div>
  );
}

function Gone({ reason }: { reason: string }) {
  const text =
    reason === "used"
      ? "This invitation was already accepted. Nothing else to do here."
      : reason === "revoked"
        ? "This invitation was replaced by a newer link. Use the most recent email, or ask for a new one."
        : "This invitation has expired. Ask the parent who invited you to send a new one.";
  return <Message icon={reason === "used" ? <CheckCircle2 className="size-10 text-eligible" aria-hidden /> : <Clock3 className="size-10 text-muted-foreground" aria-hidden />} title="This link no longer works" body={text} />;
}

function Message({ title, body, action, icon }: { title: string; body: string; action?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="space-y-3 py-8">
      {icon ?? <LinkIcon aria-hidden className="size-10 text-muted-foreground" />}
      <h1 className="t-h1">{title}</h1>
      <p className="text-muted-foreground">{body}</p>
      {action}
    </div>
  );
}

function joinNames(names: string[]): string {
  if (names.length === 0) return "your children";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
