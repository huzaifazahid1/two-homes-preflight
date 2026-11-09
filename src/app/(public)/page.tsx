import Link from "next/link";
import { ClauseCard } from "@/components/domain/clause-card";
import { Money } from "@/components/domain/money";
import { VerdictBadge } from "@/components/domain/status-badge";
import { buttonVariants } from "@/components/ui/button";

const STEPS = [
  { title: "Upload the agreement", body: "AI pulls out the expense rules. Every rule keeps its exact quote and page, checked against the document, and you confirm each one." },
  { title: "Check before you buy", body: "Enter the planned expense. The rules engine, not AI, says whether it is covered and cites the clause." },
  { title: "Ask with one link", body: "The other parent opens the link, confirms a code from their email, and approves or declines. Nothing to install." },
  { title: "Match the receipt", body: "Snap the receipt. It is read, you confirm the numbers, and it is matched to the approval." },
  { title: "Settle through PayPal", body: "The other parent pays their share with PayPal and it is paid out to your connected PayPal account." },
];

export default function LandingPage() {
  return (
    <>
      <section className="mx-auto grid max-w-[1200px] gap-10 px-4 pb-16 pt-8 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:items-center lg:gap-16 lg:pt-16">
        <div className="max-w-xl">
          <h1 className="t-h1 sm:t-display text-balance">Check the agreement before you spend.</h1>
          <p className="mt-5 text-pretty text-[17px] leading-7 text-muted-foreground">
            Two Homes Preflight checks every child expense against your own parenting agreement before you spend, gets the other
            parent&apos;s approval with one link, and settles the share through PayPal.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/signup" className={buttonVariants({ className: "h-11 px-5 text-[15px]" })}>
              Create your family account
            </Link>
            <Link href="/pricing" className={buttonVariants({ variant: "outline", className: "h-11 px-5 text-[15px]" })}>
              See plans
            </Link>
          </div>
        </div>

        <div aria-label="Example preflight check" className="rounded-[14px] border border-border bg-surface-2 p-3 sm:p-4">
          <div className="rounded-[10px] border border-border bg-surface p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium">Soccer camp, Riverside FC</p>
                <p className="t-small text-muted-foreground">Mia, planned for Saturday</p>
              </div>
              <Money cents={35_000} className="text-lg" />
            </div>
            <div className="mt-4 flex items-center gap-3">
              <VerdictBadge verdict="NEEDS_APPROVAL" />
              <span className="t-small text-muted-foreground">Above the $200 approval threshold</span>
            </div>
          </div>
          <ClauseCard
            className="mt-3"
            quote="Extracurricular activities costing more than $200 require the prior written consent of both parents, which shall not be unreasonably withheld."
            page={4}
          >
            <span className="t-small text-muted-foreground">
              Sara&apos;s share at 50%: <Money cents={17_500} />
            </span>
          </ClauseCard>
          <p className="t-small mt-3 px-1 text-muted-foreground">Synthetic example. The verdict comes from your confirmed rules, never from AI.</p>
        </div>
      </section>

      <section className="border-t border-border bg-surface">
        <div className="mx-auto max-w-[1200px] px-4 py-14 sm:px-6">
          <h2 className="t-h2">From planned expense to settled share</h2>
          <ol className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-5">
            {STEPS.map((s, i) => (
              <li key={s.title} className="border-l-2 border-primary/25 pl-4">
                <span className="font-mono text-sm text-primary tabular-nums">{i + 1}</span>
                <h3 className="t-h3 mt-1">{s.title}</h3>
                <p className="t-small mt-2 text-muted-foreground">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto max-w-[1200px] px-4 py-14 sm:px-6">
        <div className="max-w-2xl">
          <h2 className="t-h2">What it is, and what it is not</h2>
          <p className="mt-4 text-muted-foreground">
            The app shows what your agreement text says, with the quote and page. It does not give legal advice or interpret the law.
            AI only reads documents and receipts; it never decides a verdict, approves anything or moves money. This build runs on the
            PayPal sandbox with synthetic families.
          </p>
        </div>
      </section>
    </>
  );
}
