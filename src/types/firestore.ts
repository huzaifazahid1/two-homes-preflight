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
  category: RuleCategory;
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
  | "external_payment_rejected"
  | "marked_received"
  | "dispute_update"
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

export type ApprovalDecision = "APPROVED" | "PARTIALLY_APPROVED" | "DECLINED";

/** approvals/{expenseId}_{n} (server-only; holds the token hash). */
export type ApprovalDoc = {
  familyId: string;
  expenseId: string;
  n: number;
  tokenHash: string;
  requestedBy: string;
  requestedByRole: Role;
  approverRole: Role;
  requestedAt: Ts;
  expiresAt: Ts;
  decision?: ApprovalDecision;
  approvedCents?: number;
  reason?: string;
  decidedAt?: Ts;
  purchasedBeforeApproval: boolean;
  reminderSentAt?: Ts;
};

export type MatchIssue = "OVER_APPROVED" | "BEFORE_APPROVAL" | "MERCHANT_MISMATCH" | "LATE" | "POSSIBLE_DUPLICATE";

export type ReceiptDoc = {
  familyId: string;
  memberUids: string[];
  expenseId: string;
  uploadedBy: string;
  cloudinary: {
    publicId: string;
    resourceType: "image";
    deliveryType: "private";
    format: string;
    bytes: number;
    width?: number;
    height?: number;
    pages?: number;
    version: number;
    assetId: string;
  };
  originalFileName: string;
  mimeType: string;
  sha256: string;
  parseStatus: "pending" | "parsed" | "failed" | "skipped";
  parseError?: string;
  parsed?: { merchant?: string; date?: string; totalCents?: number; lineItems?: { label: string; amountCents: number }[]; confidence: number };
  confirmed?: { merchant: string; date: Ts; totalCents: number; confirmedAt: Ts; confirmedBy: string };
  match?: { result: "OK" | "ISSUES"; issues: MatchIssue[]; possibleDuplicateOf?: string; at: Ts };
  /** Issues a parent has looked at and accepted (e.g. "claim only the approved amount"). */
  acknowledged?: MatchIssue[];
  /** A newer receipt replaced this one on the same expense. Kept as evidence. */
  replacedBy?: string;
  createdAt: Ts;
};

export type DisputeRound = { by: Role; reason: string; proposedCents?: number; at: Ts };

export type DisputeDoc = {
  familyId: string;
  memberUids: string[];
  expenseId: string;
  /** Who opened it (the paying parent). */
  openedBy: Role;
  /** Settlement state the dispute was opened from. */
  openedFrom: SettlementState;
  rounds: DisputeRound[];
  status: "OPEN" | "AGREED" | "UNRESOLVED";
  agreedCents?: number;
  updatedAt: Ts;
  createdAt: Ts;
};

export type JobRunDoc = {
  startedAt: Ts;
  finishedAt?: Ts;
  runs: number;
  remindersSent: number;
  expiredApprovals: number;
  payoutsChecked: number;
  errors: string[];
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

export type PaymentAttempt = {
  orderId: string;
  requestId: string;
  status: "CREATED" | "APPROVED" | "COMPLETED" | "DECLINED" | "VOIDED";
  amountCents: number;
  feeLineCents: number;
  /** INSTRUMENT_DECLINED captures on this order; each new try uses a new capture key. */
  declines?: number;
  at: Ts;
};

/** payments/{expenseId} (server-only). */
export type PaymentDoc = {
  familyId: string;
  expenseId: string;
  attempts: PaymentAttempt[];
  orderId?: string;
  captureId?: string;
  captureStatus?: "PENDING" | "COMPLETED" | "DECLINED" | "REFUNDED" | "PARTIALLY_REFUNDED";
  capturedCents?: number;
  feeLineCents?: number;
  paypalFeeCents?: number | null;
  netCents?: number | null;
  capturedAt?: Ts;
  refund?: { refundId: string; status: string; at: Ts };
  updatedAt: Ts;
};

export type PayoutStatus = "CREATED" | "PENDING" | "PROCESSING" | "SUCCESS" | "UNCLAIMED" | "FAILED" | "RETURNED" | "BLOCKED" | "REFUNDED" | "HELD" | "CANCELED" | "DENIED";

export type PayoutAttempt = {
  senderBatchId: string;
  payoutBatchId?: string;
  payoutItemId?: string;
  recipientType: "PAYPAL_ID" | "EMAIL";
  receiver: string;
  amountCents: number;
  status: PayoutStatus;
  /** Last PayPal problem while creating it (e.g. INSUFFICIENT_FUNDS); reconcile retries the same id. */
  lastError?: string;
  /** Definitive 4xx rejections (no batch created); the next try uses a new PayPal-Request-Id. */
  rejections?: number;
  at: Ts;
  lastCheckedAt?: Ts;
};

/** payouts/{expenseId} (server-only). One doc per claim; attempts are appended. */
export type PayoutDoc = {
  familyId: string;
  expenseId: string;
  receiverRole: Role;
  attempts: PayoutAttempt[];
  status: PayoutStatus;
  updatedAt: Ts;
};

/** usage/{familyId}_{yyyymm} (server-only). */
export type UsageDoc = { coveredSettledCents?: number; aiReceiptScans?: number; extractionRuns?: number };

/** webhookEvents/{eventId} (server-only). */
export type WebhookEventDoc = {
  type: string;
  resourceId: string | null;
  receivedAt: Ts;
  processedAt?: Ts;
  outcome?: "applied" | "noop" | "ignored_unknown" | "error";
  error?: string;
  attempts: number;
};

export const RULE_CATEGORIES = [
  "medical", "dental", "education", "school_supplies", "extracurricular", "childcare", "clothing", "travel", "other",
] as const;
export type RuleCategory = (typeof RULE_CATEGORIES)[number];

export type QuoteMatch = "exact" | "exact_other_page" | "fuzzy" | "none";
export type ReviewState = "PENDING" | "CONFIRMED" | "EDITED" | "REJECTED" | "NEEDS_REVIEW";

/**
 * Why a rule needs a human. Blocking issues keep the rule in NEEDS_REVIEW and disable Confirm;
 * warnings are shown but do not block (docs/decisions.md 2.x).
 */
export type RuleIssue =
  | "quote_not_found" // blocking
  | "shares_invalid" // blocking: shares do not add up to 100
  | "shares_non_numeric" // blocking: e.g. "proportional to income", parent must enter percentages
  | "value_not_in_quote" // blocking: an AI value cannot be traced to its quote
  | "conflict" // blocking: another clause covers the same category and child with different values
  | "quote_other_page" // warning
  | "quote_fuzzy" // warning
  | "vague_terms"; // warning

/** A value taken from another clause (e.g. a general receipt deadline), with its own verified quote. */
export type SupportingQuote = {
  field: "receiptDeadlineDays" | "reimburseWithinDays";
  quote: string;
  page: number;
  quoteMatch: QuoteMatch;
};

export type Rule = {
  id: string;
  category: RuleCategory;
  label: string;
  /** Share the non-buying parent owes (0-100). */
  owedPct: number;
  sharesNonNumeric?: boolean;
  approval?: { required: boolean; operator: "gt" | "gte"; thresholdCents: number };
  receiptDeadlineDays?: number;
  reimburseWithinDays?: number;
  cap?: { amountCents: number; period: "year" };
  childIds?: string[];
  /** Child-specific rule as written in the agreement (first names); matched when childIds is absent. */
  childNames?: string[];
  quote: string;
  page: number;
  quoteMatch: QuoteMatch;
  supportingQuotes?: SupportingQuote[];
  vagueTerms?: string[];
  issues?: RuleIssue[];
  source?: "ai" | "demo" | "manual";
  reviewState: ReviewState;
  /** Original AI values when a parent edited the rule. */
  editedFrom?: Partial<Pick<Rule, "label" | "owedPct" | "approval" | "receiptDeadlineDays" | "reimburseWithinDays" | "childNames" | "quote" | "page" | "sharesNonNumeric">>;
};

export type Quoted<T> = { value: T; quote: string; page: number; quoteMatch: QuoteMatch };

export type ExtractedParties = {
  parents: Quoted<string>[];
  children: Quoted<{ firstName: string; birthYear?: number }>[];
};

export type RuleVersionDoc = {
  familyId: string;
  memberUids: string[];
  agreementId: string;
  version: number;
  status: "DRAFT" | "ACTIVE" | "SUPERSEDED";
  rules: Rule[];
  extractedParties?: ExtractedParties;
  /** How the draft was produced. "demo" = DEMO_MODE cached extraction (labelled in the UI). */
  extraction?: { mode: "ai" | "demo" | "manual"; model?: string; at: Ts };
  confirmedBy?: string;
  confirmedAt?: Ts;
  supersededAt?: Ts;
  coParentAck?: { at: Ts; perRule: Record<string, "agree" | "disagree"> };
  createdAt: Ts;
  updatedAt?: Ts;
};

export type AgreementStatus = "UPLOADED" | "EXTRACTING" | "EXTRACTED" | "FAILED";

export type AgreementDoc = {
  familyId: string;
  memberUids: string[];
  fileName: string;
  sha256: string;
  pageCount: number;
  source: "pdf" | "pasted_text";
  status: AgreementStatus;
  error?: string;
  extractionRuns: number;
  /** Latest DRAFT rule version created from this agreement. */
  draftRuleVersionId?: string;
  createdBy: string;
  createdAt: Ts;
  updatedAt?: Ts;
};

export type AgreementPageDoc = { page: number; text: string };
