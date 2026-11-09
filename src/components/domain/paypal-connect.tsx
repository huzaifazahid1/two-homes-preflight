"use client";

import { AlertTriangle, CheckCircle2, Link2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError, errorMessage } from "@/hooks/api";
import type { Role } from "@/types/firestore";

// "Connect your PayPal account" (Section F.4). Log in with PayPal tells us which PayPal account
// receives payouts. It never signs anyone in. Fallback: type the PayPal email twice.

export type ConnectionView = { method: string; email: string; verifiedAccount: boolean | null } | null;

export function PayPalConnect({
  role,
  returnTo,
  token,
  connection,
  onConnected,
  notice,
}: {
  role: Role;
  returnTo: string;
  token?: string;
  connection: ConnectionView;
  onConnected?: (c: NonNullable<ConnectionView>) => void;
  /** Result from the callback page (?paypal=cancelled etc.). */
  notice?: "connected" | "cancelled" | "error" | null;
}) {
  const [mode, setMode] = useState<"choose" | "email">("choose");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [confirm, setConfirm] = useState("");
  const [confirmError, setConfirmError] = useState<string | null>(null);

  async function startLogin() {
    setBusy(true);
    setError(null);
    try {
      const q = new URLSearchParams({ for: role, returnTo, ...(token ? { token } : {}) });
      const { url } = await api<{ url: string }>(`/api/paypal/connect/start?${q.toString()}`);
      window.location.assign(url);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  async function saveEmail(e: React.FormEvent) {
    e.preventDefault();
    setConfirmError(null);
    setError(null);
    if (email.trim().toLowerCase() !== confirm.trim().toLowerCase()) return setConfirmError("The two emails do not match.");
    setBusy(true);
    try {
      await api("/api/paypal/connect/email", { method: "POST", body: { for: role, email: email.trim(), confirmEmail: confirm.trim(), ...(token ? { token } : {}) } });
      onConnected?.({ method: "email", email: email.trim().toLowerCase(), verifiedAccount: null });
      setMode("choose");
    } catch (err) {
      if (err instanceof ApiError) setConfirmError(err.fieldError("confirmEmail") ?? null);
      setError(errorMessage(err));
    }
    setBusy(false);
  }

  return (
    <div className="space-y-4">
      {notice === "cancelled" ? (
        <p role="status" className="t-small rounded-md bg-neutral-st-bg px-3 py-2 text-neutral-st">
          Not connected. You left PayPal before finishing, so nothing was saved.
        </p>
      ) : null}
      {notice === "error" ? (
        <p role="alert" className="t-small rounded-md bg-danger-bg px-3 py-2 text-danger">
          PayPal could not be connected. Nothing was saved. Please try again.
        </p>
      ) : null}

      {connection ? (
        <div className="flex gap-3 rounded-[10px] border border-border bg-surface p-4">
          <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0 text-eligible" />
          <div className="min-w-0">
            <p className="font-medium">
              Connected as <span className="break-all">{connection.email}</span>
            </p>
            <p className="t-small text-muted-foreground">
              {connection.method === "login_with_paypal"
                ? connection.verifiedAccount
                  ? "Verified PayPal account, connected with PayPal."
                  : "Connected with PayPal."
                : "Connected by email. If this email has no PayPal account, the payout will wait until you claim it."}
            </p>
            {connection.method === "login_with_paypal" && connection.verifiedAccount === false ? (
              <p className="t-small mt-2 flex gap-1.5 text-approval">
                <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
                This PayPal account is not verified. PayPal may hold payouts until it is.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {mode === "choose" ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button className="h-11 text-[15px]" onClick={() => void startLogin()} disabled={busy}>
            <Link2 aria-hidden />
            {busy ? "Opening PayPal…" : connection ? "Reconnect with PayPal" : "Connect with PayPal"}
          </Button>
          <Button variant="link" className="h-11 justify-start px-0 sm:px-2" onClick={() => setMode("email")}>
            Use my PayPal email instead
          </Button>
        </div>
      ) : (
        <form onSubmit={saveEmail} className="max-w-md space-y-3 rounded-[10px] border border-border bg-surface p-4" noValidate>
          <p className="t-small text-muted-foreground">If this email has no PayPal account, the payout will wait until you claim it.</p>
          <div className="space-y-1.5">
            <Label htmlFor="pp-email">PayPal email</Label>
            <Input id="pp-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="h-11" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pp-confirm">Type it again</Label>
            <Input
              id="pp-confirm"
              type="email"
              autoComplete="off"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="h-11"
              aria-invalid={confirmError ? true : undefined}
              aria-describedby={confirmError ? "pp-confirm-err" : undefined}
              onPaste={(e) => e.preventDefault()}
            />
            {confirmError ? (
              <p id="pp-confirm-err" className="t-small text-danger">
                {confirmError}
              </p>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button type="submit" className="h-11" disabled={busy}>
              {busy ? "Saving…" : "Save PayPal email"}
            </Button>
            <Button type="button" variant="ghost" className="h-11" onClick={() => setMode("choose")}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      <div aria-live="polite">{error && mode === "choose" ? <p className="t-small rounded-md bg-danger-bg px-3 py-2 text-danger">{error}</p> : null}</div>
    </div>
  );
}
