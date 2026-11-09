import "server-only";

// Shared HTML shell for every email (Section H.3): product name, one sentence, one button,
// the link as plain text, a footer. Inline styles only. No tracking pixels.

export type RenderedEmail = { subject: string; html: string; text: string };

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

type LayoutInput = {
  preheader: string;
  heading: string;
  paragraphs: string[];
  button?: { label: string; url: string };
  /** Large monospace block, e.g. a one-time code. */
  code?: string;
  footer: string;
};

export function renderLayout(input: LayoutInput): { html: string; text: string } {
  const p = input.paragraphs
    .map((t) => `<p style="margin:0 0 16px;font-size:15px;line-height:24px;color:#15201E;">${escapeHtml(t)}</p>`)
    .join("");
  const code = input.code
    ? `<p style="margin:8px 0 24px;font-family:'SFMono-Regular',Menlo,Consolas,monospace;font-size:32px;letter-spacing:8px;font-weight:600;color:#12403C;">${escapeHtml(input.code)}</p>`
    : "";
  const button = input.button
    ? `<p style="margin:8px 0 24px;"><a href="${escapeHtml(input.button.url)}" style="display:inline-block;background:#12403C;color:#FFFFFF;text-decoration:none;font-weight:600;font-size:15px;padding:12px 20px;border-radius:8px;">${escapeHtml(input.button.label)}</a></p>
       <p style="margin:0 0 16px;font-size:13px;line-height:20px;color:#5B6663;">Or open this link: <a href="${escapeHtml(input.button.url)}" style="color:#12403C;word-break:break-all;">${escapeHtml(input.button.url)}</a></p>`
    : "";

  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#F7F6F2;">
<span style="display:none;max-height:0;overflow:hidden;">${escapeHtml(input.preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F7F6F2;padding:24px 12px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#FFFFFF;border:1px solid #E2DED5;border-radius:10px;">
<tr><td style="padding:28px 28px 8px;">
<p style="margin:0 0 20px;font-size:13px;font-weight:600;letter-spacing:0.02em;color:#12403C;">Two Homes Preflight</p>
<h1 style="margin:0 0 16px;font-size:22px;line-height:28px;font-weight:600;color:#15201E;">${escapeHtml(input.heading)}</h1>
${p}${code}${button}
</td></tr>
<tr><td style="padding:16px 28px 24px;border-top:1px solid #E2DED5;">
<p style="margin:0;font-size:12px;line-height:18px;color:#5B6663;">${escapeHtml(input.footer)}</p>
</td></tr>
</table></td></tr></table></body></html>`;

  const text = [
    "Two Homes Preflight",
    "",
    input.heading,
    "",
    ...input.paragraphs.flatMap((t) => [t, ""]),
    ...(input.code ? [input.code, ""] : []),
    ...(input.button ? [`${input.button.label}: ${input.button.url}`, ""] : []),
    "--",
    input.footer,
  ].join("\n");

  return { html, text };
}

export function footerFor(ownerName: string): string {
  return `You received this because ${ownerName} added you to Two Homes Preflight.`;
}
