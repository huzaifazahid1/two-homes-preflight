import { PATCH as patchMe } from "@/app/api/me/route";
import { POST as upsertFamily } from "@/app/api/family/route";
import { POST as addChild } from "@/app/api/family/children/route";
import { POST as sendInvite } from "@/app/api/family/invite/route";
import { readMemoryOutbox } from "@/lib/email/outbox";
import { call, signedInUser } from "./api";

// Reusable multi-step flows for integration tests.

export async function ownerWithFamily(opts: { coParentEmail?: string } = {}) {
  const owner = await signedInUser({ verified: true });
  const coParentEmail = opts.coParentEmail ?? `sara.${Date.now()}.${Math.floor(Math.random() * 1e6)}@example.com`;
  await expectOk(call(patchMe, { method: "PATCH", path: "/api/me", jar: owner.jar, body: { displayName: "Alex Rivera", completeStep: "profile" } }));
  await expectOk(call(patchMe, { method: "PATCH", path: "/api/me", jar: owner.jar, body: { completeStep: "agreement" } }));
  await expectOk(call(addChild, { method: "POST", path: "/api/family/children", jar: owner.jar, body: { firstName: "Mia", birthYear: 2016 } }));
  const fam = await expectOk(call(upsertFamily, { method: "POST", path: "/api/family", jar: owner.jar, body: { coParent: { name: "Sara Rivera", email: coParentEmail } } }));
  return { owner, coParentEmail, familyId: fam.json.family.id as string };
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
