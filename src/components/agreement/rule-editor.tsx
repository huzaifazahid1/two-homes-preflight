"use client";

import { useState } from "react";
import { CATEGORY_META } from "@/components/domain/status-meta";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { centsToDecimalString, parseDollarsToCents } from "@/lib/money";
import { RULE_CATEGORIES, type Rule, type RuleCategory } from "@/types/firestore";

// Edit a drafted rule (original values are kept on the server) or add one by hand.
// A hand-added rule still needs a quote that is found in the agreement.

export type RuleFormValues = {
  category: RuleCategory;
  label: string;
  owedPct: number;
  approval: { required: true; operator: "gt" | "gte"; thresholdCents: number } | null;
  receiptDeadlineDays: number | null;
  reimburseWithinDays: number | null;
  childNames: string[];
  quote: string;
  page: number;
};

const field = "h-11";

export function RuleEditor({
  rule,
  manual = false,
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  rule?: Rule;
  manual?: boolean;
  busy: boolean;
  error: string | null;
  onSubmit: (v: RuleFormValues) => void;
  onCancel: () => void;
}) {
  const id = rule?.id ?? "new";
  const [category, setCategory] = useState<RuleCategory>(rule?.category ?? "medical");
  const [label, setLabel] = useState(rule?.label ?? "");
  const [pct, setPct] = useState(rule && !rule.sharesNonNumeric ? String(rule.owedPct) : "");
  const [needsApproval, setNeedsApproval] = useState(Boolean(rule?.approval?.required));
  const [operator, setOperator] = useState<"gt" | "gte">(rule?.approval?.operator ?? "gt");
  const [threshold, setThreshold] = useState(rule?.approval ? centsToDecimalString(rule.approval.thresholdCents) : "");
  const [receiptDays, setReceiptDays] = useState(rule?.receiptDeadlineDays ? String(rule.receiptDeadlineDays) : "");
  const [reimburseDays, setReimburseDays] = useState(rule?.reimburseWithinDays ? String(rule.reimburseWithinDays) : "");
  const [children, setChildren] = useState((rule?.childNames ?? []).join(", "));
  const [quote, setQuote] = useState(rule?.quote ?? "");
  const [page, setPage] = useState(rule ? String(rule.page) : "");
  const [local, setLocal] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setLocal(null);
    const owedPct = Number(pct);
    if (!label.trim()) return setLocal("Give the rule a short name.");
    if (pct === "" || !Number.isFinite(owedPct) || owedPct < 0 || owedPct > 100) return setLocal("Enter the other parent's share between 0 and 100.");
    const cents = needsApproval ? (threshold.trim() === "" ? 0 : parseDollarsToCents(threshold)) : null;
    if (needsApproval && cents === null) return setLocal("Enter the approval amount like 200 or 150.50.");
    const days = (s: string) => (s.trim() ? Math.trunc(Number(s)) : null);
    const pageNum = Number(page);
    if (manual && (!quote.trim() || !Number.isInteger(pageNum) || pageNum < 1)) return setLocal("Copy the exact sentence from the agreement and give its page.");
    onSubmit({
      category,
      label: label.trim(),
      owedPct: Math.round(owedPct * 100) / 100,
      approval: needsApproval ? { required: true, operator: threshold.trim() === "" ? "gte" : operator, thresholdCents: cents ?? 0 } : null,
      receiptDeadlineDays: days(receiptDays),
      reimburseWithinDays: days(reimburseDays),
      childNames: children.split(",").map((s) => s.trim()).filter(Boolean),
      quote: quote.trim(),
      page: pageNum || rule?.page || 1,
    });
  }

  const message = local ?? error;
  return (
    <form onSubmit={submit} className="space-y-4 rounded-[10px] border border-border bg-background p-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        {manual ? (
          <div className="space-y-1.5">
            <Label htmlFor={`cat-${id}`}>Kind of expense</Label>
            <select id={`cat-${id}`} value={category} onChange={(e) => setCategory(e.target.value as RuleCategory)} className="h-11 w-full rounded-lg border border-input bg-surface px-3 text-foreground">
              {RULE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_META[c].label}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div className="space-y-1.5">
          <Label htmlFor={`label-${id}`}>Rule name</Label>
          <Input id={`label-${id}`} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={120} className={field} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`pct-${id}`}>Other parent&apos;s share (%)</Label>
          <Input id={`pct-${id}`} inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value.replace(/[^\d.]/g, ""))} className={`${field} font-mono`} aria-describedby={`pct-${id}-hint`} />
          <p id={`pct-${id}-hint`} className="t-small text-muted-foreground">What the parent who did not buy it pays back.</p>
        </div>
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Approval</legend>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" checked={needsApproval} onChange={(e) => setNeedsApproval(e.target.checked)} className="size-4 accent-[var(--primary)]" />
          Needs the other parent&apos;s approval first
        </label>
        {needsApproval ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`op-${id}`}>When the amount is</Label>
              <select id={`op-${id}`} value={operator} onChange={(e) => setOperator(e.target.value as "gt" | "gte")} className="h-11 w-full rounded-lg border border-input bg-surface px-3 text-foreground">
                <option value="gt">above the amount</option>
                <option value="gte">the amount or more</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`th-${id}`}>Amount (empty means always)</Label>
              <Input id={`th-${id}`} inputMode="decimal" value={threshold} onChange={(e) => setThreshold(e.target.value.replace(/[^\d.,]/g, ""))} className={`${field} font-mono`} placeholder="200" />
            </div>
          </div>
        ) : null}
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor={`rd-${id}`}>Receipt within (days)</Label>
          <Input id={`rd-${id}`} inputMode="numeric" value={receiptDays} onChange={(e) => setReceiptDays(e.target.value.replace(/\D/g, ""))} className={field} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`pd-${id}`}>Pay back within (days)</Label>
          <Input id={`pd-${id}`} inputMode="numeric" value={reimburseDays} onChange={(e) => setReimburseDays(e.target.value.replace(/\D/g, ""))} className={field} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`ch-${id}`}>Only for (optional)</Label>
          <Input id={`ch-${id}`} value={children} onChange={(e) => setChildren(e.target.value)} className={field} placeholder="Mia" />
        </div>
      </div>

      {manual ? (
        <div className="grid gap-4 sm:grid-cols-[1fr_110px]">
          <div className="space-y-1.5">
            <Label htmlFor={`q-${id}`}>Exact sentence from the agreement</Label>
            <Textarea id={`q-${id}`} value={quote} onChange={(e) => setQuote(e.target.value)} rows={3} className="font-serif" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`p-${id}`}>Page</Label>
            <Input id={`p-${id}`} inputMode="numeric" value={page} onChange={(e) => setPage(e.target.value.replace(/\D/g, ""))} className={field} />
          </div>
        </div>
      ) : null}

      <div aria-live="polite">{message ? <p className="t-small rounded-md bg-danger-bg px-3 py-2 text-danger">{message}</p> : null}</div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" className="h-11" disabled={busy}>
          {busy ? "Saving…" : manual ? "Add rule" : "Save changes"}
        </Button>
        <Button type="button" variant="ghost" className="h-11" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
