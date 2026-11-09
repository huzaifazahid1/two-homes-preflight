"use client";

import { Plus, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError, errorMessage } from "@/hooks/api";
import { ClauseCard } from "@/components/domain/clause-card";
import type { Child, ExtractedParties } from "@/types/firestore";
import { FormError, StepHeader, StickyAction, useCompleteStep, type StepProps } from "./shared";

function sameName(a: string, b: string) {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function FamilyStep({ me, parties }: StepProps & { parties: ExtractedParties | null }) {
  const family = me.family;
  // ON-5: names found in the agreement (each with its verified quote) prefill this step.
  const ownerFirst = me.displayName.split(" ")[0] ?? "";
  const suggestedCoParent = parties?.parents.find((p) => !sameName(p.value, me.displayName) && !sameName(p.value.split(" ")[0], ownerFirst)) ?? null;
  const [children, setChildren] = useState<Child[]>(family?.children ?? []);
  const [childName, setChildName] = useState("");
  const [birthYear, setBirthYear] = useState("");
  const [childBusy, setChildBusy] = useState(false);
  const [childError, setChildError] = useState<string | null>(null);
  const [cpName, setCpName] = useState(family?.coParent.name || suggestedCoParent?.value || "");
  const [cpEmail, setCpEmail] = useState(family?.coParent.email ?? "");
  const [emailError, setEmailError] = useState<string | null>(null);
  const { complete, busy, error, setError } = useCompleteStep("family");
  const accepted = family?.coParent.inviteStatus === "accepted";

  async function addChild(e: React.FormEvent | null, preset?: { firstName: string; birthYear?: number }) {
    e?.preventDefault();
    const name = preset?.firstName ?? childName.trim();
    if (!name) return setChildError("Enter the child's first name.");
    const year = preset ? preset.birthYear : birthYear ? Number(birthYear) : undefined;
    setChildBusy(true);
    setChildError(null);
    try {
      const { child } = await api<{ child: Child }>("/api/family/children", { method: "POST", body: { firstName: name, ...(year ? { birthYear: year } : {}) } });
      setChildren((c) => [...c, child]);
      setChildName("");
      setBirthYear("");
    } catch (err) {
      setChildError(errorMessage(err));
    }
    setChildBusy(false);
  }

  async function removeChild(id: string) {
    try {
      await api(`/api/family/children/${id}`, { method: "DELETE" });
      setChildren((c) => c.filter((x) => x.id !== id));
    } catch (err) {
      setChildError(errorMessage(err));
    }
  }

  async function save() {
    setEmailError(null);
    setError(null);
    if (children.length === 0) return setError("Add at least one child.");
    if (!cpName.trim() || !cpEmail.trim()) return setError("Add the other parent's name and email.");
    try {
      if (!accepted) await api("/api/family", { method: "POST", body: { coParent: { name: cpName.trim(), email: cpEmail.trim() } } });
    } catch (err) {
      if (err instanceof ApiError) setEmailError(err.fieldError("email") ?? null);
      return setError(errorMessage(err));
    }
    await complete();
  }

  return (
    <div className="space-y-8">
      <StepHeader title="Your family">Children are profiles only, never users. A first name is enough.</StepHeader>

      {parties && (parties.children.length > 0 || suggestedCoParent) ? (
        <section aria-labelledby="found-h" className="space-y-3 rounded-[14px] border border-primary/25 bg-primary-soft/50 p-4">
          <h2 id="found-h" className="font-medium">Found in your agreement</h2>
          <p className="t-small text-muted-foreground">We filled in what the agreement says. Check it and change anything that is wrong.</p>
          {parties.children
            .filter((c) => !children.some((x) => sameName(x.firstName, c.value.firstName)))
            .map((c) => (
              <ClauseCard key={c.value.firstName} quote={c.quote} page={c.page} match={c.quoteMatch} title={`${c.value.firstName}${c.value.birthYear ? `, born ${c.value.birthYear}` : ""}`}>
                <Button type="button" variant="outline" className="h-9" disabled={childBusy} onClick={() => void addChild(null, c.value)}>
                  <Plus aria-hidden /> Add {c.value.firstName}
                </Button>
              </ClauseCard>
            ))}
          {suggestedCoParent ? <ClauseCard quote={suggestedCoParent.quote} page={suggestedCoParent.page} match={suggestedCoParent.quoteMatch} title={`Other parent: ${suggestedCoParent.value}`} /> : null}
        </section>
      ) : null}

      <section aria-labelledby="children-h" className="space-y-3">
        <h2 id="children-h" className="t-h3">Children</h2>
        {children.length > 0 ? (
          <ul className="divide-y divide-border rounded-[10px] border border-border bg-surface">
            {children.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-2">
                <span>
                  {c.firstName}
                  {c.birthYear ? <span className="t-small ml-2 text-muted-foreground">born {c.birthYear}</span> : null}
                </span>
                <Button variant="ghost" size="icon" className="size-11" aria-label={`Remove ${c.firstName}`} onClick={() => void removeChild(c.id)}>
                  <X aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="t-small text-muted-foreground">No children added yet.</p>
        )}
        <form onSubmit={addChild} className="grid gap-3 sm:grid-cols-[1fr_140px_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="childName">First name</Label>
            <Input id="childName" value={childName} onChange={(e) => setChildName(e.target.value)} maxLength={40} className="h-11" autoComplete="off" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="birthYear">Birth year (optional)</Label>
            <Input id="birthYear" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} value={birthYear} onChange={(e) => setBirthYear(e.target.value.replace(/\D/g, ""))} className="h-11" />
          </div>
          <Button type="submit" variant="outline" className="h-11" disabled={childBusy}>
            <Plus aria-hidden />
            Add child
          </Button>
        </form>
        <FormError error={childError} />
      </section>

      <section aria-labelledby="cp-h" className="max-w-md space-y-3">
        <h2 id="cp-h" className="t-h3">The other parent</h2>
        <p className="t-small text-muted-foreground">They get an invite by email and act through secure links. They do not need an account.</p>
        <div className="space-y-1.5">
          <Label htmlFor="cpName">Name</Label>
          <Input id="cpName" value={cpName} onChange={(e) => setCpName(e.target.value)} maxLength={60} className="h-11" disabled={accepted} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cpEmail">Email</Label>
          <Input
            id="cpEmail"
            type="email"
            autoComplete="off"
            value={cpEmail}
            onChange={(e) => setCpEmail(e.target.value)}
            className="h-11"
            disabled={accepted}
            aria-invalid={emailError ? true : undefined}
            aria-describedby={emailError ? "cpEmail-err" : undefined}
          />
          {emailError ? (
            <p id="cpEmail-err" className="t-small text-danger">
              {emailError}
            </p>
          ) : null}
        </div>
      </section>

      <FormError error={error} />
      <StickyAction onClick={() => void save()} disabled={busy}>
        {busy ? "Saving…" : "Save and continue"}
      </StickyAction>
    </div>
  );
}
