import { AlertTriangle, Ban, CheckCircle2, CircleDashed, Clock, FileQuestion, HelpCircle, Mail, MailCheck, type LucideIcon } from "lucide-react";
import type { VerdictCode } from "@/types/firestore";

// Status metadata shared by Server and Client Components (a "use client" module cannot export
// plain objects to Server Components). Icon + words + tone: colour is never the only signal.

export type Tone = "eligible" | "approval" | "evidence" | "neutral" | "danger" | "review";
export type StatusMeta = { tone: Tone; icon: LucideIcon; label: string };

export const VERDICT_META: Record<VerdictCode, StatusMeta> = {
  ELIGIBLE: { tone: "eligible", icon: CheckCircle2, label: "Eligible" },
  NEEDS_APPROVAL: { tone: "approval", icon: Clock, label: "Needs approval" },
  MISSING_EVIDENCE: { tone: "evidence", icon: FileQuestion, label: "Missing evidence" },
  NOT_COVERED: { tone: "neutral", icon: Ban, label: "Not covered" },
  LATE: { tone: "danger", icon: AlertTriangle, label: "Late" },
  NEEDS_REVIEW: { tone: "review", icon: HelpCircle, label: "Needs review" },
};

export const INVITE_STATUS: Record<"not_sent" | "sent" | "accepted", StatusMeta> = {
  not_sent: { tone: "neutral", icon: CircleDashed, label: "Not invited yet" },
  sent: { tone: "approval", icon: Mail, label: "Invite sent" },
  accepted: { tone: "eligible", icon: MailCheck, label: "Joined" },
};
