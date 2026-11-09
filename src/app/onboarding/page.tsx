import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { requireMe } from "@/lib/data/me";

export default function OnboardingIndex() {
  return (
    <Suspense fallback={<Skeleton className="mt-6 h-64 w-full" />}>
      <Resume />
    </Suspense>
  );
}

// AU-8 / ON-3: always resume at the saved step.
async function Resume() {
  const me = await requireMe("/onboarding");
  if (!me.emailVerified) redirect("/verify-email");
  redirect(me.onboardingStep === "done" ? "/app" : `/onboarding/${me.onboardingStep}`);
  return null;
}
