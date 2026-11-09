# Data model (Cloud Firestore)

Part of the Two Homes Preflight spec. Source sections: E.1 to E.5, E.8, L.6. Read `CLAUDE.md` first; it maps section letters to files.

# E. Database architecture (Cloud Firestore)

## E.1 Principles [Agreed]

- Cloud Firestore only. No Realtime Database. No Firebase Storage.
- **All writes happen on the server** through the Admin SDK inside Route Handlers. Client security rules deny every write.
- **Clients may read** a small set of documents with the Firebase client SDK for real-time listeners, only when signed in and only their own family's data (Section E.4).
- Guest co-parents (link pages) never use the client SDK; they poll the API.
- Money: integer cents in fields ending `Cents`. Currency field always `"USD"`.
- Time: Firestore `Timestamp` in UTC. Display with `Intl.DateTimeFormat` in the user's time zone (`users.timeZone`, captured at signup from the browser).
- Uniqueness via deterministic document ids (e.g. `payouts/{expenseId}`, `receiptHashes/{familyId}_{sha256}`, `webhookEvents/{eventId}`, `linkTokens/{sha256(token)}`), created inside transactions with `create()` (fails if exists).
- Every readable document carries `memberUids: string[]` (family members with accounts) so rules can check access without extra reads.
- Every expense change increments `version` and appends one `events` row.

## E.2 Collections

Field lists below are the required fields. Types are TypeScript-style. `?` = optional.

### `users/{uid}`
```ts
{
  uid: string; email: string; emailVerified: boolean;
  displayName: string; timeZone: string;            // e.g. "Asia/Karachi"
  familyId: string | null; role: 'owner' | 'coparent';
  onboardingStep: 'profile'|'agreement'|'family'|'invite'|'paypal'|'plan'|'done';
  notificationPrefs: { approvals: boolean; payments: boolean; reminders: boolean };
  theme: 'system'|'light'|'dark';
  createdAt: Timestamp; updatedAt: Timestamp;
}
```

### `families/{familyId}`
```ts
{
  ownerUid: string; memberUids: string[];
  owner: { name: string; email: string };
  coParent: {
    name: string; email: string; uid?: string; mode: 'guest'|'joined';
    inviteStatus: 'not_sent'|'sent'|'accepted';
    acceptedAt?: Timestamp;
  };
  children: { id: string; firstName: string; birthYear?: number }[];
  payout: {                                   // where each parent receives money
    owner?:    PayPalConnection;
    coparent?: PayPalConnection;
  };
  settings: { dueDays: number /* default 30 */; currency: 'USD' };
  activeRuleVersionId?: string;
  plan: { tier: 'free'|'family' };            // display only; entitlement is derived from subscriptions/{familyId}
  createdAt: Timestamp; updatedAt: Timestamp;
}
type PayPalConnection = {
  method: 'login_with_paypal' | 'email';
  payerId?: string;                            // from Log in with PayPal (used as PAYPAL_ID payout receiver)
  email: string; verifiedAccount?: boolean;
  connectedAt: Timestamp;
};
```
`payout.*.payerId` and email are not secrets but are personal data; they are readable only by family members.

### `agreements/{agreementId}`  (server-only read)
```ts
{ familyId; memberUids; fileName; sha256; pageCount; source: 'pdf'|'pasted_text';
  status: 'UPLOADED'|'EXTRACTING'|'EXTRACTED'|'FAILED'; error?: string;
  extractionRuns: number; createdBy; createdAt }
```
The PDF itself is **not stored anywhere** [Agreed]. The server extracts per-page text and keeps it in the subcollection below.

### `agreements/{agreementId}/pages/{pageNumber}`  (server-only)
```ts
{ page: number; text: string }   // one doc per page keeps every doc far below 1 MiB
```

### `ruleVersions/{ruleVersionId}`  (family read)
```ts
{
  familyId; memberUids; agreementId; version: number;
  status: 'DRAFT'|'ACTIVE'|'SUPERSEDED';
  rules: Rule[];
  extractedParties?: { parents: Quoted<string>[]; children: Quoted<{firstName:string; birthYear?:number}>[] };
  confirmedBy?: string; confirmedAt?: Timestamp;
  coParentAck?: { at: Timestamp; perRule: Record<string, 'agree'|'disagree'> };
  createdAt;
}
type Rule = {
  id: string;
  category: 'medical'|'dental'|'education'|'school_supplies'|'extracurricular'|'childcare'|'clothing'|'travel'|'other';
  label: string;                         // human label from the clause
  owedPct: number;                       // share the non-buying parent owes (0-100)
  sharesNonNumeric?: boolean;            // e.g. "proportional to income": parent must enter percentages
  approval?: { required: boolean; operator: 'gt'|'gte'; thresholdCents: number };
  receiptDeadlineDays?: number; reimburseWithinDays?: number;
  cap?: { amountCents: number; period: 'year' };  // Should
  childIds?: string[];
  quote: string; page: number;
  quoteMatch: 'exact'|'exact_other_page'|'fuzzy'|'none';
  vagueTerms?: string[];                 // "reasonable", "necessary"
  reviewState: 'PENDING'|'CONFIRMED'|'EDITED'|'REJECTED'|'NEEDS_REVIEW';
  editedFrom?: Partial<Rule>;            // original AI values when edited
};
type Quoted<T> = { value: T; quote: string; page: number; quoteMatch: Rule['quoteMatch'] };
```
`ACTIVE` versions are immutable. Editing creates a new `DRAFT`.

### `expenses/{expenseId}`  (family read)
```ts
{
  familyId; memberUids; createdBy;
  childId; category; description; vendor?;
  amountCents: number; currency: 'USD';
  mode: 'planned'|'purchased';
  plannedDate?: Timestamp; purchaseDate?: Timestamp;
  paidByRole: 'owner'|'coparent'; owedByRole: 'owner'|'coparent';
  ruleVersionId: string;
  verdict: { code: 'ELIGIBLE'|'NEEDS_APPROVAL'|'MISSING_EVIDENCE'|'NOT_COVERED'|'LATE'|'NEEDS_REVIEW';
             ruleId?: string; citations: { quote: string; page: number }[];
             explanation: string; owedShareCents: number; inputHash: string; computedAt };
  approval: { state: ApprovalState; currentRequestId?: string; approvedCents?: number;
              decidedAt?: Timestamp; expiresAt?: Timestamp; blockedUntil?: Timestamp; reason?: string };
  purchasedBeforeApproval: boolean;
  receiptId?: string;
  settlement: { state: SettlementState; owedCents?: number; dueAt?: Timestamp; requestSentAt?: Timestamp;
                reminders: { kind: 'due_soon'|'overdue_1'|'overdue_8'|'overdue_15'|'manual'; at: Timestamp }[];
                externalReport?: { by: 'owner'|'coparent'; method: string; date: Timestamp; note?: string; at: Timestamp };
                waiver?: { reason: string; at: Timestamp };
                contestUntil?: Timestamp; settledAt?: Timestamp };
  possibleDuplicateOf?: string;
  version: number; createdAt; updatedAt;
}
```

### `expenses/{expenseId}/events/{eventId}`  (family read; the timeline)
```ts
{ type: string /* e.g. 'approval.REQUESTED->APPROVED' */; machine: 'approval'|'settlement'|'verdict'|'note';
  from?: string; to?: string; actor: { kind: 'owner'|'coparent'|'system'|'paypal'; uid?: string };
  data?: Record<string, unknown>; at: Timestamp }
```

### `approvals/{expenseId}_{n}`  (server-only; holds token hash)
```ts
{ familyId; expenseId; n; tokenHash; requestedBy; requestedAt; expiresAt;
  decision?: 'APPROVED'|'PARTIALLY_APPROVED'|'DECLINED'; approvedCents?; reason?; decidedAt?;
  purchasedBeforeApproval: boolean; reminderSentAt? }
```

### `receipts/{receiptId}`  (family read, without download URL)
```ts
{
  familyId; memberUids; expenseId; uploadedBy;
  cloudinary: { publicId: string; resourceType: 'image'; deliveryType: 'private'; format: string;
                bytes: number; width?: number; height?: number; pages?: number; version: number; assetId: string };
  originalFileName: string; mimeType: string; sha256: string;
  parsed?: { merchant?: string; date?: string; totalCents?: number; lineItems?: { label: string; amountCents: number }[]; confidence: number };
  confirmed?: { merchant: string; date: Timestamp; totalCents: number; confirmedAt: Timestamp };
  match?: { result: 'OK'|'ISSUES'; issues: ('OVER_APPROVED'|'BEFORE_APPROVAL'|'MERCHANT_MISMATCH'|'LATE'|'POSSIBLE_DUPLICATE')[] };
  createdAt;
}
```
No permanent URL is stored. Viewing a receipt calls the API, which checks access and returns a short-lived Cloudinary download URL (Section I).

### `receiptHashes/{familyId}_{sha256}`  (server-only)
`{ receiptId, createdAt }` created in the same transaction as the receipt. Duplicate file upload fails.

### `disputes/{expenseId}`  (family read) [Should]
`{ familyId; memberUids; rounds: { by; reason; proposedCents?; at }[]; status: 'OPEN'|'AGREED'|'UNRESOLVED' }`

### `payments/{expenseId}`  (server-only)
```ts
{ familyId; expenseId;
  attempts: { orderId: string; requestId: string; status: 'CREATED'|'APPROVED'|'COMPLETED'|'DECLINED'|'VOIDED';
              amountCents: number; feeLineCents: number; at: Timestamp }[];
  captureId?: string; captureStatus?: 'PENDING'|'COMPLETED'|'DECLINED'|'REFUNDED'|'PARTIALLY_REFUNDED';
  capturedCents?: number; paypalFeeCents?: number; netCents?: number; capturedAt? }
```

### `payouts/{expenseId}`  (server-only)
```ts
{ familyId; expenseId; receiverRole: 'owner'|'coparent';
  attempts: { senderBatchId: string; payoutBatchId?: string; payoutItemId?: string;
              recipientType: 'PAYPAL_ID'|'EMAIL'; receiver: string; amountCents: number;
              status: 'CREATED'|'PENDING'|'PROCESSING'|'SUCCESS'|'UNCLAIMED'|'FAILED'|'RETURNED'|'BLOCKED'|'REFUNDED'|'HELD'|'CANCELED'|'DENIED';
              at: Timestamp; lastCheckedAt? }[];
  status: string }
```

### `subscriptions/{familyId}`  (family read: status only)
```ts
{ familyId; memberUids; paypalSubscriptionId; planId; status: 'APPROVAL_PENDING'|'ACTIVE'|'SUSPENDED'|'CANCELLED'|'EXPIRED';
  paidThrough?: Timestamp; nextBillingTime?: Timestamp; trialEndsAt?: Timestamp; lastSyncedAt; updatedAt }
```

### `usage/{familyId}_{yyyymm}`  (server-only)
`{ coveredSettledCents: number; aiReceiptScans: number; extractionRuns: number }` updated in the same transaction as the event that consumes it.

### `linkTokens/{sha256(token)}`  (server-only)
```ts
{ familyId; purpose: 'invite'|'approval'|'payment'; resourcePath: string; recipientEmail: string;
  recipientRole: 'coparent'|'owner'; allowedActions: string[]; expiresAt; usedAt?; revokedAt?; createdBy; createdAt }
```
The plain token is never stored.

### `otpChallenges/{tokenHash}`  (server-only)
`{ codeHash; expiresAt; attempts; sendCount; windowStart; lockedUntil? }`

### `notifications/{dedupeKey}`  (recipient read when `toUid` set)
```ts
{ familyId; toUid?: string; toEmail: string; type: NotificationType; expenseId?;
  title: string; body: string; link?: string; read: boolean;
  email: { status: 'pending'|'sent'|'failed'|'skipped'; providerId?: string; error?: string; attempts: number };
  createdAt }
```
`dedupeKey` = `${type}:${entityId}:${version}`. Created before calling Resend; a duplicate create means "already sent".

### `webhookEvents/{eventId}`  (server-only)
`{ type; resourceId; receivedAt; processedAt?; outcome: 'applied'|'noop'|'ignored_unknown'|'error'; error? }`

### `auditLogs/{autoId}`  (server-only, append only)
`{ familyId; actor: { kind; uid?; tokenHash? }; action; target; at; ipHash; userAgent? }`

### `rateLimits/{key}`  (server-only)
`{ count; windowStart }`

### `jobRuns/{yyyy-mm-dd}`  (server-only)
`{ startedAt; finishedAt?; remindersSent; expiredApprovals; payoutsChecked; errors: string[] }`

## E.3 Relationships

- `users` 1:1 `families` (MVP). `families` 1:N `agreements` 1:N `ruleVersions` (one ACTIVE per family, pointed to by `families.activeRuleVersionId`).
- `expenses` N:1 `families`, pinned to one `ruleVersions` doc. `expenses` 1:N `approvals` (re-requests), 1:1 `receipts` (MVP), 0:1 `disputes`, 0:1 `payments`, 0:1 `payouts`.
- `subscriptions` 1:1 `families`.

## E.4 Security rules (`firestore.rules`)

```
rules_version = '2';
service cloud.firestore {
  match /databases/{db}/documents {
    function signedIn() { return request.auth != null; }
    function member(d) { return signedIn() && request.auth.uid in d.memberUids; }

    // Default: nothing readable, nothing writable from clients.
    match /{document=**} { allow read, write: if false; }

    match /users/{uid}            { allow read: if signedIn() && request.auth.uid == uid; }
    match /families/{id}          { allow read: if member(resource.data); }
    match /ruleVersions/{id}      { allow read: if member(resource.data); }
    match /expenses/{id}          { allow read: if member(resource.data);
      match /events/{e}           { allow read: if member(get(/databases/$(db)/documents/expenses/$(id)).data); } }
    match /receipts/{id}          { allow read: if member(resource.data); }
    match /disputes/{id}          { allow read: if member(resource.data); }
    match /subscriptions/{id}     { allow read: if member(resource.data); }
    match /notifications/{id}     { allow read: if signedIn() && resource.data.toUid == request.auth.uid; }
  }
}
```
Client queries must include the same constraint the rule checks (e.g. `where('memberUids', 'array-contains', uid)`, `where('toUid', '==', uid)`), otherwise Firestore rejects the query. Rules are tested with the emulator (Section N) and deployed from the repo with `npm run firebase:deploy-rules` (Section L.6). Never edit rules or indexes in the Console.

## E.5 Indexes (`firestore.indexes.json`)

| Collection | Fields | Used by |
| --- | --- | --- |
| expenses | `familyId` asc, `updatedAt` desc | Expense list, listener |
| expenses | `memberUids` array-contains, `updatedAt` desc | Client listener |
| expenses | `familyId` asc, `settlement.state` asc, `settlement.dueAt` asc | Outstanding/overdue queries, daily job |
| expenses | `familyId` asc, `owedByRole` asc, `settlement.state` asc | Dashboard sums |
| expenses | `familyId` asc, `approval.state` asc, `approval.expiresAt` asc | Daily job expiry |
| notifications | `toUid` asc, `createdAt` desc | Notification feed listener |
| approvals | `familyId` asc, `requestedAt` desc | Daily cap check |

Add any index the emulator or Firestore error message asks for, and record it in `firestore.indexes.json`.


## E.8 Real-time listeners [Agreed: use where they add value]

| Listener | Query | Where | Why |
| --- | --- | --- | --- |
| Expense detail | `doc(expenses/{id})` + `events` ordered by `at` | `/app/expenses/[id]` | Approval decision, payment and payout status appear without refresh |
| Expense list | `expenses` where `memberUids` array-contains uid, order by `updatedAt` desc, limit 30 | `/app/expenses`, Home "Needs your action" | Live badges |
| Notifications | `notifications` where `toUid == uid`, order by `createdAt` desc, limit 20 | Bell in top bar / sidebar | Live in-app feed |
| Subscription status | `subscriptions/{familyId}` | `/app/billing` | Shows ACTIVE as soon as the webhook lands |

Rules for listeners:
- Use `onSnapshot` with an error callback. On `permission-denied` sign the user out of the client SDK and redirect to login. On other errors show a small "Live updates paused, tap to retry" banner and fall back to fetching on focus.
- Unsubscribe on unmount. Never create listeners inside loops or for whole collections.
- Totals (owed, overdue) are **not** computed from listener data; they come from the server (`GET /api/dashboard`), refetched when the expense listener reports a change.
- Link pages (`/a`, `/p`, `/r`) poll the API every 10 seconds while waiting, because guests have no Firebase session.
- Listener reads count toward the Spark 50,000 reads/day; keep `limit()` on every query.

## L.6 Firebase: what is local and what is remote [Agreed]

| Thing | Where | How |
| --- | --- | --- |
| App data during `npm run dev` | Remote (real Firebase project) | Same as production; demo seed/reset scripts clean it |
| Auth providers, authorized domains, viewing data and users | Remote, Firebase Console | Owner manages in the Console |
| `firestore.rules`, `firestore.indexes.json` | Written in the repo, deployed to the remote project | `npm run firebase:deploy-rules` (`firebase deploy --only firestore:rules,firestore:indexes`). Never edit rules or indexes by hand in the Console: the repo is the source of truth. Ask the owner before the first deploy |
| Automated tests (integration, rules, E2E) | Local Firebase Emulator Suite (Auth + Firestore) | Started by the test scripts (`firebase emulators:exec`). Needs Java 21 on the owner's machine. Tests never touch the real project, so they cannot delete real data or use up the free Spark quota |

The Firebase CLI is the `firebase-tools` dev dependency, run through `npx` or npm scripts. It is used only for the emulators and for deploying rules/indexes.
