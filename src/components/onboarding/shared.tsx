"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/hooks/api";
import type { OnboardingStep } from "@/types/firestore";
import type { MeView } from "@/types/views";

export type StepProps = { me: MeView };

/** Completes the current step on the server (which checks prerequisites) and moves to the next. */
export function useCompleteStep(step: Exclude<OnboardingStep, "done">) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function complete(extra: Record<string, unknown> = {}, opts: { then?: string } = {}) {
    setBusy(true);
    setError(null);
    try {
      const { me } = await api<{ me: MeView }>("/api/me", { method: "PATCH", body: { completeStep: step, ...extra } });
      router.push(me.onboardingStep === "done" ? (opts.then ?? "/app") : `/onboarding/${me.onboardingStep}`);
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }
  return { complete, busy, error, setError };
}

export function StepHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div>
      <h1 className="t-h1">{title}</h1>
      {children ? <p className="mt-2 max-w-prose text-muted-foreground">{children}</p> : null}
    </div>
  );
}

export function FormError({ error }: { error: string | null }) {
  return <div aria-live="polite">{error ? <p className="t-small rounded-md bg-danger-bg px-3 py-2 text-danger">{error}</p> : null}</div>;
}

/** Sticky primary action on phones, inline on desktop (P.9). */
export function StickyAction({ children, ...props }: React.ComponentProps<typeof Button>) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 backdrop-blur sm:static sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
      <Button className="h-12 w-full text-[15px] sm:h-11 sm:w-auto sm:px-6" {...props}>
        {children}
      </Button>
    </div>
  );
}
