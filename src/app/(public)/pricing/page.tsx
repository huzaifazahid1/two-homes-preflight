import type { Metadata } from "next";
import Link from "next/link";
import { Check } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = { title: "Pricing" };

const FREE = [
  "One agreement, up to 3 extraction runs",
  "Preflight checks with the clause cited",
  "Approval links with an email code",
  "Receipts, claims, outstanding and overdue tracking",
  "10 AI receipt reads a month",
  "Settlement recorded when you are paid outside the app",
];
const FAMILY = [
  "Everything in Free",
  "Unlimited extraction runs and amendments",
  "Pay and get paid in the app through PayPal",
  "Processing fees covered up to $200 a month",
  "Automatic reminders before and after the due date",
  "Unlimited AI receipt reads",
];

export default function PricingPage() {
  return (
    <div className="mx-auto max-w-[1200px] px-4 py-10 sm:px-6 lg:py-16">
      <h1 className="t-h1">Plans</h1>
      <p className="mt-3 max-w-xl text-muted-foreground">
        The parent who sets up the family chooses the plan. The other parent never pays for the app.
      </p>
      <p className="t-small mt-2 text-muted-foreground">Illustrative sandbox pricing. No real payments are taken.</p>

      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <Plan name="Free" price="$0" note="Free for as long as you like" items={FREE} cta="Start free" />
        <Plan name="Family" price="$7.99" per="a month" note="14-day free trial, paid through PayPal" items={FAMILY} cta="Start with Family" featured />
      </div>
    </div>
  );
}

function Plan(props: { name: string; price: string; per?: string; note: string; items: string[]; cta: string; featured?: boolean }) {
  return (
    <section className={`rounded-[14px] border bg-surface p-6 ${props.featured ? "border-primary" : "border-border"}`}>
      <h2 className="t-h3">{props.name}</h2>
      <p className="mt-3">
        <span className="t-amount">{props.price}</span>
        {props.per ? <span className="ml-1 text-muted-foreground">{props.per}</span> : null}
      </p>
      <p className="t-small mt-1 text-muted-foreground">{props.note}</p>
      <ul className="mt-5 space-y-2.5">
        {props.items.map((i) => (
          <li key={i} className="flex gap-2.5">
            <Check aria-hidden className="mt-1 size-4 shrink-0 text-primary" />
            <span>{i}</span>
          </li>
        ))}
      </ul>
      <Link href="/signup" className={buttonVariants({ variant: props.featured ? "default" : "outline", className: "mt-6 h-11 w-full text-[15px]" })}>
        {props.cta}
      </Link>
    </section>
  );
}
