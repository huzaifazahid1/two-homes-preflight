import type { OnboardingStep } from "@/types/firestore";

export const WIZARD_STEPS: { id: Exclude<OnboardingStep, "done">; label: string }[] = [
  { id: "profile", label: "Profile" },
  { id: "agreement", label: "Agreement" },
  { id: "family", label: "Family" },
  { id: "invite", label: "Invite" },
  { id: "paypal", label: "PayPal" },
  { id: "plan", label: "Plan" },
];

export function isWizardStep(s: string): s is Exclude<OnboardingStep, "done"> {
  return WIZARD_STEPS.some((w) => w.id === s);
}

export function wizardIndex(s: OnboardingStep): number {
  return s === "done" ? WIZARD_STEPS.length : WIZARD_STEPS.findIndex((w) => w.id === s);
}
