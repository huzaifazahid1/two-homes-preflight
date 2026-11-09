"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useTheme } from "next-themes";
import { useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { PayPalConnect, type ConnectionView } from "@/components/domain/paypal-connect";
import { SignOutButton } from "@/components/layout/sign-out-button";
import { InvitePanel } from "@/components/onboarding/invite-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, errorMessage } from "@/hooks/api";
import type { MeView } from "@/types/views";

export function SettingsView({ me }: { me: MeView }) {
  const params = useSearchParams();
  const f = me.family!;
  const initial = f.payout.owner;
  const [conn, setConn] = useState<ConnectionView>(initial ? { method: initial.method, email: initial.email, verifiedAccount: initial.verifiedAccount } : null);

  return (
    <div className="max-w-2xl space-y-10">
      <h1 className="t-h1">Settings</h1>
      <Profile me={me} />

      <Section id="paypal" title="PayPal for payouts" description="Money the other parent owes you is paid out to this PayPal account.">
        <PayPalConnect role="owner" returnTo="/app/settings" connection={conn} onConnected={setConn} notice={params.get("paypal") as "connected" | "cancelled" | "error" | null} />
        {conn ? <Disconnect onDone={() => setConn(null)} /> : null}
      </Section>

      <Section id="coparent" title="The other parent" description="They act through secure email links and do not need an account.">
        <InvitePanel family={f} />
      </Section>

      <Prefs me={me} />
      <Theme />

      <Section id="account" title="Account">
        <SignOutButton />
      </Section>
    </div>
  );
}

function Section({ id, title, description, children }: { id: string; title: string; description?: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-20 space-y-3">
      <div>
        <h2 id={`${id}-h`} className="t-h3">{title}</h2>
        {description ? <p className="t-small mt-1 text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Profile({ me }: { me: MeView }) {
  const [name, setName] = useState(me.displayName);
  const [busy, setBusy] = useState(false);
  return (
    <Section id="profile" title="Profile">
      <form
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await api("/api/me", { method: "PATCH", body: { displayName: name.trim() } });
            toast.success("Name saved");
          } catch (err) {
            toast.error(errorMessage(err));
          }
          setBusy(false);
        }}
      >
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="name">Your name</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className="h-11" />
        </div>
        <Button type="submit" variant="outline" className="h-11" disabled={busy || !name.trim() || name.trim() === me.displayName}>
          Save name
        </Button>
      </form>
      <p className="t-small text-muted-foreground">Signed in as {me.email}</p>
    </Section>
  );
}

function Disconnect({ onDone }: { onDone: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!confirming)
    return (
      <Button variant="ghost" className="h-11 px-2 text-danger" onClick={() => setConfirming(true)}>
        Disconnect PayPal
      </Button>
    );
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md bg-danger-bg p-3">
      <p className="t-small flex-1 text-danger">Payouts to you will wait until you connect again.</p>
      <Button
        variant="destructive"
        className="h-11"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await api("/api/paypal/connect", { method: "DELETE" });
            toast.success("PayPal disconnected");
            onDone();
          } catch (e) {
            toast.error(errorMessage(e));
          }
          setBusy(false);
          setConfirming(false);
        }}
      >
        Disconnect
      </Button>
      <Button variant="ghost" className="h-11" onClick={() => setConfirming(false)}>
        Keep connected
      </Button>
    </div>
  );
}

const noopSubscribe = () => () => {};

const PREFS = [
  { key: "approvals", label: "Approval decisions" },
  { key: "payments", label: "Payments and payouts" },
  { key: "reminders", label: "Reminders" },
] as const;

function Prefs({ me }: { me: MeView }) {
  const [prefs, setPrefs] = useState(me.notificationPrefs);
  async function toggle(key: (typeof PREFS)[number]["key"], value: boolean) {
    const prev = prefs;
    setPrefs({ ...prefs, [key]: value });
    try {
      await api("/api/me", { method: "PATCH", body: { notificationPrefs: { [key]: value } } });
    } catch (e) {
      setPrefs(prev);
      toast.error(errorMessage(e));
    }
  }
  return (
    <Section id="notifications" title="Email notifications" description="Codes, invites and approval requests are always sent, because the app needs them to work.">
      <ul className="divide-y divide-border rounded-[10px] border border-border bg-surface">
        {PREFS.map((p) => (
          <li key={p.key}>
            <label className="flex min-h-12 cursor-pointer items-center justify-between gap-3 px-4">
              <span>{p.label}</span>
              <input type="checkbox" className="size-5 accent-[var(--primary)]" checked={prefs[p.key]} onChange={(e) => void toggle(p.key, e.target.checked)} />
            </label>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Theme() {
  const { theme, setTheme } = useTheme();
  // next-themes only knows the theme on the client; false during SSR avoids a hydration mismatch.
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const options = [
    { id: "system", label: "System", icon: Monitor },
    { id: "light", label: "Light", icon: Sun },
    { id: "dark", label: "Dark", icon: Moon },
  ] as const;
  return (
    <Section id="theme" title="Appearance">
      <div role="radiogroup" aria-label="Theme" className="inline-flex rounded-lg border border-border bg-surface p-1">
        {options.map((o) => {
          const active = mounted && theme === o.id;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => {
                setTheme(o.id);
                api("/api/me", { method: "PATCH", body: { theme: o.id } }).catch((e: unknown) => console.warn("theme: save failed", e));
              }}
              className={`flex min-h-10 items-center gap-2 rounded-md px-3 text-sm ${active ? "bg-primary-soft font-medium text-primary" : "text-muted-foreground"}`}
            >
              <o.icon aria-hidden className="size-4" />
              {o.label}
            </button>
          );
        })}
      </div>
    </Section>
  );
}
