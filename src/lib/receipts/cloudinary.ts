import "server-only";
import { v2 as cloudinary } from "cloudinary";
import { z } from "zod";
import { nowMs } from "@/lib/clock";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { log } from "@/lib/log";

// Cloudinary receipts (Section I). Private delivery only; we keep publicId + metadata, never a URL.
// Requests are signed with the SDK's own signing helpers (api_sign_request, private_download_url)
// and sent with fetch so every call has a hard timeout and tests can point at a local stub
// (docs/decisions.md 3.x). The API secret never leaves the server.

export const VIEW_URL_TTL_SECONDS = 300;

type Config = { cloudName: string; apiKey: string; apiSecret: string; base: string; timeoutMs: number; folderPrefix: string };

function config(): Config {
  const e = env();
  if (!e.CLOUDINARY_CLOUD_NAME || !e.CLOUDINARY_API_KEY || !e.CLOUDINARY_API_SECRET) {
    throw new AppError("UPLOAD_FAILED", "Receipt storage is not configured on this server.", { details: { reason: "not_configured" } });
  }
  return {
    cloudName: e.CLOUDINARY_CLOUD_NAME,
    apiKey: e.CLOUDINARY_API_KEY,
    apiSecret: e.CLOUDINARY_API_SECRET,
    base: e.CLOUDINARY_API_BASE.replace(/\/$/, ""),
    timeoutMs: e.CLOUDINARY_TIMEOUT_MS,
    folderPrefix: e.CLOUDINARY_FOLDER_PREFIX,
  };
}

export function receiptFolder(familyId: string): string {
  return `${config().folderPrefix}/${familyId}`;
}

const uploadResponse = z.object({
  public_id: z.string().min(1),
  version: z.number().int(),
  format: z.string().min(1),
  bytes: z.number().int().nonnegative(),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  pages: z.number().int().optional(),
  asset_id: z.string().min(1),
  type: z.string().optional(),
  resource_type: z.string().optional(),
});
export type UploadedAsset = z.infer<typeof uploadResponse>;

function sign(params: Record<string, string>, secret: string): string {
  return cloudinary.utils.api_sign_request(params, secret);
}

async function post(cfg: Config, action: "upload" | "destroy", form: FormData, requestId?: string): Promise<unknown> {
  const url = `${cfg.base}/v1_1/${encodeURIComponent(cfg.cloudName)}/image/${action}`;
  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", body: form, signal: AbortSignal.timeout(cfg.timeoutMs) });
  } catch (err) {
    const timeout = (err as { name?: string } | null)?.name === "TimeoutError";
    log.error("cloudinary.request_failed", { requestId, action, reason: timeout ? "timeout" : "network", error: err, durationMs: Date.now() - started });
    throw new AppError("UPLOAD_FAILED", timeout ? "Receipt storage took too long to answer. Please try again." : "Receipt storage could not be reached. Please try again.", {
      details: { reason: timeout ? "timeout" : "network" },
      cause: err,
    });
  }
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    // Cloudinary puts a human message in error.message; it is logged, never shown to users.
    const providerMessage = (body as { error?: { message?: string } } | null)?.error?.message;
    log.error("cloudinary.error", { requestId, action, status: res.status, providerMessage, durationMs: Date.now() - started });
    throw new AppError("UPLOAD_FAILED", "Receipt storage is unavailable right now. Please try again.", { details: { reason: `status_${res.status}` } });
  }
  log.info("cloudinary.ok", { requestId, action, durationMs: Date.now() - started });
  return body;
}

/** Upload as a private image resource (PDFs are image resources in Cloudinary). Never overwrites. */
export async function uploadReceipt(input: { bytes: Uint8Array; mimeType: string; publicId: string; familyId: string; expenseId: string; requestId?: string }): Promise<UploadedAsset> {
  const cfg = config();
  const params: Record<string, string> = {
    context: `expenseId=${input.expenseId}`,
    folder: `${cfg.folderPrefix}/${input.familyId}`,
    overwrite: "false",
    public_id: input.publicId,
    tags: `receipt,${input.familyId}`,
    timestamp: String(Math.floor(nowMs() / 1000)),
    type: "private",
    unique_filename: "false",
  };
  const form = new FormData();
  for (const [k, v] of Object.entries(params)) form.set(k, v);
  form.set("api_key", cfg.apiKey);
  form.set("signature", sign(params, cfg.apiSecret));
  form.set("file", new Blob([new Uint8Array(input.bytes)], { type: input.mimeType }), input.publicId);
  const body = await post(cfg, "upload", form, input.requestId);
  const parsed = uploadResponse.safeParse(body);
  if (!parsed.success) {
    log.error("cloudinary.bad_response", { requestId: input.requestId, issues: parsed.error.issues.slice(0, 3).map((i) => i.path.join(".")) });
    throw new AppError("UPLOAD_FAILED", "Receipt storage sent an unexpected answer. Please try again.", { details: { reason: "bad_response" } });
  }
  return parsed.data;
}

/** Removes an uploaded asset (compensation when our own write fails after the upload). */
export async function destroyReceipt(publicId: string, requestId?: string): Promise<void> {
  const cfg = config();
  const params: Record<string, string> = { invalidate: "true", public_id: publicId, timestamp: String(Math.floor(nowMs() / 1000)), type: "private" };
  const form = new FormData();
  for (const [k, v] of Object.entries(params)) form.set(k, v);
  form.set("api_key", cfg.apiKey);
  form.set("signature", sign(params, cfg.apiSecret));
  await post(cfg, "destroy", form, requestId);
}

/** Short-lived download URL from the Cloudinary download API (Section I.1). Not CDN cached. */
export function privateDownloadUrl(publicId: string, format: string): { url: string; expiresAt: Date } {
  const cfg = config();
  const expiresAt = Math.floor(nowMs() / 1000) + VIEW_URL_TTL_SECONDS;
  const options = {
    resource_type: "image",
    type: "private",
    expires_at: expiresAt,
    api_key: cfg.apiKey,
    api_secret: cfg.apiSecret,
    cloud_name: cfg.cloudName,
    upload_prefix: cfg.base,
  };
  const url = cloudinary.utils.private_download_url(publicId, format, options as Parameters<typeof cloudinary.utils.private_download_url>[2]);
  return { url, expiresAt: new Date(expiresAt * 1000) };
}
