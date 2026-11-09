import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET as getExpense } from "@/app/api/expenses/[id]/route";
import { POST as confirmReceipt } from "@/app/api/receipts/[id]/confirm/route";
import { GET as receiptUrl } from "@/app/api/receipts/[id]/url/route";
import { db } from "@/lib/firebase/admin";
import { call } from "../helpers/api";
import { approve, askApproval, CLOUD, clearCloudinary, formField, heicBytes, jpegBytes, linkFromEmail, guestSession, newExpense, receiptReady, todayIso, upload, withCloudinary, type Fam } from "../helpers/claims";
import { resetEmulators } from "../helpers/emulator";
import { expectOk, ownerWithFamily } from "../helpers/flows";
import { GEMINI_PATH, geminiJson, withGemini } from "../helpers/gemini";
import { buildPdf } from "../helpers/pdf";
import { StubServer } from "../helpers/stub-server";

const stub = new StubServer();
beforeAll(async () => {
  await resetEmulators();
  await stub.start();
});
afterAll(() => stub.stop());
beforeEach(() => {
  stub.reset();
  withCloudinary(stub);
});
afterEach(clearCloudinary);

const UPLOAD = `/v1_1/${CLOUD}/image/upload`;

async function detail(f: Fam, id: string) {
  return (await expectOk(call(getExpense, { jar: f.owner.jar, params: { id } }))).json;
}
const confirm = (f: Fam, id: string, body: Record<string, unknown>) => call(confirmReceipt, { method: "POST", jar: f.owner.jar, params: { id }, body });

describe("upload", () => {
  it("RC-1: a 3 MB JPEG is stored private in Cloudinary; publicId and metadata saved, no URL", async () => {
    const f = await ownerWithFamily();
    const e = await newExpense(f, { category: "dental", description: "Cleaning", vendor: "Bright Smile Dental", amountCents: 12000 });
    const up = await upload(f.owner.jar, e.id, jpegBytes(3 * 1024 * 1024));
    expect(up.status).toBe(201);
    const sent = stub.calls.find((c) => c.path === UPLOAD)!;
    expect(formField(sent.body, "type")).toBe("private");
    expect(formField(sent.body, "folder")).toBe(`two-homes/test/${f.familyId}`);
    expect(formField(sent.body, "overwrite")).toBe("false");
    expect(formField(sent.body, "signature")).toMatch(/^[0-9a-f]{40,64}$/);
    expect(sent.body).not.toContain("test-cloudinary-secret");
    const doc = (await db().collection("receipts").doc(up.json.receipt.id).get()).data()!;
    expect(doc.cloudinary).toMatchObject({ publicId: `two-homes/test/${f.familyId}/${up.json.receipt.id}`, deliveryType: "private", resourceType: "image" });
    expect(JSON.stringify(doc)).not.toMatch(/https?:\/\//);
    expect(doc.parseStatus).toBe("failed"); // Gemini is not configured in this test: manual entry
    const d = await detail(f, e.id);
    expect(d.expense.settlement.state).toBe("RECEIPT_SUBMITTED");
    expect(d.expense.receiptId).toBe(up.json.receipt.id);
  });

  it("RC-2: HEIC from an iPhone and a PDF receipt are accepted", async () => {
    const f = await ownerWithFamily();
    const a = await newExpense(f, { category: "dental", description: "Cleaning", amountCents: 12000 });
    expect((await upload(f.owner.jar, a.id, heicBytes(), { name: "IMG_0001.HEIC", type: "image/heic" })).status).toBe(201);
    const b = await newExpense(f, { category: "school_supplies", description: "Notebooks", amountCents: 1200 });
    const pdf = buildPdf([["Office Store", `Total 12.00 ${Date.now()}`]]);
    const r = await upload(f.owner.jar, b.id, pdf, { name: "receipt.pdf", type: "application/pdf" });
    expect(r.status).toBe(201);
    expect(r.json.receipt.mimeType).toBe("application/pdf");
  });

  it("RC-3: 12 MB, GIF, a renamed text file and a 6-page PDF are refused with 400", async () => {
    const f = await ownerWithFamily();
    const e = await newExpense(f, { category: "dental", description: "Cleaning", amountCents: 12000 });
    expect((await upload(f.owner.jar, e.id, jpegBytes(12 * 1024 * 1024))).status).toBe(400);
    const gif = new Uint8Array(64);
    gif.set(Buffer.from("GIF89a"));
    expect((await upload(f.owner.jar, e.id, gif, { name: "r.gif", type: "image/gif" })).status).toBe(400);
    expect((await upload(f.owner.jar, e.id, new Uint8Array(Buffer.from("hello, this is not a picture at all")), { name: "receipt.jpg" })).status).toBe(400);
    const six = buildPdf([["1"], ["2"], ["3"], ["4"], ["5"], ["6"]]);
    expect((await upload(f.owner.jar, e.id, six, { name: "long.pdf", type: "application/pdf" })).status).toBe(400);
    expect(stub.calls.filter((c) => c.path === UPLOAD)).toHaveLength(0);
  });

  it("RC-4: the same file twice (also at the same time) gives one 201 and one 409 DUPLICATE_RECEIPT", async () => {
    const f = await ownerWithFamily();
    const a = await newExpense(f, { category: "dental", description: "Cleaning A", amountCents: 12000 });
    const b = await newExpense(f, { category: "dental", description: "Cleaning B", amountCents: 12000 });
    const bytes = jpegBytes();
    const [r1, r2] = await Promise.all([upload(f.owner.jar, a.id, bytes), upload(f.owner.jar, b.id, bytes)]);
    expect([r1.status, r2.status].sort()).toEqual([201, 409]);
    const dup = r1.status === 409 ? r1 : r2;
    expect(dup.json.error.code).toBe("DUPLICATE_RECEIPT");
    expect(dup.json.error.details.link).toMatch(/^\/app\/expenses\//);
    const c = await newExpense(f, { category: "dental", description: "Cleaning C", amountCents: 12000 });
    expect((await upload(f.owner.jar, c.id, bytes)).status).toBe(409);
  });

  it("RC-5: Cloudinary 5xx gives 502, the hash doc is removed and a retry works", async () => {
    const f = await ownerWithFamily();
    const e = await newExpense(f, { category: "dental", description: "Cleaning", amountCents: 12000 });
    stub.on("POST", UPLOAD, () => ({ status: 500, json: { error: { message: "internal" } } }));
    const bytes = jpegBytes();
    const r = await upload(f.owner.jar, e.id, bytes);
    expect(r.status).toBe(502);
    expect(r.json.error.code).toBe("UPLOAD_FAILED");
    expect(r.json.error.message).not.toContain("internal");
    expect((await db().collection("receiptHashes").where("expenseId", "==", e.id).get()).size).toBe(0);
    expect((await detail(f, e.id)).expense.settlement.state).toBe("NONE");
    withCloudinary(stub);
    expect((await upload(f.owner.jar, e.id, bytes)).status).toBe(201);
  });

  it("RC-5: a Cloudinary timeout is a 502 too", async () => {
    const f = await ownerWithFamily();
    const e = await newExpense(f, { category: "dental", description: "Cleaning", amountCents: 12000 });
    stub.on("POST", UPLOAD, async () => {
      await new Promise((r) => setTimeout(r, 2500));
      return { json: {} };
    });
    const r = await upload(f.owner.jar, e.id, jpegBytes());
    expect(r.status).toBe(502);
    expect(r.json.error.details.reason).toBe("timeout");
  });

  it("RC-6: the view URL is signed, expires after 5 minutes and is 403 for another family", async () => {
    const f = await ownerWithFamily();
    const e = await newExpense(f, { category: "dental", description: "Cleaning", amountCents: 12000 });
    const up = await upload(f.owner.jar, e.id, jpegBytes());
    const r = await expectOk(call(receiptUrl, { jar: f.owner.jar, params: { id: up.json.receipt.id } }));
    const url = new URL(r.json.url);
    expect(url.pathname).toBe(`/v1_1/${CLOUD}/image/download`);
    expect(url.searchParams.get("type")).toBe("private");
    const exp = Number(url.searchParams.get("expires_at"));
    expect(exp - Math.floor(Date.now() / 1000)).toBeGreaterThan(290);
    expect(exp - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(300);
    expect(url.searchParams.get("signature")).toBeTruthy();
    const other = await ownerWithFamily();
    expect((await call(receiptUrl, { jar: other.owner.jar, params: { id: up.json.receipt.id } })).status).toBe(403);
    expect((await call(receiptUrl, { params: { id: up.json.receipt.id } })).status).toBe(401);
  });
});

describe("reading and matching", () => {
  it("Gemini reads merchant, date and total; the parent confirms; match OK moves to READY", async () => {
    const f = await ownerWithFamily();
    const e = await newExpense(f);
    await approve(f, e.id);
    stub.on("POST", GEMINI_PATH, () => geminiJson({ readable: true, merchant: "Riverside FC", date: todayIso(), totalDollars: "350.00", lineItems: [{ label: "Summer camp", amountDollars: "350.00" }], confidence: 0.94 }));
    const up = await withGemini(stub, () => upload(f.owner.jar, e.id, jpegBytes()));
    expect(up.json.receipt).toMatchObject({ parseStatus: "parsed", parsed: { merchant: "Riverside FC", totalCents: 35000, confidence: 0.94 } });
    const c = await expectOk(confirm(f, up.json.receipt.id, { merchant: "Riverside FC", date: todayIso(), totalCents: 35000 }));
    expect(c.json.receipt.match).toMatchObject({ result: "OK", issues: [] });
    const d = await detail(f, e.id);
    expect(d.expense.settlement.state).toBe("READY");
    expect(d.expense.verdict.owedShareCents).toBe(14000);
    expect(d.expense.mode).toBe("purchased");
  });

  it("RC-7: Gemini cannot read the receipt; manual entry works", async () => {
    const f = await ownerWithFamily();
    const e = await newExpense(f, { category: "dental", description: "Cleaning", vendor: "Bright Smile Dental", amountCents: 12000 });
    stub.on("POST", GEMINI_PATH, () => geminiJson({ readable: false, confidence: 0.1 }));
    const up = await withGemini(stub, () => upload(f.owner.jar, e.id, jpegBytes()));
    expect(up.json.receipt).toMatchObject({ parseStatus: "failed", parseError: "unreadable", parsed: null });
    await expectOk(confirm(f, up.json.receipt.id, { merchant: "Bright Smile Dental", date: todayIso(), totalCents: 12000 }));
    expect((await detail(f, e.id)).expense.settlement.state).toBe("READY");
  });

  it("RC-8: a total above the approved amount is an issue; only the approved amount is claimable", async () => {
    const f = await ownerWithFamily();
    const e = await newExpense(f);
    await approve(f, e.id, { decision: "PARTIALLY_APPROVED", approvedCents: 20000 });
    const { receiptId, confirm: c } = await receiptReady(f, e.id, { totalCents: 35000 });
    expect(c.json.receipt.match).toMatchObject({ result: "ISSUES", open: ["OVER_APPROVED"] });
    let d = await detail(f, e.id);
    expect(d.expense.settlement.state).toBe("RECEIPT_ISSUE");
    expect(d.expense.verdict.owedShareCents).toBe(8000); // 40% of the approved $200
    await expectOk(confirm(f, receiptId, { merchant: "Riverside FC", date: todayIso(), totalCents: 35000, acknowledge: ["OVER_APPROVED"] }));
    d = await detail(f, e.id);
    expect(d.expense.settlement.state).toBe("READY");
  });

  it("RC-9: a purchase date before the approval is flagged BEFORE_APPROVAL", async () => {
    const f = await ownerWithFamily();
    const e = await newExpense(f);
    await approve(f, e.id);
    const { confirm: c } = await receiptReady(f, e.id, { date: todayIso(-2) });
    expect(c.json.receipt.match.open).toContain("BEFORE_APPROVAL");
    expect((await detail(f, e.id)).expense.settlement.state).toBe("RECEIPT_ISSUE");
  });

  it("purchased first: approval asked afterwards and given knowingly resolves BEFORE_APPROVAL (A.5.4)", async () => {
    const f = await ownerWithFamily();
    const e = await newExpense(f);
    const { confirm: c } = await receiptReady(f, e.id);
    expect(c.json.receipt.match.open).toEqual(["BEFORE_APPROVAL"]);
    await expectOk(askApproval(f, e.id));
    const token = linkFromEmail(f.coParentEmail, "a");
    const jar = await guestSession(token, f.coParentEmail);
    const { GET: summary } = await import("@/app/api/links/[token]/route");
    expect((await expectOk(call(summary, { params: { token }, jar }))).json.summary.purchasedBeforeApproval).toBe(true);
    const { POST: decision } = await import("@/app/api/links/[token]/decision/route");
    await expectOk(call(decision, { method: "POST", params: { token }, jar, body: { decision: "APPROVED" } }));
    expect((await detail(f, e.id)).expense.settlement.state).toBe("READY");
  });

  it("RC-10: a receipt after the 30-day deadline is LATE and needs approval; a later approval excuses it", async () => {
    const f = await ownerWithFamily();
    const e = await newExpense(f, { category: "dental", description: "Cleaning", vendor: "Bright Smile Dental", amountCents: 12000 });
    expect(e.approval.state).toBe("NOT_REQUIRED");
    const { confirm: c } = await receiptReady(f, e.id, { merchant: "Bright Smile Dental", totalCents: 12000, date: todayIso(-40) });
    expect(c.json.receipt.match.open).toEqual(["LATE"]);
    const d = await detail(f, e.id);
    expect(d.expense.verdict.code).toBe("LATE");
    expect(d.expense.approval.state).toBe("REQUIRED");
    expect(d.expense.settlement.state).toBe("RECEIPT_ISSUE");
    await expectOk(askApproval(f, e.id));
    const token = linkFromEmail(f.coParentEmail, "a");
    const jar = await guestSession(token, f.coParentEmail);
    const { POST: decision } = await import("@/app/api/links/[token]/decision/route");
    await expectOk(call(decision, { method: "POST", params: { token }, jar, body: { decision: "APPROVED" } }));
    expect((await detail(f, e.id)).expense.settlement.state).toBe("READY");
  });

  it("RC-11: same merchant, date and amount with a different file asks to confirm it is not a duplicate", async () => {
    const f = await ownerWithFamily();
    const a = await newExpense(f, { category: "dental", description: "Cleaning Mia", vendor: "Bright Smile Dental", amountCents: 12000 });
    await receiptReady(f, a.id, { merchant: "Bright Smile Dental", totalCents: 12000 });
    const b = await newExpense(f, { category: "dental", description: "Check-up", vendor: "Bright Smile Dental", amountCents: 12000 });
    const { receiptId, confirm: c } = await receiptReady(f, b.id, { merchant: "Bright Smile Dental Inc.", totalCents: 12000 });
    expect(c.json.receipt.match).toMatchObject({ result: "ISSUES", open: ["POSSIBLE_DUPLICATE"], possibleDuplicateOf: a.id });
    await expectOk(confirm(f, receiptId, { merchant: "Bright Smile Dental Inc.", date: todayIso(), totalCents: 12000, acknowledge: ["POSSIBLE_DUPLICATE"] }));
    expect((await detail(f, b.id)).expense.settlement.state).toBe("READY");
  });

  it("a store name that does not match the vendor is flagged; re-uploading the right receipt fixes it", async () => {
    const f = await ownerWithFamily();
    const e = await newExpense(f, { category: "dental", description: "Cleaning", vendor: "Bright Smile Dental", amountCents: 12000 });
    const { confirm: c } = await receiptReady(f, e.id, { merchant: "Target", totalCents: 12000 });
    expect(c.json.receipt.match.open).toEqual(["MERCHANT_MISMATCH"]);
    const again = await upload(f.owner.jar, e.id, jpegBytes());
    expect(again.status).toBe(201);
    await expectOk(confirm(f, again.json.receipt.id, { merchant: "Bright Smile Dental", date: todayIso(), totalCents: 12000 }));
    expect((await detail(f, e.id)).expense.settlement.state).toBe("READY");
  });

  it("a receipt date in the future is 400; confirming twice after READY is 409", async () => {
    const f = await ownerWithFamily();
    const e = await newExpense(f, { category: "dental", description: "Cleaning", vendor: "Dentist", amountCents: 12000 });
    const up = await upload(f.owner.jar, e.id, jpegBytes());
    expect((await confirm(f, up.json.receipt.id, { merchant: "Dentist", date: todayIso(5), totalCents: 12000 })).status).toBe(400);
    await expectOk(confirm(f, up.json.receipt.id, { merchant: "Dentist", date: todayIso(), totalCents: 12000 }));
    expect((await confirm(f, up.json.receipt.id, { merchant: "Dentist", date: todayIso(), totalCents: 12000 })).status).toBe(409);
  });
});
