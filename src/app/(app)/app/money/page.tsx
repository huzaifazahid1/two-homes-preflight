import type { Metadata } from "next";
import { ChevronRight, Wallet } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { OverdueBanner, TotalsCards } from "@/components/dashboard/totals";
import { Money } from "@/components/domain/money";
import { SettlementStatusBadge } from "@/components/domain/status-badge";
import { LiveRefresh } from "@/components/live/live-refresh";
import { Skeleton } from "@/components/ui/skeleton";
import { actorOf } from "@/lib/auth/session";
import { claimTotals, listClaims, OUTSTANDING } from "@/lib/data/dashboard";
import { familyContext } from "@/lib/data/family";
import { requireOnboarded } from "@/lib/data/me";
import type { ExpenseView } from "@/types/views";

export const metadata: Metadata = { title: "Money" };

// Money tab (A.8): outstanding, overdue and closed claims, mobile-first list. Totals by aggregation.
export default function MoneyPage() {
  return (
    <Suspense fallback={<MoneySkeleton />}>
      <MoneyView />
    </Suspense>
  );
}

const fmt = (iso: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(iso));

async function MoneyView() {
  await requireOnboarded("/app/money");
  const ctx = await familyContext("/app/money");
  const [totals, claims] = await Promise.all([claimTotals(ctx), listClaims(ctx)]);
  const me = actorOf(ctx).kind;
  const names = { owner: ctx.family.owner.name.split(" ")[0], coparent: (ctx.family.coParent.name || "Other parent").split(" ")[0] };
  const open = claims.filter((c) => (OUTSTANDING as string[]).includes(c.settlement.state) || c.settlement.state === "DISPUTED");
  const overdue = open.filter((c) => c.settlement.overdue);
  const current = open.filter((c) => !c.settlement.overdue);
  const closed = claims.filter((c) => !open.includes(c)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return (
    <div className="space-y-8">
      <LiveRefresh target={{ kind: "list" }} />
      <h1 className="t-h1">Money</h1>
      <OverdueBanner totals={totals} />
      <TotalsCards totals={totals} />
      {claims.length === 0 ? (
        <div className="flex gap-4 rounded-[14px] border border-dashed border-border bg-surface p-5">
          <Wallet aria-hidden className="mt-0.5 size-6 shrink-0 text-muted-foreground" />
          <div>
            <p className="font-medium">Nothing owed either way</p>
            <p className="t-small mt-1 text-muted-foreground">Claims show up here once a payment request is sent from an expense with a confirmed receipt.</p>
          </div>
        </div>
      ) : (
        <>
          {overdue.length ? <ClaimSection id="overdue" title="Overdue" items={overdue} me={me} names={names} /> : null}
          <ClaimSection id="outstanding" title="Outstanding" items={current} me={me} names={names} empty="No other open claims." />
          {closed.length ? <ClaimSection id="closed" title="Closed" items={closed} me={me} names={names} /> : null}
        </>
      )}
    </div>
  );
}

function ClaimSection({ id, title, items, me, names, empty }: { id: string; title: string; items: ExpenseView[]; me: "owner" | "coparent"; names: Record<"owner" | "coparent", string>; empty?: string }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-20 space-y-3">
      <h2 id={`${id}-h`} className="t-h3">
        {title} <span className="t-small font-normal text-muted-foreground">({items.length})</span>
      </h2>
      {items.length === 0 ? (
        <p className="t-small text-muted-foreground">{empty}</p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-[14px] border border-border bg-surface">
          {items.map((c) => {
            const toMe = c.paidByRole === me;
            return (
              <li key={c.id}>
                <Link href={`/app/expenses/${c.id}`} className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-surface-2/60 focus-visible:-outline-offset-2">
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="truncate font-medium">{c.description}</span>
                      <Money cents={c.settlement.owedCents ?? 0} className={`shrink-0 text-[15px] ${toMe ? "" : "text-muted-foreground"}`} />
                    </span>
                    <span className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
                      <span className="t-small text-muted-foreground">
                        {toMe ? `${names[c.owedByRole]} owes you` : `You owe ${names[c.paidByRole]}`}
                        {c.settlement.dueAt && (c.settlement.state === "AWAITING_PAYMENT" || c.settlement.state === "PAYMENT_FAILED") ? `, due ${fmt(c.settlement.dueAt)}` : ""}
                      </span>
                      <SettlementStatusBadge state={c.settlement.state} overdue={c.settlement.overdue} dueSoon={c.settlement.dueSoon} />
                    </span>
                  </span>
                  <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function MoneySkeleton() {
  return (
    <div className="space-y-6" aria-busy>
      <Skeleton className="h-9 w-32" />
      <div className="grid grid-cols-2 gap-3">
        <Skeleton className="h-28 rounded-[14px]" />
        <Skeleton className="h-28 rounded-[14px]" />
      </div>
      <Skeleton className="h-48 w-full rounded-[14px]" />
    </div>
  );
}
