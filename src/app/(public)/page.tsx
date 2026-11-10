import { ArrowDown, ArrowRight } from "lucide-react";
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

const AI_READS = [
  "The expense rules in your agreement, each with its quote and page",
  "The store, date and total on a receipt",
];

const PEOPLE_DECIDE = [
  "Which rules count: you confirm every one, and a quote that is not in the document cannot be confirmed",
  "Whether an expense is covered: a fixed rules engine applies your confirmed rules",
  "Whether to approve: the other parent, with a code sent to their email",
  "When money moves: only after the other parent pays in PayPal",
];

const MONEY_PATH = [
  { who: "Sara pays her share", what: "with her PayPal account", cents: 14_000 },
  { who: "PayPal takes the payment", what: "for Two Homes Preflight", cents: null },
  { who: "Alex receives it", what: "in their connected PayPal account", cents: 14_000 },
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

        <figure aria-label="Example preflight check" className="rounded-[14px] border border-border bg-surface-2 p-3 sm:p-4">
          <div className="rounded-[10px] border border-border bg-surface p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium">Soccer camp, Riverside FC</p>
                <p className="t-small text-muted-foreground">Mia, planned for Saturday</p>
              </div>
              <Money cents={35_000} className="text-lg" />
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
              <VerdictBadge verdict="NEEDS_APPROVAL" />
              <span className="t-small text-muted-foreground">Above the $200 approval limit</span>
            </div>
          </div>
          <ClauseCard
            className="mt-3"
            quote="Extracurricular activities costing more than $200 require the prior written consent of both parents, which shall not be unreasonably withheld."
            page={4}
          >
            <span className="t-small text-muted-foreground">
              Sara&apos;s share at 40%: <Money cents={14_000} />
            </span>
          </ClauseCard>
          <figcaption className="t-small mt-3 px-1 text-muted-foreground">Synthetic example. The verdict comes from your confirmed rules, never from AI.</figcaption>
        </figure>
      </section>

      <section aria-labelledby="steps-h" className="border-y border-border bg-surface">
        <div className="mx-auto max-w-[1200px] px-4 py-14 sm:px-6">
          <h2 id="steps-h" className="t-h2">From planned expense to settled share</h2>
          <ol className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-5">
            {STEPS.map((s, i) => (
              <li key={s.title} className="border-l-2 border-primary/25 pl-4">
                <span className="font-mono text-sm text-primary tabular-nums" aria-hidden>{i + 1}</span>
                <h3 className="t-h3 mt-1">{s.title}</h3>
                <p className="t-small mt-2 text-muted-foreground">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section aria-labelledby="decide-h" className="mx-auto max-w-[1200px] px-4 py-14 sm:px-6">
        <h2 id="decide-h" className="t-h2 max-w-2xl text-balance">AI reads the paperwork. Your rules and the two of you decide.</h2>
        <div className="mt-8 grid gap-8 md:grid-cols-[1fr_1.4fr]">
          <div>
            <h3 className="t-h3">What AI reads</h3>
            <ul className="mt-3 space-y-2 text-muted-foreground">
              {AI_READS.map((t) => (
                <li key={t} className="border-l-2 border-border pl-3">{t}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="t-h3">What stays with you</h3>
            <ul className="mt-3 space-y-2 text-muted-foreground">
              {PEOPLE_DECIDE.map((t) => (
                <li key={t} className="border-l-2 border-primary/40 pl-3">{t}</li>
              ))}
            </ul>
          </div>
        </div>
        <p className="t-small mt-8 max-w-2xl text-muted-foreground">
          The app shows what your agreement text says, with the quote and page. It does not give legal advice or interpret the law.
        </p>
      </section>

      <section aria-labelledby="money-h" className="border-t border-border bg-surface">
        <div className="mx-auto max-w-[1200px] px-4 py-14 sm:px-6">
          <h2 id="money-h" className="t-h2">How the money moves</h2>
          <p className="mt-3 max-w-2xl text-muted-foreground">
            The parent who is owed receives exactly their share. Both payments run through PayPal, so nobody shares bank details.
          </p>
          <ol className="mt-8 flex flex-col gap-2 md:flex-row md:items-stretch md:gap-3">
            {MONEY_PATH.map((step, i) => (
              <li key={step.who} className="flex flex-1 flex-col gap-2 md:flex-row md:items-stretch md:gap-3">
                <div className="flex flex-1 items-center justify-between gap-4 rounded-[10px] border border-border bg-background p-4">
                  <div>
                    <p className="font-medium">{step.who}</p>
                    <p className="t-small text-muted-foreground">{step.what}</p>
                  </div>
                  {step.cents !== null ? <Money cents={step.cents} className="text-lg" /> : null}
                </div>
                {i < MONEY_PATH.length - 1 ? (
                  <span aria-hidden className="flex items-center justify-center text-muted-foreground">
                    <ArrowDown className="size-4 md:hidden" />
                    <ArrowRight className="hidden size-4 md:block" />
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
          <p className="t-small mt-6 max-w-2xl text-muted-foreground">
            On the Free plan you record payments made outside the app. The Family plan adds paying in the app, covers processing fees up to
            a monthly amount, and sends reminders before and after the due date.{" "}
            <Link href="/pricing" className="text-primary underline underline-offset-4 hover:text-primary-hover">Compare plans</Link>
          </p>
        </div>
      </section>

      <section aria-labelledby="cta-h" className="mx-auto max-w-[1200px] px-4 py-16 sm:px-6">
        <div className="flex flex-col gap-6 rounded-[14px] bg-primary px-6 py-10 text-primary-foreground sm:px-10 md:flex-row md:items-center md:justify-between">
          <div className="max-w-xl">
            <h2 id="cta-h" className="t-h2 text-balance">Start with the agreement you already have.</h2>
            <p className="mt-2 opacity-85">Upload it, confirm the rules, and check your next expense before you buy.</p>
          </div>
          <Link href="/signup" className={buttonVariants({ variant: "secondary", className: "h-11 shrink-0 px-5 text-[15px]" })}>
            Create your family account
          </Link>
        </div>
        <p className="t-small mt-4 text-muted-foreground">This build runs on the PayPal sandbox with synthetic families. No real money moves.</p>
      </section>
    </>
  );
}
