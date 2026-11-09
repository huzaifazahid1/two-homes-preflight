import { Check } from "lucide-react";
import Link from "next/link";
import { cn } from "cn";
import type { OnboardingStep } from "@/types/firestore";
import { WIZARD_STEPS, wizardIndex } from "./steps";

// Step indicator. Completed steps link back for editing; later steps are not reachable (ON-2).
export function Stepper({ current, saved }: { current: OnboardingStep; saved: OnboardingStep }) {
  const savedIdx = wizardIndex(saved);
  const currentIdx = wizardIndex(current);
  return (
    <nav aria-label="Setup steps">
      <p className="t-small text-muted-foreground sm:hidden">
        Step {currentIdx + 1} of {WIZARD_STEPS.length}: {WIZARD_STEPS[currentIdx]?.label}
      </p>
      <ol className="mt-2 flex gap-1.5 sm:mt-0 sm:gap-2">
        {WIZARD_STEPS.map((s, i) => {
          const done = i < savedIdx;
          const isCurrent = i === currentIdx;
          const content = (
            <>
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full border font-mono text-xs tabular-nums",
                  done && "border-primary bg-primary text-primary-foreground",
                  isCurrent && !done && "border-primary text-primary",
                  !done && !isCurrent && "border-border text-muted-foreground",
                )}
              >
                {done ? <Check aria-hidden className="size-3.5" /> : i + 1}
              </span>
              <span className={cn("hidden text-sm sm:inline", isCurrent ? "font-medium" : "text-muted-foreground")}>{s.label}</span>
            </>
          );
          return (
            <li key={s.id} className="flex flex-1 flex-col gap-1.5 sm:flex-none">
              <span aria-hidden className={cn("h-1 rounded-full sm:hidden", i <= Math.max(currentIdx, savedIdx - 1) ? "bg-primary" : "bg-border")} />
              {done ? (
                <Link href={`/onboarding/${s.id}`} aria-label={`${s.label}, done. Edit`} className="hidden min-h-11 items-center gap-2 rounded-md pr-2 sm:flex">
                  {content}
                </Link>
              ) : (
                <span aria-current={isCurrent ? "step" : undefined} className="hidden min-h-11 items-center gap-2 pr-2 sm:flex">
                  {content}
                  <span className="sr-only">{isCurrent ? "(current step)" : "(not started)"}</span>
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
