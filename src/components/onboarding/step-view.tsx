"use client";

import type { OnboardingStep } from "@/types/firestore";
import type { AgreementOverview, MeView } from "@/types/views";
import { AgreementStep } from "./agreement-step";
import { FamilyStep } from "./family-step";
import { InviteStep } from "./invite-step";
import { PayPalStep } from "./paypal-step";
import { PlanStep } from "./plan-step";
import { ProfileStep } from "./profile-step";

export function StepView({ step, me, agreement }: { step: Exclude<OnboardingStep, "done">; me: MeView; agreement: AgreementOverview | null }) {
  switch (step) {
    case "profile":
      return <ProfileStep me={me} />;
    case "agreement":
      return <AgreementStep me={me} agreement={agreement} />;
    case "family":
      return <FamilyStep me={me} parties={agreement?.active?.extractedParties ?? null} />;
    case "invite":
      return <InviteStep me={me} />;
    case "paypal":
      return <PayPalStep me={me} />;
    case "plan":
      return <PlanStep me={me} />;
  }
}
