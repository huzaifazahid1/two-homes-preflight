"use client";

import type { OnboardingStep } from "@/types/firestore";
import type { MeView } from "@/types/views";
import { AgreementStep } from "./agreement-step";
import { FamilyStep } from "./family-step";
import { InviteStep } from "./invite-step";
import { PayPalStep } from "./paypal-step";
import { PlanStep } from "./plan-step";
import { ProfileStep } from "./profile-step";

export function StepView({ step, me }: { step: Exclude<OnboardingStep, "done">; me: MeView }) {
  switch (step) {
    case "profile":
      return <ProfileStep me={me} />;
    case "agreement":
      return <AgreementStep me={me} />;
    case "family":
      return <FamilyStep me={me} />;
    case "invite":
      return <InviteStep me={me} />;
    case "paypal":
      return <PayPalStep me={me} />;
    case "plan":
      return <PlanStep me={me} />;
  }
}
