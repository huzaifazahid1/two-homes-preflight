import type { Metadata } from "next";
import { FileCheck2, Sparkle } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { ActiveRules, AgreementSetup } from "@/components/agreement/active-rules";
import { PageHeader } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { agreementOverview, familyContext } from "@/lib/data/family";
import { requireOnboarded } from "@/lib/data/me";

export const metadata: Metadata = { title: "Agreement" };

export default function AgreementPage() {
  return (
    <Suspense fallback={<AgreementSkeleton />}>
      <Agreement />
    </Suspense>
  );
}

async function Agreement() {
  await requireOnboarded("/app/agreement");
  const ctx = await familyContext("/app/agreement");
  if (ctx.family.ownerUid !== ctx.user.uid) {
    return <PageHeader title="Agreement" description={`${ctx.family.owner.name} manages the agreement and its rules. Every expense you see shows the clause it was checked against.`} />;
  }
  const o = await agreementOverview(ctx);
  const coParent = ctx.family.coParent.name.split(" ")[0] || "The other parent";

  if (!o.active) {
    return (
      <div className="space-y-6">
        <PageHeader title="Agreement" description="Upload the parenting agreement. Each rule is read with its exact quote and page, and you confirm every one." />
        <AgreementSetup draft={o.draft} pendingAgreementId={o.pending?.id ?? null} />
      </div>
    );
  }

  const ack = o.active.coParentAck?.perRule ?? {};
  const disagreed = Object.values(ack).filter((v) => v === "disagree").length;
  const confirmed = o.active.confirmedAt ? new Intl.DateTimeFormat("en-US", { timeZone: ctx.userDoc.timeZone, dateStyle: "medium" }).format(new Date(o.active.confirmedAt)) : null;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Agreement"
        description={
          <>
            {o.activeAgreement?.fileName ?? "Your agreement"}, {o.activeAgreement?.pageCount ?? "?"} pages. Rules version {o.active.version}
            {confirmed ? `, confirmed ${confirmed}` : ""}.
          </>
        }
      />

      {o.draft ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-primary/30 bg-primary-soft p-4">
          <p className="flex items-center gap-2 font-medium text-primary">
            <Sparkle aria-hidden className="size-4" /> New rules from an amendment are waiting for your review.
          </p>
          <Link href="/app/agreement/review" className={buttonVariants({ className: "h-11 px-4" })}>
            Review the rules
          </Link>
        </div>
      ) : null}

      <section aria-labelledby="ack-h" className="flex gap-3 rounded-[14px] border border-border bg-surface p-4">
        <FileCheck2 aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
        <div>
          <h2 id="ack-h" className="font-medium">
            {ctx.family.coParent.inviteStatus === "accepted" ? (disagreed ? `${coParent} disagrees with ${disagreed} rule${disagreed === 1 ? "" : "s"}` : `${coParent} agreed to the rules`) : `${coParent} has not answered yet`}
          </h2>
          <p className="t-small mt-0.5 text-muted-foreground">
            {disagreed
              ? "Expenses under those rules are marked Needs review instead of being checked automatically."
              : ctx.family.coParent.inviteStatus === "accepted"
                ? "Expenses are checked against these rules."
                : "The invite link shows these rules with their quotes and asks for agree or disagree on each one."}
          </p>
        </div>
      </section>

      <section aria-labelledby="rules-h" className="space-y-4">
        <h2 id="rules-h" className="t-h2">Expense rules</h2>
        <ActiveRules rv={o.active} coParentName={coParent} />
      </section>

      <section aria-labelledby="amend-h" className="rounded-[14px] border border-dashed border-border bg-surface p-5">
        <h2 id="amend-h" className="t-h3">Amendments</h2>
        {o.entitled ? (
          <div className="mt-3">
            <AgreementSetup draft={null} pendingAgreementId={null} uploadTitle="Upload an amendment" />
          </div>
        ) : (
          <p className="mt-1 text-muted-foreground">
            The Free plan includes one agreement. Amendments create a new rules version; expenses you already added keep the rules they were checked with. Amendments come with the Family plan.
          </p>
        )}
      </section>
    </div>
  );
}

function AgreementSkeleton() {
  return (
    <div className="space-y-6" aria-busy>
      <Skeleton className="h-9 w-48" />
      <Skeleton className="h-20 w-full rounded-[14px]" />
      <div className="grid gap-4 xl:grid-cols-2">
        <Skeleton className="h-56 rounded-[14px]" />
        <Skeleton className="h-56 rounded-[14px]" />
      </div>
    </div>
  );
}
