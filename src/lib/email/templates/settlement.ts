import "server-only";
import { formatCents } from "@/lib/money";
import { renderLayout, type RenderedEmail } from "./layout";

// In-app settlement emails (Section H.3): settled, payout_unclaimed, payout_failed,
// connect_paypal_needed, subscription_problem. "Paid" means the share was reimbursed (A.4).

type Common = { footer: string; url: string };

export function settledEmail(input: Common & { forRole: "payer" | "receiver"; otherName: string; description: string; owedCents: number }): RenderedEmail {
  const amount = formatCents(input.owedCents);
  const subject = input.forRole === "receiver" ? `${amount} for ${input.description} is in your PayPal account` : `Settled: your ${amount} share of ${input.description}`;
  const { html, text } = renderLayout({
    preheader: "This expense is settled.",
    heading: "Settled",
    paragraphs: [
      input.forRole === "receiver"
        ? `${input.otherName} paid their share of ${input.description}. PayPal sent ${amount} to your PayPal account.`
        : `Your share of ${input.description} (${amount}) reached ${input.otherName}'s PayPal account. Nothing more is owed for it.`,
    ],
    button: { label: "See the record", url: input.url },
    footer: input.footer,
  });
  return { subject, html, text };
}

export function payoutUnclaimedEmail(input: Common & { payerName: string; description: string; owedCents: number; email: string }): RenderedEmail {
  const amount = formatCents(input.owedCents);
  const { html, text } = renderLayout({
    preheader: "Claim it in PayPal.",
    heading: `Claim your ${amount} in PayPal`,
    paragraphs: [
      `${input.payerName} paid their share of ${input.description}. PayPal is holding ${amount} for ${input.email} until you claim it.`,
      "Sign in to PayPal with that email (or add it to your PayPal account) to receive it. If it is not claimed, PayPal returns it and you can connect another account.",
    ],
    button: { label: "Open the expense", url: input.url },
    footer: input.footer,
  });
  return { subject: `Claim ${amount} for ${input.description} in PayPal`, html, text };
}

export function payoutFailedEmail(input: Common & { description: string; owedCents: number }): RenderedEmail {
  const amount = formatCents(input.owedCents);
  const { html, text } = renderLayout({
    preheader: "Check your PayPal connection.",
    heading: "PayPal could not send your money",
    paragraphs: [
      `Your co-parent paid their share of ${input.description} (${amount}), but PayPal could not deliver it to the account you connected.`,
      "Connect your PayPal account again, then press Retry payout on the expense. The money is safe with the platform until then.",
    ],
    button: { label: "Fix and retry", url: input.url },
    footer: input.footer,
  });
  return { subject: `Action needed: ${amount} for ${input.description} could not be sent`, html, text };
}

export function connectPaypalEmail(input: Common & { payerName: string; description: string; owedCents: number }): RenderedEmail {
  const amount = formatCents(input.owedCents);
  const { html, text } = renderLayout({
    preheader: "Connect PayPal to receive it.",
    heading: `Connect PayPal to receive ${amount}`,
    paragraphs: [
      `${input.payerName} paid their share of ${input.description}. Connect the PayPal account where you want to receive ${amount}; it is sent as soon as you connect.`,
    ],
    button: { label: "Connect PayPal", url: input.url },
    footer: input.footer,
  });
  return { subject: `${input.payerName} paid ${amount}: connect PayPal to receive it`, html, text };
}

export function subscriptionProblemEmail(input: Common & { problem: "suspended" | "payment_failed" }): RenderedEmail {
  const { html, text } = renderLayout({
    preheader: "In-app settlement is paused.",
    heading: input.problem === "suspended" ? "Your Family plan is paused" : "Your Family plan payment did not go through",
    paragraphs: [
      input.problem === "suspended"
        ? "PayPal paused your Family plan. Until it is active again, payments in the app and automatic reminders are off. Claims already paid still go out."
        : "PayPal could not take this month's Family plan payment. Update your payment method in PayPal to keep in-app settlement on.",
    ],
    button: { label: "Open billing", url: input.url },
    footer: input.footer,
  });
  return { subject: input.problem === "suspended" ? "Your Family plan is paused" : "Family plan payment failed", html, text };
}
