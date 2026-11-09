import { Suspense } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { Skeleton } from "@/components/ui/skeleton";
import { currentPathname, requireOnboarded } from "@/lib/data/me";

export default function AppLayout({ children }: LayoutProps<"/app">) {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <Gate>{children}</Gate>
    </Suspense>
  );
}

// AU-8: /app is reachable only after onboarding is done; otherwise resume at the saved step.
async function Gate({ children }: { children: React.ReactNode }) {
  const me = await requireOnboarded(await currentPathname("/app"));
  const kids = me.family.children.map((c) => c.firstName).join(", ");
  return (
    <AppShell userName={me.displayName} familyLabel={kids ? `Family of ${kids}` : "Your family"}>
      {children}
    </AppShell>
  );
}

function ShellSkeleton() {
  return (
    <div className="lg:grid lg:grid-cols-[248px_1fr]" aria-busy>
      <div className="hidden h-dvh border-r border-border bg-surface lg:block" />
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    </div>
  );
}
