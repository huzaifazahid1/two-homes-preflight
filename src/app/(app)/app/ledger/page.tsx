import type { Metadata } from "next";
import { Table2 } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { Money } from "@/components/domain/money";
import { LedgerClient } from "@/components/grid/ledger-client";
import { LiveRefresh } from "@/components/live/live-refresh";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { familyContext } from "@/lib/data/family";
import { getLedger } from "@/lib/data/ledger";
import { requireOnboarded } from "@/lib/data/me";

export const metadata: Metadata = { title: "Ledger" };

// The ledger (Section K): every expense with its clause, verdict, approval and settlement.
export default function LedgerPage() {
  return (
    <Suspense fallback={<LedgerSkeleton />}>
      <LedgerView />
    </Suspense>
  );
}

async function LedgerView() {
  await requireOnboarded("/app/ledger");
  const ctx = await familyContext("/app/ledger");
  const view = await getLedger(ctx);
  const c = view.totals.claims;

  return (
    <div className="space-y-6">
      <LiveRefresh target={{ kind: "list" }} />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="t-h1">Ledger</h1>
          <p className="mt-1 text-muted-foreground">Every expense, the clause behind it, and where the money stands.</p>
        </div>
        <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <Stat label="Owed to you" cents={c.owedToYou.cents} />
          <Stat label="You owe" cents={c.youOwe.cents} />
          <Stat label="Overdue to you" cents={c.overdueToYou.cents} danger={c.overdueToYou.cents > 0} />
        </dl>
      </div>
      {view.rows.length === 0 ? (
        <div className="flex gap-4 rounded-[14px] border border-dashed border-border bg-surface p-5">
          <Table2 aria-hidden className="mt-0.5 size-6 shrink-0 text-muted-foreground" />
          <div className="space-y-3">
            <div>
              <p className="font-medium">The ledger is empty</p>
              <p className="t-small mt-1 text-muted-foreground">Each expense you add shows up here with its clause and status.</p>
            </div>
            <Link href="/app/expenses/new" className={buttonVariants({ className: "h-11" })}>Add an expense</Link>
          </div>
        </div>
      ) : (
        <LedgerClient view={view} />
      )}
    </div>
  );
}

function Stat({ label, cents, danger }: { label: string; cents: number; danger?: boolean }) {
  return (
    <div>
      <dt className="t-label text-muted-foreground">{label}</dt>
      <dd className={danger ? "text-danger" : undefined}>
        <Money cents={cents} />
      </dd>
    </div>
  );
}

function LedgerSkeleton() {
  return (
    <div className="space-y-6" aria-busy>
      <Skeleton className="h-9 w-32" />
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-[480px] w-full rounded-[10px]" />
    </div>
  );
}
