import { expect, type Page } from "@playwright/test";

// E2E helpers that talk to the emulators directly over REST (no Admin SDK in the browser test process).
const PROJECT = "demo-two-homes";
const AUTH = "http://127.0.0.1:9099";
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
const OWNER_AUTH = { Authorization: "Bearer owner" }; // emulator admin bypass

export function uniqueEmail(prefix: string) {
  return `${prefix}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@example.com`;
}

/** Marks an Auth emulator account as email-verified (stands in for clicking the Firebase email link). */
export async function verifyEmailInEmulator(email: string) {
  const res = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:lookup`, {
    method: "POST",
    headers: { "content-type": "application/json", ...OWNER_AUTH },
    body: JSON.stringify({ email: [email] }),
  });
  const body = (await res.json()) as { users?: { localId: string }[] };
  const uid = body.users?.[0]?.localId;
  if (!uid) throw new Error(`no emulator user for ${email}`);
  const upd = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:update`, {
    method: "POST",
    headers: { "content-type": "application/json", ...OWNER_AUTH },
    body: JSON.stringify({ localId: uid, emailVerified: true }),
  });
  if (!upd.ok) throw new Error(`verify failed: ${upd.status}`);
}

type FsValue = { stringValue?: string };

/** Latest OTP code emailed to `to`, read from the dev outbox (devOutbox collection in the emulator). */
export async function latestCodeFor(to: string): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const res = await fetch(`${FS}/devOutbox?pageSize=300`, { headers: OWNER_AUTH });
    const body = (await res.json()) as { documents?: { fields: Record<string, FsValue>; createTime: string }[] };
    const mails = (body.documents ?? [])
      .filter((d) => d.fields.to?.stringValue === to && /your Two Homes Preflight code/.test(d.fields.subject?.stringValue ?? ""))
      .sort((a, b) => a.createTime.localeCompare(b.createTime));
    const last = mails[mails.length - 1];
    if (last) return last.fields.subject!.stringValue!.slice(0, 6);
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no code email for ${to}`);
}

export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "page should not scroll horizontally").toBeLessThanOrEqual(0);
}
