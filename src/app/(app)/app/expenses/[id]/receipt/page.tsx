import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Money } from "@/components/domain/money";
import { ReceiptFlow } from "@/components/expenses/receipt-flow";
import { Skeleton } from "@/components/ui/skeleton";
import { familyContext, getExpense } from "@/lib/data/family";
import { requireOnboarded } from "@/lib/data/me";
import { isAppError } from "@/lib/errors";

export const metadata: Metadata = { title: "Receipt" };

// Receipt upload, AI reading, confirmation and match (Section I.2). Full-screen single column on phones.
export default function ReceiptPage({ params }: PageProps<"/app/expenses/[id]/receipt">) {
  return (
    <Suspense fallback={<Skeleton className="h-80 w-full rounded-[14px]" />}>
      <Receipt params={params} />
    </Suspense>
  );
}

async function Receipt({ params }: { params: PageProps<"/app/expenses/[id]/receipt">["params"] }) {
  const { id } = await params;
  await requireOnboarded(`/app/expenses/${id}/receipt`);
  const ctx = await familyContext(`/app/expenses/${id}/receipt`);
  let detail;
  try {
    detail = await getExpense(ctx, id);
  } catch (err) {
    if (isAppError(err) && (err.code === "NOT_FOUND" || err.code === "FORBIDDEN")) notFound();
    throw err;
  }
  const e = detail.expense;
  const other = (e.owedByRole === "owner" ? ctx.family.owner.name : ctx.family.coParent.name).split(" ")[0] || "the other parent";
  return (
    <div className="mx-auto max-w-xl space-y-6">
      <Link href={`/app/expenses/${id}`} className="t-small -ml-1 inline-flex min-h-11 items-center gap-1 px-1 text-muted-foreground hover:text-foreground">
        <ArrowLeft aria-hidden className="size-4" /> {e.description}
      </Link>
      <div>
        <h1 className="t-h1">Receipt</h1>
        <p className="mt-1 text-muted-foreground">
          {e.description} for {e.childName}, <Money cents={e.amountCents} />
          {e.vendor ? ` at ${e.vendor}` : ""}
        </p>
      </div>
      <ReceiptFlow expense={e} receipt={detail.receipt} other={other} />
    </div>
  );
}
