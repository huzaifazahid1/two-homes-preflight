import type { Metadata } from "next";
import { Suspense } from "react";
import { BillingPanel } from "@/components/billing/billing-panel";
import { Skeleton } from "@/components/ui/skeleton";
import { actorOf } from "@/lib/auth/session";
import { getBilling } from "@/lib/billing";
import { familyContext } from "@/lib/data/family";
import { requireOnboarded } from "@/lib/data/me";
import { newRequestId } from "@/lib/ids";

export const metadata: Metadata = { title: "Billing" };

// Billing (Section G.6). The owner manages the plan; the other parent never pays for the app.
export default function BillingPage() {
  return (
    <Suspense fallback={<Skeleton className="h-72 w-full rounded-[14px]" />}>
      <BillingView />
    </Suspense>
  );
}

async function BillingView() {
  await requireOnboarded("/app/billing");
  const ctx = await familyContext("/app/billing");
  const owner = actorOf(ctx).kind === "owner";
  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="t-h1">Billing</h1>
        <p className="mt-1 text-muted-foreground">{owner ? "Your plan and what it covers this month." : `${ctx.family.owner.name.split(" ")[0]} manages the plan. You never pay for the app.`}</p>
      </div>
      {owner ? <BillingPanel initial={await getBilling(ctx, { requestId: newRequestId() })} familyId={ctx.familyId} timeZone={ctx.userDoc.timeZone || null} /> : null}
    </div>
  );
}
