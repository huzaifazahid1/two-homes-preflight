"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Seeded = { ownerEmail: string; ownerPassword: string; familyId: string };

export function DemoControls() {
  const router = useRouter();
  const [secret, setSecret] = useState("");
  const [coParent, setCoParent] = useState("");
  const [payTo, setPayTo] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [out, setOut] = useState<string | null>(null);
  const [seeded, setSeeded] = useState<Seeded | null>(null);

  async function post(path: string, body?: unknown) {
    setBusy(path);
    setOut(null);
    try {
      const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json", "x-dev-secret": secret }, body: body ? JSON.stringify(body) : undefined });
      const json = await res.json();
      if (!res.ok) throw new Error(`${json?.error?.message ?? "Failed"} (${json?.error?.requestId ?? res.status})`);
      return json;
    } catch (e) {
      setOut(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setBusy(null);
      router.refresh();
    }
  }

  return (
    <section aria-labelledby="ctl-h" className="space-y-4 rounded-[14px] border border-border bg-surface p-5">
      <h2 id="ctl-h" className="t-h3">Seed and reset</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="secret" label="DEV_SECRET" value={secret} onChange={setSecret} type="password" />
        <Field id="cop" label="Co-parent email (Sara)" value={coParent} onChange={setCoParent} type="email" />
        <Field id="payto" label="Owner PayPal sandbox email (optional)" value={payTo} onChange={setPayTo} type="email" />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          className="h-11"
          disabled={!secret || !coParent || Boolean(busy)}
          onClick={async () => {
            const r = await post("/api/dev/seed", { coParentEmail: coParent, ...(payTo ? { ownerPayPalEmail: payTo } : {}) });
            if (r) setSeeded(r.seeded);
          }}
        >
          {busy === "/api/dev/seed" ? "Seeding…" : "Seed demo family"}
        </Button>
        <Button variant="outline" className="h-11" disabled={!secret || Boolean(busy)} onClick={async () => { if (await post("/api/dev/reset")) setSeeded(null); }}>
          {busy === "/api/dev/reset" ? "Resetting…" : "Reset demo data"}
        </Button>
      </div>
      <div aria-live="polite">
        {seeded ? (
          <p className="t-small rounded-md bg-surface-2 px-3 py-2">
            Sign in as <span className="font-mono">{seeded.ownerEmail}</span> with password <span className="font-mono">{seeded.ownerPassword}</span>.
          </p>
        ) : null}
        {out ? <p className="t-small rounded-md bg-danger-bg px-3 py-2 text-danger">{out}</p> : null}
      </div>
    </section>
  );
}

function Field({ id, label, value, onChange, type }: { id: string; label: string; value: string; onChange: (v: string) => void; type: string }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      <Input id={id} type={type} className="h-11 text-base" value={value} onChange={(e) => onChange(e.target.value)} autoComplete="off" spellCheck={false} />
    </div>
  );
}
