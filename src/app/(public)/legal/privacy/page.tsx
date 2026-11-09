import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy" };

export default function PrivacyPage() {
  return (
    <article className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <h1 className="t-h1">Privacy</h1>
      <p className="t-small mt-2 text-muted-foreground">What the demo stores and why.</p>
      <div className="mt-6 space-y-4">
        <p>
          We store your name, email, time zone, your family&apos;s children&apos;s first names and optional birth years, and the other
          parent&apos;s name and email. We never ask for a child&apos;s full birth date.
        </p>
        <p>
          Your agreement PDF is not stored. We keep the text of each page so rules can be checked against their quotes. Receipts are
          stored privately with Cloudinary and shown only through short-lived links.
        </p>
        <p>
          When you connect PayPal we keep your PayPal account ID, email and whether the account is verified, so payouts reach you. We do
          not keep any PayPal password or access token.
        </p>
        <p>
          Emails come from notifications@mail.huzaifalabs.site. Replies go to the parent who acted, not to us. Emails have no tracking
          pixels.
        </p>
        <p>Links sent by email work only with a one-time code sent to the invited address. We store links and codes only as hashes.</p>
      </div>
    </article>
  );
}
