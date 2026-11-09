"use client";

import { AlertTriangle, CopyCheck, NotebookPen } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Segmented } from "@/components/domain/segmented";
import { SourceSheet, type SourceTarget } from "@/components/domain/source-sheet";
import { VerdictBadge } from "@/components/domain/status-badge";
import { CATEGORY_META } from "@/components/domain/status-meta";
import { VerdictPanel, type VerdictData } from "@/components/domain/verdict-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { api, ApiError, errorMessage } from "@/hooks/api";
import { centsToDecimalString, formatCents, parseDollarsToCents } from "@/lib/money";
import type { QuickAddResult } from "@/schemas";
import { RULE_CATEGORIES, type Child, type Role, type RuleCategory } from "@/types/firestore";
import type { ExpenseView, PreflightResult } from "@/types/views";

// New / edit expense (A.5.3): native form, live preflight verdict, AI quick add that only fills
// fields (the verdict always comes from the rules engine after the parent reviews them).

type Props = {
  childrenList: Child[];
  viewerRole: Role;
  ownerName: string;
  coParentName: string;
  agreementId: string | null;
  today: string;
  expense?: ExpenseView;
};

type Fields = {
  childId: string;
  category: RuleCategory | "";
  description: string;
  vendor: string;
  amount: string;
  mode: "planned" | "purchased";
  date: string;
  paidByRole: Role;
};

function first(name: string) {
  return name.split(" ")[0] || name;
}

export function ExpenseForm({ childrenList, viewerRole, ownerName, coParentName, agreementId, today, expense }: Props) {
  const router = useRouter();
  const [f, setF] = useState<Fields>(() => ({
    childId: expense?.childId ?? (childrenList.length === 1 ? childrenList[0].id : ""),
    category: expense?.category ?? "",
    description: expense?.description ?? "",
    vendor: expense?.vendor ?? "",
    amount: expense ? centsToDecimalString(expense.amountCents) : "",
    mode: expense?.mode ?? "planned",
    date: expense?.date ?? "",
    paidByRole: expense?.paidByRole ?? viewerRole,
  }));
  const set = <K extends keyof Fields>(k: K, v: Fields[K]) => setF((p) => ({ ...p, [k]: v }));
  const amountCents = f.amount.trim() ? parseDollarsToCents(f.amount) : null;
  const amountError = f.amount.trim() && (amountCents === null || amountCents <= 0) ? "Enter an amount like 350 or 19.99" : amountCents !== null && amountCents > 10_000_000 ? "The amount cannot be more than $100,000" : null;

  // ---- Live preflight ----
  type VerdictState = { forKey: string; status: "ready" | "error"; data: (VerdictData & { owedByRole: Role }) | null; error: string | null };
  const [result, setResult] = useState<VerdictState | null>(null);
  const seq = useRef(0);
  const ready = Boolean(f.childId && f.category && amountCents && !amountError);
  const key = ready ? JSON.stringify([f.childId, f.category, amountCents, f.mode, f.date, f.paidByRole]) : "";
  useEffect(() => {
    if (!key) return;
    const id = ++seq.current;
    const t = setTimeout(async () => {
      const [childId, category, cents, mode, date, paidByRole] = JSON.parse(key);
      try {
        const { preflight } = await api<{ preflight: PreflightResult }>("/api/expenses/preflight", {
          method: "POST",
          body: { childId, category, amountCents: cents, mode, paidByRole, description: "preflight", ...(date ? { date } : {}) },
        });
        if (id !== seq.current) return;
        setResult({
          forKey: key,
          status: "ready",
          error: null,
          data: { verdict: preflight.verdict, explanation: preflight.explanation, citations: preflight.citations, owedShareCents: preflight.shares.owedShareCents, otherShareCents: preflight.shares.otherShareCents, quoteMatch: preflight.rule?.quoteMatch, owedByRole: preflight.owedByRole },
        });
      } catch (e) {
        if (id === seq.current) setResult({ forKey: key, status: "error", data: null, error: errorMessage(e) });
      }
    }, 300);
    return () => clearTimeout(t);
  }, [key]);
  // Derived: idle without inputs, loading while the latest inputs have no answer yet (previous verdict stays dimmed).
  const verdict = !key
    ? { status: "idle" as const, data: null, error: null }
    : result?.forKey === key
      ? result
      : { status: "loading" as const, data: result?.status === "ready" ? result.data : null, error: null };

  // ---- Quick add ----
  const [note, setNote] = useState("");
  const [qa, setQa] = useState<{ busy: boolean; message: string | null; error: string | null }>({ busy: false, message: null, error: null });
  async function quickAdd(e: React.FormEvent) {
    e.preventDefault();
    if (note.trim().length < 3) return setQa({ busy: false, message: null, error: "Type a short note first, for example: Mia soccer camp $350 next Saturday." });
    setQa({ busy: true, message: null, error: null });
    try {
      const { fields } = await api<{ fields: QuickAddResult }>("/api/ai/expense-parse", { method: "POST", body: { text: note.trim() } });
      const missing: string[] = [];
      setF((p) => ({
        ...p,
        childId: fields.childId ?? p.childId,
        category: fields.category ?? p.category,
        description: fields.description ?? p.description,
        vendor: fields.vendor ?? p.vendor,
        amount: fields.amountCents !== null ? centsToDecimalString(fields.amountCents) : p.amount,
        mode: fields.mode ?? p.mode,
        date: fields.date ?? p.date,
      }));
      if (!fields.amountCents) missing.push("amount");
      if (!fields.childId && childrenList.length > 1) missing.push("child");
      if (!fields.category) missing.push("kind of expense");
      setQa({ busy: false, error: null, message: missing.length ? `Filled what the note said. Add the ${missing.join(" and ")} yourself.` : "Filled from your note. Check each field before saving." });
    } catch (err) {
      setQa({ busy: false, message: null, error: errorMessage(err) });
    }
  }

  // ---- Submit ----
  const [submit, setSubmit] = useState<{ busy: boolean; error: string | null; duplicateOf: string | null }>({ busy: false, error: null, duplicateOf: null });
  async function save(confirmDuplicate = false) {
    if (!f.childId || !f.category || !f.description.trim() || !amountCents || amountError) {
      const missing = !f.childId ? "childId" : !f.category ? "category" : !f.description.trim() ? "description" : "amount";
      document.getElementById(missing)?.focus();
      return setSubmit({ busy: false, duplicateOf: null, error: "Fill in the child, kind of expense, description and amount." });
    }
    setSubmit({ busy: true, error: null, duplicateOf: null });
    const payload = {
      childId: f.childId,
      category: f.category,
      description: f.description.trim(),
      amountCents,
      mode: f.mode,
      paidByRole: f.paidByRole,
      ...(f.date ? { date: f.date } : {}),
    };
    try {
      if (expense) {
        await api(`/api/expenses/${expense.id}`, { method: "PATCH", body: { ...payload, vendor: f.vendor.trim() || null, date: f.date || null, version: expense.version } });
        router.push(`/app/expenses/${expense.id}`);
      } else {
        const r = await api<{ expense: ExpenseView }>("/api/expenses", { method: "POST", body: { ...payload, ...(f.vendor.trim() ? { vendor: f.vendor.trim() } : {}), ...(confirmDuplicate ? { confirmDuplicate: true } : {}) } });
        router.push(`/app/expenses/${r.expense.id}`);
      }
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError && err.code === "DUPLICATE") return setSubmit({ busy: false, error: null, duplicateOf: String(err.details?.possibleDuplicateOf ?? "") });
      setSubmit({ busy: false, duplicateOf: null, error: errorMessage(err) });
    }
  }

  const [source, setSource] = useState<SourceTarget>(null);
  const viewerName = viewerRole === "owner" ? ownerName : coParentName;
  const otherName = viewerRole === "owner" ? coParentName : ownerName;
  const buyerName = f.paidByRole === "owner" ? ownerName : coParentName;
  const owedName = f.paidByRole === "owner" ? coParentName : ownerName;
  const purchasedFirst = f.mode === "purchased" && verdict.data?.verdict === "NEEDS_APPROVAL";

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start xl:gap-10">
      <div className="space-y-6">
        {!expense ? (
          <form onSubmit={quickAdd} className="rounded-[14px] border border-dashed border-primary/30 bg-primary-soft/50 p-4">
            <Label htmlFor="note" className="flex items-center gap-2 font-medium">
              <NotebookPen aria-hidden className="size-4 text-primary" />
              Quick add from a note
            </Label>
            <p id="note-hint" className="t-small mt-1 text-muted-foreground">Write it the way you would text it. We fill the form; you check it.</p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <Input id="note" aria-describedby="note-hint" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Mia soccer camp $350 next Saturday at Riverside FC…" className="h-11 bg-surface" autoComplete="off" />
              <Button type="submit" variant="outline" className="h-11 shrink-0 bg-surface" disabled={qa.busy}>
                {qa.busy ? <Spinner /> : null}
                {qa.busy ? "Reading…" : "Fill the form"}
              </Button>
            </div>
            <div aria-live="polite">
              {qa.message ? <p className="t-small mt-2 text-primary">{qa.message}</p> : null}
              {qa.error ? <p className="t-small mt-2 text-danger">{qa.error}</p> : null}
            </div>
          </form>
        ) : null}

        <form
          id="expense-form"
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          noValidate
        >
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="childId">Child</Label>
              <select id="childId" value={f.childId} onChange={(e) => set("childId", e.target.value)} className="h-11 w-full rounded-lg border border-input bg-surface px-3 text-foreground" required>
                <option value="">Choose…</option>
                {childrenList.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.firstName}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="category">Kind of expense</Label>
              <select id="category" value={f.category} onChange={(e) => set("category", e.target.value as RuleCategory)} className="h-11 w-full rounded-lg border border-input bg-surface px-3 text-foreground" required>
                <option value="">Choose…</option>
                {RULE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_META[c].label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="description">What is it for?</Label>
            <Input id="description" value={f.description} onChange={(e) => set("description", e.target.value)} maxLength={200} className="h-11" placeholder="Summer soccer camp…" autoComplete="off" />
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="amount">Amount (USD)</Label>
              <div className="relative">
                <span aria-hidden className="pointer-events-none absolute inset-y-0 left-3 flex items-center font-mono text-muted-foreground">$</span>
                <Input
                  id="amount"
                  inputMode="decimal"
                  value={f.amount}
                  onChange={(e) => set("amount", e.target.value.replace(/[^\d.,]/g, ""))}
                  className="h-11 pl-7 font-mono tabular-nums"
                  placeholder="0.00"
                  autoComplete="off"
                  aria-invalid={amountError ? true : undefined}
                  aria-describedby={amountError ? "amount-err" : undefined}
                />
              </div>
              {amountError ? <p id="amount-err" className="t-small text-danger">{amountError}</p> : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vendor">Where (optional)</Label>
              <Input id="vendor" value={f.vendor} onChange={(e) => set("vendor", e.target.value)} maxLength={120} className="h-11" placeholder="Riverside FC…" autoComplete="off" />
            </div>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <Segmented
              name="mode"
              legend="Status"
              value={f.mode}
              onChange={(v) => set("mode", v)}
              options={[
                { value: "planned", label: "Planning to buy" },
                { value: "purchased", label: "Already bought" },
              ]}
            />
            <div className="space-y-1.5">
              <Label htmlFor="date">{f.mode === "purchased" ? "Purchase date" : "Planned date (optional)"}</Label>
              <Input id="date" type="date" value={f.date} max={f.mode === "purchased" ? today : undefined} onChange={(e) => set("date", e.target.value)} className="h-11" />
            </div>
          </div>

          <Segmented
            name="paidBy"
            legend="Who is buying it?"
            value={f.paidByRole}
            onChange={(v) => set("paidByRole", v)}
            options={[
              { value: viewerRole, label: `${first(viewerName)} (you)` },
              { value: viewerRole === "owner" ? "coparent" : "owner", label: first(otherName) },
            ]}
          />

          {purchasedFirst ? (
            <p className="t-small flex gap-2 rounded-md bg-approval-bg px-3 py-2 text-approval">
              <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
              The agreement asks for approval before this purchase. You can still ask for approval afterwards; {first(otherName)} will see that it was bought first.
            </p>
          ) : null}
        </form>
      </div>

      <div className="space-y-4 lg:sticky lg:top-20">
        <VerdictPanel
          data={verdict.data}
          status={verdict.status}
          error={verdict.error}
          owedLabel={`${first(owedName)} owes`}
          otherLabel={`${first(buyerName)} pays`}
          onOpenSource={agreementId ? (c) => setSource({ agreementId, page: c.page, quote: c.quote }) : undefined}
        />
        {submit.duplicateOf ? (
          <div role="alert" className="space-y-3 rounded-[10px] border border-approval/30 bg-approval-bg p-4 text-approval">
            <p className="flex gap-2 font-medium">
              <CopyCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
              This looks like an expense you added in the last 24 hours.
            </p>
            <p className="t-small">Same child, description and amount. Save it only if it is a different purchase.</p>
            <div className="flex flex-wrap gap-2">
              <Button className="h-11" onClick={() => void save(true)} disabled={submit.busy}>
                It is different, save it
              </Button>
              <Button variant="outline" className="h-11 bg-surface" onClick={() => router.push(`/app/expenses/${submit.duplicateOf}`)}>
                Open the earlier one
              </Button>
            </div>
          </div>
        ) : null}
        <div aria-live="polite">{submit.error ? <p className="t-small rounded-md bg-danger-bg px-3 py-2 text-danger">{submit.error}</p> : null}</div>
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 backdrop-blur lg:static lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
          {verdict.data ? (
            <div className="mb-2 flex items-center justify-between gap-3 lg:hidden" aria-hidden>
              <VerdictBadge verdict={verdict.data.verdict} />
              {verdict.data.verdict !== "NOT_COVERED" ? (
                <span className="t-small text-muted-foreground">
                  {first(owedName)} owes <span className="font-mono text-foreground">{formatCents(verdict.data.owedShareCents)}</span>
                </span>
              ) : null}
            </div>
          ) : null}
          <Button type="submit" form="expense-form" className="h-12 w-full text-[15px] lg:h-11" disabled={submit.busy}>
            {submit.busy ? <Spinner /> : null}
            {expense ? "Save changes" : f.mode === "purchased" ? "Save purchase" : "Save planned expense"}
          </Button>
        </div>
      </div>
      <SourceSheet target={source} onClose={() => setSource(null)} />
    </div>
  );
}
