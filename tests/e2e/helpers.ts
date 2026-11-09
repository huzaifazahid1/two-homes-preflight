import { readFileSync } from "node:fs";
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

export const DEMO_AGREEMENT = readFileSync("fixtures/agreement/demo-agreement.md", "utf8");

/** Onboarding step 2: paste the demo agreement, review (demo mode cached extraction), confirm all, activate. */
export async function completeAgreementStep(page: Page) {
  await expect(page).toHaveURL(/\/onboarding\/agreement$/);
  await page.getByText("Paste the text", { exact: true }).click();
  await page.getByLabel("Agreement text").fill(DEMO_AGREEMENT);
  await page.getByRole("button", { name: "Read the rules" }).click();
  await expect(page.getByText("Demo mode: cached extraction")).toBeVisible({ timeout: 30_000 });
  const confirm = page.getByRole("button", { name: "Confirm", exact: true });
  for (let n = await confirm.count(); n > 0; n--) {
    await confirm.first().click();
    await expect(confirm).toHaveCount(n - 1);
  }
  await page.getByRole("button", { name: "Confirm rules" }).click();
  await expect(page.getByText(/rules? confirmed/)).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
}

/** Full owner onboarding through the UI, ending on /app. */
export async function onboardOwner(page: Page) {
  const email = uniqueEmail("alex");
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("Passw0rd!long");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/verify-email$/, { timeout: 20_000 });
  await verifyEmailInEmulator(email);
  await page.getByRole("button", { name: "I have verified my email" }).click();
  await page.getByLabel("Your name").fill("Alex Rivera");
  await page.getByRole("button", { name: "Save and continue" }).click();
  await completeAgreementStep(page);
  await page.getByRole("button", { name: "Add Mia" }).click();
  await expect(page.getByRole("button", { name: "Remove Mia" })).toBeVisible();
  await page.getByRole("region", { name: "The other parent" }).getByLabel("Email", { exact: true }).fill(uniqueEmail("sara"));
  await page.getByRole("button", { name: "Save and continue" }).click();
  await page.getByRole("button", { name: "Send invite" }).click();
  await expect(page.getByLabel("Invite link (works for 7 days)")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Use my PayPal email instead" }).click();
  await page.getByLabel("PayPal email").fill("alex.pp@example.com");
  await page.getByLabel("Type it again").fill("alex.pp@example.com");
  await page.getByRole("button", { name: "Save PayPal email" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue with Free" }).click();
  await expect(page).toHaveURL(/\/app$/);
  return { email };
}
