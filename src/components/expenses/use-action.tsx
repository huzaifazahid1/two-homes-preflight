"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiError, errorMessage } from "@/hooks/api";

// One server action at a time per panel: busy flag, error text, and a server refresh on success.
// Offline submits show the retry message and keep the button usable (NW-1).
export function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run<T>(key: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<T | null> {
    if (busy) return null;
    setBusy(key);
    setError(null);
    try {
      const out = await api<T>(path, { method: init.method ?? "POST", body: init.body });
      router.refresh();
      return out;
    } catch (e) {
      setError(e instanceof ApiError && e.requestId ? `${errorMessage(e)} (ref ${e.requestId})` : errorMessage(e));
      if (e instanceof ApiError && e.status === 409) router.refresh();
      return null;
    } finally {
      setBusy(null);
    }
  }
  return { busy, error, setError, run, refresh: () => router.refresh() };
}

export function ActionError({ error }: { error: string | null }) {
  return <div aria-live="polite">{error ? <p className="t-small mt-3 rounded-md bg-danger-bg px-3 py-2 text-danger">{error}</p> : null}</div>;
}
