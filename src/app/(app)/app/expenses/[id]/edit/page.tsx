import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { ExpenseForm } from "@/components/expenses/expense-form";
import { PageHeader } from "@/components/layout/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { todayIn } from "@/lib/ai/quick-add";
import { now } from "@/lib/clock";
import { familyContext, getExpense } from "@/lib/data/family";
import { requireOnboarded } from "@/lib/data/me";
import { isAppError } from "@/lib/errors";

export const metadata: Metadata = { title: "Edit expense" };

export default function EditExpensePage({ params }: PageProps<"/app/expenses/[id]/edit">) {
  return (
    <Suspense fallback={<Skeleton className="h-[480px] w-full rounded-[14px]" />}>
      <Edit params={params} />
    </Suspense>
  );
}

async function Edit({ params }: { params: PageProps<"/app/expenses/[id]/edit">["params"] }) {
  const { id } = await params;
  await requireOnboarded(`/app/expenses/${id}/edit`);
  const ctx = await familyContext(`/app/expenses/${id}/edit`);
  let detail;
  try {
    detail = await getExpense(ctx, id);
  } catch (err) {
    if (isAppError(err) && (err.code === "NOT_FOUND" || err.code === "FORBIDDEN")) notFound();
    throw err;
  }
  const e = detail.expense;
  if (e.settlement.state !== "NONE" || e.approval.state === "REQUESTED") redirect(`/app/expenses/${id}`);
  const f = ctx.family;
  return (
    <div className="space-y-6">
      <PageHeader title="Edit expense" description="The check runs again with the same agreement rules this expense started with." />
      <ExpenseForm
        expense={e}
        childrenList={f.children}
        viewerRole={f.ownerUid === ctx.user.uid ? "owner" : "coparent"}
        ownerName={f.owner.name}
        coParentName={f.coParent.name || "The other parent"}
        agreementId={detail.agreementId}
        today={todayIn(ctx.userDoc.timeZone, now())}
      />
    </div>
  );
}
