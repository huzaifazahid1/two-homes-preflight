import "server-only";
import { formatCents } from "@/lib/money";
import { renderLayout, type RenderedEmail } from "./layout";

// Approval emails (Section H.3): approval_request, approval_reminder, approval_decision.
// One clear sentence, one button, the link as plain text, a footer. No tracking.

type Common = { footer: string };

export function approvalRequestEmail(input: Common & {
  requesterName: string;
  childName: string;
  description: string;
  amountCents: number;
  owedShareCents: number;
  clauseLabel: string | null;
  page: number | null;
  purchasedBeforeApproval: boolean;
  url: string;
  expiresOn: string;
}): RenderedEmail {
  const subject = `${input.requesterName} asks for your approval: ${input.description} (${formatCents(input.amountCents)})`;
  const clause = input.clauseLabel && input.page ? ` Your agreement asks for written approval for this (${input.clauseLabel}, p. ${input.page}).` : "";
  const { html, text } = renderLayout({
    preheader: `Your share would be ${formatCents(input.owedShareCents)}. No app to install.`,
    heading: `Approve ${input.description} for ${input.childName}?`,
    paragraphs: [
      `${input.requesterName} ${input.purchasedBeforeApproval ? "already bought" : "wants to buy"} ${input.description} for ${input.childName} for ${formatCents(input.amountCents)}. Your share would be ${formatCents(input.owedShareCents)}.${clause}`,
      ...(input.purchasedBeforeApproval ? ["This was purchased before asking you. You can still approve or decline."] : []),
      `Open the link to approve, approve part of it, or decline. We will email you a one-time code first. The link works until ${input.expiresOn}.`,
    ],
    button: { label: "Review the request", url: input.url },
    footer: input.footer,
  });
  return { subject, html, text };
}

export function approvalReminderEmail(input: Common & { requesterName: string; childName: string; description: string; amountCents: number; url: string; expiresOn: string }): RenderedEmail {
  const subject = `Reminder: ${input.requesterName} is waiting for your answer on ${input.description}`;
  const { html, text } = renderLayout({
    preheader: `The request ends on ${input.expiresOn}.`,
    heading: `${input.requesterName} is still waiting for your answer`,
    paragraphs: [
      `${input.requesterName} asked 3 days ago whether you approve ${input.description} for ${input.childName} (${formatCents(input.amountCents)}). Nothing happens automatically if you do not answer.`,
      `This is a new link; the one in the first email no longer works. It works until ${input.expiresOn}.`,
    ],
    button: { label: "Review the request", url: input.url },
    footer: input.footer,
  });
  return { subject, html, text };
}

const DECISION_WORD = { APPROVED: "approved", PARTIALLY_APPROVED: "approved part of", DECLINED: "declined" } as const;

export function approvalDecisionEmail(input: Common & {
  approverName: string;
  description: string;
  decision: keyof typeof DECISION_WORD;
  approvedCents: number | null;
  amountCents: number;
  reason: string | null;
  url: string;
}): RenderedEmail {
  const what =
    input.decision === "PARTIALLY_APPROVED" && input.approvedCents !== null
      ? `${input.approverName} approved ${formatCents(input.approvedCents)} of ${formatCents(input.amountCents)} for ${input.description}.`
      : `${input.approverName} ${DECISION_WORD[input.decision]} ${input.description} (${formatCents(input.amountCents)}).`;
  const subject = `${input.approverName} ${DECISION_WORD[input.decision]} ${input.description}`;
  const { html, text } = renderLayout({
    preheader: what,
    heading: what,
    paragraphs: [
      ...(input.reason ? [`Their note: "${input.reason}"`] : []),
      input.decision === "DECLINED"
        ? "A new request for this expense is possible 7 days after the decline."
        : "After the purchase, add the receipt and send the payment request from the expense page.",
    ],
    button: { label: "Open the expense", url: input.url },
    footer: input.footer,
  });
  return { subject, html, text };
}
