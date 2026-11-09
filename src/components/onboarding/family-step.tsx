"use client";

import { Plus, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError, errorMessage } from "@/hooks/api";
import type { Child } from "@/types/firestore";
import { FormError, StepHeader, StickyAction, useCompleteStep, type StepProps } from "./shared";

export function FamilyStep({ me }: StepProps) {
  const family = me.family;
  const [children, setChildren] = useState<Child[]>(family?.children ?? []);
  const [childName, setChildName] = useState("");
  const [birthYear, setBirthYear] = useState("");
  const [childBusy, setChildBusy] = useState(false);
  const [childError, setChildError] = useState<string | null>(null);
  const [cpName, setCpName] = useState(family?.coParent.name ?? "");
  const [cpEmail, setCpEmail] = useState(family?.coParent.email ?? "");
  const [emailError, setEmailError] = useState<string | null>(null);
  const { complete, busy, error, setError } = useCompleteStep("family");
  const accepted = family?.coParent.inviteStatus === "accepted";

  async function addChild(e: React.FormEvent) {
    e.preventDefault();
    if (!childName.trim()) return setChildError("Enter the child's first name.");
    const year = birthYear ? Number(birthYear) : undefined;
    setChildBusy(true);
    setChildError(null);
    try {
      const { child } = await api<{ child: Child }>("/api/family/children", { method: "POST", body: { firstName: childName.trim(), ...(year ? { birthYear: year } : {}) } });
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
