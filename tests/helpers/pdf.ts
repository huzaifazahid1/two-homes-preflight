// Builds small, valid PDFs for tests (no dependency). Each page gets its lines as Helvetica text;
// an empty page list entry makes a page without a text layer (like a scanned page).

function esc(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

export function buildPdf(pages: string[][]): Uint8Array {
  const objects: string[] = [];
  const add = (body: string) => {
    objects.push(body);
    return objects.length;
  };
  const catalog = add("");
  const pagesObj = add("");
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const kids: number[] = [];
  for (const lines of pages) {
    const ops = lines.length
      ? `BT /F1 11 Tf 14 TL 50 780 Td ${lines.map((l) => `(${esc(l)}) Tj T*`).join(" ")} ET`
      : "0.9 g 50 50 500 700 re f"; // a filled box: no text, like an image-only scan
    const content = add(`<< /Length ${Buffer.byteLength(ops, "latin1")} >>\nstream\n${ops}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objects[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, "latin1"));
}

/** The demo agreement as a PDF: one PDF page per "--- Page N ---" section. */
export function demoAgreementPdf(markdown: string): Uint8Array {
  const sections = markdown.split(/^--- Page \d+ ---$/m).map((s) => s.trim()).filter(Boolean);
  return buildPdf(sections.map((s) => s.split(/\n+/).flatMap((line) => wrap(line, 95))));
}

function wrap(line: string, width: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const word of line.split(" ")) {
    if (cur && cur.length + word.length + 1 > width) {
      out.push(cur);
      cur = word;
    } else cur = cur ? `${cur} ${word}` : word;
  }
  if (cur) out.push(cur);
  return out;
}

/** multipart/form-data body with one file field, for calling the upload handler directly. */
export function multipart(file: Uint8Array, name: string, type = "application/pdf") {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(file)], { type }), name);
  return form;
}
