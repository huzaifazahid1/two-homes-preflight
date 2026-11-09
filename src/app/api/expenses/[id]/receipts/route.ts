import { requestMeta } from "@/lib/audit";
import { requireFamily } from "@/lib/auth/session";
import { HOUR_MS } from "@/lib/clock";
import { AppError } from "@/lib/errors";
import { consumeRateLimit } from "@/lib/rate-limit";
import { MAX_RECEIPT_BYTES } from "@/lib/receipts/file-type";
import { uploadReceipt } from "@/lib/receipts/upload";
import { route } from "@/lib/route";
import { docIdParams } from "@/schemas";

const TOO_BIG = "The file is larger than 10 MB. Take a smaller photo or upload a PDF.";

// Receipt upload (multipart, field "file"). The type is checked by magic bytes on the server (Section I.2).
export const POST = route({ name: "POST /api/expenses/:id/receipts", auth: "user", params: docIdParams }, async ({ user, params, req, requestId }) => {
  const ctx = await requireFamily(user!);
  await consumeRateLimit({ key: `upload:${ctx.familyId}`, limit: 20, windowMs: HOUR_MS, message: "Your family uploaded 20 receipts in the last hour. Try again later." });
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_RECEIPT_BYTES + 64 * 1024) throw new AppError("INVALID", TOO_BIG);
  let form: FormData;
  try {
    form = await req.formData();
  } catch (err) {
    throw new AppError("INVALID", "Send the receipt as a file upload.", { cause: err });
  }
  const file = form.get("file");
  if (!(file instanceof Blob)) throw new AppError("INVALID", "Choose a receipt photo or PDF.", { details: { fields: [{ path: "body.file", message: "Choose a file" }] } });
  if (file.size > MAX_RECEIPT_BYTES) throw new AppError("INVALID", TOO_BIG);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const name = typeof (file as File).name === "string" ? (file as File).name : "receipt";
  const out = await uploadReceipt(ctx, params.id, { bytes, fileName: name }, { requestId, ...requestMeta(req) });
  return Response.json(out, { status: 201 });
});
