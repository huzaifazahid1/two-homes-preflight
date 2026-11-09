"use client";

import { PendingLabel } from "@/components/domain/pending-label";
import { useState } from "react";
import { Segmented } from "@/components/domain/segmented";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage } from "@/hooks/api";
import { parseDollarsToCents } from "@/lib/money";

// Answer a dispute: agree (accepts the other parent's latest proposal) or answer once more.

export function RespondForm({ expenseId, receiver, proposal, onDone, redirectOn401 = false }: { expenseId: string; receiver: string; proposal: number | null; onDone: () => Promise<void> | void; redirectOn401?: boolean }) {
  const [action, setAction] = useState<"agree" | "counter">("counter");
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    const cents = amount.trim() ? parseDollarsToCents(amount) : null;
    if (action === "counter" && !reason.trim()) return setError("Write a short answer.");
    if (amount.trim() && (cents === null || cents <= 0)) return setError("Enter a valid amount.");
    setBusy(true);
    setError(null);
    try {
      await api(`/api/disputes/${expenseId}/respond`, { method: "POST", body: action === "agree" ? { action } : { action, reason: reason.trim(), ...(cents ? { proposedCents: cents } : {}) }, redirectOn401 });
      await onDone();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }
  return (
    <form
      className="space-y-4 rounded-[14px] border border-border bg-surface p-5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Segmented<"agree" | "counter">
        name="respond"
        legend="Your answer"
        value={action}
        onChange={setAction}
        options={[
          { value: "agree", label: proposal !== null ? "Accept the proposal" : `Agree with ${receiver}` },
          { value: "counter", label: "Answer" },
        ]}
      />
      {action === "counter" ? (
        <>
          <Textarea aria-label="Your answer" rows={3} maxLength={1000} className="text-base" value={reason} onChange={(e) => setReason(e.target.value)} />
          <Input aria-label="Amount you propose (optional)" inputMode="decimal" className="h-11 font-mono text-base tabular-nums" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount you propose (optional)…" />
        </>
      ) : null}
      <div aria-live="polite">{error ? <p className="t-small rounded-md bg-danger-bg px-3 py-2 text-danger">{error}</p> : null}</div>
      <Button type="submit" className="h-11" disabled={busy}>
        <PendingLabel pending={busy} busy="Sending…" idle={action === "agree" ? "Agree" : "Send answer"} />
      </Button>
    </form>
  );
}
