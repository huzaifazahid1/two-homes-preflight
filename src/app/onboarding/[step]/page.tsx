import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { StepView } from "@/components/onboarding/step-view";
import { isWizardStep, wizardIndex } from "@/components/onboarding/steps";
import { Stepper } from "@/components/onboarding/stepper";
import { Skeleton } from "@/components/ui/skeleton";
import { requireMe } from "@/lib/data/me";

export default function OnboardingStepPage({ params }: PageProps<"/onboarding/[step]">) {
  return (
    <Suspense fallback={<StepSkeleton />}>
      <Step params={params} />
    </Suspense>
  );
}

async function Step({ params }: { params: PageProps<"/onboarding/[step]">["params"] }) {
  const { step } = await params;
  if (!isWizardStep(step)) notFound();
  const me = await requireMe(`/onboarding/${step}`);
  if (!me.emailVerified) redirect("/verify-email");
  if (me.onboardingStep === "done") redirect("/app");
  // ON-2: steps after the saved one are not reachable by URL.
  if (wizardIndex(step) > wizardIndex(me.onboardingStep)) redirect(`/onboarding/${me.onboardingStep}`);
  return (
    <div className="space-y-8">
      <Stepper current={step} saved={me.onboardingStep} />
      <StepView step={step} me={me} />
    </div>
  );
}

function StepSkeleton() {
  return (
    <div className="space-y-8" aria-busy>
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-9 w-2/3" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}
