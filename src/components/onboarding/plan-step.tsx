"use client";

import { Check } from "lucide-react";
import { FormError, StepHeader, StickyAction, useCompleteStep, type StepProps } from "./shared";

// Free is a real, complete choice. The Family plan (PayPal Subscriptions) is wired in Phase 4.
export function PlanStep({ me }: StepProps) {
  const free = me.family?.plan.tier === "free";
  const { complete, busy, error } = useCompleteStep("plan");
  return (
    <div className="space-y-6">
      <StepHeader title="Choose a plan">You can change plans later in Billing. The other parent never pays for the app.</StepHeader>
      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-[14px] border-2 border-primary bg-surface p-5" aria-labelledby="free-h" aria-current={free ? "true" : undefined}>
          <h2 id="free-h" className="t-h3">Free</h2>
          <p className="mt-2"><span className="t-amount">$0</span></p>
          <ul className="t-small mt-4 space-y-2 text-muted-foreground">
            {["Preflight checks with the clause cited", "Approval links with an email code", "Receipts, claims and overdue tracking", "Settlement recorded when paid outside the app"].map((i) => (
              <li key={i} className="flex gap-2"><Check aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />{i}</li>
            ))}
          </ul>
        </section>
        <section className="rounded-[14px] border border-border bg-surface-2 p-5 text-muted-foreground" aria-labelledby="family-h">
          <h2 id="family-h" className="t-h3 text-foreground">Family</h2>
          <p className="mt-2"><span className="t-amount">$7.99</span> a month</p>
          <p className="t-small mt-4">In-app PayPal settlement, covered fees and automatic reminders. Coming in this build; you can upgrade from Billing once it is ready.</p>
          <p className="t-small mt-2">Illustrative sandbox pricing.</p>
        </section>
      </div>
      <FormError error={error} />
      <StickyAction onClick={() => void complete({ plan: "free" })} disabled={busy}>
        {busy ? "Finishing…" : "Continue with Free"}
      </StickyAction>
    </div>
  );
}
