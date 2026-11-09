import type { Metadata } from "next";
import { ArrowLeft, Info } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Money } from "@/components/domain/money";
import { ApprovalStatusBadge, SettlementStatusBadge } from "@/components/domain/status-badge";
import { CATEGORY_META } from "@/components/domain/status-meta";
import { Timeline } from "@/components/domain/timeline";
import { ApprovalStep } from "@/components/expenses/approval-step";
import { ClaimStep, ReceiptStep } from "@/components/expenses/claim-step";
import { ExpenseActions, ExpenseVerdict } from "@/components/expenses/expense-detail-client";
import { LiveRefresh } from "@/components/live/live-refresh";
import { ExpenseList, formatDay } from "@/components/expenses/expense-list";
import { Skeleton } from "@/components/ui/skeleton";
import { familyContext, getExpense, listExpenses } from "@/lib/data/family";
import { requireOnboarded } from "@/lib/data/me";
import { isAppError } from "@/lib/errors";

export const metadata: Metadata = { title: "Expense" };

export default function ExpensePage({ params }: PageProps<"/app/expenses/[id]">) {
  return (
    <Suspense fallback={<DetailSkeleton />}>
      <Detail params={params} />
    </Suspense>
  );
}

function first(n: string) {
  return n.split(" ")[0] || n;
}

async function Detail({ params }: { params: PageProps<"/app/expenses/[id]">["params"] }) {
  const { id } = await params;
  await requireOnboarded(`/app/expenses/${id}`);
  const ctx = await familyContext(`/app/expenses/${id}`);
  let detail;
  try {
    detail = await getExpense(ctx, id);
  } catch (err) {
    if (isAppError(err) && (err.code === "NOT_FOUND" || err.code === "FORBIDDEN")) notFound();
    throw err;
  }
  const { items } = await listExpenses(ctx, { limit: 30 });
  const e = detail.expense;
  const f = ctx.family;
  const names = { owner: first(f.owner.name), coparent: first(f.coParent.name || "Other parent") };
  const buyer = names[e.paidByRole];
  const owed = names[e.owedByRole];
  const Cat = CATEGORY_META[e.category].icon;
  const day = formatDay(e.date);
  const blocked = e.verdict.code === "NOT_COVERED" || e.verdict.code === "NEEDS_REVIEW";
  const me = detail.me;
  const tz = ctx.userDoc.timeZone || "UTC";
  const isBuyer = e.paidByRole === me;

  return (
    <div className="xl:grid xl:grid-cols-[340px_minmax(0,1fr)] xl:gap-8">
      <aside aria-label="All expenses" className="hidden xl:block">
        <div className="sticky top-20 max-h-[calc(100dvh-6rem)] overflow-y-auto">
          <ExpenseList items={items} activeId={e.id} compact />
        </div>
      </aside>

      <article className="space-y-8">
        <LiveRefresh target={{ kind: "expense", id: e.id }} />
        <div className="space-y-4">
          <Link href="/app/expenses" className="t-small -ml-1 inline-flex min-h-11 items-center gap-1 px-1 text-muted-foreground hover:text-foreground xl:hidden">
            <ArrowLeft aria-hidden className="size-4" /> Expenses
          </Link>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="t-small flex items-center gap-1.5 text-muted-foreground">
                <Cat aria-hidden className="size-4" />
                {CATEGORY_META[e.category].label} for {e.childName}
              </p>
              <h1 className={`t-h1 mt-1 text-balance ${e.settlement.state === "CANCELLED" ? "text-muted-foreground line-through" : ""}`}>{e.description}</h1>
              <p className="mt-1 text-muted-foreground">
                {e.mode === "purchased" ? `Bought by ${buyer}` : `${buyer} plans to buy it`}
                {e.vendor ? ` at ${e.vendor}` : ""}
                {day ? `, ${day}` : ""}
              </p>
            </div>
            <Money cents={e.amountCents} size="big" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {e.settlement.state === "CANCELLED" ? <span className="t-label inline-flex h-6 items-center rounded-full bg-neutral-st-bg px-2.5 text-neutral-st">Cancelled</span> : <ApprovalStatusBadge state={e.approval.state} />}
            {e.settlement.state !== "NONE" && e.settlement.state !== "CANCELLED" ? <SettlementStatusBadge state={e.settlement.state} overdue={e.settlement.overdue} dueSoon={e.settlement.dueSoon} /> : null}
            {e.possibleDuplicateOf ? (
              <Link href={`/app/expenses/${e.possibleDuplicateOf}`} className="t-label inline-flex h-6 items-center rounded-full bg-approval-bg px-2.5 text-approval underline-offset-2 hover:underline">
                Saved as a separate purchase from a similar one
              </Link>
            ) : null}
          </div>
        </div>

        <div className="grid gap-8 2xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-6">
            <ExpenseVerdict expense={e} agreementId={detail.agreementId} owedLabel={`${owed} owes`} otherLabel={`${buyer} pays`} />

            {e.settlement.state !== "CANCELLED" ? (
              <section aria-labelledby="next-h" className="space-y-5 rounded-[14px] border border-border bg-surface p-5">
                <h2 id="next-h" className="t-h3">What happens next</h2>
                {blocked && PRE_CLAIM.has(e.settlement.state) ? (
                  <p className="flex gap-2 text-muted-foreground">
                    <Info aria-hidden className="mt-1 size-4 shrink-0" />
                    {e.verdict.code === "NOT_COVERED"
                      ? "The agreement does not cover this, so it cannot be sent for approval or payment. It stays here as your own record."
                      : `Talk with ${names[e.paidByRole === "owner" ? "coparent" : "owner"]} about the rule first. Until it is settled this expense is not checked automatically.`}
                  </p>
                ) : null}
                {!blocked && e.approval.state !== "NOT_REQUIRED" ? (
                  <Step title="Approval">
                    <ApprovalStep e={e} other={names[e.owedByRole]} isBuyer={isBuyer} timeZone={tz} />
                  </Step>
                ) : null}
                <Step title="Receipt">
                  <ReceiptStep e={e} receipt={detail.receipt} me={me} timeZone={tz} />
                </Step>
                {CLAIM_VISIBLE.has(e.settlement.state) ? (
                  <Step title="Payment">
                    <ClaimStep e={e} dispute={detail.dispute} me={me} names={names} dueTerms={detail.dueTerms} timeZone={tz} />
                  </Step>
                ) : null}
                <div className="border-t border-border pt-4">
                  <ExpenseActions expense={e} />
                </div>
              </section>
            ) : null}
          </div>

          <section aria-labelledby="tl-h" className="space-y-4">
            <h2 id="tl-h" className="t-h3">History</h2>
            <Timeline events={detail.events} timeZone={ctx.userDoc.timeZone} names={{ owner: names.owner, coparent: names.coparent }} />
            {detail.ruleVersion ? <p className="t-small text-muted-foreground">Checked against rule version {detail.ruleVersion.version}{detail.ruleVersion.status === "SUPERSEDED" ? " (since replaced by an amendment)" : ""}.</p> : null}
          </section>
        </div>
      </article>
    </div>
  );
}

const PRE_CLAIM = new Set(["NONE", "RECEIPT_SUBMITTED", "RECEIPT_ISSUE", "READY"]);
const CLAIM_VISIBLE = new Set([
  "READY", "AWAITING_PAYMENT", "PAYMENT_FAILED", "EXTERNAL_PAYMENT_REPORTED", "SETTLED_EXTERNALLY", "WAIVED", "DISPUTED", "UNRESOLVED",
  "PAID", "PAYOUT_PROCESSING", "SETTLED", "PAYOUT_UNCLAIMED", "PAYOUT_FAILED", "REFUNDED",
]);

function Step({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="t-label uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-6" aria-busy>
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-10 w-2/3" />
      <Skeleton className="h-64 w-full rounded-[14px]" />
    </div>
  );
}
