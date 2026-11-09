import {
  AlertTriangle, Ban, Baby, BookOpen, CheckCircle2, CircleDashed, Clock, FileQuestion, GraduationCap, HeartPulse, HelpCircle, Mail, MailCheck,
  Plane, Shapes, Shirt, Smile, Trophy, Hourglass, XCircle, CircleCheck, CircleSlash, type LucideIcon,
} from "lucide-react";
import type { ApprovalState, RuleCategory, RuleIssue, SettlementState, VerdictCode } from "@/types/firestore";

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

export const CATEGORY_META: Record<RuleCategory, { label: string; icon: LucideIcon }> = {
  medical: { label: "Medical", icon: HeartPulse },
  dental: { label: "Dental", icon: Smile },
  education: { label: "Education", icon: GraduationCap },
  school_supplies: { label: "School supplies", icon: BookOpen },
  extracurricular: { label: "Extracurricular", icon: Trophy },
  childcare: { label: "Childcare", icon: Baby },
  clothing: { label: "Clothing", icon: Shirt },
  travel: { label: "Travel", icon: Plane },
  other: { label: "Other", icon: Shapes },
};

export const APPROVAL_META: Record<ApprovalState, StatusMeta> = {
  NOT_REQUIRED: { tone: "eligible", icon: CircleCheck, label: "No approval needed" },
  REQUIRED: { tone: "approval", icon: Clock, label: "Approval needed" },
  REQUESTED: { tone: "approval", icon: Hourglass, label: "Waiting for approval" },
  APPROVED: { tone: "eligible", icon: CheckCircle2, label: "Approved" },
  PARTIALLY_APPROVED: { tone: "eligible", icon: CheckCircle2, label: "Partly approved" },
  DECLINED: { tone: "danger", icon: XCircle, label: "Declined" },
  EXPIRED: { tone: "neutral", icon: CircleSlash, label: "Request expired" },
  CANCELLED: { tone: "neutral", icon: CircleSlash, label: "Request cancelled" },
};

export const SETTLEMENT_LABEL: Partial<Record<SettlementState, string>> = {
  NONE: "No receipt yet",
  CANCELLED: "Cancelled",
};

export const ISSUE_META: Record<RuleIssue, { blocking: boolean; short: string }> = {
  quote_not_found: { blocking: true, short: "Quote not found" },
  shares_invalid: { blocking: true, short: "Shares do not add up" },
  shares_non_numeric: { blocking: true, short: "Shares not fixed" },
  value_not_in_quote: { blocking: true, short: "Value not in quote" },
  conflict: { blocking: true, short: "Conflicting clause" },
  quote_other_page: { blocking: false, short: "Found on another page" },
  quote_fuzzy: { blocking: false, short: "Close match" },
  vague_terms: { blocking: false, short: "Vague wording" },
};
