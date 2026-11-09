import { cn } from "cn";
import Link from "next/link";
import { Money } from "@/components/domain/money";
import { CATEGORY_META } from "@/components/domain/status-meta";
import { ApprovalStatusBadge, SettlementStatusBadge, VerdictBadge } from "@/components/domain/status-badge";
import type { ExpenseView } from "@/types/views";

// Expense card list (phones and the master column on desktop). Server Component.

export function formatDay(iso: string | null): string | null {
  if (!iso) return null;
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }).format(new Date(`${iso}T12:00:00Z`));
}

export function ExpenseList({ items, activeId, compact = false }: { items: ExpenseView[]; activeId?: string; compact?: boolean }) {
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-[14px] border border-border bg-surface">
      {items.map((e) => {
        const Cat = CATEGORY_META[e.category].icon;
        const cancelled = e.settlement.state === "CANCELLED";
        const day = formatDay(e.date);
        const showSettlement = !cancelled && e.settlement.state !== "NONE";
        const showApproval = !cancelled && !showSettlement && e.approval.state !== "NOT_REQUIRED" && e.approval.state !== "REQUIRED";
        return (
          <li key={e.id}>
            <Link
              href={`/app/expenses/${e.id}`}
              aria-current={activeId === e.id ? "page" : undefined}
              className={cn(
                "flex gap-3 px-4 py-3.5 transition-colors hover:bg-surface-2/60 focus-visible:-outline-offset-2",
                activeId === e.id && "bg-primary-soft hover:bg-primary-soft",
                cancelled && "opacity-60",
              )}
            >
              <span aria-hidden className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted-foreground">
                <Cat className="size-[18px]" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-3">
                  <span className={cn("truncate font-medium", cancelled && "line-through")}>{e.description}</span>
                  <Money cents={e.amountCents} className="shrink-0 text-[15px]" />
                </span>
                <span className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
                  <span className="t-small truncate text-muted-foreground">
                    {e.childName}, {CATEGORY_META[e.category].label.toLowerCase()}
                    {day && !compact ? `, ${e.mode === "purchased" ? "bought" : "planned"} ${day}` : ""}
                  </span>
                  <span className="flex flex-wrap gap-1.5">
                    {cancelled ? <span className="t-label inline-flex h-6 items-center rounded-full bg-neutral-st-bg px-2.5 text-neutral-st">Cancelled</span> : <VerdictBadge verdict={e.verdict.code} />}
                    {showApproval ? <ApprovalStatusBadge state={e.approval.state} /> : null}
                    {showSettlement ? <SettlementStatusBadge state={e.settlement.state} overdue={e.settlement.overdue} dueSoon={e.settlement.dueSoon} /> : null}
                  </span>
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
