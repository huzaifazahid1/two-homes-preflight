"use client";

import { cloneElement, useState, type ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useMediaQuery } from "@/hooks/use-media-query";
import { PendingLabel } from "./pending-label";

// Confirmation for consequential claim actions (P.9): a bottom sheet on phones (thumb reach,
// swipe to dismiss), a centred dialog on desktop (Esc closes, focus is trapped). The primitives
// animate themselves; no second Motion layer. Closes only after the action succeeds.

export function ConfirmSheet({
  trigger,
  title,
  description,
  confirmLabel,
  pendingLabel,
  cancelLabel = "Cancel",
  destructive = false,
  canConfirm = true,
  onConfirm,
  children,
}: {
  trigger: ReactElement<{ onClick?: () => void }>;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  pendingLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  canConfirm?: boolean;
  /** Return true when done (closes), false to keep it open (the error shows on the page). */
  onConfirm: () => Promise<boolean>;
  children?: React.ReactNode;
}) {
  const desktop = useMediaQuery("(min-width: 1024px)");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    const ok = await onConfirm();
    setBusy(false);
    if (ok) setOpen(false);
  }

  const actions = (
    <>
      <Button variant="outline" className="h-12 lg:h-11" onClick={() => setOpen(false)} disabled={busy}>
        {cancelLabel}
      </Button>
      <Button className={`h-12 lg:h-11 ${destructive ? "bg-danger text-white hover:bg-danger/90" : ""}`} onClick={() => void confirm()} disabled={busy || !canConfirm}>
        <PendingLabel pending={busy} idle={confirmLabel} busy={pendingLabel} />
      </Button>
    </>
  );

  return (
    <>
      {cloneElement(trigger, { onClick: () => setOpen(true) })}
      {desktop ? (
        <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>{description}</DialogDescription>
            </DialogHeader>
            {children}
            <DialogFooter>{actions}</DialogFooter>
          </DialogContent>
        </Dialog>
      ) : (
        <Sheet open={open} onOpenChange={(o) => !busy && setOpen(o)}>
          <SheetContent side="bottom" className="max-h-[88dvh] gap-0 rounded-t-[18px] pb-[env(safe-area-inset-bottom)]">
            <SheetHeader className="pr-12">
              <SheetTitle className="t-h3">{title}</SheetTitle>
              <SheetDescription>{description}</SheetDescription>
            </SheetHeader>
            {children ? <div className="overflow-y-auto overscroll-contain px-4">{children}</div> : null}
            <SheetFooter className="flex-col-reverse">{actions}</SheetFooter>
          </SheetContent>
        </Sheet>
      )}
    </>
  );
}
