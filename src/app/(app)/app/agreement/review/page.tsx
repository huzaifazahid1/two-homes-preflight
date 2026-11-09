import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AgreementSetup } from "@/components/agreement/active-rules";
import { PageHeader } from "@/components/layout/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { agreementOverview, familyContext } from "@/lib/data/family";
import { requireOnboarded } from "@/lib/data/me";

export const metadata: Metadata = { title: "Review rules" };

export default function ReviewPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full rounded-[14px]" />}>
      <Review />
    </Suspense>
  );
}

async function Review() {
  await requireOnboarded("/app/agreement/review");
  const ctx = await familyContext("/app/agreement/review");
  if (ctx.family.ownerUid !== ctx.user.uid) redirect("/app/agreement");
  const o = await agreementOverview(ctx);
  if (!o.draft) redirect("/app/agreement");
  return (
    <div className="space-y-6">
      <PageHeader title="Review the rules" description={`From ${o.draftAgreement?.fileName ?? "your agreement"}. Open any page to see the quote in place.`} />
      <AgreementSetup draft={o.draft} pendingAgreementId={null} />
    </div>
  );
}
