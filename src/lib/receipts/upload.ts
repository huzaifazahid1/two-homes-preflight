import "server-only";
import type { DocumentReference, Transaction } from "firebase-admin/firestore";
import { audit, auditInTx } from "@/lib/audit";
import { actorOf, requireFamily, type FamilyContext, type SessionUser } from "@/lib/auth/session";
import { DAY_MS, now } from "@/lib/clock";
import { familyEntitled } from "@/lib/entitlement";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { dateFromIso, isoFromTs } from "@/lib/expense-view";
import { loadFamilyExpense, loadRuleVersion } from "@/lib/expenses";
import { db, FieldValue, Timestamp } from "@/lib/firebase/admin";
import { newId, sha256Hex } from "@/lib/ids";
import { resolveLinkHash } from "@/lib/links/tokens";
import { log } from "@/lib/log";
import { countPdfPages } from "@/lib/pdf";
import { evaluate } from "@/lib/rules-engine";
import { effectiveApprovalState } from "@/lib/state/effective";
import { transition } from "@/lib/state/transition";
import type { Actor, ApprovalDoc, ExpenseDoc, FamilyDoc, MatchIssue, ReceiptDoc } from "@/types/firestore";
import { destroyReceipt, privateDownloadUrl, uploadReceipt as uploadToCloudinary } from "./cloudinary";
import { detectReceiptType, MAX_RECEIPT_BYTES, MAX_RECEIPT_PDF_PAGES } from "./file-type";
import { ACKNOWLEDGEABLE, matchReceipt, merchantKey } from "./match";
import { parseReceipt } from "./parse";

// Receipts (Section I.2). Our server checks type, size and duplicate hash before anything is
// stored; Cloudinary keeps the private original; Gemini reads it; a parent confirms; the match
// runs. A receipt always means "I already bought it" (A.4), never that the share was paid.

export const FREE_AI_RECEIPT_SCANS = 10;
const UPLOADABLE = new Set(["NONE", "RECEIPT_ISSUE"]);
const CONFIRMABLE = new Set(["RECEIPT_SUBMITTED", "RECEIPT_ISSUE"]);
const APPROVAL_GIVEN = new Set(["APPROVED", "PARTIALLY_APPROVED"]);

type Meta = { requestId?: string; ip?: string | null; userAgent?: string | null };

export function receiptsCol() {
  return db().collection("receipts");
}

function hashRef(familyId: string, sha: string) {
  return db().collection("receiptHashes").doc(`${familyId}_${sha}`);
}

export function receiptView(id: string, r: ReceiptDoc) {
  const acknowledged = r.acknowledged ?? [];
  return {
    id,
    expenseId: r.expenseId,
    fileName: r.originalFileName,
    mimeType: r.mimeType,
    bytes: r.cloudinary.bytes,
    pages: r.cloudinary.pages ?? null,
    parseStatus: r.parseStatus,
    parseError: r.parseError ?? null,
    parsed: r.parsed ?? null,
    confirmed: r.confirmed ? { merchant: r.confirmed.merchant, date: isoFromTs(r.confirmed.date), totalCents: r.confirmed.totalCents } : null,
    match: r.match
      ? {
          result: r.match.result,
          issues: r.match.issues,
          open: r.match.issues.filter((i) => !(ACKNOWLEDGEABLE.has(i) && acknowledged.includes(i))),
          possibleDuplicateOf: r.match.possibleDuplicateOf ?? null,
        }
      : null,
    acknowledged,
    replaced: Boolean(r.replacedBy),
    createdAt: r.createdAt.toDate().toISOString(),
  };
}
export type ReceiptView = ReturnType<typeof receiptView>;

function yyyymm(d: Date) {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Free plan: 10 AI receipt reads per month (A.6.5). Reserves one read in the usage doc. */
async function reserveAiScan(familyId: string): Promise<boolean> {
  if (await familyEntitled(familyId)) return true;
  const ref = db().collection("usage").doc(`${familyId}_${yyyymm(now())}`);
  return db().runTransaction(async (tx) => {
    const used = ((await tx.get(ref)).data()?.aiReceiptScans as number | undefined) ?? 0;
    if (used >= FREE_AI_RECEIPT_SCANS) return false;
    tx.set(ref, { aiReceiptScans: used + 1 }, { merge: true });
    return true;
  });
}

/** POST /api/expenses/:id/receipts (multipart). Upload + parse. */
export async function uploadReceipt(ctx: FamilyContext, expenseId: string, file: { bytes: Uint8Array; fileName: string }, meta: Meta = {}) {
  const e = await loadFamilyExpense(ctx, expenseId, meta.requestId);
  if (!UPLOADABLE.has(e.settlement.state)) {
    throw new AppError("STATE_CONFLICT", e.settlement.state === "CANCELLED" ? "This expense was cancelled." : "This expense already has a receipt. Confirm it, or fix its issues first.");
  }
  const { bytes } = file;
  if (bytes.byteLength === 0) throw new AppError("INVALID", "The file is empty.");
  if (bytes.byteLength > MAX_RECEIPT_BYTES) throw new AppError("INVALID", "The file is larger than 10 MB. Take a smaller photo or upload a PDF.");
  const type = detectReceiptType(bytes);
  if (!type) throw new AppError("INVALID", "Upload a photo (JPEG, PNG, WEBP or HEIC) or a PDF of the receipt.");
  if (type.ext === "pdf") {
    const pages = await countPdfPages(bytes);
    if (pages > MAX_RECEIPT_PDF_PAGES) throw new AppError("INVALID", `This PDF has ${pages} pages. A receipt can have at most ${MAX_RECEIPT_PDF_PAGES}.`);
  }

  const sha = sha256Hex(Buffer.from(bytes));
  const receiptId = newId();
  const hRef = hashRef(ctx.familyId, sha);
  const t = Timestamp.fromDate(now());

  // 1. Duplicate check (RC-4): the hash doc is created first; a second identical file fails here.
  await db().runTransaction(async (tx) => {
    const h = await tx.get(hRef);
    if (h.exists) {
      const other = (h.data() as { expenseId?: string }).expenseId;
      throw new AppError("DUPLICATE_RECEIPT", "This exact receipt was already uploaded.", { details: other ? { expenseId: other, link: `/app/expenses/${other}` } : {} });
    }
    tx.create(hRef, { receiptId, expenseId, createdAt: t });
  });

  // 2. Cloudinary. On failure the hash doc is removed (compensation, RC-5) and nothing else changed.
  let asset;
  try {
    asset = await uploadToCloudinary({ bytes, mimeType: type.mime, publicId: receiptId, familyId: ctx.familyId, expenseId, requestId: meta.requestId });
  } catch (err) {
    await hRef.delete().catch((delErr: unknown) => log.error("receipt.hash_compensation_failed", { requestId: meta.requestId, familyId: ctx.familyId, error: delErr }));
    throw err;
  }

  const doc: Omit<ReceiptDoc, "createdAt"> & { createdAt: Timestamp } = {
    familyId: ctx.familyId,
    memberUids: ctx.family.memberUids,
    expenseId,
    uploadedBy: ctx.user.uid,
    cloudinary: {
      publicId: asset.public_id,
      resourceType: "image",
      deliveryType: "private",
      format: asset.format,
      bytes: asset.bytes,
      ...(asset.width !== undefined ? { width: asset.width } : {}),
      ...(asset.height !== undefined ? { height: asset.height } : {}),
      ...(asset.pages !== undefined ? { pages: asset.pages } : {}),
      version: asset.version,
      assetId: asset.asset_id,
    },
    originalFileName: file.fileName.slice(0, 200) || `receipt.${type.ext}`,
    mimeType: type.mime,
    sha256: sha,
    parseStatus: "pending",
    createdAt: t,
  };

  // 3. Receipt doc + expense in one transaction.
  try {
    await attachReceipt(ctx, expenseId, receiptId, doc, meta);
  } catch (err) {
    await Promise.allSettled([
      destroyReceipt(asset.public_id, meta.requestId).catch((dErr: unknown) => log.error("receipt.asset_compensation_failed", { requestId: meta.requestId, familyId: ctx.familyId, error: dErr })),
      hRef.delete(),
    ]);
    throw err;
  }

  // 4. AI reading. Never blocks: on failure the parent types the values (RC-7).
  const patch: Record<string, unknown> = {};
  const e2 = env();
  if (!e2.GEMINI_API_KEY || !e2.GEMINI_MODEL) {
    // Not configured is a real error state, shown as "type the values" (rule 5); no plan quota used.
    patch.parseStatus = "failed";
    patch.parseError = "not_configured";
    log.warn("receipt.parse_failed", { requestId: meta.requestId, familyId: ctx.familyId, reason: "not_configured" });
  } else if (!(await reserveAiScan(ctx.familyId))) {
    patch.parseStatus = "skipped";
    patch.parseError = "plan_limit";
  } else {
    const outcome = await parseReceipt({ bytes, mimeType: type.mime, requestId: meta.requestId });
    if (outcome.status === "parsed") {
      patch.parseStatus = "parsed";
      patch.parsed = outcome.parsed;
    } else {
      patch.parseStatus = "failed";
      patch.parseError = outcome.reason;
      log.warn("receipt.parse_failed", { requestId: meta.requestId, familyId: ctx.familyId, reason: outcome.reason });
    }
  }
  await receiptsCol().doc(receiptId).update(patch);
  const saved = (await receiptsCol().doc(receiptId).get()).data() as ReceiptDoc;
  return { receipt: receiptView(receiptId, saved) };
}

/** Writes the receipt, links it to the expense and moves settlement NONE -> RECEIPT_SUBMITTED. */
async function attachReceipt(ctx: FamilyContext, expenseId: string, receiptId: string, doc: Omit<ReceiptDoc, "createdAt"> & { createdAt: Timestamp }, meta: Meta) {
  const actor = actorOf(ctx);
  const at = now();
  const receiptRef = receiptsCol().doc(receiptId);

  // Bought while approval was needed and not given (A.5.4): flag it, and show it on the open request (AP-9).
  const flagsFor = async (tx: Transaction, current: ExpenseDoc) => {
    const approval = effectiveApprovalState(current.approval, at);
    const pending = approval === "REQUESTED" && current.approval.currentRequestId ? approvalsRef(current.approval.currentRequestId) : null;
    // Read in the read phase so the open request cannot change under us.
    if (pending && !(await tx.get(pending)).exists) throw new AppError("STATE_CONFLICT", "The approval request changed. Refresh and try again.");
    return { before: approval !== "NOT_REQUIRED" && !APPROVAL_GIVEN.has(approval), pending };
  };

  const snap = await db().collection("expenses").doc(expenseId).get();
  const state = (snap.data() as ExpenseDoc).settlement.state;
  if (state === "NONE") {
    let flags: Awaited<ReturnType<typeof flagsFor>> = { before: false, pending: null };
    const res = await transition({
      expenseId,
      machine: "settlement",
      event: "RECEIPT_UPLOADED",
      actor,
      requestId: meta.requestId,
      ip: meta.ip,
      userAgent: meta.userAgent,
      loadFacts: async (tx, current) => {
        flags = await flagsFor(tx, current);
        return {};
      },
      extraWrites: (tx, { expenseRef }) => {
        tx.create(receiptRef, doc);
        tx.update(expenseRef, { receiptId, ...(flags.before ? { purchasedBeforeApproval: true } : {}) });
        if (flags.pending) tx.update(flags.pending, { purchasedBeforeApproval: true });
      },
    });
    if (res.outcome === "noop") throw new AppError("STATE_CONFLICT", "This expense already has a receipt.");
    return;
  }

  // RECEIPT_ISSUE: a new receipt replaces the one with issues. No state change until it is confirmed.
  const expenseRef = db().collection("expenses").doc(expenseId);
  await db().runTransaction(async (tx) => {
    const current = (await tx.get(expenseRef)).data() as ExpenseDoc;
    if (current.settlement.state !== "RECEIPT_ISSUE") throw new AppError("STATE_CONFLICT", "This expense already has a receipt.");
    const flags = await flagsFor(tx, current);
    const t = Timestamp.fromDate(at);
    tx.create(receiptRef, doc);
    if (current.receiptId) tx.update(receiptsCol().doc(current.receiptId), { replacedBy: receiptId });
    tx.update(expenseRef, { receiptId, version: current.version + 1, updatedAt: t, ...(flags.before ? { purchasedBeforeApproval: true } : {}) });
    if (flags.pending) tx.update(flags.pending, { purchasedBeforeApproval: true });
    tx.create(expenseRef.collection("events").doc(), { type: "receipt.replaced", machine: "note", actor, data: { event: "RECEIPT_REPLACED" }, at: t });
    auditInTx(tx, { familyId: ctx.familyId, actor, action: "receipt.replace", target: `receipts/${receiptId}`, ip: meta.ip, userAgent: meta.userAgent });
  });
}

function approvalsRef(id: string) {
  return db().collection("approvals").doc(id);
}

export type ConfirmInput = { merchant: string; date: string; totalCents: number; acknowledge?: MatchIssue[] };

/** POST /api/receipts/:id/confirm: the parent's values, then the match (RC-8 to RC-11). */
export async function confirmReceipt(ctx: FamilyContext, receiptId: string, input: ConfirmInput, meta: Meta = {}) {
  const r = await loadFamilyReceipt(ctx, receiptId, meta.requestId);
  const e = await loadFamilyExpense(ctx, r.expenseId, meta.requestId);
  if (e.receiptId !== receiptId) throw new AppError("STATE_CONFLICT", "A newer receipt replaced this one.");
  if (!CONFIRMABLE.has(e.settlement.state)) throw new AppError("STATE_CONFLICT", "This receipt was already confirmed.");
  if (dateFromIso(input.date).getTime() > now().getTime() + DAY_MS) {
    throw new AppError("INVALID", "The receipt date cannot be in the future.", { details: { fields: [{ path: "body.date", message: "Cannot be in the future" }] } });
  }
  const acknowledged = [...new Set([...(r.acknowledged ?? []), ...(input.acknowledge ?? [])])].filter((i) => ACKNOWLEDGEABLE.has(i));
  await runMatch(r.expenseId, receiptId, { merchant: input.merchant, date: input.date, totalCents: input.totalCents, by: ctx.user.uid }, acknowledged, actorOf(ctx), meta);
  const saved = (await receiptsCol().doc(receiptId).get()).data() as ReceiptDoc;
  return { receipt: receiptView(receiptId, saved) };
}

/** After an approval decision: match the waiting receipt again with its confirmed values. */
export async function rematchReceipt(expenseId: string, actor: Actor, meta: Meta = {}) {
  const e = (await db().collection("expenses").doc(expenseId).get()).data() as ExpenseDoc | undefined;
  if (!e?.receiptId || e.settlement.state !== "RECEIPT_ISSUE") return;
  const r = (await receiptsCol().doc(e.receiptId).get()).data() as ReceiptDoc | undefined;
  if (!r?.confirmed) return;
  await runMatch(expenseId, e.receiptId, { merchant: r.confirmed.merchant, date: isoFromTs(r.confirmed.date)!, totalCents: r.confirmed.totalCents, by: r.confirmed.confirmedBy }, r.acknowledged ?? [], actor, meta);
}

async function findDuplicate(familyId: string, receiptId: string, expenseId: string, v: { merchant: string; date: string; totalCents: number }): Promise<string | null> {
  const snaps = await receiptsCol().where("familyId", "==", familyId).where("confirmed.totalCents", "==", v.totalCents).limit(25).get();
  const key = merchantKey(v.merchant);
  const hit = snaps.docs.find((d) => {
    const o = d.data() as ReceiptDoc;
    return d.id !== receiptId && o.expenseId !== expenseId && !o.replacedBy && o.confirmed && isoFromTs(o.confirmed.date) === v.date && merchantKey(o.confirmed.merchant) === key;
  });
  return hit ? (hit.data() as ReceiptDoc).expenseId : null;
}

async function runMatch(expenseId: string, receiptId: string, v: { merchant: string; date: string; totalCents: number; by: string }, acknowledged: MatchIssue[], actor: Actor, meta: Meta) {
  const expenseRef = db().collection("expenses").doc(expenseId);
  const e = (await expenseRef.get()).data() as ExpenseDoc;
  const [familySnap, rv, receiptSnap, approvalSnap, duplicateOf] = await Promise.all([
    db().collection("families").doc(e.familyId).get(),
    loadRuleVersion(e.ruleVersionId),
    receiptsCol().doc(receiptId).get(),
    e.approval.currentRequestId ? approvalsRef(e.approval.currentRequestId).get() : Promise.resolve(null),
    findDuplicate(e.familyId, receiptId, expenseId, v),
  ]);
  const family = familySnap.data() as FamilyDoc;
  const receipt = receiptSnap.data() as ReceiptDoc;
  const approvalDoc = approvalSnap?.data() as ApprovalDoc | undefined;
  const at = now();
  const approvalState = effectiveApprovalState(e.approval, at);
  const approved = APPROVAL_GIVEN.has(approvalState);
  const child = family.children.find((c) => c.id === e.childId) ?? { id: e.childId, firstName: "" };
  const submittedAt = receipt.createdAt.toDate();

  // The verdict is the engine's, with the receipt's facts (A.6.1 steps 4 to 6; shares on min(receipt, approved)).
  const result = evaluate(
    {
      category: e.category,
      child,
      amountCents: v.totalCents,
      currency: "USD",
      // Mode only shapes the explanation: with an approval in hand it must not say
      // "approval was required before purchase". Deadlines use purchaseDate either way.
      mode: approved ? "planned" : "purchased",
      purchaseDate: dateFromIso(v.date),
      receiptSubmittedAt: submittedAt,
      stage: "claim",
      hasReceipt: true,
      approvedCents: approved ? (e.approval.approvedCents ?? null) : null,
      receiptTotalCents: v.totalCents,
    },
    rv ? { id: rv.id, rules: rv.rules, coParentAck: rv.coParentAck ?? null } : null,
    at,
  );
  const match = matchReceipt({
    receipt: { merchant: v.merchant, date: v.date, totalCents: v.totalCents, submittedAt },
    expense: { vendor: e.vendor ?? null, approvalState, approvedCents: e.approval.approvedCents ?? null, approvalDecidedAt: e.approval.decidedAt?.toDate() ?? null },
    verdictWithReceipt: result.verdict,
    approvalKnewPurchased: Boolean(approvalDoc?.purchasedBeforeApproval && approvalDoc.decision && approvalDoc.decision !== "DECLINED"),
    duplicateOf,
    acknowledged,
  });

  // A receipt total that now needs approval (or is late) puts approval back to REQUIRED (E.6.1).
  if ((result.verdict === "NEEDS_APPROVAL" || result.verdict === "LATE") && approvalState === "NOT_REQUIRED") {
    await transition({ expenseId, machine: "approval", event: "VERDICT_REQUIRES_APPROVAL", actor, requestId: meta.requestId, ip: meta.ip, userAgent: meta.userAgent });
  }

  const t = Timestamp.fromDate(at);
  const verdict = {
    code: result.verdict,
    ...(result.ruleId ? { ruleId: result.ruleId } : {}),
    citations: result.citations,
    explanation: result.explanation,
    owedShareCents: result.shares.owedShareCents,
    inputHash: sha256Hex(JSON.stringify([rv?.id ?? null, "receipt", receiptId, v.totalCents, v.date, e.approval.approvedCents ?? null, approvalState])).slice(0, 32),
    computedAt: t,
  };
  const expenseFields = {
    verdict,
    mode: "purchased",
    purchaseDate: Timestamp.fromDate(dateFromIso(v.date)),
    plannedDate: FieldValue.delete(),
    ...(match.issues.includes("BEFORE_APPROVAL") ? { purchasedBeforeApproval: true } : {}),
  };
  const receiptFields = {
    confirmed: { merchant: v.merchant.trim().slice(0, 120), date: Timestamp.fromDate(dateFromIso(v.date)), totalCents: v.totalCents, confirmedAt: t, confirmedBy: v.by },
    match: { result: match.result, issues: match.issues, ...(duplicateOf ? { possibleDuplicateOf: duplicateOf } : {}), at: t },
    acknowledged,
  };
  const extra = { issues: match.open, totalCents: v.totalCents };
  const writeAll = (tx: Transaction, ref: DocumentReference) => {
    tx.update(ref, expenseFields);
    tx.update(receiptsCol().doc(receiptId), receiptFields);
  };

  const state = ((await expenseRef.get()).data() as ExpenseDoc).settlement.state;
  if (state === "RECEIPT_SUBMITTED" || (state === "RECEIPT_ISSUE" && match.result === "OK")) {
    const event = state === "RECEIPT_SUBMITTED" ? (match.result === "OK" ? "MATCH_OK" : "MATCH_ISSUES") : "ISSUE_RESOLVED";
    await transition({
      expenseId,
      machine: "settlement",
      event,
      actor,
      payload: { extra },
      requestId: meta.requestId,
      ip: meta.ip,
      userAgent: meta.userAgent,
      loadFacts: async (_tx, current) => {
        if (current.receiptId !== receiptId) throw new AppError("STATE_CONFLICT", "A newer receipt replaced this one.");
        return {};
      },
      extraWrites: (tx, { expenseRef: ref }) => writeAll(tx, ref),
    });
    return;
  }
  if (state !== "RECEIPT_ISSUE") throw new AppError("STATE_CONFLICT", "This receipt was already confirmed.");
  // Still has issues: record the new values and issues, no state change.
  await db().runTransaction(async (tx) => {
    const current = (await tx.get(expenseRef)).data() as ExpenseDoc;
    if (current.settlement.state !== "RECEIPT_ISSUE" || current.receiptId !== receiptId) throw new AppError("STATE_CONFLICT", "This expense changed. Refresh and try again.");
    writeAll(tx, expenseRef);
    tx.update(expenseRef, { version: current.version + 1, updatedAt: t });
    tx.create(expenseRef.collection("events").doc(), { type: "receipt.rematched", machine: "note", actor: { kind: actor.kind, uid: actor.uid }, data: { event: "REMATCH", ...extra }, at: t });
  });
}

async function loadFamilyReceipt(ctx: FamilyContext, receiptId: string, requestId?: string): Promise<ReceiptDoc> {
  const snap = await receiptsCol().doc(receiptId).get();
  if (!snap.exists) throw new AppError("NOT_FOUND", "Receipt not found.");
  const r = snap.data() as ReceiptDoc;
  if (r.familyId !== ctx.familyId) {
    await audit({ familyId: ctx.familyId, actor: actorOf(ctx), action: "forbidden.receipt", target: `receipts/${receiptId}` }, requestId);
    throw new AppError("FORBIDDEN", "You do not have access to this receipt.");
  }
  return r;
}

/** GET /api/receipts/:id (member): the receipt and its match. */
export async function getReceipt(ctx: FamilyContext, receiptId: string, requestId?: string) {
  return { receipt: receiptView(receiptId, await loadFamilyReceipt(ctx, receiptId, requestId)) };
}

/**
 * GET /api/receipts/:id/url (RC-6): a 5-minute private download URL for a family member, or for the
 * paying parent through a payment link session on that claim. Never cached, never stored.
 */
export async function receiptViewUrl(receiptId: string, ctx: { user: SessionUser | null; linkSession: { tokenHash: string } | null }, requestId?: string) {
  const snap = await receiptsCol().doc(receiptId).get();
  if (!snap.exists) throw new AppError("NOT_FOUND", "Receipt not found.");
  const r = snap.data() as ReceiptDoc;
  let allowed = false;
  if (ctx.user) {
    const fam = await requireFamily(ctx.user).catch(() => null);
    allowed = fam?.familyId === r.familyId;
    if (!allowed && fam) await audit({ familyId: fam.familyId, actor: actorOf(fam), action: "forbidden.receipt_url", target: `receipts/${receiptId}` }, requestId);
  }
  if (!allowed && ctx.linkSession) {
    const { link } = await resolveLinkHash(ctx.linkSession.tokenHash).catch(() => ({ link: null }));
    allowed = Boolean(link && link.purpose === "payment" && link.familyId === r.familyId && link.resourcePath === `expenses/${r.expenseId}`);
  }
  if (!allowed) {
    if (!ctx.user && !ctx.linkSession) throw new AppError("UNAUTHENTICATED", "Please sign in.");
    throw new AppError("FORBIDDEN", "You do not have access to this receipt.");
  }
  const { url, expiresAt } = privateDownloadUrl(r.cloudinary.publicId, r.cloudinary.format);
  return { url, expiresAt: expiresAt.toISOString(), mimeType: r.mimeType };
}
