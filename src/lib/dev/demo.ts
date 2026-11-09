import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { POST as uploadAgreement } from "@/app/api/agreements/route";
import { POST as extract } from "@/app/api/agreements/[id]/extract/route";
import { POST as createSession } from "@/app/api/auth/session/route";
import { POST as createExpense } from "@/app/api/expenses/route";
import { POST as addChild } from "@/app/api/family/children/route";
import { POST as sendInvite } from "@/app/api/family/invite/route";
import { POST as upsertFamily } from "@/app/api/family/route";
import { PATCH as patchMe } from "@/app/api/me/route";
import { POST as connectEmail } from "@/app/api/paypal/connect/email/route";
import { POST as activate } from "@/app/api/rule-versions/[id]/activate/route";
import { PATCH as patchRule } from "@/app/api/rule-versions/[id]/rules/[ruleId]/route";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { adminAuth, db } from "@/lib/firebase/admin";
import { newId, safeEqual, sha256Hex } from "@/lib/ids";
import { log } from "@/lib/log";
import { publicEnv } from "@/lib/public-env";
import type { FamilyDoc, UserDoc } from "@/types/firestore";

// Demo tooling (Section A.8 /dev/demo, Phase 4): seed and reset one synthetic family. Available
// only with DEMO_MODE=true (404 otherwise, SE-7) and the DEV_SECRET. The seed drives the real
// route handlers in-process with a real session, exactly like the integration tests, so every
// state change takes the normal guarded path (transition(), validation, audit).

export const DEMO_DOMAIN = "demo.twohomes.test";

export function requireDev(req: Request) {
  const e = env();
  if (!e.DEMO_MODE) throw new AppError("NOT_FOUND", "Not found.");
  const given = req.headers.get("x-dev-secret") ?? "";
  if (!given || !e.DEV_SECRET || !safeEqual(sha256Hex(given), sha256Hex(e.DEV_SECRET))) throw new AppError("UNAUTHENTICATED", "Missing or wrong dev secret.");
}

type Handler = (req: Request, ctx?: { params: Promise<Record<string, string>> }) => Promise<Response>;

class Jar {
  cookie = "";
  async call<T = unknown>(h: Handler, path: string, init: { method?: string; body?: unknown; params?: Record<string, string> } = {}): Promise<T> {
    const res = await h(
      new Request(`${env().APP_URL}${path}`, {
        method: init.method ?? "POST",
        headers: { "content-type": "application/json", ...(this.cookie ? { cookie: this.cookie } : {}) },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      }),
      { params: Promise.resolve(init.params ?? {}) },
    );
    const set = res.headers.getSetCookie().find((c) => c.startsWith("thp_session="));
    if (set) this.cookie = set.split(";")[0];
    const json = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    if (!res.ok) throw new Error(`seed step ${path} failed: ${res.status} ${json?.error?.code ?? ""} ${json?.error?.message ?? ""}`);
    return json as T;
  }
}

/** A real ID token for a user the seed created: custom token exchanged at Identity Toolkit. */
async function idTokenFor(uid: string): Promise<string> {
  const token = await adminAuth().createCustomToken(uid);
  const emu = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const base = emu ? `http://${emu}/identitytoolkit.googleapis.com` : "https://identitytoolkit.googleapis.com";
  const res = await fetch(`${base}/v1/accounts:signInWithCustomToken?key=${publicEnv().NEXT_PUBLIC_FIREBASE_API_KEY}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, returnSecureToken: true }),
  });
  const body = (await res.json()) as { idToken?: string };
  if (!body.idToken) throw new Error("seed sign-in failed");
  return body.idToken;
}

export type SeedInput = { coParentEmail: string; ownerPayPalEmail?: string };
export type SeedResult = { ownerEmail: string; ownerPassword: string; familyId: string; expenses: string[] };

/** Alex (owner), Sara (co-parent, guest), Mia (child); the fixture agreement active; two expenses. */
export async function seedDemo(input: SeedInput): Promise<SeedResult> {
  const ownerEmail = `alex.${newId(6).toLowerCase()}@${DEMO_DOMAIN}`;
  const ownerPassword = `Demo-${newId(12)}`;
  const user = await adminAuth().createUser({ email: ownerEmail, password: ownerPassword, emailVerified: true, displayName: "Alex Rivera" });
  const jar = new Jar();
  await jar.call(createSession, "/api/auth/session", { body: { idToken: await idTokenFor(user.uid), timeZone: "America/New_York" } });
  await jar.call(patchMe, "/api/me", { method: "PATCH", body: { displayName: "Alex Rivera", completeStep: "profile" } });

  const text = readFileSync(join(process.cwd(), "fixtures", "agreement", "demo-agreement.md"), "utf8");
  const agreementId = (await jar.call<{ agreement: { id: string } }>(uploadAgreement, "/api/agreements", { body: { text } })).agreement.id as string;
  const draft = (await jar.call<{ draft: { id: string; rules: { id: string; reviewState: string }[] } }>(extract, `/api/agreements/${agreementId}/extract`, { body: {}, params: { id: agreementId } })).draft;
  for (const rule of draft.rules) {
    // Rules that need a human (vague terms, non-numeric shares) stay for the live demo.
    if (rule.reviewState === "NEEDS_REVIEW") continue;
    await jar.call(patchRule, `/api/rule-versions/${draft.id}/rules/${rule.id}`, { method: "PATCH", body: { action: "confirm" }, params: { id: draft.id, ruleId: rule.id } });
  }
  await jar.call(activate, `/api/rule-versions/${draft.id}/activate`, { params: { id: draft.id } });
  await jar.call(patchMe, "/api/me", { method: "PATCH", body: { completeStep: "agreement" } });

  const child = (await jar.call<{ child: { id: string } }>(addChild, "/api/family/children", { body: { firstName: "Mia", birthYear: 2016 } })).child;
  const family = (await jar.call<{ family: { id: string } }>(upsertFamily, "/api/family", { body: { coParent: { name: "Sara Rivera", email: input.coParentEmail } } })).family;
  await jar.call(patchMe, "/api/me", { method: "PATCH", body: { completeStep: "family" } });
  await jar.call(sendInvite, "/api/family/invite");
  await jar.call(patchMe, "/api/me", { method: "PATCH", body: { completeStep: "invite" } });
  const payTo = input.ownerPayPalEmail ?? ownerEmail;
  await jar.call(connectEmail, "/api/paypal/connect/email", { body: { for: "owner", email: payTo, confirmEmail: payTo } });
  await jar.call(patchMe, "/api/me", { method: "PATCH", body: { completeStep: "paypal" } });
  await jar.call(patchMe, "/api/me", { method: "PATCH", body: { completeStep: "plan", plan: "free" } });
  await db().collection("families").doc(family.id).update({ demo: true });

  const today = new Date().toISOString().slice(0, 10);
  const expenses: string[] = [];
  for (const e of [
    { category: "dental", description: "Bright Smile cleaning", vendor: "Bright Smile Dental", amountCents: 12000, mode: "purchased", date: today },
    { category: "school_supplies", description: "Fall school supplies", vendor: "Paper & Co", amountCents: 6400, mode: "planned", date: today },
  ]) {
    const r = await jar.call<{ expense: { id: string } }>(createExpense, "/api/expenses", { body: { ...e, childId: child.id, paidByRole: "owner", confirmDuplicate: true } });
    expenses.push(r.expense.id);
  }
  log.info("dev.seed.done", { familyId: family.id, expenses: expenses.length });
  return { ownerEmail, ownerPassword, familyId: family.id, expenses };
}

/** Deletes every seeded demo family (families with demo: true) and its users. */
export async function resetDemo(): Promise<{ families: number }> {
  const fams = await db().collection("families").where("demo", "==", true).get();
  for (const f of fams.docs) {
    const fam = f.data() as FamilyDoc;
    const familyId = f.id;
    for (const col of ["expenses", "approvals", "receipts", "disputes", "agreements", "ruleVersions", "linkTokens", "notifications", "auditLogs"]) {
      const snap = await db().collection(col).where("familyId", "==", familyId).get();
      for (const d of snap.docs) await db().recursiveDelete(d.ref);
    }
    for (const col of ["payments", "payouts"]) {
      for (const d of (await db().collection(col).where("familyId", "==", familyId).get()).docs) await d.ref.delete();
    }
    await db().collection("subscriptions").doc(familyId).delete();
    for (const d of (await db().collection("usage").where("__name__", ">=", `${familyId}_`).where("__name__", "<", `${familyId}_~`).get()).docs) await d.ref.delete();
    for (const uid of fam.memberUids) {
      const u = (await db().collection("users").doc(uid).get()).data() as UserDoc | undefined;
      await db().collection("users").doc(uid).delete();
      if (u?.email?.endsWith(`@${DEMO_DOMAIN}`)) await adminAuth().deleteUser(uid).catch((err: unknown) => log.warn("dev.reset.user_delete_failed", { error: err }));
    }
    await db().recursiveDelete(f.ref);
  }
  log.info("dev.reset.done", { families: fams.size });
  return { families: fams.size };
}
