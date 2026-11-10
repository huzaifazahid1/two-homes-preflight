"use client";

import { PayPalButtons, PayPalScriptProvider } from "@paypal/react-paypal-js";
import { AlertTriangle, Check, CheckCircle2, CircleSlash, Clock, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { ConfirmSheet } from "@/components/domain/confirm-sheet";
import { Money } from "@/components/domain/money";
import { StatusBadge } from "@/components/domain/status-badge";
import type { Tone } from "@/components/domain/status-meta";
import { SuccessCheck } from "@/components/domain/success-check";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiError, errorMessage } from "@/hooks/api";
import { formatCents } from "@/lib/money";
import { FAMILY_PRICE_CENTS, FAMILY_TRIAL_DAYS } from "@/lib/plans";
import { publicEnv } from "@/lib/public-env";
import type { BillingView } from "@/types/views";

// /app/billing (Section G.6): subscribe with PayPal (vault + intent=subscription), status,
// covered-volume bar, cancel. The server verifies every subscription with PayPal (SB-1, SB-2).

const STATUS: Record<NonNullable<BillingView["subscription"]>["status"], { label: string; tone: Tone; icon: LucideIcon }> = {
  ACTIVE: { label: "Active", tone: "eligible", icon: CheckCircle2 },
  APPROVAL_PENDING: { label: "Waiting for PayPal", tone: "review", icon: Clock },
  SUSPENDED: { label: "Paused by PayPal", tone: "danger", icon: AlertTriangle },
  CANCELLED: { label: "Cancelled", tone: "neutral", icon: CircleSlash },
  EXPIRED: { label: "Expired", tone: "neutral", icon: CircleSlash },
};

export function BillingPanel({ initial, familyId, timeZone }: { initial: BillingView; familyId: string; timeZone: string | null }) {
  const [b, setB] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [justJoined, setJustJoined] = useState(false);
  const day = (iso: string) => new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: timeZone ?? undefined }).format(new Date(iso));
  const sub = b.subscription;
  const canSubscribe = !b.entitled && b.planConfigured && (!sub || sub.status === "CANCELLED" || sub.status === "EXPIRED" || sub.status === "APPROVAL_PENDING");
  const used = Math.min(b.coveredVolume.usedCents, b.coveredVolume.limitCents);
  const pct = b.coveredVolume.limitCents > 0 ? Math.round((used / b.coveredVolume.limitCents) * 100) : 0;

  return (
    <div className="space-y-6">
      <section aria-labelledby="plan-h" className="space-y-4 rounded-[14px] border border-border bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="t-label text-muted-foreground">Your plan</p>
            <h2 id="plan-h" className="t-h2">{b.entitled ? "Family" : "Free"}</h2>
          </div>
          {sub ? <StatusBadge tone={STATUS[sub.status].tone} icon={STATUS[sub.status].icon} label={STATUS[sub.status].label} /> : null}
        </div>
        <div aria-live="polite">
          {justJoined ? <SuccessCheck label="Family plan active" /> : null}
          {sub?.status === "SUSPENDED" ? (
            <p className="flex gap-2 rounded-md bg-danger-bg px-3 py-2 text-danger">
              <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" /> PayPal paused the plan after a failed payment. Paying in the app and automatic reminders are off until it is active again. Claims already paid still go out.
            </p>
          ) : null}
        </div>
        {b.entitled ? (
          <dl className="grid gap-3 text-[15px] sm:grid-cols-2">
            {sub?.status === "ACTIVE" && sub.trialEndsAt ? <Row label="Free trial ends" value={day(sub.trialEndsAt)} /> : null}
            {sub?.status === "ACTIVE" && sub.nextBillingTime ? <Row label="Next payment" value={`${day(sub.nextBillingTime)}, ${formatCents(FAMILY_PRICE_CENTS)}`} /> : null}
            {sub?.status === "CANCELLED" && sub.paidThrough ? <Row label="Family features until" value={day(sub.paidThrough)} /> : null}
          </dl>
        ) : (
          <p className="text-muted-foreground">Agreement checks, approvals, receipts and claims. Settlement is paid outside the app and recorded here.</p>
        )}
        {b.entitled ? (
          <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="font-medium">Fees covered this month</span>
              <span className="text-muted-foreground">
                <Money cents={used} /> of <Money cents={b.coveredVolume.limitCents} />
              </span>
            </div>
            <div role="progressbar" aria-label="Covered volume used this month" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-2 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-primary transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${pct}%` }} />
            </div>
            <p className="t-small text-muted-foreground">Above this, the paying parent sees a small processing fee before they pay. The parent who is owed always receives the full share.</p>
          </div>
        ) : null}
        {sub?.status === "ACTIVE" ? (
          <ConfirmSheet
            trigger={<Button variant="ghost" className="h-11 px-3 text-muted-foreground">Cancel the Family plan</Button>}
            title="Cancel the Family plan?"
            description={sub.nextBillingTime ? `You keep Family features until ${day(sub.nextBillingTime)}. Claims already paid still reach the other parent.` : "Claims already paid still reach the other parent."}
            confirmLabel="Cancel the plan"
            pendingLabel="Cancelling…"
            cancelLabel="Keep it"
            destructive
            onConfirm={async () => {
              setError(null);
              try {
                const r = await api<{ billing: BillingView }>("/api/billing/cancel", { method: "POST", body: {} });
                setB(r.billing);
                return true;
              } catch (e) {
                setError(withId(e));
                return false;
              }
            }}
          />
        ) : null}
        <div aria-live="polite">{error ? <p className="t-small rounded-md bg-danger-bg px-3 py-2 text-danger">{error}</p> : null}</div>
      </section>

      {canSubscribe ? (
        <section aria-labelledby="upgrade-h" className="space-y-4 rounded-[14px] border border-primary/30 bg-surface p-5">
          <div>
            <h2 id="upgrade-h" className="t-h3">Family plan</h2>
            <p className="mt-1 text-muted-foreground">
              <Money cents={FAMILY_PRICE_CENTS} /> a month after a {FAMILY_TRIAL_DAYS}-day free trial. Illustrative sandbox pricing; no real money moves.
            </p>
          </div>
          <ul className="space-y-1.5 text-[15px]">
            {["Pay and get paid in the app through PayPal", `Fees covered up to ${formatDollars(b.coveredVolume.limitCents)} of claims a month`, "Automatic reminders before and after the due date", "Unlimited AI receipt reads and agreement amendments"].map((t) => (
              <li key={t} className="flex gap-2">
                <Check aria-hidden className="mt-1 size-4 shrink-0 text-primary" /> {t}
              </li>
            ))}
          </ul>
          <PayPalScriptProvider options={{ clientId: publicEnv().NEXT_PUBLIC_PAYPAL_CLIENT_ID, vault: true, intent: "subscription", components: "buttons" }}>
            <div className="relative min-h-[110px] max-w-md">
              <Skeleton className="absolute inset-x-0 top-0 h-12" aria-hidden />
              <div className="relative">
                <PayPalButtons
                  style={{ layout: "vertical", shape: "rect", label: "subscribe", height: 48 }}
                  createSubscription={(_data, actions) => actions.subscription.create({ plan_id: b.planId!, custom_id: familyId })}
                  onApprove={async (data) => {
                    setError(null);
                    try {
                      const r = await api<{ billing: BillingView }>("/api/billing/subscription", { method: "POST", body: { subscriptionId: data.subscriptionID } });
                      setB(r.billing);
                      setJustJoined(r.billing.entitled);
                    } catch (e) {
                      setError(withId(e));
                    }
                  }}
                  onCancel={() => setError("Subscription cancelled in PayPal. Nothing was charged.")}
                  onError={() => setError("PayPal could not start the subscription. Nothing was charged. Please try again.")}
                />
              </div>
            </div>
          </PayPalScriptProvider>
        </section>
      ) : !b.planConfigured && !b.entitled ? (
        <p className="t-small rounded-md border border-border bg-surface-2 px-3 py-2 text-muted-foreground">The Family plan is not set up on this server yet (run scripts/setup-paypal-plans.ts and set PAYPAL_FAMILY_PLAN_ID).</p>
      ) : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="t-label text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function formatDollars(cents: number) {
  return `$${Math.round(cents / 100)}`;
}

function withId(e: unknown) {
  return `${errorMessage(e)}${e instanceof ApiError && e.requestId ? ` (reference ${e.requestId})` : ""}`;
}
