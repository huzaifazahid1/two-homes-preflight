import "server-only";
import { formatCents } from "@/lib/money";
import { renderLayout, type RenderedEmail } from "./layout";

// Claim emails (Section H.3): payment_request, payment_reminder_manual, payment_due_soon,
// payment_overdue, external_payment_reported / confirmed / rejected, marked_received, dispute_update.
// "Paid" always means the co-parent's share was reimbursed, never the purchase itself (A.4).

type Common = { footer: string; url: string };

export function paymentRequestEmail(input: Common & {
  receiverName: string;
  childName: string;
  description: string;
  owedCents: number;
  dueOn: string;
  dueClause: string | null;
}): RenderedEmail {
  const subject = `${input.receiverName} asks for ${formatCents(input.owedCents)} for ${input.description}, due ${input.dueOn}`;
  const { html, text } = renderLayout({
    preheader: `Your share of ${input.description} for ${input.childName}.`,
    heading: `Your share: ${formatCents(input.owedCents)}, due ${input.dueOn}`,
    paragraphs: [
      `${input.receiverName} bought ${input.description} for ${input.childName} and asks for your share of ${formatCents(input.owedCents)} by ${input.dueOn}.${input.dueClause ? ` ${input.dueClause}` : ""}`,
      "Open the link to see the receipt and the clause. If you already paid outside the app, you can say so there. We will email you a one-time code first.",
    ],
    button: { label: "See the request", url: input.url },
    footer: input.footer,
  });
  return { subject, html, text };
}

export function paymentReminderEmail(input: Common & {
  kind: "manual" | "due_soon" | "overdue";
  receiverName: string;
  description: string;
  owedCents: number;
  dueOn: string;
  overdueDays?: number;
}): RenderedEmail {
  const subject =
    input.kind === "overdue"
      ? `Overdue: ${formatCents(input.owedCents)} for ${input.description} was due ${input.dueOn}`
      : input.kind === "due_soon"
        ? `Due soon: ${formatCents(input.owedCents)} for ${input.description} is due ${input.dueOn}`
        : `Reminder from ${input.receiverName}: ${formatCents(input.owedCents)} for ${input.description}`;
  const lead =
    input.kind === "overdue"
      ? `Your share of ${input.description} (${formatCents(input.owedCents)}) was due on ${input.dueOn}${input.overdueDays ? `, ${input.overdueDays} day${input.overdueDays === 1 ? "" : "s"} ago` : ""}.`
      : input.kind === "due_soon"
        ? `Your share of ${input.description} (${formatCents(input.owedCents)}) is due on ${input.dueOn}.`
        : `${input.receiverName} sent a reminder about your share of ${input.description} (${formatCents(input.owedCents)}), due ${input.dueOn}.`;
  const { html, text } = renderLayout({
    preheader: lead,
    heading: input.kind === "overdue" ? "This payment is overdue" : input.kind === "due_soon" ? "This payment is due soon" : "A friendly reminder",
    paragraphs: [lead, "Open the link to see the receipt and the clause, or to say you already paid outside the app."],
    button: { label: "See the request", url: input.url },
    footer: input.footer,
  });
  return { subject, html, text };
}

export function externalReportedEmail(input: Common & { payerName: string; description: string; owedCents: number; method: string; dateOn: string }): RenderedEmail {
  const subject = `${input.payerName} says they paid ${formatCents(input.owedCents)} for ${input.description}`;
  const { html, text } = renderLayout({
    preheader: "Confirm it when you see the money.",
    heading: `${input.payerName} says they paid you outside the app`,
    paragraphs: [
      `${input.payerName} reported paying ${formatCents(input.owedCents)} for ${input.description} by ${input.method} on ${input.dateOn}.`,
      "It stays outstanding until you confirm you received it. If you did not, you can reject the report.",
    ],
    button: { label: "Confirm or reject", url: input.url },
    footer: input.footer,
  });
  return { subject, html, text };
}

export function externalResolvedEmail(input: Common & { receiverName: string; description: string; owedCents: number; outcome: "confirmed" | "rejected" | "marked_received"; contestUntilOn?: string }): RenderedEmail {
  const subject =
    input.outcome === "rejected"
      ? `${input.receiverName} did not confirm your payment for ${input.description}`
      : `${input.receiverName} confirmed your ${formatCents(input.owedCents)} for ${input.description}`;
  const paragraphs =
    input.outcome === "rejected"
      ? [`${input.receiverName} has not received your ${formatCents(input.owedCents)} for ${input.description}, so it is outstanding again.`, "If you think this is a mistake, reply to this email to talk to them."]
      : input.outcome === "marked_received"
        ? [
            `${input.receiverName} marked your share of ${input.description} (${formatCents(input.owedCents)}) as received outside the app. Nothing more is owed.`,
            `If you did not pay this, you can contest it${input.contestUntilOn ? ` until ${input.contestUntilOn}` : " within 7 days"}.`,
          ]
        : [`${input.receiverName} confirmed they received your ${formatCents(input.owedCents)} for ${input.description}. Nothing more is owed.`];
  const { html, text } = renderLayout({
    preheader: paragraphs[0],
    heading: input.outcome === "rejected" ? "Payment not confirmed" : "Settled",
    paragraphs,
    button: { label: "Open the request", url: input.url },
    footer: input.footer,
  });
  return { subject, html, text };
}

export function disputeUpdateEmail(input: Common & { fromName: string; description: string; event: "opened" | "reply" | "agreed" | "unresolved"; reason?: string; proposedCents?: number | null }): RenderedEmail {
  const heading =
    input.event === "opened"
      ? `${input.fromName} disputes the claim for ${input.description}`
      : input.event === "reply"
        ? `${input.fromName} replied about ${input.description}`
        : input.event === "agreed"
          ? `You agreed on ${input.description}`
          : `No agreement on ${input.description}`;
  const paragraphs = [
    ...(input.reason ? [`Their note: "${input.reason}"`] : []),
    ...(typeof input.proposedCents === "number" ? [`They propose ${formatCents(input.proposedCents)}.`] : []),
    input.event === "unresolved"
      ? "After two rounds there is no agreement. The claim is closed as unresolved and the full record stays in the app."
      : input.event === "agreed"
        ? "The claim is open again with the agreed amount."
        : "Open the claim to agree or answer. There are at most two rounds of answers.",
  ];
  const { html, text } = renderLayout({ preheader: heading, heading, paragraphs, button: { label: "Open the claim", url: input.url }, footer: input.footer });
  return { subject: heading, html, text };
}
