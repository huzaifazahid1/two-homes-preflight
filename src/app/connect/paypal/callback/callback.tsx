"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorMessage } from "@/hooks/api";

// Return URL for Log in with PayPal. Sends code + state to the server once, then goes back to
// where the flow started. Cancel or failure saves nothing (PC-2, PC-3).
export function Callback() {
  const params = useSearchParams();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    const code = params.get("code") ?? undefined;
    const state = params.get("state") ?? "";
    const err = params.get("error") ?? (code ? undefined : "cancelled");
    api<{ status: "connected" | "cancelled"; returnTo: string }>("/api/paypal/connect/callback", {
      method: "POST",
      body: { state, ...(code ? { code } : {}), ...(err ? { error: err.slice(0, 200) } : {}) },
      redirectOn401: false,
    })
      .then((r) => router.replace(`${r.returnTo}?paypal=${r.status}`))
      .catch((e) => setError(errorMessage(e)));
  }, [params, router]);

  if (!error) {
    return (
      <div aria-busy className="space-y-3">
        <p className="font-medium">Connecting your PayPal account…</p>
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <h1 className="t-h2">PayPal was not connected</h1>
      <p role="alert" className="text-muted-foreground">
        {error} Nothing was saved.
      </p>
      <div className="flex flex-wrap gap-4 text-sm">
        <Link className="font-medium text-primary underline-offset-4 hover:underline" href="/onboarding">
          Back to setup
        </Link>
        <Link className="font-medium text-primary underline-offset-4 hover:underline" href="/app/settings">
          Go to settings
        </Link>
      </div>
      <p className="t-small text-muted-foreground">If you came from an invite link, open the link from your email again.</p>
    </div>
  );
}
