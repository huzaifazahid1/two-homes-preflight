"use client";

import { FileText } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/hooks/api";

// Opens a receipt through a fresh 5-minute URL (Section I.3). Never cached or stored.
// The tab is opened synchronously (popup blockers) and pointed at the URL once it arrives.
export function ReceiptViewButton({ receiptId, label = "View receipt", redirectOn401 = true }: { receiptId: string; label?: string; redirectOn401?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function open() {
    setBusy(true);
    setError(null);
    const tab = window.open("about:blank", "_blank");
    try {
      const r = await api<{ url: string }>(`/api/receipts/${receiptId}/url`, { redirectOn401 });
      if (tab) {
        tab.opener = null;
        tab.location.href = r.url;
      } else window.location.assign(r.url);
    } catch (e) {
      tab?.close();
      setError(errorMessage(e));
    }
    setBusy(false);
  }
  return (
    <span className="inline-flex flex-col gap-1">
      <Button type="button" variant="outline" className="h-11 px-4" onClick={() => void open()} disabled={busy}>
        <FileText aria-hidden /> {busy ? "Opening…" : label}
      </Button>
      <span aria-live="polite" className="t-small text-danger">{error}</span>
    </span>
  );
}
