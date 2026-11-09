import type { Metadata } from "next";
import { Suspense } from "react";
import { Logo } from "@/components/layout/logo";
import { Skeleton } from "@/components/ui/skeleton";
import { PaymentLink } from "./payment-link";

export const metadata: Metadata = { title: "Payment request", robots: { index: false, follow: false }, referrer: "no-referrer" };

// Payment request by link (Section A.5.3 step 8, A.6.4, G.3): pay with PayPal (Family plan) or report an outside payment.
export default function PaymentPage() {
  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-2xl items-center px-4 py-3">
        <Logo href="/" />
      </header>
      <main className="mx-auto max-w-2xl px-4 pb-16 pt-2">
        <Suspense fallback={<Skeleton className="h-72 w-full" />}>
          <PaymentLink />
        </Suspense>
      </main>
    </div>
  );
}
