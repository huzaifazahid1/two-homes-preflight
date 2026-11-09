import { cn } from "cn";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { LiveList } from "@/components/domain/live-list";
import { Money } from "@/components/domain/money";
import { CATEGORY_META } from "@/components/domain/status-meta";
import type { ActionItem } from "@/lib/data/dashboard";

// "Needs your action": one row per expense with the single next step (src/lib/next-action.ts).
export function ActionList({ items }: { items: ActionItem[] }) {
  return (
    <LiveList className="divide-y divide-border overflow-hidden rounded-[14px] border border-border bg-surface">
      {items.map(({ expense: e, action }) => {
        const Cat = CATEGORY_META[e.category].icon;
        return (
            <Link key={e.id} href={action.kind === "add_receipt" || action.kind === "confirm_receipt" || action.kind === "fix_receipt" ? `/app/expenses/${e.id}/receipt` : `/app/expenses/${e.id}`} className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-surface-2/60 focus-visible:-outline-offset-2">
              <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted-foreground">
                <Cat className="size-[18px]" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-3">
                  <span className="truncate font-medium">{e.description}</span>
                  <Money cents={e.settlement.owedCents ?? e.amountCents} className="shrink-0 text-[15px]" />
                </span>
                <span className={cn("t-small mt-0.5 block", action.urgent ? "font-medium text-danger" : "text-muted-foreground")}>
                  {action.label}
                  <span className="font-normal text-muted-foreground"> · {e.childName}</span>
                </span>
              </span>
              <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            </Link>
        );
      })}
    </LiveList>
  );
}
