"use client";

import { cn } from "cn";
import { AnimatePresence, motion } from "motion/react";
import type { ApprovalState, SettlementState, VerdictCode } from "@/types/firestore";
import { APPROVAL_META, DUE_SOON_META, INVITE_STATUS, OVERDUE_META, SETTLEMENT_META, VERDICT_META, type Tone } from "./status-meta";

// Status and verdict chips: icon + words + colour, never colour alone (P.9, P.10).
// Cross-fades when the status changes (real-time updates); the container is aria-live.

const TONE: Record<Tone, string> = {
  eligible: "text-eligible bg-eligible-bg",
  approval: "text-approval bg-approval-bg",
  evidence: "text-evidence bg-evidence-bg",
  neutral: "text-neutral-st bg-neutral-st-bg",
  danger: "text-danger bg-danger-bg",
  review: "text-review bg-review-bg",
};

export function StatusBadge({ tone, icon: Icon, label, className }: { tone: Tone; icon?: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>; label: string; className?: string }) {
  return (
    <span aria-live="polite" className={cn("relative inline-flex", className)}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={`${tone}-${label}`}
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.12 } }}
          transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
          className={cn("t-label inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5", TONE[tone])}
        >
          {Icon ? <Icon aria-hidden className="size-3.5" /> : null}
          {label}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

export function VerdictBadge({ verdict, className }: { verdict: VerdictCode; className?: string }) {
  const v = VERDICT_META[verdict];
  return <StatusBadge tone={v.tone} icon={v.icon} label={v.label} className={className} />;
}

export function ApprovalStatusBadge({ state, className }: { state: ApprovalState; className?: string }) {
  const s = APPROVAL_META[state];
  return <StatusBadge tone={s.tone} icon={s.icon} label={s.label} className={className} />;
}

/** Invite status chip; takes the status string so Server Components never pass icon components. */
export function InviteStatusBadge({ status, className }: { status: keyof typeof INVITE_STATUS; className?: string }) {
  const s = INVITE_STATUS[status];
  return <StatusBadge tone={s.tone} icon={s.icon} label={s.label} className={className} />;
}

/** Claim status; overdue and due soon are derived on the server and passed in. */
export function SettlementStatusBadge({ state, overdue, dueSoon, className }: { state: SettlementState; overdue?: boolean; dueSoon?: boolean; className?: string }) {
  const s = overdue ? OVERDUE_META : dueSoon ? DUE_SOON_META : SETTLEMENT_META[state];
  return <StatusBadge tone={s.tone} icon={s.icon} label={s.label} className={className} />;
}
