import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { InviteStatusBadge } from "@/components/domain/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { requireOnboarded } from "@/lib/data/me";

export const metadata: Metadata = { title: "Home" };

export default function HomePage() {
  return (
    <Suspense fallback={<HomeSkeleton />}>
      <Home />
    </Suspense>
  );
}

async function Home() {
  const me = await requireOnboarded("/app");
  const f = me.family;
  const first = me.displayName.split(" ")[0];
  return (
    <div className="space-y-8">
      <h1 className="t-h1">Hi {first}</h1>

      <section aria-labelledby="action-h" className="space-y-3">
        <h2 id="action-h" className="t-h3">Needs your action</h2>
        <div className="rounded-[10px] border border-dashed border-border bg-surface p-5">
          <p className="font-medium">Nothing to do right now</p>
          <p className="t-small mt-1 text-muted-foreground">
            Expenses, approvals and payment requests will show up here. Preflight checks arrive with agreement upload in the next part of this build.
          </p>
        </div>
      </section>

      <section aria-labelledby="family-h" className="grid gap-4 md:grid-cols-2">
        <h2 id="family-h" className="sr-only">Your family</h2>
        <div className="rounded-[10px] border border-border bg-surface p-5">
          <p className="t-label text-muted-foreground">Other parent</p>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">{f.coParent.name}</p>
            <InviteStatusBadge status={f.coParent.inviteStatus} />
          </div>
          {f.coParent.inviteStatus !== "accepted" ? (
            <Link href="/app/settings#coparent" className="t-small mt-3 inline-flex min-h-11 items-center font-medium text-primary underline-offset-4 hover:underline">
              Manage the invite
            </Link>
          ) : null}
        </div>
        <div className="rounded-[10px] border border-border bg-surface p-5">
          <p className="t-label text-muted-foreground">Your PayPal for payouts</p>
          {f.payout.owner ? (
            <p className="mt-2 break-all font-medium">{f.payout.owner.email}</p>
          ) : (
            <p className="mt-2 text-muted-foreground">Not connected</p>
          )}
          <Link href="/app/settings#paypal" className="t-small mt-3 inline-flex min-h-11 items-center font-medium text-primary underline-offset-4 hover:underline">
            PayPal settings
          </Link>
        </div>
        <div className="rounded-[10px] border border-border bg-surface p-5 md:col-span-2">
          <p className="t-label text-muted-foreground">Children</p>
          <p className="mt-2">{f.children.map((c) => c.firstName).join(", ")}</p>
        </div>
      </section>
    </div>
  );
}

function HomeSkeleton() {
  return (
    <div className="space-y-6" aria-busy>
      <Skeleton className="h-9 w-40" />
      <Skeleton className="h-28 w-full" />
      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
      </div>
    </div>
  );
}
