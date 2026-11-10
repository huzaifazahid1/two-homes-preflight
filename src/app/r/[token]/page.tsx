import type { Metadata } from "next";
import { Suspense } from "react";
import { Logo } from "@/components/layout/logo";
import { Skeleton } from "@/components/ui/skeleton";
import { InviteLink } from "./invite-link";

export const metadata: Metadata = { title: "Invitation", robots: { index: false, follow: false }, referrer: "no-referrer" };

// Co-parent invite (Section A.5.2). Guests have no Firebase session; the page talks to the link API.
export default function InvitePage() {
  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-2xl items-center px-4 py-3">
        <Logo href="/" />
      </header>
      <main id="main" tabIndex={-1} className="outline-none mx-auto max-w-2xl px-4 pb-16 pt-2">
        <Suspense fallback={<Skeleton className="h-72 w-full" />}>
          <InviteLink />
        </Suspense>
      </main>
    </div>
  );
}
