import type { Metadata } from "next";
import { ArrowRight, ScrollText } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { ExpenseList } from "@/components/expenses/expense-list";
import { InviteStatusBadge } from "@/components/domain/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { agreementOverview, familyContext, listExpenses } from "@/lib/data/family";
import { requireOnboarded } from "@/lib/data/me";

export const metadata: Metadata = { title: "Home" };

export default function HomePage() {
  return (
    <Suspense fallback={<HomeSkeleton />}>
      <Home />
    </Suspense>
  );
}

async function Home() {
  const me = await requireOnboarded("/app");
  const ctx = await familyContext("/app");
  const [{ items }, overview] = await Promise.all([listExpenses(ctx, { limit: 30 }), agreementOverview(ctx)]);
  const f = me.family;
  const first = me.displayName.split(" ")[0];
  const coParent = f.coParent.name.split(" ")[0] || "the other parent";
  const open = items.filter((e) => e.settlement.state !== "CANCELLED");
  const action = open.filter((e) => e.verdict.code === "NEEDS_REVIEW" || e.approval.state === "REQUIRED").slice(0, 5);
  const recent = items.slice(0, 5);
  const ruleCount = overview.active?.rules.filter((r) => r.reviewState === "CONFIRMED" || r.reviewState === "EDITED").length ?? 0;

  return (
    <div className="space-y-8">
      <h1 className="t-h1">Hi {first}</h1>

      <Link
        href="/app/expenses/new"
        className="group relative block overflow-hidden rounded-[18px] bg-primary p-6 text-primary-foreground shadow-[0_10px_30px_rgb(18_64_60/0.18)] transition-[background-color] hover:bg-primary-hover sm:p-7"
      >
        <span aria-hidden className="absolute -right-6 -top-10 size-40 rounded-full border-[18px] border-primary-foreground/[0.06]" />
        <span className="relative block max-w-md">
          <span className="t-h2 block">About to buy something for {f.children.map((c) => c.firstName).join(" or ")}?</span>
          <span className="mt-2 block text-primary-foreground/80">Check it against your agreement first. You get the verdict and the exact clause before anyone spends.</span>
          <span className="mt-5 inline-flex h-11 items-center gap-2 rounded-lg bg-primary-foreground px-4 font-medium text-primary">
            Check an expense
            <ArrowRight aria-hidden className="size-4 transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none" />
          </span>
        </span>
      </Link>

      <section aria-labelledby="action-h" className="space-y-3">
        <h2 id="action-h" className="t-h3">Needs your action</h2>
        {action.length ? (
          <ExpenseList items={action} />
        ) : (
          <p className="rounded-[14px] border border-dashed border-border bg-surface p-5 text-muted-foreground">Nothing is waiting on you. Expenses that need approval or a conversation show up here.</p>
        )}
      </section>

      {recent.length ? (
        <section aria-labelledby="recent-h" className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 id="recent-h" className="t-h3">Recent expenses</h2>
            <Link href="/app/expenses" className="t-small inline-flex min-h-11 items-center font-medium text-primary underline-offset-4 hover:underline">
              See all
            </Link>
          </div>
          <ExpenseList items={recent} />
        </section>
      ) : null}

      <section aria-labelledby="family-h" className="grid gap-4 md:grid-cols-3">
        <h2 id="family-h" className="sr-only">Your family</h2>
        <Link href="/app/agreement" className="rounded-[14px] border border-border bg-surface p-5 transition-colors hover:border-primary/40">
          <p className="t-label flex items-center gap-1.5 text-muted-foreground">
            <ScrollText aria-hidden className="size-3.5" /> Agreement
          </p>
          <p className="mt-2 font-medium">{ruleCount ? `${ruleCount} confirmed rules` : "No rules yet"}</p>
          <p className="t-small mt-1 text-muted-foreground">{overview.active ? `Version ${overview.active.version}` : "Upload to start"}</p>
        </Link>
        <div className="rounded-[14px] border border-border bg-surface p-5">
          <p className="t-label text-muted-foreground">Other parent</p>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">{f.coParent.name}</p>
            <InviteStatusBadge status={f.coParent.inviteStatus} />
          </div>
          {f.coParent.inviteStatus !== "accepted" ? (
            <Link href="/app/settings#coparent" className="t-small mt-2 inline-flex min-h-11 items-center font-medium text-primary underline-offset-4 hover:underline">
              Manage the invite to {coParent}
            </Link>
          ) : null}
        </div>
        <div className="rounded-[14px] border border-border bg-surface p-5">
          <p className="t-label text-muted-foreground">Your PayPal for payouts</p>
          <p className={f.payout.owner ? "mt-2 break-all font-medium" : "mt-2 text-muted-foreground"}>{f.payout.owner ? f.payout.owner.email : "Not connected"}</p>
          <Link href="/app/settings#paypal" className="t-small mt-2 inline-flex min-h-11 items-center font-medium text-primary underline-offset-4 hover:underline">
            PayPal settings
          </Link>
        </div>
      </section>
    </div>
  );
}

function HomeSkeleton() {
  return (
    <div className="space-y-6" aria-busy>
      <Skeleton className="h-9 w-40" />
      <Skeleton className="h-44 w-full rounded-[18px]" />
      <Skeleton className="h-40 w-full rounded-[14px]" />
    </div>
  );
}
