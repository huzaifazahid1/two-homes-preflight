import type { Metadata } from "next";
import { Plus, ReceiptText, ScrollText } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { ExpenseList } from "@/components/expenses/expense-list";
import { LiveRefresh } from "@/components/live/live-refresh";
import { PageHeader } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { familyContext, listExpenses } from "@/lib/data/family";
import { requireOnboarded } from "@/lib/data/me";

export const metadata: Metadata = { title: "Expenses" };

export default function ExpensesPage() {
  return (
    <Suspense fallback={<ListSkeleton />}>
      <Expenses />
    </Suspense>
  );
}

async function Expenses() {
  await requireOnboarded("/app/expenses");
  const ctx = await familyContext("/app/expenses");
  const { items } = await listExpenses(ctx, { limit: 30 });
  const newButton = (
    <Link href="/app/expenses/new" className={buttonVariants({ className: "h-11 px-4 max-lg:hidden" })}>
      <Plus aria-hidden /> New expense
    </Link>
  );
  return (
    <div className="space-y-6">
      <LiveRefresh target={{ kind: "list" }} />
      <PageHeader title="Expenses" description="Every expense is checked against your agreement, with the clause it relies on." action={items.length ? newButton : null} />
      {!ctx.family.activeRuleVersionId ? (
        <EmptyState icon={<ScrollText />} title="Confirm your agreement first" body="Expenses are checked against the rules in your agreement. Upload it and confirm the rules to start." href="/app/agreement" cta="Go to the agreement" />
      ) : items.length === 0 ? (
        <EmptyState icon={<ReceiptText />} title="No expenses yet" body="Planning a purchase for your child? Check it against the agreement before you spend." href="/app/expenses/new" cta="Add your first expense" />
      ) : (
        <ExpenseList items={items} />
      )}
    </div>
  );
}

function EmptyState({ icon, title, body, href, cta }: { icon: React.ReactNode; title: string; body: string; href: string; cta: string }) {
  return (
    <Empty className="rounded-[14px] border border-dashed border-border bg-surface py-12">
      <EmptyHeader>
        <EmptyMedia variant="icon">{icon}</EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{body}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Link href={href} className={buttonVariants({ className: "h-11 px-5" })}>
          {cta}
        </Link>
      </EmptyContent>
    </Empty>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-6" aria-busy>
      <Skeleton className="h-9 w-40" />
      <Skeleton className="h-72 w-full rounded-[14px]" />
    </div>
  );
}
