import "server-only";
import { footerFor, renderLayout, type RenderedEmail } from "./layout";

export function inviteEmail(input: { ownerName: string; coParentName: string; childNames: string[]; url: string }): RenderedEmail {
  const kids = input.childNames.length > 0 ? ` for ${joinNames(input.childNames)}` : "";
  const subject = `${input.ownerName} invited you to share child expenses${kids}`;
  const { html, text } = renderLayout({
    preheader: `Review the expense rules from your agreement. No app to install.`,
    heading: `${input.ownerName} invited you to Two Homes Preflight`,
    paragraphs: [
      `Hi ${input.coParentName}, ${input.ownerName} uses Two Homes Preflight to check child expenses${kids} against your parenting agreement before anyone spends.`,
      "Open the link to see the expense rules and accept the invitation. You do not need to install anything or create an account. We will email you a one-time code to confirm it is you.",
      "This link works for 7 days.",
    ],
    button: { label: "Review the invitation", url: input.url },
    footer: footerFor(input.ownerName),
  });
  return { subject, html, text };
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
