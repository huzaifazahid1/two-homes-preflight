"use client";

import { PendingLabel } from "@/components/domain/pending-label";
import { CheckCircle2, Clock3, LinkIcon } from "lucide-react";
import { useState } from "react";
import { OtpInput } from "@/components/domain/otp-input";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/hooks/api";

// Shared by the link pages (/r, /a, /p): ask for the email code, enter it, get a 30-minute session.
// The code always goes to the address the link was sent to, never to one typed here (LK-8).

export function LinkVerify({ token, sentTo, purpose, onVerified }: { token: string; sentTo: string; purpose: string; onVerified: () => Promise<void> | void }) {
  const [sent, setSent] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ sentTo: string }>(`/api/links/${token}/otp`, { method: "POST", redirectOn401: false });
      setSent(r.sentTo);
      setCode("");
    } catch (e) {
      setError(errorMessage(e));
    }
    setBusy(false);
  }

  async function verify(value: string) {
    if (value.length !== 6) return setError("Enter the 6-digit code.");
    setBusy(true);
    setError(null);
    try {
      await api(`/api/links/${token}/otp/verify`, { method: "POST", body: { code: value }, redirectOn401: false });
      await onVerified();
    } catch (e) {
      setError(errorMessage(e));
      setCode("");
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="verify-h" className="rounded-[14px] border border-border bg-surface p-5">
      <h2 id="verify-h" className="t-h3">Confirm it is you</h2>
      {!sent ? (
        <>
          <p className="mt-2 text-muted-foreground">To {purpose}, we will email a 6-digit code to {sentTo}, the address this link was sent to.</p>
          <div aria-live="polite" className="mt-3">{error ? <p className="t-small rounded-md bg-danger-bg px-3 py-2 text-danger">{error}</p> : null}</div>
          <Button className="mt-3 h-11 w-full text-[15px] sm:w-auto" onClick={() => void send()} disabled={busy}>
            <PendingLabel pending={busy} busy="Sending…" idle="Email me a code" />
          </Button>
        </>
      ) : (
        <form
          className="mt-2 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void verify(code);
          }}
        >
          <p className="text-muted-foreground">We sent a code to {sent}. It expires in 10 minutes.</p>
          <label htmlFor="otp" className="t-label block">One-time code</label>
          <OtpInput value={code} onChange={setCode} onComplete={(v) => void verify(v)} disabled={busy} invalid={Boolean(error)} />
          <div aria-live="polite">{error ? <p className="t-small rounded-md bg-danger-bg px-3 py-2 text-danger">{error}</p> : null}</div>
          <div className="flex flex-wrap gap-3">
            <Button type="submit" className="h-11 text-[15px]" disabled={busy}>
              <PendingLabel pending={busy} busy="Checking…" idle="Confirm code" />
            </Button>
            <Button type="button" variant="ghost" className="h-11" onClick={() => void send()} disabled={busy}>
              Send a new code
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

export function LinkMessage({ title, body, action, icon }: { title: string; body: string; action?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="space-y-3 py-8">
      {icon ?? <LinkIcon aria-hidden className="size-10 text-muted-foreground" />}
      <h1 className="t-h1 text-balance">{title}</h1>
      <p className="text-muted-foreground">{body}</p>
      {action}
    </div>
  );
}

export function LinkGone({ reason, what }: { reason: string; what: "request" | "payment request" }) {
  const body =
    reason === "used"
      ? `This ${what} was already answered. Nothing else to do here.`
      : reason === "revoked"
        ? `This link was replaced by a newer email, or the ${what} was cancelled. Use the most recent email.`
        : `This link has expired. Ask the other parent to send a new one.`;
  return (
    <LinkMessage
      icon={reason === "used" ? <CheckCircle2 className="size-10 text-eligible" aria-hidden /> : <Clock3 className="size-10 text-muted-foreground" aria-hidden />}
      title="This link no longer works"
      body={body}
    />
  );
}
