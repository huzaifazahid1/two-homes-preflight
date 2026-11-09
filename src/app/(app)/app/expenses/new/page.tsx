import type { Metadata } from "next";
import { Suspense } from "react";
import { ExpenseForm } from "@/components/expenses/expense-form";
import { PageHeader } from "@/components/layout/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { todayIn } from "@/lib/ai/quick-add";
import { now } from "@/lib/clock";
import { agreementOverview, familyContext } from "@/lib/data/family";
import { requireOnboarded } from "@/lib/data/me";

export const metadata: Metadata = { title: "New expense" };

export default function NewExpensePage() {
  return (
    <Suspense fallback={<FormSkeleton />}>
      <NewExpense />
    </Suspense>
  );
}

async function NewExpense() {
  await requireOnboarded("/app/expenses/new");
  const ctx = await familyContext("/app/expenses/new");
  const overview = await agreementOverview(ctx);
  const f = ctx.family;
  return (
    <div className="space-y-6">
      <PageHeader title="New expense" description="Check it against the agreement before anyone spends." />
      <ExpenseForm
        childrenList={f.children}
        viewerRole={f.ownerUid === ctx.user.uid ? "owner" : "coparent"}
        ownerName={f.owner.name}
        coParentName={f.coParent.name || "The other parent"}
        agreementId={overview.active?.agreementId ?? null}
        today={todayIn(ctx.userDoc.timeZone, now())}
      />
    </div>
  );
}

function FormSkeleton() {
  return (
    <div className="space-y-6" aria-busy>
      <Skeleton className="h-9 w-52" />
      <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
        <Skeleton className="h-[420px] rounded-[14px]" />
        <Skeleton className="h-64 rounded-[14px]" />
      </div>
    </div>
  );
}
