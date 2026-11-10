"use client";

import { usePayPalScriptReducer } from "@paypal/react-paypal-js";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

// Wraps PayPal Buttons inside a PayPalScriptProvider: keeps the space while the SDK loads (no
// layout jump) and shows a real error when the script cannot load (rule 5), instead of a
// skeleton that never ends.
export function PayPalFrame({ children, className = "min-h-[110px]" }: { children: React.ReactNode; className?: string }) {
  const [{ isPending, isRejected }] = usePayPalScriptReducer();
  if (isRejected) {
    return (
      <div role="alert" className="space-y-3 rounded-md bg-danger-bg px-3 py-3 text-danger">
        <p className="t-small flex gap-2">
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
          PayPal could not load in this browser. Nothing was charged. Check the connection or turn off content blockers for this page, then try again.
        </p>
        <Button variant="outline" className="h-11" onClick={() => window.location.reload()}>
          Reload the page
        </Button>
      </div>
    );
  }
  return (
    <div className={`relative ${className}`} aria-busy={isPending || undefined}>
      {isPending ? <Skeleton className="absolute inset-x-0 top-0 h-12" aria-hidden /> : null}
      <div className="relative">{children}</div>
    </div>
  );
}
