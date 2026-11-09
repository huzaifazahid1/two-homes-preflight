# PayPal, webhooks, APIMatic

Part of the Two Homes Preflight spec. Source sections: G, J, L.1 to L.5. Read `CLAUDE.md` first; it maps section letters to files.

# G. PayPal integration and payment architecture

## G.1 Model [Agreed]

```
Paying parent (personal PayPal) --Orders v2 capture--> Platform (business sandbox account)
Platform --Payouts API--> Receiving parent (personal PayPal, by payer ID or email)
```

History (do not re-try these): Orders v2 with `payee` = parent failed with `PAYEE_NOT_CONSENTED`; Partner Referrals onboarding was blocked because Casual Seller is disabled for personal accounts; fees were high ($150 became $144.60). PayPal Invoicing needs a business account per sender. So: pass-through via the platform. [Agreed]

Eligibility notes (document in README, do not hide):
- Sandbox: all accounts are US sandbox accounts; everything works without approval.
- Live (not part of this project): the platform needs a business account in a supported country, Payouts must be enabled/approved by PayPal, and pass-through settlement needs regulatory review. Personal accounts in some countries (including Pakistan) cannot receive commercial payments. None of this blocks the sandbox build.

## G.2 Amounts and fees

- Order amount = `owedCents + feeLineCents`. `feeLineCents` is 0 while the family's monthly `coveredSettledCents` plus this claim stays within the covered volume; otherwise it is the estimated processing fee for the uncovered part, shown to the payer before checkout. Fee formula constants live in config and are [Confirm] after reading real sandbox fees.
- Payout amount = `owedCents` always. The platform absorbs the capture and payout fees within the covered volume (that is what the subscription pays for).
- Format amounts for PayPal as strings with two decimals from cents (`(cents / 100).toFixed(2)` is acceptable only for formatting; never for arithmetic). Currency `USD`.
- Store PayPal's actual fee from the capture's `seller_receivable_breakdown.paypal_fee` into `payments.paypalFeeCents`.

## G.3 Buyer (paying parent) flow

1. `/p/[token]`: summary, OTP, then breakdown and PayPal Buttons (`intent=capture`, currency USD).
2. `createOrder` callback calls `POST /api/links/:token/orders`. Server checks: link session, token purpose `payment`, settlement in (`AWAITING_PAYMENT`,`PAYMENT_FAILED`), family entitled, payee connection exists or payout can wait. Creates the order with:
   - `intent: CAPTURE`, one purchase unit, `amount` from the server, `custom_id: expenseId`, `invoice_id: expenseId-attempt`, `description` "Child expense share: <description>".
   - Header `PayPal-Request-Id: order-{expenseId}-{attempt}`.
   - No `payee` field (money goes to the platform account that owns the credentials).
   - `application_context`/`payment_source.paypal.experience_context`: `shipping_preference: NO_SHIPPING`, `user_action: PAY_NOW`, brand name "Two Homes Preflight".
3. `onApprove` calls `POST /api/links/:token/orders/:orderId/capture`. Server captures with `PayPal-Request-Id: capture-{orderId}`.
4. Capture result:
   - `COMPLETED`: `transition(settlement, CAPTURE_COMPLETED)` to `PAID`, then the payout step (G.4) in the same request. Return the done page.
   - `PENDING`: store, show "Payment pending with PayPal"; no payout until a `PAYMENT.CAPTURE.COMPLETED` webhook or reconcile confirms.
   - `DECLINED`/error `INSTRUMENT_DECLINED`: `PAYMENT_FAILED`; for `INSTRUMENT_DECLINED` call `actions.restart()` on the client per PayPal guidance.
5. `onCancel`: nothing changes; show "Payment cancelled, nothing was charged".
6. `onError`: show a real error with the request id; nothing is marked paid.

## G.4 Seller/receiver flow (payout)

1. After `PAID`: if the receiver has no PayPal connection, stay in `PAID` with banner and notification; when they connect, create the payout.
2. `POST /v1/payments/payouts` with `sender_batch_header.sender_batch_id = {expenseId}-{payoutAttempt}`, `email_subject`/`email_message` friendly text, one item: `recipient_type` `PAYPAL_ID` or `EMAIL`, `amount {value, currency: USD}`, `note`, `sender_item_id: expenseId`.
3. Network failure or timeout: retry with the **same** `sender_batch_id` (PayPal rejects a duplicate batch id, which protects against double payouts; confirm the exact duplicate error in sandbox and treat it as "already created", then look it up). After a definitive `FAILED`/`RETURNED`, a new attempt uses `payoutAttempt + 1`.
4. Store `payout_batch_id` and the item id; `transition` to `PAYOUT_PROCESSING`.
5. Status updates from webhooks (G.7) and from `GET /v1/payments/payouts/{payout_batch_id}` (on expense view if older than 60 seconds, in reconcile, and in the daily job).
6. `UNCLAIMED`: notify the receiver ("Claim it in PayPal"). PayPal returns unclaimed payouts after a period [Confirm duration in docs]; when returned, `PAYOUT_FAILED`.
7. Platform sandbox balance must cover payouts. If the payout fails for insufficient funds, the claim stays `PAID`, an admin alert is logged, and reconcile retries after funding. Pre-demo checklist includes funding.

## G.5 Refunds and cancellation

- Before capture: cancelling checkout leaves the claim unpaid. Cancelling the expense revokes the payment token.
- After capture, payout not yet successful and payout failed: refund the payer via `POST /v2/payments/captures/{capture_id}/refund` (Server SDK PaymentsController) with `PayPal-Request-Id: refund-{captureId}`; settlement `REFUNDED`. [Should]
- After payout succeeded: no in-app refund. If the payer opens a PayPal dispute, record `CUSTOMER.DISPUTE.CREATED` in `auditLogs` and show it on the timeline. Production would need a reserve policy (README note).

## G.6 Subscriptions (Family plan)

- `scripts/setup-paypal-plans.ts` (run once per sandbox app): create catalog product (`POST /v1/catalogs/products`, type SERVICE) and plan (`POST /v1/billing/plans`): monthly USD price, optional trial cycle (`tenure_type: TRIAL`), `payment_preferences.payment_failure_threshold: 1`. Print the plan id; the owner puts it in `PAYPAL_FAMILY_PLAN_ID`.
- `/app/billing`: PayPal Buttons with `intent=subscription&vault=true`; `createSubscription` passes `plan_id` and `custom_id: familyId`.
- `onApprove(data)` posts `subscriptionID` to `POST /api/billing/subscription`. The server **does not trust the client**: `GET /v1/billing/subscriptions/{id}`, checks `custom_id == familyId` and `plan_id`, then stores status, `billing_info.next_billing_time` as `nextBillingTime`, and `paidThrough`.
- Cancel: `POST /api/billing/cancel` calls `POST /v1/billing/subscriptions/{id}/cancel` with a reason, keeps `paidThrough` (entitled until then).
- Webhooks keep status current: `BILLING.SUBSCRIPTION.ACTIVATED`, `.UPDATED`, `.CANCELLED`, `.SUSPENDED`, `.EXPIRED`, `.PAYMENT.FAILED`, and `PAYMENT.SALE.COMPLETED` (extends `paidThrough`).
- If a webhook is missed, `/app/billing` and gated actions re-sync with GET when `lastSyncedAt` is older than 1 hour.
- Cancelling a subscription never cancels captured claims: their payouts still go out.

## G.7 Webhook events to subscribe (per sandbox app)

Payments: `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.PENDING`, `PAYMENT.CAPTURE.DENIED`, `PAYMENT.CAPTURE.DECLINED`, `PAYMENT.CAPTURE.REFUNDED`, `PAYMENT.CAPTURE.REVERSED`, `CHECKOUT.ORDER.APPROVED` (informational).
Payouts (exact names from PayPal docs): `PAYMENT.PAYOUTSBATCH.DENIED`, `PAYMENT.PAYOUTSBATCH.PROCESSING`, `PAYMENT.PAYOUTSBATCH.SUCCESS`, `PAYMENT.PAYOUTS-ITEM.BLOCKED`, `PAYMENT.PAYOUTS-ITEM.CANCELED`, `PAYMENT.PAYOUTS-ITEM.FAILED`, `PAYMENT.PAYOUTS-ITEM.HELD`, `PAYMENT.PAYOUTS-ITEM.REFUNDED`, `PAYMENT.PAYOUTS-ITEM.RETURNED`, `PAYMENT.PAYOUTS-ITEM.SUCCEEDED`, `PAYMENT.PAYOUTS-ITEM.UNCLAIMED`.
Subscriptions: `BILLING.SUBSCRIPTION.ACTIVATED`, `BILLING.SUBSCRIPTION.UPDATED`, `BILLING.SUBSCRIPTION.CANCELLED`, `BILLING.SUBSCRIPTION.SUSPENDED`, `BILLING.SUBSCRIPTION.EXPIRED`, `BILLING.SUBSCRIPTION.PAYMENT.FAILED`, `PAYMENT.SALE.COMPLETED`.
Disputes (record only): `CUSTOMER.DISPUTE.CREATED`.

Mapping to transitions:
| Event | Effect |
| --- | --- |
| `PAYMENT.CAPTURE.COMPLETED` | `PAID` (noop if already), then ensure payout exists |
| `PAYMENT.CAPTURE.PENDING` | store status only |
| `PAYMENT.CAPTURE.DENIED` / `DECLINED` | `PAYMENT_FAILED` |
| `PAYMENT.CAPTURE.REFUNDED` / `REVERSED` | record; `REFUNDED` if before payout success, otherwise audit + timeline note |
| `PAYMENT.PAYOUTS-ITEM.SUCCEEDED` | `SETTLED` |
| `PAYMENT.PAYOUTS-ITEM.UNCLAIMED` | `PAYOUT_UNCLAIMED` |
| `PAYMENT.PAYOUTS-ITEM.FAILED`, `.RETURNED`, `.BLOCKED`, `.CANCELED`, `.REFUNDED`, `PAYMENT.PAYOUTSBATCH.DENIED` | `PAYOUT_FAILED` |
| `...HELD`, `PAYMENT.PAYOUTSBATCH.PROCESSING` | stay `PAYOUT_PROCESSING`, store status |
| `BILLING.*`, `PAYMENT.SALE.COMPLETED` | update `subscriptions/{familyId}` |

## G.8 Idempotency summary

| Operation | Key |
| --- | --- |
| Create order | `PayPal-Request-Id: order-{expenseId}-{attempt}` + transaction lock on `payments/{expenseId}` |
| Capture | `PayPal-Request-Id: capture-{orderId}` |
| Payout | `sender_batch_id: {expenseId}-{payoutAttempt}` + doc id `payouts/{expenseId}` |
| Refund | `PayPal-Request-Id: refund-{captureId}` |
| Webhook | `webhookEvents/{event.id}` created before processing |
| Email | `notifications/{type:entity:version}` |
| State | `transition()` + `version` |

## G.9 Reconcile

`POST /api/expenses/:id/reconcile` (owner, joined co-parent, or job): reads the order/capture (`GET /v2/checkout/orders/{id}`) and payout batch from PayPal and applies missing transitions through `transition()`. Used after outages, missed webhooks, and in the daily job for claims in `PAID`, `PAYOUT_PROCESSING`, `PAYOUT_UNCLAIMED` older than 10 minutes.

## G.10 Error handling

- PayPal 4xx with `name`/`details[].issue`: map to `AppError` codes (`PAYPAL_VALIDATION`, `PAYPAL_DECLINED`, `PAYPAL_DUPLICATE`, `PAYPAL_AUTH`), log `debug_id` from the response.
- 5xx and timeouts: retry up to 2 times with backoff only for idempotent calls (all calls above are idempotent by key); otherwise surface the error and leave state unchanged.
- OAuth token: cached in memory until 60 seconds before expiry; refreshed on 401 once.

## G.11 Which client to use

Use `@paypal/paypal-server-sdk` for Orders (create, get, capture), Payments (refund), and Subscriptions where the SDK exposes the operation (check with the APIMatic context plugin). Use `src/lib/paypal/http.ts` (typed `fetch` with zod-validated responses) for Payouts, webhook signature verification, Log in with PayPal, catalog products and plan creation, and any subscription operation the SDK lacks.

# J. APIMatic [Agreed: Context Plugin only]

- The **PayPal Context Plugin** by APIMatic is an MCP server that gives Claude Code current documentation for the PayPal Server SDK (`@paypal/paypal-server-sdk`, TypeScript). Install command: `npx context-plugins install paypal` (installs for Claude Code, Cursor, VS Code and Codex). The owner installs it during setup.
- Use it when writing `src/lib/paypal/orders.ts`, `subscriptions.ts` and refunds: ask it for the exact controller methods, request and response types, and how to pass `PayPal-Request-Id`.
- It does **not** cover Payouts, webhook verification or Log in with PayPal (the SDK has no such controllers). For those, use PayPal REST documentation and our `http.ts`.
- It is a development tool only: not in `package.json`, never called at runtime, never receives user data.
- The APIMatic dashboard, developer portal and SDK generation are **not** used [Agreed]. Our own API contract is documented in `docs/api.md` (endpoint, auth, request schema name, responses, errors), kept in sync with `src/app/api` and the zod schemas in `src/schemas`.
- README gets a short "Built with the PayPal Context Plugin (APIMatic)" section listing which files were written with it.
- If the plugin is unavailable (beta), continue with PayPal's official docs; do not block.

# L. Webhooks and local development

## L.1 Endpoint
`POST /api/webhooks/paypal` (`runtime = 'nodejs'`, `dynamic = 'force-dynamic'`).

1. Read the raw body as text (do not let anything re-serialize it first), then `JSON.parse`.
2. Verify the signature with PayPal: `POST /v1/notifications/verify-webhook-signature` with `auth_algo`, `cert_url`, `transmission_id`, `transmission_sig`, `transmission_time` (from headers `paypal-auth-algo`, `paypal-cert-url`, `paypal-transmission-id`, `paypal-transmission-sig`, `paypal-transmission-time`), `webhook_id` (env `PAYPAL_WEBHOOK_ID`), and `webhook_event` (the parsed body). Accept only `verification_status: SUCCESS`. Otherwise return 400 and log (no state change).
3. Create `webhookEvents/{event.id}`; if it already exists, return 200 immediately (duplicate).
4. Dispatch by `event_type` (Section G.7). Find the expense by `custom_id`, `sender_item_id`, or stored ids. Unknown resource: mark `ignored_unknown`, return 200.
5. Apply through `transition()`. Update `processedAt` and `outcome`.
6. Return 200 within a few seconds. On an unexpected error return 500 so PayPal retries (PayPal retries failed deliveries with backoff); the event doc stays without `processedAt`, and reprocessing is allowed for docs with `outcome = 'error'`.
7. Out-of-order events are safe because transitions are guarded and noops are recorded.

## L.2 Logging
Log `event.id`, `event_type`, resource id, outcome, duration, PayPal `debug_id` where present. Never log full bodies containing emails in production; redact.

## L.3 Development vs production [Agreed]

| | Local development | Production (Render) |
| --- | --- | --- |
| PayPal app | Sandbox app **"Two Homes Dev"** | Sandbox app **"Two Homes Prod"** |
| Webhook URL | `https://<your-static-domain>.ngrok-free.app/api/webhooks/paypal` | `https://<render-service>.onrender.com/api/webhooks/paypal` |
| `PAYPAL_WEBHOOK_ID` | Dev app's webhook id | Prod app's webhook id |
| Log in with PayPal Return URL | `https://<ngrok-domain>/connect/paypal/callback` | `https://<render-service>.onrender.com/connect/paypal/callback` |
| Firebase | The real Firebase project (same project as production) for `npm run dev`. Emulators are used **only** by automated tests | The real Firebase project |
| Email | `EMAIL_TRANSPORT=outbox` (or `resend` when testing real delivery) | `resend` |

Two sandbox apps keep events and credentials separate (webhooks are configured per app). Never put an ngrok URL in production config, and never assume a local URL is reachable by judges.

## L.4 ngrok
- Free plan: one static dev domain that does not change across restarts, so the PayPal dev webhook URL is set once. Limits: 1 GB/month, 20,000 requests/month, 500 webhook verifications/month (ngrok's own feature, not used).
- Run: `ngrok http --url=<your-static-domain>.ngrok-free.app 3000`.
- The browser warning page only affects browsers; PayPal webhook calls are unaffected. Log in with PayPal redirects a browser to the ngrok domain: the owner clicks "Visit" once (cookie lasts 7 days).
- Add the ngrok domain to Firebase Auth authorized domains for local Google sign-in through ngrok.

## L.5 Local webhook testing
- PayPal developer dashboard webhook simulator can send sample events to the dev URL (signature verification of simulator events can fail; use real sandbox transactions for verification tests).
- Real flow: run the app, run ngrok, pay with a sandbox personal account, watch `webhookEvents` in the Firebase Console (Firestore data viewer).
- Replay test: re-send the same event (PayPal dashboard "Resend") and confirm a single state change.
