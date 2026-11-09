import { AlertTriangle, ArrowDownLeft, ArrowUpRight, ChevronRight } from "lucide-react";
import Link from "next/link";
import { CountUpMoney } from "@/components/domain/count-up";
import type { ClaimTotals } from "@/types/views";

// Owed to you / you owe, from server aggregation (A.6.4). Amounts count up on first load (P.9).

export function OverdueBanner({ totals }: { totals: ClaimTotals }) {
  const n = totals.overdueToYou.count + totals.overdueYouOwe.count;
  if (n === 0) return null;
  return (
    <Link href="/app/money#overdue" className="flex min-h-11 items-center gap-3 rounded-[10px] border border-danger/30 bg-danger-bg px-4 py-3 text-danger transition-colors hover:border-danger/60">
      <AlertTriangle aria-hidden className="size-5 shrink-0" />
      <span className="flex-1">
        <span className="font-medium">{n === 1 ? "1 claim is overdue" : `${n} claims are overdue`}</span>
        <span className="t-small block">
          {totals.overdueToYou.count ? <>Owed to you: <CountUpMoney cents={totals.overdueToYou.cents} /></> : null}
          {totals.overdueToYou.count && totals.overdueYouOwe.count ? " · " : null}
          {totals.overdueYouOwe.count ? <>You owe: <CountUpMoney cents={totals.overdueYouOwe.cents} /></> : null}
        </span>
      </span>
      <ChevronRight aria-hidden className="size-4" />
    </Link>
  );
}

export function TotalsCards({ totals }: { totals: ClaimTotals }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Card label="Owed to you" icon={<ArrowDownLeft aria-hidden className="size-3.5" />} cents={totals.owedToYou.cents} count={totals.owedToYou.count} />
      <Card label="You owe" icon={<ArrowUpRight aria-hidden className="size-3.5" />} cents={totals.youOwe.cents} count={totals.youOwe.count} />
    </div>
  );
}

function Card({ label, icon, cents, count }: { label: string; icon: React.ReactNode; cents: number; count: number }) {
  return (
    <Link href="/app/money" className="rounded-[14px] border border-border bg-surface p-4 transition-colors hover:border-primary/40 sm:p-5">
      <p className="t-label flex items-center gap-1.5 text-muted-foreground">
        {icon} {label}
      </p>
      <CountUpMoney cents={cents} className="mt-1.5 block text-2xl leading-8 sm:text-[32px] sm:leading-9" />
      <p className="t-small mt-0.5 text-muted-foreground">{count === 0 ? "Nothing outstanding" : count === 1 ? "1 open claim" : `${count} open claims`}</p>
    </Link>
  );
}
