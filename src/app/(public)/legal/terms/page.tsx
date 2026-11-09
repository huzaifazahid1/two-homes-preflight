import type { Metadata } from "next";

export const metadata: Metadata = { title: "Terms" };

export default function TermsPage() {
  return (
    <article className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <h1 className="t-h1">Terms</h1>
      <p className="t-small mt-2 text-muted-foreground">Plain-language terms for the hackathon demo.</p>
      <div className="mt-6 space-y-4">
        <p>Two Homes Preflight is a demo built for the PayPal AI Hackathon 2026. It runs on the PayPal sandbox. No real money moves.</p>
        <p>
          The app shows what your parenting agreement text says, with quotes and page numbers. It is not legal advice and does not
          interpret the law. If you are unsure what your agreement means, ask a lawyer or mediator.
        </p>
        <p>
          AI is used only to read your agreement and receipts and to fill in forms. You confirm every rule and every receipt. Verdicts
          come from the rules you confirmed.
        </p>
        <p>
          Collecting money from one parent and paying it to another is regulated in most US states. A real launch would need approval
          from PayPal and a legal review. This demo does not offer that service to the public.
        </p>
        <p>Use only synthetic data in this demo. Do not upload a real agreement or real receipts.</p>
      </div>
    </article>
  );
}
