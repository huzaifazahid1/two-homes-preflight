import "server-only";
import { CheckoutPaymentIntent, PaypalExperienceUserAction, PaypalWalletContextShippingPreference } from "@paypal/paypal-server-sdk";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { log } from "@/lib/log";
import { centsToDecimalString, CURRENCY, decimalStringToCents } from "@/lib/money";
import { orders, payments, sdkCall } from "./sdk";

// Orders v2 and refunds through the Server SDK (Section G.3, G.5). Money goes to the platform
// account that owns the credentials: no `payee` field, ever (G.1). Every call is keyed.

const BRAND = "Two Homes Preflight";

const money = z.object({ currencyCode: z.string(), value: z.string() });
const captureSchema = z
  .object({
    id: z.string(),
    status: z.string(),
    amount: money.optional(),
    customId: z.string().optional(),
    sellerReceivableBreakdown: z.object({ paypalFee: money.optional(), netAmount: money.optional() }).loose().optional(),
    createTime: z.string().optional(),
  })
  .loose();
const orderSchema = z
  .object({
    id: z.string(),
    status: z.string().optional(),
    purchaseUnits: z
      .array(z.object({ customId: z.string().optional(), payments: z.object({ captures: z.array(captureSchema).optional() }).loose().optional() }).loose())
      .optional(),
  })
  .loose();

export type CaptureInfo = {
  id: string;
  status: "COMPLETED" | "PENDING" | "DECLINED" | "FAILED" | "REFUNDED" | "PARTIALLY_REFUNDED";
  amountCents: number;
  paypalFeeCents: number | null;
  netCents: number | null;
};
export type OrderInfo = { orderId: string; status: string; customId: string | null; capture: CaptureInfo | null };

function cents(m: { currencyCode: string; value: string } | undefined): number | null {
  if (!m) return null;
  if (m.currencyCode !== CURRENCY) throw new AppError("UPSTREAM_FAILED", "PayPal returned an unexpected currency.");
  return decimalStringToCents(m.value);
}

const CAPTURE_STATUSES = new Set(["COMPLETED", "PENDING", "DECLINED", "FAILED", "REFUNDED", "PARTIALLY_REFUNDED"]);

function normalize(raw: unknown, what: string): OrderInfo {
  const parsed = orderSchema.safeParse(raw);
  if (!parsed.success) {
    log.error("paypal.unexpected_response", { what, issues: parsed.error.issues.map((i) => i.path.join(".")) });
    throw new AppError("UPSTREAM_FAILED", "PayPal returned an unexpected response.");
  }
  const unit = parsed.data.purchaseUnits?.[0];
  const c = unit?.payments?.captures?.[0];
  let capture: CaptureInfo | null = null;
  if (c) {
    if (!CAPTURE_STATUSES.has(c.status)) throw new AppError("UPSTREAM_FAILED", "PayPal returned an unknown capture status.");
    capture = {
      id: c.id,
      status: c.status as CaptureInfo["status"],
      amountCents: cents(c.amount) ?? 0,
      paypalFeeCents: cents(c.sellerReceivableBreakdown?.paypalFee),
      netCents: cents(c.sellerReceivableBreakdown?.netAmount),
    };
  }
  return { orderId: parsed.data.id, status: parsed.data.status ?? "UNKNOWN", customId: unit?.customId ?? c?.customId ?? null, capture };
}

export function orderRequestId(expenseId: string, attempt: number) {
  return `order-${expenseId}-${attempt}`;
}

/** POST /v2/checkout/orders. Amount comes from the server only (PY-2). */
export async function createOrder(input: { expenseId: string; attempt: number; amountCents: number; description: string; requestId?: string }): Promise<OrderInfo> {
  const { result } = await sdkCall(
    "orders.create",
    () =>
      orders().createOrder({
        paypalRequestId: orderRequestId(input.expenseId, input.attempt),
        prefer: "return=representation",
        body: {
          intent: CheckoutPaymentIntent.Capture,
          purchaseUnits: [
            {
              amount: { currencyCode: CURRENCY, value: centsToDecimalString(input.amountCents) },
              customId: input.expenseId,
              invoiceId: `${input.expenseId}-${input.attempt}`,
              description: `Child expense share: ${input.description}`.slice(0, 127),
            },
          ],
          paymentSource: {
            paypal: {
              experienceContext: {
                brandName: BRAND,
                shippingPreference: PaypalWalletContextShippingPreference.NoShipping,
                userAction: PaypalExperienceUserAction.PayNow,
              },
            },
          },
        },
      }),
    input.requestId,
  );
  return normalize(result, "orders.create");
}

/**
 * POST /v2/checkout/orders/{id}/capture with PayPal-Request-Id capture-{orderId} (PY-5). After a
 * decline the payer picks another funding source on the same order; that new try needs its own
 * key, or PayPal would replay the cached decline.
 */
export async function captureOrder(orderId: string, requestId?: string, declinesSoFar = 0): Promise<OrderInfo> {
  const key = declinesSoFar > 0 ? `capture-${orderId}-${declinesSoFar}` : `capture-${orderId}`;
  const { result } = await sdkCall(
    "orders.capture",
    () => orders().captureOrder({ id: orderId, paypalRequestId: key, prefer: "return=representation" }),
    requestId,
  );
  return normalize(result, "orders.capture");
}

/** GET /v2/checkout/orders/{id} (reconcile, Section G.9). */
export async function getOrder(orderId: string, requestId?: string): Promise<OrderInfo> {
  const { result } = await sdkCall("orders.get", () => orders().getOrder({ id: orderId }), requestId);
  return normalize(result, "orders.get");
}

const refundSchema = z.object({ id: z.string(), status: z.string() }).loose();

/** Full refund of a capture (Section G.5) with PayPal-Request-Id refund-{captureId}. */
export async function refundCapture(captureId: string, input: { invoiceId: string; note: string; requestId?: string }): Promise<{ refundId: string; status: string }> {
  const { result } = await sdkCall(
    "payments.refund",
    () =>
      payments().refundCapturedPayment({
        captureId,
        paypalRequestId: `refund-${captureId}`,
        prefer: "return=representation",
        body: { invoiceId: input.invoiceId, noteToPayer: input.note.slice(0, 255) },
      }),
    input.requestId,
  );
  const parsed = refundSchema.safeParse(result);
  if (!parsed.success) throw new AppError("UPSTREAM_FAILED", "PayPal returned an unexpected response.");
  return { refundId: parsed.data.id, status: parsed.data.status };
}
