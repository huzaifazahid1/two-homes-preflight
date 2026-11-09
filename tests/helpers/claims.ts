import { POST as requestApproval } from "@/app/api/expenses/[id]/approval-request/route";
import { POST as uploadReceipt } from "@/app/api/expenses/[id]/receipts/route";
import { POST as createExpense } from "@/app/api/expenses/route";
import { POST as decision } from "@/app/api/links/[token]/decision/route";
import { POST as sendOtp } from "@/app/api/links/[token]/otp/route";
import { POST as verifyOtp } from "@/app/api/links/[token]/otp/verify/route";
import { POST as confirmReceipt } from "@/app/api/receipts/[id]/confirm/route";
import { POST as paymentRequest } from "@/app/api/expenses/[id]/payment-request/route";
import { DAY_MS, now } from "@/lib/clock";
import { readMemoryOutbox } from "@/lib/email/outbox";
import { resetEnvCache } from "@/lib/env";
import { call, CookieJar } from "./api";
import { expectOk, lastCodeFor, ownerWithFamily } from "./flows";
import type { StubServer } from "./stub-server";

// Phase 3 flows: approvals by link + code, receipts through the Cloudinary stub, claims.

export type Fam = Awaited<ReturnType<typeof ownerWithFamily>>;

export const CLOUD = "test-cloud";

/** Calendar day (UTC) relative to the app clock. */
export function todayIso(offsetDays = 0): string {
  return new Date(now().getTime() + offsetDays * DAY_MS).toISOString().slice(0, 10);
}

/** Points the Cloudinary client at the stub and answers uploads like Cloudinary does. */
export function withCloudinary(stub: StubServer) {
  process.env.CLOUDINARY_CLOUD_NAME = CLOUD;
  process.env.CLOUDINARY_API_KEY = "123456789012345";
  process.env.CLOUDINARY_API_SECRET = "test-cloudinary-secret";
  process.env.CLOUDINARY_FOLDER_PREFIX = "two-homes/test";
  process.env.CLOUDINARY_API_BASE = stub.url;
  process.env.CLOUDINARY_TIMEOUT_MS = "2000";
  resetEnvCache();
  stubCloudinaryOk(stub);
}

export function clearCloudinary() {
  for (const k of ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET", "CLOUDINARY_FOLDER_PREFIX", "CLOUDINARY_API_BASE", "CLOUDINARY_TIMEOUT_MS"]) delete process.env[k];
  resetEnvCache();
}

export function formField(body: string, name: string): string | null {
  const m = new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r]*)\\r\\n`).exec(body);
  return m ? m[1] : null;
}

export function stubCloudinaryOk(stub: StubServer) {
  let version = 1700000000;
  stub.on("POST", `/v1_1/${CLOUD}/image/upload`, (req) => {
    const folder = formField(req.body, "folder");
    const publicId = formField(req.body, "public_id");
    const format = /Content-Type: application\/pdf/.test(req.body) ? "pdf" : /image\/heic/.test(req.body) ? "heic" : "jpg";
    return { json: { public_id: `${folder}/${publicId}`, version: ++version, format, bytes: req.body.length, width: 800, height: 1200, asset_id: `asset_${publicId}`, type: "private", resource_type: "image" } };
  });
  stub.on("POST", `/v1_1/${CLOUD}/image/destroy`, () => ({ json: { result: "ok" } }));
}

let seed = 0;
/** A small "JPEG": correct magic bytes plus unique content, so each call has a new hash. */
export function jpegBytes(size = 2048, unique: string | number = ++seed): Uint8Array {
  const b = new Uint8Array(size);
  b.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);
  const tag = Buffer.from(`thp-${unique}-${Date.now()}-${Math.random()}`);
  b.set(tag.subarray(0, Math.min(tag.length, size - 20)), 16);
  return b;
}

export function heicBytes(): Uint8Array {
  const b = jpegBytes(1024);
  b.set([0, 0, 0, 0x18], 0);
  b.set(Buffer.from("ftypheic"), 4);
  return b;
}

export async function upload(jar: CookieJar, expenseId: string, bytes: Uint8Array, opts: { name?: string; type?: string } = {}) {
  const form = new FormData();
  form.set("file", new Blob([new Uint8Array(bytes)], { type: opts.type ?? "image/jpeg" }), opts.name ?? "receipt.jpg");
  const req = new Request(`http://localhost:3100/api/expenses/${expenseId}/receipts`, { method: "POST", headers: { cookie: jar.header() }, body: form });
  const res = await uploadReceipt(req, { params: Promise.resolve({ id: expenseId }) });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

export const campBody = (f: Fam, over: Record<string, unknown> = {}) => ({
  childId: f.childId, category: "extracurricular", description: "Riverside FC soccer camp", vendor: "Riverside FC", amountCents: 35000, mode: "planned", date: "2026-11-14", paidByRole: "owner", ...over,
});

export async function newExpense(f: Fam, over: Record<string, unknown> = {}) {
  const r = await expectOk(call(createExpense, { method: "POST", path: "/api/expenses", jar: f.owner.jar, body: { ...campBody(f, over), confirmDuplicate: true } }));
  return r.json.expense as { id: string; verdict: { code: string; owedShareCents: number }; approval: { state: string } };
}

export function linkFromEmail(to: string, kind: "a" | "p"): string {
  const mails = readMemoryOutbox().filter((m) => m.to === to && m.text.includes(`/${kind}/`));
  const last = mails[mails.length - 1];
  if (!last) throw new Error(`no /${kind}/ email for ${to}`);
  const m = new RegExp(`/${kind}/([A-Za-z0-9_-]{43})`).exec(last.text);
  return m![1];
}

/** Guest opens the link, asks for a code and enters it. Returns their cookie jar. */
export async function guestSession(token: string, email: string): Promise<CookieJar> {
  const jar = new CookieJar();
  await expectOk(call(sendOtp, { method: "POST", params: { token }, jar }));
  await expectOk(call(verifyOtp, { method: "POST", params: { token }, jar, body: { code: lastCodeFor(email) } }));
  return jar;
}

export async function askApproval(f: Fam, expenseId: string) {
  const r = await call(requestApproval, { method: "POST", jar: f.owner.jar, params: { id: expenseId } });
  return r;
}

export async function approve(f: Fam, expenseId: string, body: Record<string, unknown> = { decision: "APPROVED" }) {
  await expectOk(askApproval(f, expenseId));
  const token = linkFromEmail(f.coParentEmail, "a");
  const jar = await guestSession(token, f.coParentEmail);
  const r = await call(decision, { method: "POST", params: { token }, jar, body });
  return { token, jar, r };
}

export async function receiptReady(f: Fam, expenseId: string, values: { merchant?: string; date?: string; totalCents?: number; acknowledge?: string[] } = {}) {
  const up = await upload(f.owner.jar, expenseId, jpegBytes());
  if (up.status !== 201) throw new Error(`upload failed ${up.status} ${JSON.stringify(up.json)}`);
  const id = up.json.receipt.id as string;
  const c = await call(confirmReceipt, { method: "POST", jar: f.owner.jar, params: { id }, body: { merchant: "Riverside FC", date: todayIso(), totalCents: 35000, ...values } });
  return { receiptId: id, confirm: c };
}

export async function claimSent(f: Fam, expenseId: string) {
  return expectOk(call(paymentRequest, { method: "POST", jar: f.owner.jar, params: { id: expenseId } }));
}
