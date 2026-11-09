// Receipt file checks (Section I.2 step 3). Pure: decides by magic bytes, never by the
// file name or the browser's content type (RC-3: a renamed text file is refused).

export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;
export const MAX_RECEIPT_PDF_PAGES = 5;

export type ReceiptFileType = { mime: "image/jpeg" | "image/png" | "image/webp" | "image/heic" | "application/pdf"; ext: "jpg" | "png" | "webp" | "heic" | "pdf" };

const HEIF_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"]);

function ascii(bytes: Uint8Array, start: number, end: number): string {
  let s = "";
  for (let i = start; i < Math.min(end, bytes.length); i++) s += String.fromCharCode(bytes[i]);
  return s;
}

/** JPEG, PNG, WEBP, HEIC/HEIF or PDF; null for anything else (GIF, text, executables). */
export function detectReceiptType(bytes: Uint8Array): ReceiptFileType | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (bytes[0] === 0x89 && ascii(bytes, 1, 4) === "PNG" && bytes[4] === 0x0d && bytes[5] === 0x0a) return { mime: "image/png", ext: "png" };
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return { mime: "image/webp", ext: "webp" };
  // ISO base media: [size:4]["ftyp"][major brand:4]...; iPhone photos are "heic" or "mif1".
  if (ascii(bytes, 4, 8) === "ftyp" && HEIF_BRANDS.has(ascii(bytes, 8, 12).toLowerCase())) return { mime: "image/heic", ext: "heic" };
  // "%PDF-" within the first 1 KB (some generators put a few bytes before it).
  if (ascii(bytes, 0, 1024).includes("%PDF-")) return { mime: "application/pdf", ext: "pdf" };
  return null;
}
