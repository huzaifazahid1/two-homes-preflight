"use client";

import { FileText } from "lucide-react";
import { FormError, StepHeader, StickyAction, useCompleteStep, type StepProps } from "./shared";

// Agreement upload and rule review are wired in Phase 2. Until then this step can be passed
// only outside production (or in DEMO_MODE), and it says so plainly.
export function AgreementStep({ me }: StepProps) {
  const { complete, busy, error } = useCompleteStep("agreement");
  const done = Boolean(me.family?.activeRuleVersionId);
  return (
    <div className="space-y-6">
      <StepHeader title="Your parenting agreement">
        Upload the agreement so every expense can be checked against its rules, with the exact quote and page.
      </StepHeader>
      <div className="flex gap-4 rounded-[10px] border border-dashed border-border bg-surface p-5">
        <FileText aria-hidden className="mt-0.5 size-6 shrink-0 text-muted-foreground" />
        <div>
          <p className="font-medium">Agreement upload is coming in this build</p>
          <p className="t-small mt-1 text-muted-foreground">
            Extraction, quote checking and rule review arrive in the next phase. {me.placeholderSteps ? "For now you can continue without an agreement." : "This step cannot be completed yet."}
          </p>
        </div>
      </div>
      <FormError error={error} />
      {me.placeholderSteps || done ? (
        <StickyAction onClick={() => void complete()} disabled={busy}>
          {busy ? "Saving…" : "Continue"}
        </StickyAction>
      ) : null}
    </div>
  );
}
