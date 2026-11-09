// Quote verification (Section A.6.2). Pure, no dependencies, safe for client and server.
// Normalise both texts (lowercase, collapse whitespace, straight quotes, remove soft hyphens),
// then: exact substring on the claimed page, else exact on any page (warn), else fuzzy
// similarity >= 0.9 (Levenshtein ratio over a sliding window), else "none".

export type QuoteMatch = "exact" | "exact_other_page" | "fuzzy" | "none";

export type PageText = { page: number; text: string };

export type QuoteResult = {
  match: QuoteMatch;
  /** Page where the quote was found (the claimed page when match is "none"). */
  page: number;
  /** 1 for exact matches, the best similarity ratio otherwise. */
  score: number;
};

export const FUZZY_THRESHOLD = 0.9;
/** Quotes shorter than this cannot be fuzzy-matched: too easy to match by chance. */
const MIN_FUZZY_LENGTH = 20;
/** Upper bound for the fuzzy search so a long agreement cannot make verification slow. */
const MAX_FUZZY_QUOTE = 600;

export function normalizeText(input: string): string {
  return input
    .normalize("NFKC")
    .replace(/­/g, "") // soft hyphen
    .replace(/[‘’‚‛′`´]/g, "'")
    .replace(/[“”„‟″«»]/g, '"')
    .replace(/[‐-―−]/g, "-")
    // A word hyphenated across a line break in a PDF ("reim-\nbursement").
    .replace(/(\p{L})-\s*\n\s*(\p{L})/gu, "$1$2")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Levenshtein distance with two rows: O(a*b) time, O(b) memory. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

export function similarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  return 1 - levenshtein(a, b) / longest;
}

/**
 * Best similarity of `needle` against any window of `hay` of the same length (+/- 10%).
 * Windows start on word boundaries to keep the search fast.
 */
export function bestWindowSimilarity(needle: string, hay: string): number {
  if (!needle || !hay) return 0;
  const n = needle.length;
  if (hay.length <= n) return similarity(needle, hay);
  const starts: number[] = [0];
  for (let i = 1; i < hay.length; i++) if (hay[i - 1] === " ") starts.push(i);
  const sizes = [n, Math.round(n * 0.9), Math.round(n * 1.1)];
  let best = 0;
  for (const s of starts) {
    if (s + Math.round(n * 0.9) > hay.length) break;
    for (const size of sizes) {
      const window = hay.slice(s, s + size);
      // Cheap lower bound: the length difference alone already rules this window out.
      if (1 - Math.abs(window.length - n) / Math.max(window.length, n) < best) continue;
      const score = similarity(needle, window);
      if (score > best) best = score;
      if (best === 1) return 1;
    }
  }
  return best;
}

/** Text of one page plus the next, so a quote that runs over a page break is found. */
function withNext(pages: PageText[], i: number): string {
  const next = pages[i + 1];
  return next ? `${pages[i].text} ${next.text}` : pages[i].text;
}

/** The quote starts on page i (it may continue onto page i + 1). */
function startsOn(pages: PageText[], i: number, q: string): boolean {
  const at = withNext(pages, i).indexOf(q);
  return at >= 0 && at < pages[i].text.length;
}

export function verifyQuote(quote: string, pages: PageText[], claimedPage: number): QuoteResult {
  const q = normalizeText(quote);
  if (q.length < 8 || pages.length === 0) return { match: "none", page: claimedPage, score: 0 };
  const norm = [...pages].sort((a, b) => a.page - b.page).map((p) => ({ page: p.page, text: normalizeText(p.text) }));

  // 1. Exact on the claimed page: it starts there, or it starts on the previous page and runs onto it.
  const ci = norm.findIndex((p) => p.page === claimedPage);
  if (ci >= 0 && startsOn(norm, ci, q)) return { match: "exact", page: claimedPage, score: 1 };
  if (ci > 0 && startsOn(norm, ci - 1, q) && !norm[ci - 1].text.includes(q)) return { match: "exact", page: claimedPage, score: 1 };

  // 2. Exact on another page (warn). The same clause repeated on two pages resolves to the claimed page above.
  for (let i = 0; i < norm.length; i++) {
    if (startsOn(norm, i, q)) return { match: "exact_other_page", page: norm[i].page, score: 1 };
  }

  // 3. Fuzzy, claimed page first.
  if (q.length >= MIN_FUZZY_LENGTH && q.length <= MAX_FUZZY_QUOTE) {
    const order = ci >= 0 ? [ci, ...norm.map((_, i) => i).filter((i) => i !== ci)] : norm.map((_, i) => i);
    let best = { score: 0, page: claimedPage };
    for (const i of order) {
      const score = bestWindowSimilarity(q, withNext(norm, i));
      if (score > best.score) best = { score, page: norm[i].page };
      if (score >= 0.999) break;
    }
    if (best.score >= FUZZY_THRESHOLD) return { match: "fuzzy", page: best.page, score: Math.round(best.score * 1000) / 1000 };
    return { match: "none", page: claimedPage, score: Math.round(best.score * 1000) / 1000 };
  }
  return { match: "none", page: claimedPage, score: 0 };
}

/** Character range of a quote inside raw page text, for highlighting in the source sheet. */
export function locateQuote(quote: string, pageText: string): { start: number; end: number } | null {
  const q = normalizeText(quote);
  if (!q) return null;
  // Map each normalised character back to its raw index (same rules as normalizeText, per char).
  const map: number[] = [];
  let norm = "";
  let lastSpace = true;
  const raw = pageText.normalize("NFKC");
  for (let i = 0; i < raw.length; i++) {
    let ch = raw[i];
    if (ch === "­") continue;
    if (/[‘’‚‛′`´]/.test(ch)) ch = "'";
    else if (/[“”„‟″«»]/.test(ch)) ch = '"';
    else if (/[‐-―−]/.test(ch)) ch = "-";
    if (/\s/.test(ch)) {
      if (lastSpace) continue;
      ch = " ";
      lastSpace = true;
    } else lastSpace = false;
    norm += ch.toLowerCase();
    map.push(i);
  }
  const at = norm.indexOf(q);
  if (at < 0) return null;
  return { start: map[at], end: map[at + q.length - 1] + 1 };
}
