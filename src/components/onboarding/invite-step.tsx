"use client";

import { useState } from "react";
import { InvitePanel } from "./invite-panel";
import { FormError, StepHeader, StickyAction, useCompleteStep, type StepProps } from "./shared";

export function InviteStep({ me }: StepProps) {
  const family = me.family!;
  const [sent, setSent] = useState(family.coParent.inviteStatus !== "not_sent");
  const { complete, busy, error } = useCompleteStep("invite");
  return (
    <div className="space-y-6">
      <StepHeader title={`Invite ${family.coParent.name}`}>
        They get an email from Two Homes Preflight with a link to review the expense rules. Replies go to you. You can continue as soon
        as the invite is sent; they can accept later.
      </StepHeader>
      <InvitePanel family={family} onSent={() => setSent(true)} />
      <FormError error={error} />
      {sent ? (
        <StickyAction onClick={() => void complete()} disabled={busy}>
          {busy ? "Saving…" : "Continue"}
        </StickyAction>
      ) : null}
    </div>
  );
}
