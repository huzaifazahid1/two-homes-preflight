"use client";

import { cn } from "cn";
import { FileText, FileUp, PenLine, RotateCcw } from "lucide-react";
import { useRef, useState } from "react";
import { Segmented } from "@/components/domain/segmented";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, api, errorMessage } from "@/hooks/api";
import type { RuleVersionView } from "@/types/views";

// Agreement upload (A.5.1 step 2): PDF (<= 10 MB, <= 50 pages) or pasted text, then extraction.
// A scanned PDF switches to paste (ON-6). AI failure offers retry or manual entry (AG-8).

type Phase = { kind: "idle" } | { kind: "uploading" } | { kind: "extracting"; agreementId: string } | { kind: "failed"; agreementId: string; message: string; manual: boolean; upgrade: boolean };

const MAX = 10 * 1024 * 1024;

async function uploadFile(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  let res: Response;
  try {
    res = await fetch("/api/agreements", { method: "POST", body: form, credentials: "same-origin" });
  } catch {
    throw new ApiError(0, "NETWORK", "You appear to be offline. Check your connection and try again.");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error?.code ?? "UNKNOWN", data?.error?.message ?? "The upload failed. Please try again.", data?.error?.requestId, data?.error?.details);
  return data.agreement.id as string;
}

export function AgreementUpload({ onDraft, pendingAgreementId, title = "Add your agreement" }: { onDraft: (draft: RuleVersionView) => void; pendingAgreementId?: string | null; title?: string }) {
  const [method, setMethod] = useState<"pdf" | "text">("pdf");
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>(pendingAgreementId ? { kind: "failed", agreementId: pendingAgreementId, message: "The last extraction did not finish. Try again or add the rules by hand.", manual: true, upgrade: false } : { kind: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [scanned, setScanned] = useState(false);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  function pick(f: File | undefined | null) {
    setError(null);
    if (!f) return;
    if (f.size > MAX) return setError("The PDF is larger than 10 MB. Upload a smaller file or paste the text.");
    if (f.type && f.type !== "application/pdf") return setError("Choose a PDF file, or paste the text instead.");
    setFile(f);
  }

  async function extract(agreementId: string, mode: "ai" | "manual" = "ai") {
    setPhase({ kind: "extracting", agreementId });
    try {
      const { draft } = await api<{ draft: RuleVersionView }>(`/api/agreements/${agreementId}/extract`, { method: "POST", body: { mode } });
      onDraft(draft);
    } catch (e) {
      const details = e instanceof ApiError ? e.details : undefined;
      setPhase({ kind: "failed", agreementId, message: errorMessage(e), manual: Boolean(details?.manualEntry) || mode === "ai", upgrade: Boolean(details?.upgrade) });
    }
  }

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (method === "pdf" && !file) return setError("Choose the agreement PDF first.");
    if (method === "text" && text.trim().length < 200) return setError("Paste the full agreement text. That looks too short.");
    setPhase({ kind: "uploading" });
    try {
      const id = method === "pdf" ? await uploadFile(file!) : (await api<{ agreement: { id: string } }>("/api/agreements", { method: "POST", body: { text } })).agreement.id;
      await extract(id);
    } catch (err) {
      setPhase({ kind: "idle" });
      if (err instanceof ApiError && err.details?.reason === "scanned") {
        setScanned(true);
        setMethod("text");
      }
      setError(errorMessage(err));
    }
  }

  if (phase.kind === "extracting" || phase.kind === "uploading") {
    return (
      <div role="status" className="rounded-[14px] border border-border bg-surface p-6">
        <div className="flex items-start gap-4">
          <Spinner className="mt-1 size-5 text-primary" />
          <div>
            <p className="t-h3">{phase.kind === "uploading" ? "Reading the pages…" : "Finding the expense rules…"}</p>
            <p className="mt-1 text-muted-foreground">
              {phase.kind === "uploading" ? "We keep the text of each page so every rule can be checked against it. The file itself is not stored." : "Each rule comes back with its exact quote and page, and we check every quote against the text. This takes up to a minute."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (phase.kind === "failed") {
    return (
      <div role="alert" className="space-y-4 rounded-[14px] border border-danger/25 bg-surface p-5">
        <div>
          <p className="t-h3">The rules could not be read automatically</p>
          <p className="mt-1 text-muted-foreground">{phase.message}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!phase.upgrade ? (
            <Button className="h-11" onClick={() => void extract(phase.agreementId)}>
              <RotateCcw aria-hidden /> Try again
            </Button>
          ) : null}
          {phase.manual ? (
            <Button variant="outline" className="h-11" onClick={() => void extract(phase.agreementId, "manual")}>
              <PenLine aria-hidden /> Add the rules by hand
            </Button>
          ) : null}
          <Button variant="ghost" className="h-11" onClick={() => setPhase({ kind: "idle" })}>
            Upload a different file
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={start} className="space-y-5 rounded-[14px] border border-border bg-surface p-5">
      <div>
        <h2 className="t-h3">{title}</h2>
        <p className="t-small mt-1 text-muted-foreground">A PDF with selectable text, up to 10 MB and 50 pages. Scanned copies: paste the text instead.</p>
      </div>
      <Segmented
        name="method"
        legend="How do you want to add it?"
        value={method}
        onChange={(v) => {
          setMethod(v);
          setError(null);
        }}
        options={[
          { value: "pdf", label: "Upload PDF" },
          { value: "text", label: "Paste the text" },
        ]}
      />
      {method === "pdf" ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            pick(e.dataTransfer.files[0]);
          }}
          className={cn("relative rounded-[10px] border-2 border-dashed px-4 py-8 text-center transition-colors", dragging ? "border-primary bg-primary-soft" : "border-border bg-background")}
        >
          <input ref={input} id="agreement-file" type="file" accept="application/pdf,.pdf" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
          {file ? (
            <div className="flex flex-col items-center gap-2">
              <FileText aria-hidden className="size-8 text-primary" />
              <p className="max-w-full truncate font-medium">{file.name}</p>
              <p className="t-small text-muted-foreground">{(file.size / 1024 / 1024).toFixed(1)} MB</p>
              <Button type="button" variant="ghost" className="h-10" onClick={() => input.current?.click()}>
                Choose another file
              </Button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <FileUp aria-hidden className="size-8 text-muted-foreground" />
              <Label htmlFor="agreement-file" className="cursor-pointer text-[15px]">
                <span className="font-medium text-primary underline-offset-4 hover:underline">Choose the PDF</span>
                <span className="font-normal text-muted-foreground max-sm:hidden"> or drop it here</span>
              </Label>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-1.5">
          <Label htmlFor="agreement-text">Agreement text</Label>
          {scanned ? <p className="t-small text-approval">That PDF has no text layer (it looks scanned). Copy the text from the original document and paste it here.</p> : null}
          <Textarea id="agreement-text" value={text} onChange={(e) => setText(e.target.value)} rows={10} className="min-h-48 font-serif text-[15px] leading-6" placeholder={"Paste the whole agreement. Lines like --- Page 2 --- mark page numbers."} />
          <p className="t-small text-muted-foreground">Page markers keep page numbers in the quotes. Without them, long text is split into sections.</p>
        </div>
      )}
      <div aria-live="polite">{error ? <p className="t-small rounded-md bg-danger-bg px-3 py-2 text-danger">{error}</p> : null}</div>
      <Button type="submit" className="h-11 w-full px-6 sm:w-auto">
        Read the rules
      </Button>
    </form>
  );
}
