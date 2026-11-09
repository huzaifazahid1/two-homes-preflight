import { readFileSync } from "node:fs";
import { PATCH as patchMe } from "@/app/api/me/route";
import { POST as upsertFamily } from "@/app/api/family/route";
import { POST as addChild } from "@/app/api/family/children/route";
import { POST as sendInvite } from "@/app/api/family/invite/route";
import { POST as uploadAgreement } from "@/app/api/agreements/route";
import { POST as extract } from "@/app/api/agreements/[id]/extract/route";
import { PATCH as patchRule } from "@/app/api/rule-versions/[id]/rules/[ruleId]/route";
import { POST as activate } from "@/app/api/rule-versions/[id]/activate/route";
import { readMemoryOutbox } from "@/lib/email/outbox";
import { resetEnvCache } from "@/lib/env";
import { call, signedInUser, type CookieJar } from "./api";

// Reusable multi-step flows for integration tests.

export const DEMO_AGREEMENT_TEXT = readFileSync("fixtures/agreement/demo-agreement.md", "utf8");

/** Runs fn with DEMO_MODE on (cached extraction when Gemini is not configured, as in tests). */
export async function withDemoMode<T>(fn: () => Promise<T>): Promise<T> {
  const prev = { DEMO_MODE: process.env.DEMO_MODE, DEV_SECRET: process.env.DEV_SECRET };
  process.env.DEMO_MODE = "true";
  process.env.DEV_SECRET = "test-dev-secret-0123456789abcdef0123456789";
  resetEnvCache();
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    resetEnvCache();
  }
}

/** Uploads pasted text and returns the agreement id. */
export async function uploadText(jar: CookieJar, text = DEMO_AGREEMENT_TEXT) {
  const r = await expectOk(call(uploadAgreement, { method: "POST", path: "/api/agreements", jar, body: { text } }));
  return r.json.agreement.id as string;
}

/** Demo agreement -> cached extraction -> confirm every rule -> activate. Returns the active version. */
export async function activateDemoAgreement(jar: CookieJar) {
  const agreementId = await uploadText(jar);
  const draft = await withDemoMode(async () => (await expectOk(call(extract, { method: "POST", path: `/api/agreements/${agreementId}/extract`, jar, params: { id: agreementId }, body: {} }))).json.draft);
  for (const rule of draft.rules) {
    await expectOk(call(patchRule, { method: "PATCH", jar, params: { id: draft.id, ruleId: rule.id }, body: { action: "confirm" } }));
  }
  const rv = (await expectOk(call(activate, { method: "POST", jar, params: { id: draft.id } }))).json.ruleVersion;
  return { agreementId, ruleVersion: rv as { id: string; rules: { id: string; category: string; owedPct: number; reviewState: string }[] } };
}

export async function ownerWithFamily(opts: { coParentEmail?: string } = {}) {
  const owner = await signedInUser({ verified: true });
  const coParentEmail = opts.coParentEmail ?? `sara.${Date.now()}.${Math.floor(Math.random() * 1e6)}@example.com`;
  await expectOk(call(patchMe, { method: "PATCH", path: "/api/me", jar: owner.jar, body: { displayName: "Alex Rivera", completeStep: "profile" } }));
  const { ruleVersion, agreementId } = await activateDemoAgreement(owner.jar);
  await expectOk(call(patchMe, { method: "PATCH", path: "/api/me", jar: owner.jar, body: { completeStep: "agreement" } }));
  const child = await expectOk(call(addChild, { method: "POST", path: "/api/family/children", jar: owner.jar, body: { firstName: "Mia", birthYear: 2016 } }));
  const fam = await expectOk(call(upsertFamily, { method: "POST", path: "/api/family", jar: owner.jar, body: { coParent: { name: "Sara Rivera", email: coParentEmail } } }));
  return { owner, coParentEmail, familyId: fam.json.family.id as string, childId: child.json.child.id as string, ruleVersion, agreementId };
}

export async function ownerWithInvite() {
  const base = await ownerWithFamily();
  const inv = await expectOk(call(sendInvite, { method: "POST", path: "/api/family/invite", jar: base.owner.jar }));
  const link = inv.json.link as string;
  return { ...base, link, token: link.split("/r/")[1] };
}

export function lastCodeFor(email: string): string {
  const mails = readMemoryOutbox().filter((m) => m.to === email && /your Two Homes Preflight code/.test(m.subject));
  const last = mails[mails.length - 1];
  if (!last) throw new Error(`no code email for ${email}`);
  return last.subject.slice(0, 6);
}

export async function expectOk<T extends { status: number; json: any }>(p: Promise<T>): Promise<T> {
  const r = await p;
  if (r.status >= 300) throw new Error(`expected 2xx, got ${r.status}: ${JSON.stringify(r.json)}`);
  return r;
}
