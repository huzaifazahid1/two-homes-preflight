import { cn } from "cn";
import { Money } from "./money";

// SplitBar (P.9): who pays what. Widths come from integer cents; labels carry the amounts
// so the bar is never the only signal.

export function SplitBar({
  owedCents,
  otherCents,
  owedLabel,
  otherLabel,
  className,
}: {
  owedCents: number;
  otherCents: number;
  owedLabel: string;
  otherLabel: string;
  className?: string;
}) {
  const total = owedCents + otherCents;
  const owedPct = total > 0 ? Math.round((owedCents * 1000) / total) / 10 : 0;
  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-surface-2" role="img" aria-label={`${owedLabel} ${owedPct}%, ${otherLabel} ${Math.round((100 - owedPct) * 10) / 10}%`}>
        <div className="h-full bg-primary" style={{ width: `${owedPct}%` }} />
        <div className="h-full flex-1 bg-brand-accent/25" />
      </div>
      <dl className="flex justify-between gap-4 text-sm">
        <div>
          <dt className="t-label flex items-center gap-1.5 text-muted-foreground">
            <span aria-hidden className="size-2 rounded-full bg-primary" />
            {owedLabel}
          </dt>
          <dd className="mt-0.5 font-medium">
            <Money cents={owedCents} />
          </dd>
        </div>
        <div className="text-right">
          <dt className="t-label flex items-center justify-end gap-1.5 text-muted-foreground">
            {otherLabel}
            <span aria-hidden className="size-2 rounded-full bg-brand-accent/40" />
          </dt>
          <dd className="mt-0.5 font-medium">
            <Money cents={otherCents} />
          </dd>
        </div>
      </dl>
    </div>
  );
}
