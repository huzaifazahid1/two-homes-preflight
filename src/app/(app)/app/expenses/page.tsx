import type { Metadata } from "next";
import { ReceiptText } from "lucide-react";

export const metadata: Metadata = { title: "Expenses" };

export default function ExpensesPage() {
  return (
    <div className="space-y-6">
      <h1 className="t-h1">Expenses</h1>
      <div className="flex gap-4 rounded-[10px] border border-dashed border-border bg-surface p-5">
        <ReceiptText aria-hidden className="mt-0.5 size-6 shrink-0 text-muted-foreground" />
        <div>
          <p className="font-medium">No expenses yet</p>
          <p className="t-small mt-1 text-muted-foreground">
            Planned and purchased expenses, each checked against your agreement, arrive in the next part of this build.
          </p>
        </div>
      </div>
    </div>
  );
}
