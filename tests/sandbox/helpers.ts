import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

// Helpers for the manual @sandbox journey (docs/testing.md). Unlike tests/e2e, this runs against
// the real Firebase project and real PayPal sandbox through the running dev server, so the dev
// outbox and documents are read with the Admin SDK. Nothing here prints secrets.

process.loadEnvFile(".env.local");

export function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is missing (set it in .env.local)`);
  return v;
}

let firestore: Firestore | null = null;
export function fs(): Firestore {
  if (firestore) return firestore;
  const app =
    getApps()[0] ??
    initializeApp({
      credential: cert({
        projectId: need("FIREBASE_PROJECT_ID"),
        clientEmail: need("FIREBASE_CLIENT_EMAIL"),
        privateKey: need("FIREBASE_PRIVATE_KEY").replace(/\\n/g, "\n"),
      }),
    });
  firestore = getFirestore(app);
  return firestore;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Polls until `get` returns a value, or throws with `what` after `timeoutMs`. */
export async function waitFor<T>(what: string, get: () => Promise<T | null | undefined>, timeoutMs = 60_000, everyMs = 1500): Promise<T> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await get();
    if (v !== null && v !== undefined) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(everyMs);
  }
}

type OutboxMail = { to: string; subject: string; text: string; at: Date };

async function outboxFor(to: string, after: number): Promise<OutboxMail[]> {
  // The app stores emails lowercased (emailSchema), so match the outbox the same way.
  const snap = await fs().collection("devOutbox").where("to", "==", to.trim().toLowerCase()).get();
  return snap.docs
    .map((d) => {
      const x = d.data();
      return { to: x.to as string, subject: x.subject as string, text: x.text as string, at: x.at?.toDate?.() ?? new Date(0) };
    })
    .filter((m) => m.at.getTime() > after)
    .sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** The latest OTP code emailed to `to` after `after` (ms). */
export function latestCode(to: string, after: number) {
  return waitFor(`OTP email to ${to}`, async () => {
    const m = (await outboxFor(to, after)).filter((x) => /your Two Homes Preflight code/.test(x.subject)).pop();
    return m ? m.subject.slice(0, 6) : null;
  });
}

/** The latest /p/ or /a/ link path emailed to `to` after `after` (ms). */
export function latestLink(to: string, kind: "a" | "p", after: number) {
  const re = new RegExp(`/${kind}/([A-Za-z0-9_-]{43})`);
  return waitFor(`/${kind}/ link email to ${to}`, async () => {
    const m = (await outboxFor(to, after)).filter((x) => re.test(x.text)).pop();
    return m ? `/${kind}/${re.exec(m.text)![1]}` : null;
  });
}

/** Seeds one demo family through the running server (DEMO_MODE + DEV_SECRET). */
export async function seed(baseURL: string, body: Record<string, string>) {
  const res = await fetch(`${baseURL}/api/dev/seed`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-dev-secret": need("DEV_SECRET") },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { seeded?: { ownerEmail: string; ownerPassword: string; familyId: string; expenses: string[] }; error?: { code: string; message: string } };
  if (!res.ok || !json.seeded) throw new Error(`seed failed: ${res.status} ${json.error?.code} ${json.error?.message}`);
  return json.seeded;
}

export async function reset(baseURL: string) {
  const res = await fetch(`${baseURL}/api/dev/reset`, { method: "POST", headers: { "x-dev-secret": need("DEV_SECRET") } });
  if (!res.ok) throw new Error(`reset failed: ${res.status} ${await res.text()}`);
}

export async function doc<T = Record<string, unknown>>(path: string): Promise<T | null> {
  const s = await fs().doc(path).get();
  return s.exists ? (s.data() as T) : null;
}

/** Webhook events stored for one PayPal resource id (stored only after the signature check passed). */
export async function webhookEventsFor(resourceId: string) {
  const snap = await fs().collection("webhookEvents").where("resourceId", "==", resourceId).get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as { type: string; outcome?: string; attempts: number }) }));
}

/** One line per step so the owner can follow the headed run in the terminal. */
export function say(msg: string) {
  console.log(`[sandbox] ${msg}`);
}
