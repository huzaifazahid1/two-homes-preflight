import "server-only";
import type { Transaction } from "firebase-admin/firestore";
import { buildDraft, runExtraction } from "@/lib/ai/extract";
import { demoExtractionFor } from "@/lib/ai/demo-mode";
import { AiError } from "@/lib/ai/gemini";
import { audit } from "@/lib/audit";
import { actorOf, type FamilyContext } from "@/lib/auth/session";
import { MINUTE_MS, now } from "@/lib/clock";
import { familyEntitled, FREE_EXTRACTION_RUNS } from "@/lib/entitlement";
import { AppError } from "@/lib/errors";
import { db, FieldValue, Timestamp } from "@/lib/firebase/admin";
import { sha256Hex } from "@/lib/ids";
import { log } from "@/lib/log";
import { pagesFromPastedText, readPdfPages, type ExtractedPage } from "@/lib/pdf";
import type { PageText } from "@/lib/quote-verify";
import type { AgreementDoc, AgreementPageDoc, RuleVersionDoc } from "@/types/firestore";
import { ruleVersionView } from "./rule-version-view";

// Agreement upload and extraction (Section A.5.1 step 2, E.2). Owner only (F.2, AZ-3).

const EXTRACTING_LOCK_MS = 3 * MINUTE_MS;

export function agreementsCol() {
  return db().collection("agreements");
}
export function ruleVersionsCol() {
  return db().collection("ruleVersions");
}

export type UploadInput = { kind: "pdf"; bytes: Uint8Array; fileName: string } | { kind: "text"; text: string; fileName?: string };

/** Loads an agreement of the caller's family. 404 if unknown; 403 + audit for another family (AZ-2). */
export async function loadFamilyAgreement(ctx: FamilyContext, id: string, requestId?: string): Promise<AgreementDoc> {
  const snap = await agreementsCol().doc(id).get();
  if (!snap.exists) throw new AppError("NOT_FOUND", "Agreement not found.");
  const a = snap.data() as AgreementDoc;
  if (a.familyId !== ctx.familyId) {
    await audit({ familyId: ctx.familyId, actor: actorOf(ctx), action: "forbidden.agreement", target: `agreements/${id}` }, requestId);
    throw new AppError("FORBIDDEN", "You do not have access to this agreement.");
  }
  return a;
}

export async function loadPages(agreementId: string): Promise<PageText[]> {
  const snaps = await agreementsCol().doc(agreementId).collection("pages").orderBy("page").get();
  return snaps.docs.map((d) => d.data() as AgreementPageDoc);
}

/** POST /api/agreements. Scanned PDFs are refused with reason "scanned" so the UI offers paste (ON-6). */
export async function uploadAgreement(ctx: FamilyContext, input: UploadInput): Promise<{ id: string; pageCount: number; source: AgreementDoc["source"] }> {
  if (ctx.family.activeRuleVersionId && !(await familyEntitled(ctx.familyId))) {
    throw new AppError("PLAN_REQUIRED", "The Free plan includes one agreement. Upgrade to the Family plan to upload an amendment.", { details: { upgrade: true } });
  }
  let pages: ExtractedPage[];
  let sha: string;
  let fileName: string;
  if (input.kind === "pdf") {
    const read = await readPdfPages(input.bytes);
    if (read.scanned) {
      throw new AppError("INVALID", "This PDF looks scanned: it has no text we can read. Paste the agreement text instead.", { details: { reason: "scanned", pageCount: read.pages.length } });
    }
    pages = read.pages;
    sha = sha256Hex(Buffer.from(input.bytes));
    fileName = input.fileName;
  } else {
    pages = pagesFromPastedText(input.text);
    sha = sha256Hex(input.text);
    fileName = input.fileName?.trim() || "Pasted agreement text";
  }

  const ref = agreementsCol().doc();
  const batch = db().batch();
  const t = Timestamp.fromDate(now());
  batch.create(ref, {
    familyId: ctx.familyId,
    memberUids: ctx.family.memberUids,
    fileName: fileName.slice(0, 120),
    sha256: sha,
    pageCount: pages.length,
    source: input.kind === "pdf" ? "pdf" : "pasted_text",
    status: "UPLOADED",
    extractionRuns: 0,
    createdBy: ctx.user.uid,
    createdAt: t,
    updatedAt: t,
  });
  for (const p of pages) batch.create(ref.collection("pages").doc(String(p.page)), { page: p.page, text: p.text });
  await batch.commit();
  return { id: ref.id, pageCount: pages.length, source: input.kind === "pdf" ? "pdf" : "pasted_text" };
}

async function familyRuns(tx: Transaction, familyId: string): Promise<number> {
  const snaps = await tx.get(agreementsCol().where("familyId", "==", familyId));
  return snaps.docs.reduce((n, d) => n + ((d.data() as AgreementDoc).extractionRuns ?? 0), 0);
}

async function nextVersionNumber(tx: Transaction, familyId: string): Promise<number> {
  const snaps = await tx.get(ruleVersionsCol().where("familyId", "==", familyId));
  return snaps.docs.reduce((m, d) => Math.max(m, (d.data() as RuleVersionDoc).version ?? 0), 0) + 1;
}

/**
 * POST /api/agreements/:id/extract. AI mode counts toward the plan limit (AG-11) when it produces
 * a draft. Gemini failure after one retry: demo mode if allowed, else 502 with manual entry (AG-8).
 */
export async function extractAgreement(ctx: FamilyContext, id: string, mode: "ai" | "manual", requestId?: string) {
  const ref = agreementsCol().doc(id);
  await loadFamilyAgreement(ctx, id, requestId);
  const entitled = await familyEntitled(ctx.familyId);

  if (mode === "ai") {
    await db().runTransaction(async (tx) => {
      const a = (await tx.get(ref)).data() as AgreementDoc;
      const runs = await familyRuns(tx, ctx.familyId);
      if (a.status === "EXTRACTING" && a.updatedAt && now().getTime() - a.updatedAt.toMillis() < EXTRACTING_LOCK_MS) {
        throw new AppError("STATE_CONFLICT", "Extraction is already running for this agreement.");
      }
      if (!entitled && runs >= FREE_EXTRACTION_RUNS) {
        throw new AppError("PLAN_REQUIRED", `The Free plan includes ${FREE_EXTRACTION_RUNS} extraction runs. Upgrade to the Family plan for more, or add rules by hand.`, {
          details: { upgrade: true, manualEntry: true, runs, limit: FREE_EXTRACTION_RUNS },
        });
      }
      tx.update(ref, { status: "EXTRACTING", error: FieldValue.delete(), updatedAt: Timestamp.fromDate(now()) });
    });
  }

  const pages = await loadPages(id);
  let draft: ReturnType<typeof buildDraft> = { rules: [], parties: { parents: [], children: [] } };
  let extraction: { mode: "ai" | "demo" | "manual"; model?: string } = { mode: "manual" };

  if (mode === "ai") {
    try {
      const res = await runExtraction(pages, requestId);
      draft = buildDraft(res.data, pages, "ai");
      extraction = { mode: "ai", model: res.model };
    } catch (err) {
      const cached = demoExtractionFor(pages);
      if (cached) {
        log.warn("agreement.demo_mode_used", { requestId, familyId: ctx.familyId, reason: err instanceof AiError ? err.reason : "error" });
        draft = buildDraft(cached, pages, "demo");
        extraction = { mode: "demo" };
      } else {
        const reason = err instanceof AiError ? err.reason : "unavailable";
        await ref.update({ status: "FAILED", error: reason, updatedAt: Timestamp.fromDate(now()) });
        if (err instanceof AiError) {
          throw new AppError("UPSTREAM_FAILED", `${err.message} You can try again, or add the rules by hand.`, { details: { reason, manualEntry: true }, cause: err });
        }
        throw err;
      }
    }
  }

  const rvRef = ruleVersionsCol().doc();
  await db().runTransaction(async (tx) => {
    const a = (await tx.get(ref)).data() as AgreementDoc;
    const version = await nextVersionNumber(tx, ctx.familyId);
    const oldDraftRef = a.draftRuleVersionId ? ruleVersionsCol().doc(a.draftRuleVersionId) : null;
    const oldDraft = oldDraftRef ? await tx.get(oldDraftRef) : null;
    const t = Timestamp.fromDate(now());
    // A replaced draft was never active and no expense is pinned to it.
    if (oldDraftRef && oldDraft?.exists && (oldDraft.data() as RuleVersionDoc).status === "DRAFT") tx.delete(oldDraftRef);
    tx.create(rvRef, {
      familyId: ctx.familyId,
      memberUids: ctx.family.memberUids,
      agreementId: id,
      version,
      status: "DRAFT",
      rules: draft.rules,
      extractedParties: draft.parties,
      extraction: { ...extraction, at: t },
      createdAt: t,
      updatedAt: t,
    });
    const counted = extraction.mode !== "manual";
    tx.update(ref, {
      status: "EXTRACTED",
      draftRuleVersionId: rvRef.id,
      updatedAt: t,
      ...(counted ? { extractionRuns: FieldValue.increment(1) } : {}),
    });
    if (counted) {
      const ym = now().toISOString().slice(0, 7).replace("-", "");
      tx.set(db().collection("usage").doc(`${ctx.familyId}_${ym}`), { extractionRuns: FieldValue.increment(1) }, { merge: true });
    }
  });
  const snap = await rvRef.get();
  return ruleVersionView(rvRef.id, snap.data() as RuleVersionDoc);
}

export function agreementView(id: string, a: AgreementDoc) {
  return {
    id,
    fileName: a.fileName,
    pageCount: a.pageCount,
    source: a.source,
    status: a.status,
    error: a.error ?? null,
    extractionRuns: a.extractionRuns,
    draftRuleVersionId: a.draftRuleVersionId ?? null,
    createdAt: a.createdAt.toDate().toISOString(),
  };
}
export type AgreementView = ReturnType<typeof agreementView>;

/** GET /api/agreements/:id: status + draft. */
export async function getAgreement(ctx: FamilyContext, id: string, requestId?: string) {
  const a = await loadFamilyAgreement(ctx, id, requestId);
  const draftSnap = a.draftRuleVersionId ? await ruleVersionsCol().doc(a.draftRuleVersionId).get() : null;
  const draft = draftSnap?.exists ? ruleVersionView(draftSnap.id, draftSnap.data() as RuleVersionDoc) : null;
  const entitled = await familyEntitled(ctx.familyId);
  const runsUsed = (await agreementsCol().where("familyId", "==", ctx.familyId).get()).docs.reduce((n, d) => n + ((d.data() as AgreementDoc).extractionRuns ?? 0), 0);
  return {
    agreement: agreementView(id, a),
    draft: draft?.status === "DRAFT" ? draft : null,
    runsLeft: entitled ? null : Math.max(0, FREE_EXTRACTION_RUNS - runsUsed),
  };
}

/** GET /api/agreements/:id/pages/:n. Owner or joined co-parent (family members). */
export async function getAgreementPage(ctx: FamilyContext, id: string, n: number, requestId?: string): Promise<AgreementPageDoc & { pageCount: number }> {
  const a = await loadFamilyAgreement(ctx, id, requestId);
  const snap = await agreementsCol().doc(id).collection("pages").doc(String(n)).get();
  if (!snap.exists) throw new AppError("NOT_FOUND", "That page does not exist.");
  return { ...(snap.data() as AgreementPageDoc), pageCount: a.pageCount };
}
