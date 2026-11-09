"use client";

import { Copy, RefreshCw, Send } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { InviteStatusBadge } from "@/components/domain/status-badge";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/hooks/api";
import type { FamilyView } from "@/types/views";

type InviteResult = { link: string; expiresAt: string; email: { status: "sent" | "failed" } };

// Send / resend the co-parent invite. The copyable link is always shown after sending,
// so a failed email never blocks anything (ON-7). Used in onboarding and settings.
export function InvitePanel({ family, onSent }: { family: FamilyView; onSent?: () => void }) {
  const [status, setStatus] = useState(family.coParent.inviteStatus);
  const [result, setResult] = useState<InviteResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(resend: boolean) {
    setBusy(true);
    setError(null);
    try {
      const r = await api<InviteResult>(resend ? "/api/family/invite/resend" : "/api/family/invite", { method: "POST" });
      setResult(r);
      setStatus("sent");
      if (r.email.status === "sent") toast.success(`Invite sent to ${family.coParent.email}`);
      onSent?.();
    } catch (e) {
      setError(errorMessage(e));
    }
    setBusy(false);
  }

  async function copy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.link);
      toast.success("Link copied");
    } catch {
      toast.error("Could not copy. Select the link and copy it by hand.");
    }
  }

  return (
    <div className="space-y-4 rounded-[10px] border border-border bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-medium">{family.coParent.name}</p>
          <p className="t-small text-muted-foreground">{family.coParent.email}</p>
        </div>
        <InviteStatusBadge status={status} />
      </div>

      {result?.email.status === "failed" ? (
        <p role="alert" className="t-small rounded-md bg-approval-bg px-3 py-2 text-approval">
          The email did not go out. Copy the link below and send it to {family.coParent.name} yourself.
        </p>
      ) : null}

      {result ? (
        <div className="space-y-2">
          <label htmlFor="invite-link" className="t-label text-muted-foreground">
            Invite link (works for 7 days)
          </label>
          <div className="flex gap-2">
            <input id="invite-link" translate="no" readOnly value={result.link} onFocus={(e) => e.currentTarget.select()} className="h-11 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 font-mono text-sm" />
            <Button variant="outline" className="h-11" onClick={() => void copy()}>
              <Copy aria-hidden />
              Copy
            </Button>
          </div>
        </div>
      ) : null}

      <div aria-live="polite">{error ? <p className="t-small rounded-md bg-danger-bg px-3 py-2 text-danger">{error}</p> : null}</div>

      {status === "accepted" ? null : status === "not_sent" ? (
        <Button className="h-11" onClick={() => void send(false)} disabled={busy}>
          <Send aria-hidden />
          {busy ? "Sending…" : "Send invite"}
        </Button>
      ) : (
        <div className="space-y-1">
          <Button variant="outline" className="h-11" onClick={() => void send(true)} disabled={busy}>
            <RefreshCw aria-hidden />
            {busy ? "Sending…" : "Send a new invite link"}
          </Button>
          <p className="t-small text-muted-foreground">A new link replaces the old one, which stops working.</p>
        </div>
      )}
    </div>
  );
}
