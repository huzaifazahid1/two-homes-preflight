import "server-only";
import { extractText, getDocumentProxy } from "unpdf";
import { AppError } from "@/lib/errors";

// Agreement text (Section A.5.1 step 2, E.2 agreements/pages). The PDF itself is never stored:
// we read per-page text with unpdf and keep only that.

export const MAX_PDF_BYTES = 10 * 1024 * 1024;
export const MAX_PAGES = 50;
export const MAX_PASTED_CHARS = 300_000;
/** Below this many letters per page on average, the PDF is treated as scanned (no text layer). */
const MIN_LETTERS_PER_PAGE = 40;

export type ExtractedPage = { page: number; text: string };

export function isPdfMagic(bytes: Uint8Array): boolean {
  // "%PDF-" within the first 1 KB (some generators put a few bytes before it).
  const head = Buffer.from(bytes.subarray(0, 1024)).toString("latin1");
  return head.includes("%PDF-");
}

function letters(text: string): number {
  return (text.match(/\p{L}/gu) ?? []).length;
}

export function looksScanned(pages: ExtractedPage[]): boolean {
  if (pages.length === 0) return true;
  const total = pages.reduce((n, p) => n + letters(p.text), 0);
  return total / pages.length < MIN_LETTERS_PER_PAGE;
}

/** Validates and reads a PDF. 400 for wrong type, too large, too many pages, password or corrupt. */
export async function readPdfPages(bytes: Uint8Array): Promise<{ pages: ExtractedPage[]; scanned: boolean }> {
  if (bytes.byteLength > MAX_PDF_BYTES) throw new AppError("INVALID", "The PDF is larger than 10 MB. Upload a smaller file or paste the text.");
  if (bytes.byteLength === 0) throw new AppError("INVALID", "The file is empty.");
  if (!isPdfMagic(bytes)) throw new AppError("INVALID", "This file is not a PDF. Upload the agreement as a PDF, or paste its text.");

  let doc;
  try {
    // unpdf transfers the buffer to its worker: pass a copy so the caller's bytes stay usable.
    doc = await getDocumentProxy(new Uint8Array(bytes));
  } catch (err) {
    const name = (err as { name?: string } | null)?.name ?? "";
    if (name === "PasswordException") {
      throw new AppError("INVALID", "This PDF is password protected. Remove the password, or paste the text instead.", { cause: err });
    }
    throw new AppError("INVALID", "This PDF could not be read. It may be damaged. Try exporting it again, or paste the text.", { cause: err });
  }
  try {
    if (doc.numPages > MAX_PAGES) {
      throw new AppError("INVALID", `The agreement has ${doc.numPages} pages. The limit is ${MAX_PAGES} pages.`, { details: { pageCount: doc.numPages, limit: MAX_PAGES } });
    }
    const { text } = await extractText(doc, { mergePages: false });
    const pages = text.map((t, i) => ({ page: i + 1, text: tidy(t) }));
    return { pages, scanned: looksScanned(pages) };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError("INVALID", "The text of this PDF could not be read. Paste the text instead.", { cause: err });
  } finally {
    // Frees parsed pages; the document itself is garbage collected.
    await doc.cleanup().catch(() => undefined);
  }
}

function tidy(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

const PAGE_MARKER = /^[ \t]*(?:-{3,}|={3,})?[ \t]*page[ \t]+(\d{1,3})(?:[ \t]+of[ \t]+\d{1,3})?[ \t]*(?:-{3,}|={3,})?[ \t]*$/gim;
const CHUNK = 4000;

/**
 * Pasted text: pages split on form feeds or marker lines like "--- Page 2 ---".
 * Without markers, long text is split at paragraph boundaries into sections of ~4000 characters.
 */
export function pagesFromPastedText(input: string): ExtractedPage[] {
  const text = tidy(input);
  if (!text) throw new AppError("INVALID", "Paste the agreement text first.");
  if (text.length > MAX_PASTED_CHARS) throw new AppError("INVALID", "The pasted text is too long. The limit is about 50 pages.");

  let parts: string[];
  if (text.includes("\f")) {
    parts = text.split("\f");
  } else if (PAGE_MARKER.test(text)) {
    PAGE_MARKER.lastIndex = 0;
    parts = text.split(PAGE_MARKER).filter((_, i) => i % 2 === 0);
    // Text before the first marker belongs to page 1 only when there is any.
    if (parts[0].trim() === "") parts = parts.slice(1);
  } else {
    parts = [];
    let current = "";
    for (const para of text.split(/\n\s*\n/)) {
      if (current && current.length + para.length > CHUNK) {
        parts.push(current);
        current = "";
      }
      current = current ? `${current}\n\n${para}` : para;
    }
    if (current) parts.push(current);
  }
  const pages = parts.map((t) => tidy(t)).filter((t) => t.length > 0).map((t, i) => ({ page: i + 1, text: t }));
  if (pages.length > MAX_PAGES) throw new AppError("INVALID", `The text has more than ${MAX_PAGES} pages.`);
  if (pages.reduce((n, p) => n + letters(p.text), 0) < 200) throw new AppError("INVALID", "That text is too short to be a parenting agreement.");
  return pages;
}
