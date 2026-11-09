import "server-only";
import { connectPaypalEmail, payoutFailedEmail, payoutUnclaimedEmail, settledEmail } from "@/lib/email/templates/settlement";
import type { RenderedEmail } from "@/lib/email/templates/layout";
import { formatCents } from "@/lib/money";
import { dedupeKey, deliverNotificationEmail, type NotificationInput } from "@/lib/notifications";
import { appUrl, footerForRole, party } from "@/lib/parties";
import type { ExpenseDoc, FamilyDoc, Role } from "@/types/firestore";

// Notifications for in-app settlement (Section H.3: settled, payout_unclaimed, payout_failed,
// connect_paypal_needed). Built inside the transition (doc created in the transaction), emailed
// after commit only for docs that transaction created, so a replayed webhook never re-sends.

export type SettlementNotice = "settled" | "payout_unclaimed" | "payout_failed" | "connect_paypal_needed";

type Built = { input: NotificationInput; email: RenderedEmail; replyTo?: string };

/** A guest co-parent has no app account: their emails point at the expense only if they joined. */
function linkFor(family: FamilyDoc, role: Role, expenseId: string): { path?: string; url: string } {
  const p = party(family, role);
  return p.uid ? { path: `/app/expenses/${expenseId}`, url: appUrl(`/app/expenses/${expenseId}`) } : { url: appUrl("/") };
}

export function buildNotices(kind: SettlementNotice, family: FamilyDoc, familyId: string, expenseId: string, e: ExpenseDoc, version: number | string): Built[] {
  const owed = e.settlement.owedCents ?? 0;
  const receiver = party(family, e.paidByRole);
  const payer = party(family, e.owedByRole);
  const rl = linkFor(family, receiver.role, expenseId);
  const base = { familyId, expenseId, sendEmail: true } as const;

  if (kind === "settled") {
    const pl = linkFor(family, payer.role, expenseId);
    return [
      {
        input: { ...base, dedupeKey: dedupeKey("settled", `${expenseId}_${receiver.role}`, version), toUid: receiver.uid, toEmail: receiver.email, type: "settled", title: `${formatCents(owed)} reached your PayPal`, body: `${e.description}: settled.`, link: rl.path },
        email: settledEmail({ forRole: "receiver", otherName: payer.firstName, description: e.description, owedCents: owed, url: rl.url, footer: footerForRole(family, receiver.role) }),
      },
      {
        input: { ...base, dedupeKey: dedupeKey("settled", `${expenseId}_${payer.role}`, version), toUid: payer.uid, toEmail: payer.email, type: "settled", title: `Settled: ${e.description}`, body: `Your ${formatCents(owed)} share reached ${receiver.firstName}.`, link: pl.path },
        email: settledEmail({ forRole: "payer", otherName: receiver.firstName, description: e.description, owedCents: owed, url: pl.url, footer: footerForRole(family, payer.role) }),
      },
    ];
  }
  if (kind === "payout_unclaimed") {
    const email = family.payout?.[receiver.role]?.email ?? receiver.email;
    return [
      {
        input: { ...base, dedupeKey: dedupeKey("payout_unclaimed", expenseId, version), toUid: receiver.uid, toEmail: receiver.email, type: "payout_unclaimed", title: `Claim ${formatCents(owed)} in PayPal`, body: `PayPal is holding it for ${email}.`, link: rl.path },
        email: payoutUnclaimedEmail({ payerName: payer.firstName, description: e.description, owedCents: owed, email, url: rl.url, footer: footerForRole(family, receiver.role) }),
      },
    ];
  }
  if (kind === "payout_failed") {
    return [
      {
        input: { ...base, dedupeKey: dedupeKey("payout_failed", expenseId, version), toUid: receiver.uid, toEmail: receiver.email, type: "payout_failed", title: "PayPal could not send your money", body: `${e.description}: connect PayPal again, then retry.`, link: rl.path },
        email: payoutFailedEmail({ description: e.description, owedCents: owed, url: rl.url, footer: footerForRole(family, receiver.role) }),
      },
    ];
  }
  const settings = receiver.uid ? appUrl("/app/settings#paypal") : appUrl("/");
  return [
    {
      input: { ...base, dedupeKey: dedupeKey("connect_paypal_needed", expenseId, version), toUid: receiver.uid, toEmail: receiver.email, type: "connect_paypal_needed", title: `Connect PayPal to receive ${formatCents(owed)}`, body: `${payer.firstName} paid their share of ${e.description}.`, link: receiver.uid ? "/app/settings#paypal" : undefined },
      email: connectPaypalEmail({ payerName: payer.firstName, description: e.description, owedCents: owed, url: settings, footer: footerForRole(family, receiver.role) }),
    },
  ];
}

/** After commit: email the notices whose docs this transaction created. Never throws. */
export async function deliverNotices(built: Built[], created: NotificationInput[], requestId?: string) {
  const keys = new Set(created.map((n) => n.dedupeKey));
  for (const b of built) {
    if (!keys.has(b.input.dedupeKey)) continue;
    await deliverNotificationEmail({ dedupeKey: b.input.dedupeKey, to: b.input.toEmail, replyTo: b.replyTo, email: b.email, requestId });
  }
}
