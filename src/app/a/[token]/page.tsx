import type { Metadata } from "next";
import { Suspense } from "react";
import { Logo } from "@/components/layout/logo";
import { Skeleton } from "@/components/ui/skeleton";
import { ApprovalLink } from "./approval-link";

export const metadata: Metadata = { title: "Approval request", robots: { index: false, follow: false }, referrer: "no-referrer" };

// Approval decision by link (Section A.5.3 step 4, F.3). No install, no account: email code only.
export default function ApprovalPage() {
  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-2xl items-center px-4 py-3">
        <Logo href="/" />
      </header>
      <main id="main" tabIndex={-1} className="outline-none mx-auto max-w-2xl px-4 pb-16 pt-2">
        <Suspense fallback={<Skeleton className="h-72 w-full" />}>
          <ApprovalLink />
        </Suspense>
      </main>
    </div>
  );
}
