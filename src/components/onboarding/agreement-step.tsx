"use client";

import { CheckCircle2 } from "lucide-react";
import { useState } from "react";
import { AgreementFlow } from "@/components/agreement/agreement-flow";
import type { AgreementOverview, RuleVersionView } from "@/types/views";
import { FormError, StepHeader, StickyAction, useCompleteStep, type StepProps } from "./shared";

// Onboarding step 2 (A.5.1): upload, extraction, review every rule, activate. Mandatory.
export function AgreementStep({ agreement }: StepProps & { agreement: AgreementOverview | null }) {
  const { complete, busy, error } = useCompleteStep("agreement");
  const [active, setActive] = useState<RuleVersionView | null>(agreement?.active ?? null);
  const kept = active?.rules.filter((r) => r.reviewState === "CONFIRMED" || r.reviewState === "EDITED").length ?? 0;
  return (
    <div className="space-y-6">
      <StepHeader title="Your parenting agreement">
        Every expense will be checked against the rules in it. We read each rule with its exact quote and page; you confirm every one before it is used.
      </StepHeader>
      {active ? (
        <>
          <div className="flex gap-3 rounded-[14px] border border-eligible/30 bg-eligible-bg p-5 text-eligible">
            <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0" />
            <div>
              <p className="font-medium">{kept} rule{kept === 1 ? "" : "s"} confirmed</p>
              <p className="t-small mt-0.5">Next, the names in the agreement help fill in your family.</p>
            </div>
          </div>
          <FormError error={error} />
          <StickyAction onClick={() => void complete()} disabled={busy}>
            {busy ? "Saving…" : "Continue"}
          </StickyAction>
        </>
      ) : (
        <AgreementFlow draft={agreement?.draft ?? null} pendingAgreementId={agreement?.pending?.id ?? null} onActivated={setActive} activateLabel="Confirm rules" />
      )}
    </div>
  );
}
