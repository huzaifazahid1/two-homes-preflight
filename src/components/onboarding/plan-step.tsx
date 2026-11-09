"use client";

import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FAMILY_PRICE_CENTS, FAMILY_TRIAL_DAYS } from "@/lib/plans";
import { FormError, StepHeader, StickyAction, useCompleteStep, type StepProps } from "./shared";

// Last onboarding step (A.5.1). Free is a complete choice. Family finishes onboarding and opens
// Billing, where the PayPal subscription is approved and verified by the server (Section G.6).
export function PlanStep({ me }: StepProps) {
  const free = me.family?.plan.tier !== "family";
  const { complete, busy, error } = useCompleteStep("plan");
  const price = `$${(FAMILY_PRICE_CENTS / 100).toFixed(2)}`;
  return (
    <div className="space-y-6">
      <StepHeader title="Choose a plan">You can change plans later in Billing. The other parent never pays for the app.</StepHeader>
      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-[14px] border border-border bg-surface p-5" aria-labelledby="free-h" aria-current={free ? "true" : undefined}>
          <h2 id="free-h" className="t-h3">Free</h2>
          <p className="mt-2"><span className="t-amount">$0</span></p>
          <ul className="t-small mt-4 space-y-2 text-muted-foreground">
            {["Preflight checks with the clause cited", "Approval links with an email code", "Receipts, claims and overdue tracking", "Settlement recorded when paid outside the app"].map((i) => (
              <li key={i} className="flex gap-2"><Check aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />{i}</li>
            ))}
          </ul>
        </section>
        <section className="rounded-[14px] border-2 border-primary bg-surface p-5" aria-labelledby="family-h">
          <h2 id="family-h" className="t-h3">Family</h2>
          <p className="mt-2"><span className="t-amount">{price}</span> a month after a {FAMILY_TRIAL_DAYS}-day free trial</p>
          <ul className="t-small mt-4 space-y-2 text-muted-foreground">
            {["Everything in Free", "Pay and get paid in the app through PayPal", "Processing fees covered up to a monthly volume", "Automatic reminders, unlimited AI receipt reads"].map((i) => (
              <li key={i} className="flex gap-2"><Check aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />{i}</li>
            ))}
          </ul>
          <Button className="mt-5 h-11 w-full" disabled={busy} onClick={() => void complete({ plan: "family" }, { then: "/app/billing" })}>
            {busy ? "Finishing…" : "Start the Family plan"}
          </Button>
          <p className="t-small mt-2 text-muted-foreground">Illustrative sandbox pricing. You approve it in PayPal on the next screen.</p>
        </section>
      </div>
      <FormError error={error} />
      <StickyAction onClick={() => void complete({ plan: "free" })} disabled={busy}>
        {busy ? "Finishing…" : "Continue with Free"}
      </StickyAction>
    </div>
  );
}
