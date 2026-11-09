// Firestore document types (Section E.2). Shared by server and client.
// `Ts` is structural so both the Admin SDK and client SDK Timestamp types satisfy it.

export type Ts = { toMillis(): number; toDate(): Date };

export type Role = "owner" | "coparent";
export type OnboardingStep = "profile" | "agreement" | "family" | "invite" | "paypal" | "plan" | "done";
export const ONBOARDING_STEPS: readonly OnboardingStep[] = ["profile", "agreement", "family", "invite", "paypal", "plan", "done"];

export type UserDoc = {
  uid: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
  timeZone: string;
  familyId: string | null;
  role: Role;
  onboardingStep: OnboardingStep;
  notificationPrefs: { approvals: boolean; payments: boolean; reminders: boolean };
  theme: "system" | "light" | "dark";
  createdAt: Ts;
  updatedAt: Ts;
};

export type PayPalConnection = {
  method: "login_with_paypal" | "email";
  payerId?: string;
  email: string;
  verifiedAccount?: boolean;
  connectedAt: Ts;
};

export type Child = { id: string; firstName: string; birthYear?: number };

export type FamilyDoc = {
  ownerUid: string;
  memberUids: string[];
  owner: { name: string; email: string };
  coParent: {
    name: string;
    email: string;
    uid?: string;
    mode: "guest" | "joined";
    inviteStatus: "not_sent" | "sent" | "accepted";
    acceptedAt?: Ts;
  };
  children: Child[];
  payout: { owner?: PayPalConnection; coparent?: PayPalConnection };
  settings: { dueDays: number; currency: "USD" };
  activeRuleVersionId?: string;
  plan: { tier: "free" | "family" };
  createdAt: Ts;
  updatedAt: Ts;
};

export type VerdictCode = "ELIGIBLE" | "NEEDS_APPROVAL" | "MISSING_EVIDENCE" | "NOT_COVERED" | "LATE" | "NEEDS_REVIEW";

export type ApprovalState =
  | "NOT_REQUIRED"
  | "REQUIRED"
  | "REQUESTED"
  | "APPROVED"
  | "PARTIALLY_APPROVED"
  | "DECLINED"
  | "EXPIRED"
  | "CANCELLED";

export type SettlementState =
  | "NONE"
  | "RECEIPT_SUBMITTED"
  | "READY"
  | "RECEIPT_ISSUE"
  | "AWAITING_PAYMENT"
  | "PAID"
  | "PAYMENT_FAILED"
  | "PAYOUT_PROCESSING"
  | "SETTLED"
  | "PAYOUT_UNCLAIMED"
  | "PAYOUT_FAILED"
  | "REFUNDED"
  | "EXTERNAL_PAYMENT_REPORTED"
  | "SETTLED_EXTERNALLY"
  | "WAIVED"
  | "DISPUTED"
  | "UNRESOLVED"
  | "CANCELLED";

export type ReminderKind = "due_soon" | "overdue_1" | "overdue_8" | "overdue_15" | "manual";

export type ApprovalFields = {
  state: ApprovalState;
  currentRequestId?: string;
  approvedCents?: number;
  decidedAt?: Ts;
  expiresAt?: Ts;
  blockedUntil?: Ts;
  reason?: string;
};

export type SettlementFields = {
  state: SettlementState;
  owedCents?: number;
  dueAt?: Ts;
  requestSentAt?: Ts;
  reminders: { kind: ReminderKind; at: Ts }[];
  externalReport?: { by: Role; method: string; date: Ts; note?: string; at: Ts };
  waiver?: { reason: string; at: Ts };
  contestUntil?: Ts;
  settledAt?: Ts;
};

export type ExpenseDoc = {
  familyId: string;
  memberUids: string[];
  createdBy: string;
  childId: string;
  category: string;
  description: string;
  vendor?: string;
  amountCents: number;
  currency: "USD";
  mode: "planned" | "purchased";
  plannedDate?: Ts;
  purchaseDate?: Ts;
  paidByRole: Role;
  owedByRole: Role;
  ruleVersionId: string;
  verdict: {
    code: VerdictCode;
    ruleId?: string;
    citations: { quote: string; page: number }[];
    explanation: string;
    owedShareCents: number;
    inputHash: string;
    computedAt: Ts;
  };
  approval: ApprovalFields;
  purchasedBeforeApproval: boolean;
  receiptId?: string;
  settlement: SettlementFields;
  possibleDuplicateOf?: string;
  version: number;
  createdAt: Ts;
  updatedAt: Ts;
};

export type ActorKind = "owner" | "coparent" | "system" | "paypal";
export type Actor = { kind: ActorKind; uid?: string; tokenHash?: string };

export type ExpenseEventDoc = {
  type: string;
  machine: "approval" | "settlement" | "verdict" | "note";
  from?: string;
  to?: string;
  actor: { kind: ActorKind; uid?: string };
  data?: Record<string, unknown>;
  at: Ts;
};

export type LinkPurpose = "invite" | "approval" | "payment";

export type LinkTokenDoc = {
  familyId: string;
  purpose: LinkPurpose;
  resourcePath: string;
  recipientEmail: string;
  recipientRole: Role;
  allowedActions: string[];
  expiresAt: Ts;
  usedAt: Ts | null;
  revokedAt: Ts | null;
  createdBy: string;
  createdAt: Ts;
};

export type OtpChallengeDoc = {
  codeHash: string | null;
  expiresAt: Ts | null;
  attempts: number;
  sendCount: number;
  windowStart: Ts;
  lockedUntil?: Ts | null;
};

export type NotificationType =
  | "invite"
  | "invite_accepted"
  | "approval_request"
  | "approval_reminder"
  | "approval_decision"
  | "payment_request"
  | "payment_reminder_manual"
  | "payment_due_soon"
  | "payment_overdue"
  | "external_payment_reported"
  | "external_payment_confirmed"
  | "marked_received"
  | "settled"
  | "payout_unclaimed"
  | "payout_failed"
  | "connect_paypal_needed"
  | "subscription_problem";

export type NotificationDoc = {
  familyId: string;
  toUid?: string;
  toEmail: string;
  type: NotificationType;
  expenseId?: string;
  title: string;
  body: string;
  link?: string;
  read: boolean;
  email: { status: "pending" | "sent" | "failed" | "skipped"; providerId?: string; error?: string; attempts: number };
  createdAt: Ts;
};

export type SubscriptionDoc = {
  familyId: string;
  memberUids: string[];
  paypalSubscriptionId: string;
  planId: string;
  status: "APPROVAL_PENDING" | "ACTIVE" | "SUSPENDED" | "CANCELLED" | "EXPIRED";
  paidThrough?: Ts;
  nextBillingTime?: Ts;
  trialEndsAt?: Ts;
  lastSyncedAt: Ts;
  updatedAt: Ts;
};

export type Rule = {
  id: string;
  category: "medical" | "dental" | "education" | "school_supplies" | "extracurricular" | "childcare" | "clothing" | "travel" | "other";
  label: string;
  owedPct: number;
  sharesNonNumeric?: boolean;
  approval?: { required: boolean; operator: "gt" | "gte"; thresholdCents: number };
  receiptDeadlineDays?: number;
  reimburseWithinDays?: number;
  cap?: { amountCents: number; period: "year" };
  childIds?: string[];
  quote: string;
  page: number;
  quoteMatch: "exact" | "exact_other_page" | "fuzzy" | "none";
  vagueTerms?: string[];
  reviewState: "PENDING" | "CONFIRMED" | "EDITED" | "REJECTED" | "NEEDS_REVIEW";
};

export type RuleVersionDoc = {
  familyId: string;
  memberUids: string[];
  agreementId: string;
  version: number;
  status: "DRAFT" | "ACTIVE" | "SUPERSEDED";
  rules: Rule[];
  coParentAck?: { at: Ts; perRule: Record<string, "agree" | "disagree"> };
  createdAt: Ts;
};
