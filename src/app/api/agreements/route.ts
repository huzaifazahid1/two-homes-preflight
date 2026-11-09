import { uploadAgreement } from "@/lib/agreements";
import { requireOwner } from "@/lib/auth/session";
import { HOUR_MS } from "@/lib/clock";
import { AppError } from "@/lib/errors";
import { MAX_PDF_BYTES } from "@/lib/pdf";
import { route } from "@/lib/route";
import { pastedAgreementSchema } from "@/schemas";

// Upload a PDF (multipart field "file") or pasted text (JSON { text }). Owner only.
// The body is read here instead of by route(), because it is either multipart or JSON.
export const POST = route(
  {
    name: "POST /api/agreements",
    auth: "user",
    rateLimit: ({ user }) => ({ key: `agreement-upload:${user!.uid}`, limit: 20, windowMs: HOUR_MS, message: "Too many uploads. Try again in an hour." }),
  },
  async ({ req, user }) => {
    const ctx = await requireOwner(user!);
    const type = req.headers.get("content-type") ?? "";
    if (type.startsWith("multipart/form-data")) {
      const declared = Number(req.headers.get("content-length") ?? 0);
      if (declared > MAX_PDF_BYTES + 64 * 1024) throw new AppError("INVALID", "The PDF is larger than 10 MB. Upload a smaller file or paste the text.");
      let form: FormData;
      try {
        form = await req.formData();
      } catch (err) {
        throw new AppError("INVALID", "The upload could not be read. Please try again.", { cause: err });
      }
      const file = form.get("file");
      if (!(file instanceof File)) throw new AppError("INVALID", "Choose a PDF file to upload.");
      if (file.size > MAX_PDF_BYTES) throw new AppError("INVALID", "The PDF is larger than 10 MB. Upload a smaller file or paste the text.");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = await uploadAgreement(ctx, { kind: "pdf", bytes, fileName: file.name || "agreement.pdf" });
      return Response.json({ agreement: result }, { status: 201 });
    }
    let json: unknown;
    try {
      json = await req.json();
    } catch (err) {
      throw new AppError("INVALID", "Send a PDF file or the pasted text.", { cause: err });
    }
    const parsed = pastedAgreementSchema.safeParse(json);
    if (!parsed.success) throw new AppError("INVALID", parsed.error.issues[0]?.message ?? "Paste the agreement text.");
    const result = await uploadAgreement(ctx, { kind: "text", text: parsed.data.text, fileName: parsed.data.fileName });
    return Response.json({ agreement: result }, { status: 201 });
  },
);
