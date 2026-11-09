import type { Metadata } from "next";
import { Wallet } from "lucide-react";

export const metadata: Metadata = { title: "Money" };

export default function MoneyPage() {
  return (
    <div className="space-y-6">
      <h1 className="t-h1">Money</h1>
      <div className="flex gap-4 rounded-[10px] border border-dashed border-border bg-surface p-5">
        <Wallet aria-hidden className="mt-0.5 size-6 shrink-0 text-muted-foreground" />
        <div>
          <p className="font-medium">Nothing owed either way</p>
          <p className="t-small mt-1 text-muted-foreground">Outstanding, overdue and settled claims will be listed here once you send a payment request.</p>
        </div>
      </div>
    </div>
  );
}
