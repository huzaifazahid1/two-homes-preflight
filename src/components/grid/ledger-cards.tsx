"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { Money } from "@/components/domain/money";
import { SettlementStatusBadge, VerdictBadge } from "@/components/domain/status-badge";
import type { LedgerRow } from "@/types/views";

// Phone alternative to the ledger grid (Section K.1): cards grouped by month. Filters are the
// same as the grid's toolbar; rows and amounts come from the server as they are.

export function LedgerCards({ rows, quick, filters, dateFmt }: { rows: LedgerRow[]; quick: string; filters: { overdueOnly: boolean; owedToMe: boolean; childId: string }; dateFmt: Intl.DateTimeFormat }) {
  const q = quick.trim().toLowerCase();
  const shown = rows.filter(
    (r) =>
      (!filters.overdueOnly || r.isOverdue) &&
      (!filters.owedToMe || r.owedToMe) &&
      (!filters.childId || r.childId === filters.childId) &&
      (!q || `${r.description} ${r.vendor ?? ""} ${r.childName} ${r.category}`.toLowerCase().includes(q)),
  );
  if (shown.length === 0) return <p className="rounded-[14px] border border-dashed border-border bg-surface p-5 text-muted-foreground">No expenses match these filters.</p>;

  const months = new Map<string, LedgerRow[]>();
  for (const r of shown) {
    const key = r.month ?? "Undated";
    months.set(key, [...(months.get(key) ?? []), r]);
  }
  const monthName = (m: string) => (m === "Undated" ? m : new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${m}-15T12:00:00Z`)));

  return (
    <div className="space-y-6">
      {[...months].map(([month, items]) => (
        <section key={month} aria-labelledby={`m-${month}`} className="space-y-2">
          <h2 id={`m-${month}`} className="t-label text-muted-foreground">{monthName(month)}</h2>
          <ul className="divide-y divide-border overflow-hidden rounded-[14px] border border-border bg-surface">
            {items.map((r) => (
              <li key={r.id}>
                <Link href={`/app/expenses/${r.id}`} className="flex min-h-[64px] items-center gap-3 px-4 py-3 active:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <p className="truncate font-medium">{r.description}</p>
                    <p className="t-small truncate text-muted-foreground">
                      {r.childName}
                      {r.date ? ` · ${dateFmt.format(new Date(r.date))}` : ""}
                      {r.clause ? ` · p. ${r.clause.page}` : ""}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      <VerdictBadge verdict={r.verdict} />
                      {r.settlement !== "NONE" ? <SettlementStatusBadge state={r.settlement} overdue={r.isOverdue} dueSoon={r.dueSoon} /> : null}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <Money cents={r.totalCents} className="block" />
                    <span className="t-small text-muted-foreground">
                      {r.owedToMe ? `${r.owedByName}'s share` : "your share"} <Money cents={r.owedCents} />
                    </span>
                  </div>
                  <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
