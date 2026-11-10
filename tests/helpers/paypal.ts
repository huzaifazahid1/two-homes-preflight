import { resetEnvCache } from "@/lib/env";
import { resetPayPalTokenCache } from "@/lib/paypal/http";
import { resetPayPalSdk } from "@/lib/paypal/sdk";
import type { StubRequest, StubResponse, StubServer } from "./stub-server";

// A small stateful PayPal for integration tests (Orders v2, Payouts, Subscriptions, webhook
// verification). Like the real API, a repeated PayPal-Request-Id returns the first response.
// Responses use PayPal's wire format (snake_case); the Server SDK maps them.

export const PLAN_ID = "P-TESTFAMILYPLAN";
export const WEBHOOK_ID = "WH-TEST-0001";
export const VALID_SIG = "valid-signature";

type Order = { id: string; amount: string; customId: string; status: string; capture?: { id: string; status: string; amount: string } };
type CaptureMode = "COMPLETED" | "PENDING" | "DECLINED" | "INSTRUMENT_DECLINED" | "NETWORK";
type PayoutMode = "ok" | "insufficient" | "unavailable";
type Batch = { id: string; senderBatchId: string; expenseId: string; amount: string; receiver: string; itemId: string; itemStatus: string; batchStatus: string };
export type Sub = { id: string; status: string; plan_id: string; custom_id: string; next_billing_time?: string; trial?: boolean };

export class FakePayPal {
  orders = new Map<string, Order>();
  batches = new Map<string, Batch>();
  subs = new Map<string, Sub>();
  captureCalls = 0;
  payoutPosts = 0;
  refunds: string[] = [];
  captureMode: CaptureMode = "COMPLETED";
  payoutMode: PayoutMode = "ok";
  /** Payout POSTs that create the batch but answer 503 (a timeout after PayPal acted). */
  payoutLostResponses = 0;
  private cache = new Map<string, StubResponse>();
  private seq = 0;

  constructor(private stub: StubServer) {}

  private nextId(prefix: string, len = 17) {
    this.seq++;
    return `${prefix}${String(this.seq).padStart(len - prefix.length, "0")}`;
  }

  private keyed(req: StubRequest, fn: () => StubResponse): StubResponse {
    const key = req.headers["paypal-request-id"] as string | undefined;
    if (key && this.cache.has(key)) return this.cache.get(key)!;
    const res = fn();
    if (key && (res.status ?? 200) < 500) this.cache.set(key, res);
    return res;
  }

  install() {
    process.env.PAYPAL_API_BASE = this.stub.url;
    process.env.PAYPAL_WEBHOOK_ID = WEBHOOK_ID;
    process.env.PAYPAL_FAMILY_PLAN_ID = PLAN_ID;
    process.env.PAYPAL_TIMEOUT_MS = "3000";
    resetEnvCache();
    resetPayPalSdk();
    resetPayPalTokenCache();
    const s = this.stub;
    s.on("POST", "/v1/oauth2/token", () => ({ json: { access_token: "A21.app-token", token_type: "Bearer", expires_in: 32400 } }));

    s.on("POST", "/v2/checkout/orders", (req) =>
      this.keyed(req, () => {
        const body = JSON.parse(req.body);
        const pu = body.purchase_units[0];
        if (body.purchase_units[0].payee) return { status: 400, json: { name: "INVALID_REQUEST", debug_id: "d1" } };
        const o: Order = { id: this.nextId("ORD"), amount: pu.amount.value, customId: pu.custom_id, status: "CREATED" };
        this.orders.set(o.id, o);
        return { status: 201, json: this.orderJson(o) };
      }),
    );
    s.onPattern("POST", /^\/v2\/checkout\/orders\/([A-Z0-9]+)\/capture$/, (req) =>
      this.keyed(req, () => {
        this.captureCalls++;
        const o = this.orders.get(req.match![1]);
        if (!o) return { status: 404, json: { name: "RESOURCE_NOT_FOUND", debug_id: "d2" } };
        if (o.capture) return { status: 422, json: { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "ORDER_ALREADY_CAPTURED" }], debug_id: "d3" } };
        if (this.captureMode === "NETWORK") return { status: 503, json: {} };
        if (this.captureMode === "INSTRUMENT_DECLINED") return { status: 422, json: { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "INSTRUMENT_DECLINED" }], debug_id: "d4" } };
        o.capture = { id: this.nextId("CAP"), status: this.captureMode, amount: o.amount };
        o.status = this.captureMode === "COMPLETED" ? "COMPLETED" : o.status;
        return { status: 201, json: this.orderJson(o) };
      }),
    );
    s.onPattern("GET", /^\/v2\/checkout\/orders\/([A-Z0-9]+)$/, (req) => {
      const o = this.orders.get(req.match![1]);
      return o ? { json: this.orderJson(o) } : { status: 404, json: { name: "RESOURCE_NOT_FOUND" } };
    });
    s.onPattern("POST", /^\/v2\/payments\/captures\/([A-Z0-9]+)\/refund$/, (req) =>
      this.keyed(req, () => {
        this.refunds.push(req.match![1]);
        return { status: 201, json: { id: this.nextId("REF"), status: "COMPLETED" } };
      }),
    );

    s.on("POST", "/v1/payments/payouts", (req) => {
      this.payoutPosts++;
      return this.keyed(req, () => {
        const body = JSON.parse(req.body);
        const sender = body.sender_batch_header.sender_batch_id as string;
        const item = body.items[0];
        const existing = [...this.batches.values()].find((b) => b.senderBatchId === sender);
        if (this.payoutLostResponses > 0) {
          // PayPal created the batch, but the response never arrived (timeout).
          this.payoutLostResponses--;
          if (!existing) this.createBatch(sender, item);
          return { status: 503, json: {} };
        }
        if (existing) {
          return { status: 400, json: { name: "USER_BUSINESS_ERROR", debug_id: "d5", details: [{ issue: "Batch with given sender_batch_id already exists", link: [{ href: `https://api.sandbox.paypal.com/v1/payments/payouts/${existing.id}` }] }] } };
        }
        if (this.payoutMode === "insufficient") return { status: 422, json: { name: "INSUFFICIENT_FUNDS", debug_id: "d6" } };
        if (this.payoutMode === "unavailable") return { status: 503, json: {} };
        const b = this.createBatch(sender, item);
        return { status: 201, json: { batch_header: { payout_batch_id: b.id, batch_status: "PENDING", sender_batch_header: { sender_batch_id: sender } } } };
      });
    });
    s.onPattern("GET", /^\/v1\/payments\/payouts\/([A-Z0-9]+)$/, (req) => {
      const b = this.batches.get(req.match![1]);
      if (!b) return { status: 404, json: { name: "INVALID_RESOURCE_ID" } };
      return { json: { batch_header: { payout_batch_id: b.id, batch_status: b.batchStatus, sender_batch_header: { sender_batch_id: b.senderBatchId } }, items: [{ payout_item_id: b.itemId, transaction_status: b.itemStatus, payout_item: { sender_item_id: b.expenseId, amount: { value: b.amount, currency: "USD" } } }] } };
    });

    s.on("POST", "/v1/notifications/verify-webhook-signature", (req) => {
      const body = JSON.parse(req.body);
      const ok = body.transmission_sig === VALID_SIG && body.webhook_id === WEBHOOK_ID;
      return { json: { verification_status: ok ? "SUCCESS" : "FAILURE" } };
    });

    s.onPattern("GET", /^\/v1\/billing\/subscriptions\/([A-Z0-9-]+)$/, (req) => {
      const sub = this.subs.get(req.match![1]);
      return sub ? { json: this.subJson(sub) } : { status: 404, json: { name: "RESOURCE_NOT_FOUND", debug_id: "d7" } };
    });
    s.onPattern("POST", /^\/v1\/billing\/subscriptions\/([A-Z0-9-]+)\/cancel$/, (req) => {
      const sub = this.subs.get(req.match![1]);
      if (!sub) return { status: 404, json: { name: "RESOURCE_NOT_FOUND" } };
      if (sub.status === "CANCELLED") return { status: 422, json: { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "SUBSCRIPTION_STATUS_INVALID" }] } };
      sub.status = "CANCELLED";
      delete sub.next_billing_time;
      return { status: 204 };
    });
    return this;
  }

  orderJson(o: Order) {
    return {
      id: o.id,
      status: o.status,
      intent: "CAPTURE",
      purchase_units: [
        {
          custom_id: o.customId,
          amount: { currency_code: "USD", value: o.amount },
          ...(o.capture
            ? {
                payments: {
                  captures: [
                    {
                      id: o.capture.id, status: o.capture.status, custom_id: o.customId, amount: { currency_code: "USD", value: o.capture.amount },
                      seller_receivable_breakdown: { gross_amount: { currency_code: "USD", value: o.capture.amount }, paypal_fee: { currency_code: "USD", value: "2.58" }, net_amount: { currency_code: "USD", value: (Number(o.capture.amount) - 2.58).toFixed(2) } },
                    },
                  ],
                },
              }
            : {}),
        },
      ],
    };
  }

  subJson(s: Sub) {
    return {
      id: s.id, status: s.status, plan_id: s.plan_id, custom_id: s.custom_id,
      billing_info: {
        outstanding_balance: { currency_code: "USD", value: "0.00" },
        failed_payments_count: 0,
        ...(s.next_billing_time ? { next_billing_time: s.next_billing_time } : {}),
        cycle_executions: [{ tenure_type: s.trial ? "TRIAL" : "REGULAR", sequence: 1, cycles_completed: 0, cycles_remaining: 1 }],
      },
    };
  }

  private createBatch(sender: string, item: { sender_item_id: string; amount: { value: string }; receiver: string }): Batch {
    const b: Batch = { id: this.nextId("BAT", 13), senderBatchId: sender, expenseId: item.sender_item_id, amount: item.amount.value, receiver: item.receiver, itemId: this.nextId("ITM", 13), itemStatus: "PENDING", batchStatus: "PENDING" };
    this.batches.set(b.id, b);
    return b;
  }

  /** Simulates the buyer approving the order in the PayPal popup. */
  approve(orderId: string) {
    const o = this.orders.get(orderId)!;
    o.status = "APPROVED";
  }

  batchFor(expenseId: string) {
    return [...this.batches.values()].filter((b) => b.expenseId === expenseId);
  }

  addSub(sub: Sub) {
    this.subs.set(sub.id, sub);
    return sub;
  }
}

/** Headers PayPal sends with a webhook; the fake verifies VALID_SIG. */
export function webhookHeaders(sig = VALID_SIG): Record<string, string> {
  return {
    "paypal-auth-algo": "SHA256withRSA",
    "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1",
    "paypal-transmission-id": `t-${Math.random().toString(36).slice(2)}`,
    "paypal-transmission-sig": sig,
    "paypal-transmission-time": new Date().toISOString(),
    "content-type": "application/json",
  };
}

export function clearPayPal() {
  process.env.PAYPAL_API_BASE = "https://api-m.sandbox.paypal.com";
  for (const k of ["PAYPAL_WEBHOOK_ID", "PAYPAL_FAMILY_PLAN_ID", "PAYPAL_TIMEOUT_MS"]) delete process.env[k];
  resetEnvCache();
  resetPayPalSdk();
  resetPayPalTokenCache();
}
