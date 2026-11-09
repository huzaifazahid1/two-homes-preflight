"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormError, StepHeader, StickyAction, useCompleteStep, type StepProps } from "./shared";

export function ProfileStep({ me }: StepProps) {
  const [name, setName] = useState(me.displayName);
  const { complete, busy, error, setError } = useCompleteStep("profile");

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return setError("Enter your name.");
        void complete({ displayName: name.trim() });
      }}
    >
      <StepHeader title="Your profile">This is how the other parent will see you in emails and on approval links.</StepHeader>
      <div className="max-w-md space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="profile-name">Your name</Label>
          <Input id="profile-name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className="h-11" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="profile-email">Email</Label>
          <Input id="profile-email" value={me.email} readOnly disabled className="h-11" aria-describedby="email-note" />
          <p id="email-note" className="t-small text-eligible">
            Verified
          </p>
        </div>
      </div>
      <FormError error={error} />
      <StickyAction type="submit" disabled={busy}>
        {busy ? "Saving…" : "Save and continue"}
      </StickyAction>
    </form>
  );
}
