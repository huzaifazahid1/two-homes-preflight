import { CircleDot } from "lucide-react";
import { formatCents } from "@/lib/money";
import type { ApprovalState, VerdictCode } from "@/types/firestore";
import type { ExpenseEventView } from "@/types/views";
import { APPROVAL_META, VERDICT_META } from "./status-meta";

// Timeline (P.9) from the expense's events subcollection. One row per events doc; no-op notes are hidden.

const FIELD: Record<string, string> = { amountCents: "amount", childId: "child", category: "category", description: "description", vendor: "vendor", mode: "purchase status", date: "date", paidByRole: "who is buying" };

function describe(ev: ExpenseEventView): { title: string; detail?: string } | null {
  if (ev.machine === "note") return null;
  if (ev.type === "expense.created") return { title: "Expense added", detail: `Checked against the agreement: ${VERDICT_META[ev.to as VerdictCode]?.label ?? ev.to}.` };
  if (ev.type === "expense.edited") {
    const changed = ((ev.data.changed as string[] | undefined) ?? []).map((k) => FIELD[k] ?? k);
    const verdict = ev.from !== ev.to ? ` Verdict changed from ${VERDICT_META[ev.from as VerdictCode]?.label} to ${VERDICT_META[ev.to as VerdictCode]?.label}.` : "";
    return { title: "Expense edited", detail: `Changed ${changed.join(", ") || "details"}.${verdict}` };
  }
  if (ev.type === "verdict.recomputed") {
    return { title: "Checked again", detail: `The other parent changed an answer on the rules. Now: ${VERDICT_META[ev.to as VerdictCode]?.label ?? ev.to}.` };
  }
  if (ev.machine === "approval") {
    const to = ev.to as ApprovalState;
    const amount = typeof ev.data.newAmountCents === "number" ? ` The amount went up to ${formatCents(ev.data.newAmountCents)}.` : "";
    return { title: APPROVAL_META[to]?.label ?? to, detail: amount || undefined };
  }
  if (ev.machine === "settlement") return { title: ev.to === "CANCELLED" ? "Expense cancelled" : `Payment status: ${ev.to?.toLowerCase().replace(/_/g, " ")}` };
  return { title: ev.type };
}

const ACTOR: Record<string, string> = { owner: "Owner", coparent: "Other parent", system: "Automatic", paypal: "PayPal" };

export function Timeline({ events, timeZone, names }: { events: ExpenseEventView[]; timeZone: string; names?: { owner?: string; coparent?: string } }) {
  const rows = events.map((e) => ({ e, d: describe(e) })).filter((r): r is { e: ExpenseEventView; d: NonNullable<ReturnType<typeof describe>> } => r.d !== null);
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return (
    <ol className="relative space-y-5 border-l border-border pl-6">
      {rows.map(({ e, d }) => (
        <li key={e.id} className="relative">
          <span aria-hidden className="absolute -left-[31px] top-0.5 flex size-[14px] items-center justify-center rounded-full bg-background">
            <CircleDot className="size-[14px] text-primary" />
          </span>
          <p className="font-medium leading-6">{d.title}</p>
          {d.detail ? <p className="t-small text-muted-foreground">{d.detail}</p> : null}
          <p className="t-label mt-0.5 text-muted-foreground">
            <time dateTime={e.at}>{fmt.format(new Date(e.at))}</time>, {names?.[e.actor as "owner" | "coparent"] ?? ACTOR[e.actor] ?? e.actor}
          </p>
        </li>
      ))}
    </ol>
  );
}
