import "server-only";
import { footerFor, renderLayout, type RenderedEmail } from "./layout";

export function otpEmail(input: { code: string; ownerName: string; purposeLabel: string }): RenderedEmail {
  const subject = `${input.code} is your Two Homes Preflight code`;
  const { html, text } = renderLayout({
    preheader: `Your code expires in 10 minutes.`,
    heading: "Your one-time code",
    paragraphs: [
      `Enter this code to ${input.purposeLabel}. It expires in 10 minutes.`,
      "If you did not ask for this code, you can ignore this email. Nobody can act on your behalf without it.",
    ],
    code: input.code,
    footer: footerFor(input.ownerName),
  });
  return { subject, html, text };
}
