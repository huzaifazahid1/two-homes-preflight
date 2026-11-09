import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Logo } from "@/components/layout/logo";
import { env } from "@/lib/env";
import { db } from "@/lib/firebase/admin";
import { DemoControls } from "./demo-controls";

export const metadata: Metadata = { title: "Demo tools", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

// /dev/demo (Section A.8): seed/reset the synthetic family and read the dev email outbox.
// Exists only with DEMO_MODE=true; actions also need the DEV_SECRET.
export default async function DemoPage() {
  if (!env().DEMO_MODE) notFound();
  const snap = await db().collection("devOutbox").orderBy("at", "desc").limit(25).get();
  const mails = snap.docs.map((d) => {
    const m = d.data() as { to: string; subject: string; text: string; at?: { toDate(): Date } };
    return { id: d.id, to: m.to, subject: m.subject, text: m.text, at: m.at?.toDate().toISOString() ?? null };
  });
  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-3xl items-center px-4 py-3">
        <Logo href="/" />
      </header>
      <main className="mx-auto max-w-3xl space-y-8 px-4 pb-16 pt-2">
        <div>
          <h1 className="t-h1">Demo tools</h1>
          <p className="mt-1 text-muted-foreground">Synthetic data only. PayPal stays in sandbox.</p>
        </div>
        <DemoControls />
        <section aria-labelledby="outbox-h" className="space-y-3">
          <h2 id="outbox-h" className="t-h2">Dev email outbox</h2>
          <p className="t-small text-muted-foreground">Emails written here instead of being sent (EMAIL_TRANSPORT=outbox). Links in them work.</p>
          {mails.length === 0 ? (
            <p className="rounded-[14px] border border-dashed border-border bg-surface p-5 text-muted-foreground">No emails yet.</p>
          ) : (
            <ul className="space-y-3">
              {mails.map((m) => (
                <li key={m.id} className="rounded-[14px] border border-border bg-surface p-4">
                  <details>
                    <summary className="cursor-pointer list-none">
                      <p className="font-medium">{m.subject}</p>
                      <p className="t-small text-muted-foreground">To {m.to}{m.at ? ` · ${new Date(m.at).toUTCString()}` : ""}</p>
                    </summary>
                    <pre className="t-small mt-3 whitespace-pre-wrap break-words font-mono text-muted-foreground">{linkify(m.text)}</pre>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}

function linkify(text: string) {
  return text.split(/(https?:\/\/\S+)/g).map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a key={i} href={part} className="text-primary underline">
        {part}
      </a>
    ) : (
      part
    ),
  );
}
