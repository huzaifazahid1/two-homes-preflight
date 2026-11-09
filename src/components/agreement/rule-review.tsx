"use client";

import { cn } from "cn";
import { AlertTriangle, Check, FlaskConical, Info, Pencil, Plus, Undo2, X } from "lucide-react";
import { useState } from "react";
import { ClauseCard } from "@/components/domain/clause-card";
import { SourceSheet, type SourceTarget } from "@/components/domain/source-sheet";
import { CATEGORY_META, ISSUE_META } from "@/components/domain/status-meta";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { api, errorMessage } from "@/hooks/api";
import { ISSUE_TEXT, isBlocking } from "@/lib/rules-review";
import type { Rule } from "@/types/firestore";
import type { RuleVersionView } from "@/types/views";
import { RuleEditor, type RuleFormValues } from "./rule-editor";
import { ruleFacts } from "./rule-facts";

// Rule review (A.5.1 step 2, demo screen 2): confirm, edit (original kept) or reject each rule.
// A rule whose quote is not in the agreement cannot be confirmed (AG-3). Activation needs every
// rule decided and moves the family to the new version in one step.

const STATE: Record<Rule["reviewState"], { label: string; className: string }> = {
  PENDING: { label: "To check", className: "bg-surface-2 text-muted-foreground" },
  NEEDS_REVIEW: { label: "Needs your attention", className: "bg-review-bg text-review" },
  CONFIRMED: { label: "Confirmed", className: "bg-eligible-bg text-eligible" },
  EDITED: { label: "Confirmed with edits", className: "bg-eligible-bg text-eligible" },
  REJECTED: { label: "Rejected", className: "bg-neutral-st-bg text-neutral-st" },
};

export function RuleReview({ draft, onActivated, activateLabel = "Confirm these rules" }: { draft: RuleVersionView; onActivated: (rv: RuleVersionView) => void; activateLabel?: string }) {
  const [rv, setRv] = useState(draft);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [source, setSource] = useState<SourceTarget>(null);
  const [activating, setActivating] = useState(false);
  const [activateError, setActivateError] = useState<string | null>(null);

  const live = rv.rules.filter((r) => r.reviewState !== "REJECTED");
  const decided = rv.rules.filter((r) => r.reviewState === "CONFIRMED" || r.reviewState === "EDITED" || r.reviewState === "REJECTED").length;
  const attention = rv.rules.filter((r) => r.reviewState === "NEEDS_REVIEW").length;
  const canActivate = decided === rv.rules.length && live.length > 0;

  async function patch(ruleId: string, body: unknown) {
    setBusy(ruleId);
    setErrors((e) => ({ ...e, [ruleId]: null }));
    try {
      const r = await api<{ ruleVersion: RuleVersionView }>(`/api/rule-versions/${rv.id}/rules/${ruleId}`, { method: "PATCH", body });
      setRv(r.ruleVersion);
      setEditing(null);
    } catch (e) {
      setErrors((x) => ({ ...x, [ruleId]: errorMessage(e) }));
    }
    setBusy(null);
  }

  async function addManual(v: RuleFormValues) {
    setBusy("new");
    setErrors((e) => ({ ...e, new: null }));
    try {
      const r = await api<{ ruleVersion: RuleVersionView }>(`/api/rule-versions/${rv.id}/rules`, {
        method: "POST",
        body: { category: v.category, label: v.label, owedPct: v.owedPct, approval: v.approval, receiptDeadlineDays: v.receiptDeadlineDays, reimburseWithinDays: v.reimburseWithinDays, childNames: v.childNames, quote: v.quote, page: v.page },
      });
      setRv(r.ruleVersion);
      setEditing(null);
    } catch (e) {
      setErrors((x) => ({ ...x, new: errorMessage(e) }));
    }
    setBusy(null);
  }

  async function activate() {
    setActivating(true);
    setActivateError(null);
    try {
      const r = await api<{ ruleVersion: RuleVersionView }>(`/api/rule-versions/${rv.id}/activate`, { method: "POST" });
      onActivated(r.ruleVersion);
    } catch (e) {
      setActivateError(errorMessage(e));
      setActivating(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3 rounded-[14px] border border-border bg-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="t-h3">
            {rv.rules.length === 0 ? "No rules yet" : `${rv.rules.length} rule${rv.rules.length === 1 ? "" : "s"} found`}
            {attention > 0 ? <span className="font-normal text-muted-foreground">, {attention} need{attention === 1 ? "s" : ""} your attention</span> : null}
          </p>
          {rv.extraction?.mode === "demo" ? (
            <span className="t-label inline-flex h-7 items-center gap-1.5 rounded-full bg-evidence-bg px-3 text-evidence">
              <FlaskConical aria-hidden className="size-3.5" /> Demo mode: cached extraction
            </span>
          ) : rv.extraction?.mode === "manual" ? (
            <span className="t-label inline-flex h-7 items-center rounded-full bg-surface-2 px-3 text-muted-foreground">Entered by hand</span>
          ) : null}
        </div>
        {rv.rules.length > 0 ? (
          <>
            <Progress value={(decided / rv.rules.length) * 100} aria-label={`${decided} of ${rv.rules.length} rules decided`} />
            <p className="t-small text-muted-foreground">
              {decided} of {rv.rules.length} decided. Check each quote against its page, then confirm, edit or reject the rule. Nothing is used until you confirm the whole set.
            </p>
          </>
        ) : (
          <p className="t-small text-muted-foreground">Add each expense rule by hand, using the exact sentence from the agreement.</p>
        )}
      </div>

      <ul className="space-y-4">
        {rv.rules.map((rule) => (
          <li key={rule.id}>
            <RuleCard
              rule={rule}
              busy={busy === rule.id}
              error={errors[rule.id] ?? null}
              editing={editing === rule.id}
              onEdit={() => setEditing(rule.id)}
              onCancelEdit={() => setEditing(null)}
              onPatch={(body) => void patch(rule.id, body)}
              onOpenSource={(page, quote) => setSource({ agreementId: rv.agreementId, page, quote })}
            />
          </li>
        ))}
      </ul>

      {editing === "new" ? (
        <RuleEditor manual busy={busy === "new"} error={errors.new ?? null} onSubmit={(v) => void addManual(v)} onCancel={() => setEditing(null)} />
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="h-11" onClick={() => setEditing("new")}>
            <Plus aria-hidden /> Add a rule by hand
          </Button>
          <Button variant="ghost" className="h-11" onClick={() => setSource({ agreementId: rv.agreementId, page: 1 })}>
            Read the agreement
          </Button>
        </div>
      )}

      <div className="sticky bottom-4 z-10 in-data-[shell=app]:max-lg:bottom-[84px] rounded-[14px] border border-border bg-surface/95 p-4 shadow-[0_8px_24px_rgb(21_32_30/0.08)] backdrop-blur lg:bottom-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="t-small text-muted-foreground" aria-live="polite">
            {canActivate ? "All rules decided. Confirming makes them the rules every expense is checked against." : live.length === 0 && decided === rv.rules.length ? "Keep at least one rule." : `${rv.rules.length - decided} rule${rv.rules.length - decided === 1 ? "" : "s"} left to decide.`}
          </p>
          <Button className="h-11 px-5" disabled={!canActivate || activating} onClick={() => void activate()}>
            {activating ? "Confirming…" : activateLabel}
          </Button>
        </div>
        {activateError ? <p className="t-small mt-2 rounded-md bg-danger-bg px-3 py-2 text-danger">{activateError}</p> : null}
      </div>
      <SourceSheet target={source} onClose={() => setSource(null)} />
    </div>
  );
}

function RuleCard({
  rule,
  busy,
  error,
  editing,
  onEdit,
  onCancelEdit,
  onPatch,
  onOpenSource,
}: {
  rule: Rule;
  busy: boolean;
  error: string | null;
  editing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onPatch: (body: unknown) => void;
  onOpenSource: (page: number, quote: string) => void;
}) {
  const Cat = CATEGORY_META[rule.category].icon;
  const blocking = isBlocking(rule);
  const rejected = rule.reviewState === "REJECTED";
  const decided = rule.reviewState === "CONFIRMED" || rule.reviewState === "EDITED" || rejected;
  const issues = rule.issues ?? [];
  const confirmHint = `confirm-hint-${rule.id}`;

  return (
    <article aria-labelledby={`rule-${rule.id}`} className={cn("rounded-[14px] border bg-surface p-4 sm:p-5", blocking ? "border-review/40" : "border-border", rejected && "opacity-70")}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <h3 id={`rule-${rule.id}`} className="flex items-center gap-2 font-medium">
          <Cat aria-hidden className="size-[18px] text-muted-foreground" />
          <span>
            <span className="text-muted-foreground">{CATEGORY_META[rule.category].label}: </span>
            {rule.label}
          </span>
        </h3>
        <span className={cn("t-label inline-flex h-6 items-center rounded-full px-2.5", STATE[rule.reviewState].className)}>{STATE[rule.reviewState].label}</span>
      </header>

      <ClauseCard plain className="mt-3" quote={rule.quote} page={rule.page} match={rule.quoteMatch} onOpenSource={() => onOpenSource(rule.page, rule.quote)} />

      <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="What this rule says">
        {ruleFacts(rule).map((f) => (
          <li key={f} className="t-label inline-flex h-7 items-center rounded-md bg-surface-2 px-2.5 text-foreground">
            {f}
          </li>
        ))}
      </ul>

      {rule.supportingQuotes?.length ? (
        <details className="group mt-3">
          <summary className="t-small inline-flex min-h-9 cursor-pointer items-center text-primary underline-offset-4 hover:underline">Where the deadlines come from</summary>
          <div className="mt-2 space-y-2">
            {rule.supportingQuotes.map((s) => (
              <ClauseCard key={s.field} plain quote={s.quote} page={s.page} match={s.quoteMatch} onOpenSource={() => onOpenSource(s.page, s.quote)} />
            ))}
          </div>
        </details>
      ) : null}

      {issues.length > 0 && !rejected ? (
        <ul className="mt-3 space-y-1.5">
          {issues.map((i) => (
            <li key={i} className={cn("t-small flex gap-2 rounded-md px-3 py-2", ISSUE_META[i].blocking ? "bg-review-bg text-review" : "bg-approval-bg text-approval")}>
              {ISSUE_META[i].blocking ? <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" /> : <Info aria-hidden className="mt-0.5 size-4 shrink-0" />}
              <span>
                <span className="font-medium">{ISSUE_META[i].short}.</span> {i === "vague_terms" && rule.vagueTerms?.length ? `"${rule.vagueTerms.join('", "')}" can mean different things. Decide together what it covers.` : ISSUE_TEXT[i]}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {rule.editedFrom && rule.reviewState === "EDITED" ? <p className="t-small mt-3 text-muted-foreground">You changed this rule. The values read from the agreement are kept in its history.</p> : null}

      {editing ? (
        <div className="mt-4">
          <RuleEditor
            rule={rule}
            busy={busy}
            error={error}
            onCancel={onCancelEdit}
            onSubmit={(v) =>
              onPatch({
                action: "edit",
                changes: { label: v.label, owedPct: v.owedPct, sharesNonNumeric: false, approval: v.approval, receiptDeadlineDays: v.receiptDeadlineDays, reimburseWithinDays: v.reimburseWithinDays, childNames: v.childNames },
              })
            }
          />
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          <div className="flex flex-wrap gap-2">
            {decided ? (
              <Button variant="ghost" className="h-11" disabled={busy} onClick={() => onPatch({ action: "undo" })}>
                <Undo2 aria-hidden /> Undo
              </Button>
            ) : (
              <>
                <Button className="h-11" disabled={busy || blocking} aria-describedby={blocking ? confirmHint : undefined} onClick={() => onPatch({ action: "confirm" })}>
                  <Check aria-hidden /> Confirm
                </Button>
                <Button variant="outline" className="h-11" disabled={busy || rule.quoteMatch === "none"} onClick={onEdit}>
                  <Pencil aria-hidden /> Edit
                </Button>
                <Button variant="ghost" className="h-11" disabled={busy} onClick={() => onPatch({ action: "reject" })}>
                  <X aria-hidden /> Reject
                </Button>
              </>
            )}
          </div>
          {blocking && !decided ? (
            <p id={confirmHint} className="t-small text-muted-foreground">
              {rule.quoteMatch === "none" ? "Confirm is off because this quote is not in the agreement. Reject it, or add the rule by hand with the real sentence." : "Confirm is off until the problem above is fixed. Edit the rule or reject it."}
            </p>
          ) : null}
          <div aria-live="polite">{error ? <p className="t-small rounded-md bg-danger-bg px-3 py-2 text-danger">{error}</p> : null}</div>
        </div>
      )}
    </article>
  );
}
