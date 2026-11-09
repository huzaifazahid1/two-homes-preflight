"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { PayPalConnect, type ConnectionView } from "@/components/domain/paypal-connect";
import { FormError, StepHeader, StickyAction, useCompleteStep, type StepProps } from "./shared";

export function PayPalStep({ me }: StepProps) {
  const params = useSearchParams();
  const notice = params.get("paypal") as "connected" | "cancelled" | "error" | null;
  const initial = me.family?.payout.owner;
  const [conn, setConn] = useState<ConnectionView>(initial ? { method: initial.method, email: initial.email, verifiedAccount: initial.verifiedAccount } : null);
  const { complete, busy, error } = useCompleteStep("paypal");
  return (
    <div className="space-y-6">
      <StepHeader title="Connect your PayPal account">
        When the other parent pays their share, it is paid out to this PayPal account. You connect once and it is reused for every
        payout. This does not sign you in to anything.
      </StepHeader>
      <PayPalConnect role="owner" returnTo="/onboarding/paypal" connection={conn} onConnected={setConn} notice={notice} />
      <FormError error={error} />
      {conn ? (
        <StickyAction onClick={() => void complete()} disabled={busy}>
          {busy ? "Saving…" : "Continue"}
        </StickyAction>
      ) : null}
    </div>
  );
}
