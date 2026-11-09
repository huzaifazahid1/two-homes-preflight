"use client";

import { PendingLabel } from "@/components/domain/pending-label";
import { AlertTriangle, Camera, CheckCircle2, FileText, ImageUp, Sparkles } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ISSUE_TEXT } from "@/components/domain/status-meta";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, ApiError, errorMessage } from "@/hooks/api";
import { formatCents, parseDollarsToCents } from "@/lib/money";
import type { MatchIssue } from "@/types/firestore";
import type { ExpenseView, ReceiptView } from "@/types/views";

// Upload -> AI reads -> parent confirms -> match (Section I.2). A receipt means "I already bought it".

const ACCEPT = "image/jpeg,image/png,image/webp,image/heic,application/pdf";
const MAX = 10 * 1024 * 1024;
const NOT_GIVEN = new Set(["REQUIRED", "REQUESTED", "DECLINED", "EXPIRED", "CANCELLED"]);
const ACK_LABEL: Partial<Record<MatchIssue, (approved: string) => string>> = {
  OVER_APPROVED: (a) => `I understand only the approved ${a} can be claimed`,
  POSSIBLE_DUPLICATE: () => "This is a different purchase, not a duplicate",
  MERCHANT_MISMATCH: () => "This is the right receipt for this expense",
};
const ease = [0.23, 1, 0.32, 1] as const;

export function ReceiptFlow({ expense: e, receipt, other }: { expense: ExpenseView; receipt: ReceiptView | null; other: string }) {
  const s = e.settlement.state;
  const canUpload = s === "NONE" || s === "RECEIPT_ISSUE";
  const needsConfirm = receipt && (s === "RECEIPT_SUBMITTED" || s === "RECEIPT_ISSUE");
  const [current, setCurrent] = useState<ReceiptView | null>(needsConfirm ? receipt : null);
  const [replacing, setReplacing] = useState(false);

  if (!canUpload && !needsConfirm) {
    return (
      <div className="space-y-3 rounded-[14px] border border-border bg-surface p-5">
        <CheckCircle2 aria-hidden className="size-8 text-eligible" />
        <p className="font-medium">The receipt is confirmed.</p>
        <Link href={`/app/expenses/${e.id}`} className={buttonVariants({ className: "h-11" })}>
          Back to the expense
        </Link>
      </div>
    );
  }

  return (
    <AnimatePresence mode="wait" initial={false}>
      {current && !replacing ? (
        <motion.div key={`confirm-${current.id}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.14 } }} transition={{ duration: 0.22, ease }}>
          <ConfirmForm e={e} r={current} other={other} onReplace={s === "RECEIPT_ISSUE" ? () => setReplacing(true) : undefined} />
        </motion.div>
      ) : (
        <motion.div key="upload" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.14 } }} transition={{ duration: 0.22, ease }}>
          <Upload
            e={e}
            other={other}
            onUploaded={(r) => {
              setCurrent(r);
              setReplacing(false);
            }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Upload({ e, other, onUploaded }: { e: ExpenseView; other: string; onUploaded: (r: ReceiptView) => void }) {
  const camera = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<"idle" | "uploading">("idle");
  const [error, setError] = useState<string | null>(null);
  const [duplicateLink, setDuplicateLink] = useState<string | null>(null);
  const preview = useMemo(() => (file && /^image\/(jpeg|png|webp)$/.test(file.type) ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => (preview ? URL.revokeObjectURL(preview) : undefined), [preview]);
  const warnBefore = NOT_GIVEN.has(e.approval.state);

  function choose(f: File | undefined) {
    setError(null);
    setDuplicateLink(null);
    if (!f) return;
    if (f.size > MAX) {
      setFile(null);
      return setError("The file is larger than 10 MB. Take a smaller photo or upload a PDF.");
    }
    setFile(f);
  }

  async function send() {
    if (!file) return;
    setPhase("uploading");
    setError(null);
    const form = new FormData();
    form.set("file", file, file.name || "receipt");
    try {
      const r = await api<{ receipt: ReceiptView }>(`/api/expenses/${e.id}/receipts`, { method: "POST", body: form });
      onUploaded(r.receipt);
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiError && err.code === "DUPLICATE_RECEIPT") setDuplicateLink(String(err.details?.link ?? ""));
      setPhase("idle");
    }
  }

  return (
    <div className="space-y-5">
      {warnBefore ? (
        <div role="note" className="flex gap-3 rounded-[10px] border border-approval/30 bg-approval-bg p-4 text-approval">
          <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0" />
          <div className="t-small">
            <p className="font-medium">Approval was required before purchase</p>
            <p className="mt-0.5">
              {e.approval.state === "REQUESTED" ? `${other} has not answered yet.` : `${other} has not approved this.`} If you upload now, {other} will see it was bought before
              approval, and may decline. A decline is backed by the agreement and closes the claim.
            </p>
          </div>
        </div>
      ) : null}

      <div className="rounded-[14px] border border-dashed border-border bg-surface p-5">
        {file ? (
          <div className="flex items-center gap-4">
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element -- local preview of the user's own file (blob URL)
              <img src={preview} alt="Receipt preview" width={80} height={112} className="h-28 w-20 rounded-md border border-border object-cover" />
            ) : (
              <span className="flex h-28 w-20 items-center justify-center rounded-md border border-border bg-surface-2">
                <FileText aria-hidden className="size-7 text-muted-foreground" />
              </span>
            )}
            <div className="min-w-0">
              <p className="truncate font-medium">{file.name || "Receipt"}</p>
              <p className="t-small text-muted-foreground">{(file.size / 1024 / 1024).toFixed(1)} MB</p>
              <Button variant="ghost" className="-ml-3 h-11" onClick={() => setFile(null)} disabled={phase !== "idle"}>
                Choose another
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3 text-center">
            <ImageUp aria-hidden className="mx-auto size-8 text-muted-foreground" />
            <p className="text-muted-foreground">A photo or PDF of the receipt, up to 10 MB.</p>
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
              <Button className="h-12 text-[15px] sm:h-11 lg:hidden" onClick={() => camera.current?.click()}>
                <Camera aria-hidden /> Take a photo
              </Button>
              <Button variant="outline" className="h-12 text-[15px] sm:h-11" onClick={() => picker.current?.click()}>
                <FileText aria-hidden /> Choose a file
              </Button>
            </div>
          </div>
        )}
        <input ref={camera} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden onChange={(ev) => choose(ev.target.files?.[0])} />
        <input ref={picker} type="file" accept={ACCEPT} className="sr-only" tabIndex={-1} aria-hidden onChange={(ev) => choose(ev.target.files?.[0])} />
      </div>

      <div aria-live="polite">
        {error ? (
          <p className="t-small rounded-md bg-danger-bg px-3 py-2 text-danger">
            {error}{" "}
            {duplicateLink ? (
              <Link href={duplicateLink} className="font-medium underline underline-offset-2">
                Open that expense
              </Link>
            ) : null}
          </p>
        ) : null}
        {phase === "uploading" ? <p className="t-small text-muted-foreground">Uploading and reading the receipt. This takes a few seconds.</p> : null}
      </div>
      <div className="sticky bottom-[calc(64px+env(safe-area-inset-bottom))] -mx-4 border-t border-border bg-background/95 px-4 py-3 backdrop-blur lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:p-0">
        <Button className="h-12 w-full text-[15px] lg:w-auto lg:px-6" onClick={() => void send()} disabled={!file || phase !== "idle"}>
          <PendingLabel pending={phase === "uploading"} busy="Uploading…" idle="Upload receipt" />
        </Button>
      </div>
    </div>
  );
}

function ConfirmForm({ e, r, other, onReplace }: { e: ExpenseView; r: ReceiptView; other: string; onReplace?: () => void }) {
  const router = useRouter();
  const start = r.confirmed ?? { merchant: r.parsed?.merchant ?? e.vendor ?? "", date: r.parsed?.date ?? "", totalCents: r.parsed?.totalCents ?? null };
  const [merchant, setMerchant] = useState(start.merchant ?? "");
  const [date, setDate] = useState(start.date ?? "");
  const [total, setTotal] = useState(start.totalCents ? formatCents(start.totalCents).replace(/^\$/, "") : "");
  const [ack, setAck] = useState<MatchIssue[]>(r.acknowledged);
  const [result, setResult] = useState<ReceiptView | null>(r.match ? r : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const today = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const approved = e.approval.approvedCents ? formatCents(e.approval.approvedCents) : "amount";

  async function submit() {
    const cents = parseDollarsToCents(total);
    if (!merchant.trim()) return setError("Enter the store name.");
    if (!date) return setError("Enter the date on the receipt.");
    if (cents === null || cents <= 0) return setError("Enter the total, for example 350.00.");
    setBusy(true);
    setError(null);
    try {
      const out = await api<{ receipt: ReceiptView }>(`/api/receipts/${r.id}/confirm`, { method: "POST", body: { merchant: merchant.trim(), date, totalCents: cents, ...(ack.length ? { acknowledge: ack } : {}) } });
      setResult(out.receipt);
      if (out.receipt.match?.result === "OK") {
        router.push(`/app/expenses/${e.id}`);
        router.refresh();
        return;
      }
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    }
    setBusy(false);
  }

  const open = result?.match?.open ?? [];
  const read = r.parseStatus === "parsed";
  return (
    <form
      className="space-y-5"
      onSubmit={(ev) => {
        ev.preventDefault();
        void submit();
      }}
    >
      <p className={`t-small flex items-start gap-2 rounded-md px-3 py-2 ${read ? "bg-primary-soft text-primary" : "bg-surface-2 text-muted-foreground"}`}>
        <Sparkles aria-hidden className="mt-0.5 size-4 shrink-0" />
        {read
          ? "Read by AI. Check each value against the receipt before you confirm."
          : r.parseError === "plan_limit"
            ? "This month's AI receipt readings on the Free plan are used up. Type the values from the receipt."
            : "We could not read this receipt automatically. Type the values from the receipt."}
      </p>

      <div className="space-y-1.5">
        <label htmlFor="merchant" className="text-sm font-medium">Store</label>
        <Input id="merchant" className="h-11 text-base" maxLength={120} autoComplete="off" value={merchant} onChange={(ev) => setMerchant(ev.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label htmlFor="rdate" className="text-sm font-medium">Date on the receipt</label>
          <Input id="rdate" type="date" max={today} className="h-11 text-base" value={date} onChange={(ev) => setDate(ev.target.value)} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="rtotal" className="text-sm font-medium">Total paid</label>
          <div className="relative">
            <span aria-hidden className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted-foreground">$</span>
            <Input id="rtotal" inputMode="decimal" autoComplete="off" className="h-11 pl-7 font-mono text-base tabular-nums" value={total} onChange={(ev) => setTotal(ev.target.value)} />
          </div>
        </div>
      </div>
      {r.parsed?.lineItems?.length ? (
        <details className="t-small text-muted-foreground">
          <summary className="min-h-11 cursor-pointer py-2">{r.parsed.lineItems.length} line items read</summary>
          <ul className="space-y-1 pb-2">
            {r.parsed.lineItems.map((l, i) => (
              <li key={i} className="flex justify-between gap-3">
                <span className="truncate">{l.label}</span>
                <span className="font-mono tabular-nums">{formatCents(l.amountCents)}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <AnimatePresence initial={false}>
        {open.length ? (
          <motion.section aria-live="polite" aria-labelledby="issues-h" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.14 } }} transition={{ duration: 0.22, ease }} className="space-y-3 rounded-[14px] border border-approval/30 bg-approval-bg p-4">
            <h2 id="issues-h" className="flex items-center gap-2 font-medium text-approval">
              <AlertTriangle aria-hidden className="size-4" /> Before you can ask for {other}&rsquo;s share
            </h2>
            <ul className="space-y-3">
              {open.map((i) => {
                const label = ACK_LABEL[i];
                return (
                  <li key={i} className="t-small text-approval">
                    <p>
                      <span className="font-medium">{ISSUE_TEXT[i].title}.</span> {ISSUE_TEXT[i].body}
                    </p>
                    {label ? (
                      <label className="mt-1.5 flex min-h-11 cursor-pointer items-center gap-2 text-foreground">
                        <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={ack.includes(i)} onChange={(ev) => setAck((a) => (ev.target.checked ? [...a, i] : a.filter((x) => x !== i)))} />
                        {label(approved)}
                      </label>
                    ) : (
                      <Link href={`/app/expenses/${e.id}`} className="mt-1 inline-flex min-h-11 items-center font-medium text-foreground underline underline-offset-2">
                        Ask {other} for approval from the expense page
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          </motion.section>
        ) : null}
      </AnimatePresence>

      <div aria-live="polite">{error ? <p className="t-small rounded-md bg-danger-bg px-3 py-2 text-danger">{error}</p> : null}</div>
      <div className="sticky bottom-[calc(64px+env(safe-area-inset-bottom))] -mx-4 flex flex-col gap-2 border-t border-border bg-background/95 px-4 py-3 backdrop-blur lg:static lg:mx-0 lg:flex-row lg:border-0 lg:bg-transparent lg:p-0">
        <Button type="submit" className="h-12 w-full text-[15px] lg:w-auto lg:px-6" disabled={busy}>
          <PendingLabel pending={busy} busy="Checking…" idle={open.length ? "Check again" : "Confirm receipt"} />
        </Button>
        {onReplace ? (
          <Button type="button" variant="ghost" className="h-11" onClick={onReplace} disabled={busy}>
            Upload a different receipt
          </Button>
        ) : null}
      </div>
    </form>
  );
}
