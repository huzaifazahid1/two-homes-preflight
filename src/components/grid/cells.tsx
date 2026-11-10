"use client";

import type { CustomCellRendererProps } from "ag-grid-react";
import Link from "next/link";
import { Money } from "@/components/domain/money";
import { ApprovalStatusBadge, SettlementStatusBadge, VerdictBadge } from "@/components/domain/status-badge";
import type { LedgerRow } from "@/types/views";

// Cell renderers for the ledger and desktop tables (Section K.3). They only display server
// values; nothing here computes money or status (K.6).

export type GridRow = LedgerRow & { isTotal?: false };
export type TotalRow = { isTotal: true; description: string; totalCents: number; owedCents: number };
type P = CustomCellRendererProps<GridRow | TotalRow>;

const isRow = (d: GridRow | TotalRow | undefined): d is GridRow => Boolean(d && !d.isTotal);

export function DescriptionCell({ data }: P) {
  if (!data) return null;
  if (!isRow(data)) return <span className="font-medium">{data.description}</span>;
  return (
    <div className="flex min-w-0 flex-col justify-center py-1.5 leading-tight">
      <Link href={`/app/expenses/${data.id}`} className="truncate font-medium text-foreground underline-offset-2 hover:underline focus-visible:underline">
        {data.description}
      </Link>
      {data.vendor ? <span className="t-small truncate text-muted-foreground">{data.vendor}</span> : null}
    </div>
  );
}

export function ClauseCell({ data, context }: P & { context: { openSource: (c: NonNullable<GridRow["clause"]>) => void } }) {
  if (!isRow(data) || !data.clause) return null;
  const c = data.clause;
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="truncate font-serif text-[13px]" title={c.quote}>
        “{c.quote}”
      </span>
      {c.agreementId ? (
        <button
          type="button"
          className="shrink-0 rounded-md bg-clause px-1.5 py-0.5 text-xs font-medium text-clause-ink outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => context.openSource(c)}
        >
          {/* The accessible name starts with the visible text (WCAG 2.5.3, voice control). */}
          p. {c.page}
          <span className="sr-only">, open page {c.page} of the agreement</span>
        </button>
      ) : null}
    </div>
  );
}

export function VerdictCell({ data }: P) {
  return isRow(data) ? <VerdictBadge verdict={data.verdict} /> : null;
}

export function ApprovalCell({ data }: P) {
  return isRow(data) ? <ApprovalStatusBadge state={data.approval} /> : null;
}

export function SettlementCell({ data }: P) {
  if (!isRow(data)) return null;
  return (
    <span className="inline-flex items-center gap-1.5">
      <SettlementStatusBadge state={data.settlement} overdue={data.isOverdue} dueSoon={data.dueSoon} />
      {data.isOverdue ? <span className="t-small font-medium text-danger">{data.daysOverdue}d</span> : null}
    </span>
  );
}

export function MoneyCell({ value, data }: P) {
  if (typeof value !== "number") return null;
  return <Money cents={value} size="table" className={data?.isTotal ? "font-semibold" : undefined} />;
}

export function ActionsCell({ data, context }: P & { context: { remind: (id: string) => void; busyId: string | null } }) {
  if (!isRow(data)) return null;
  return (
    <div className="flex items-center gap-1">
      <Link href={`/app/expenses/${data.id}`} className="rounded-md px-2 py-1 text-sm font-medium text-primary hover:bg-primary-soft focus-visible:ring-2 focus-visible:ring-ring">
        Open
      </Link>
      {data.canRemind ? (
        <button
          type="button"
          disabled={context.busyId === data.id}
          onClick={() => context.remind(data.id)}
          className="rounded-md px-2 py-1 text-sm font-medium text-primary hover:bg-primary-soft focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        >
          {context.busyId === data.id ? "Sending…" : "Remind"}
        </button>
      ) : null}
    </div>
  );
}
