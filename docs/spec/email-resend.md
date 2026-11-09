# Email (Resend)

Part of the Two Homes Preflight spec. Source sections: H. Read `CLAUDE.md` first; it maps section letters to files.

# H. Resend email architecture

## H.1 Configuration [Agreed]

- Sending domain: **`mail.huzaifalabs.site`** (a subdomain, so it cannot affect the portfolio site or any root-domain email). Verified in Resend with the SPF, DKIM (and the MX record for the bounce subdomain) records Resend shows. DNS is managed at Cloudflare or Hostinger, whichever holds the nameservers (owner's setup guide covers both).
- `resend.dev` cannot be used for real users: it only delivers to the Resend account owner's address. It is acceptable only for the owner's first smoke test.
- From: `Two Homes Preflight <notifications@mail.huzaifalabs.site>` (env `EMAIL_FROM`). Reply-To: the acting parent's email, so replies go to the parent, not to us.
- No user mailbox integration of any kind (Gmail, Outlook) [Agreed].
- Firebase Auth verification and password reset emails are sent by Firebase itself, not Resend.

## H.2 Transport

`src/lib/email/send.ts` chooses the transport from `EMAIL_TRANSPORT`:
- `resend` (production and real local testing)
- `outbox` (tests and default local dev): writes the rendered email to an in-memory store (tests) or to a `devOutbox` collection in Firestore (local dev); `/dev/demo` can display it. Never active when `NODE_ENV=production` unless `DEMO_MODE=true`.

## H.3 Templates (`src/lib/email/templates/*.ts`)

Plain HTML string templates with inline styles, plus a text version. Every template: product name, one clear sentence, one button, the link also as plain text, footer "You received this because <owner name> added you to Two Homes Preflight." No tracking pixels.

| Template | Trigger | To | Plan |
| --- | --- | --- | --- |
| `invite` | Owner sends invite | Co-parent | All |
| `otp` | Code requested on a link | Link recipient | All |
| `approval_request` | Request approval | Approver | All |
| `approval_reminder` | 3 days without decision (once) | Approver | All |
| `approval_decision` | Approve/partial/decline | Requester | All |
| `payment_request` | Claim sent | Payer | All |
| `payment_reminder_manual` | Owed parent presses remind | Payer | All |
| `payment_due_soon`, `payment_overdue` | Daily job | Payer | Family |
| `external_payment_reported` / `external_payment_confirmed` / `marked_received` | Manual resolution | Other parent | All |
| `settled` | Payout SUCCESS | Both | Family |
| `payout_unclaimed`, `payout_failed`, `connect_paypal_needed` | Payout status | Receiver | Family |
| `subscription_problem` | Billing webhook SUSPENDED / PAYMENT.FAILED | Owner | Family |

## H.4 Sending and errors

- Create `notifications/{dedupeKey}` first (in the transition transaction). After commit, send. Update `email.status` to `sent` with `providerId`, or `failed` with the error.
- Retries: up to 3 attempts with backoff for 429 and 5xx. 4xx validation errors are not retried.
- On failure the UI always offers "Copy link" for invites, approvals and payment requests. Email failure never blocks the state change.
- Respect free limits: 100/day, 10 requests/second. Daily job stops sending reminders if `jobRuns` count for the day exceeds 60 and logs it.
- Respect `notificationPrefs` for reminders; never for OTP, invites or approval requests (those are required for the product to work).

## H.5 Environment
`RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_TRANSPORT`, `APP_URL` (for links).
