import "server-only";
import { z } from "zod";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { paypalRequest } from "./http";

// Webhook signature verification (Section L.1 step 2): PayPal checks the signature for us.
// Only verification_status SUCCESS is accepted. A bad or missing signature is "invalid" (400);
// PayPal unreachable or no PAYPAL_WEBHOOK_ID is "unavailable" (500, PayPal retries). Neither
// processes anything.

export const webhookEventSchema = z
  .object({
    id: z.string().min(1).max(128),
    event_type: z.string().min(1).max(128),
    resource_type: z.string().optional(),
    resource: z.record(z.string(), z.unknown()),
    create_time: z.string().optional(),
  })
  .loose();
export type WebhookEvent = z.infer<typeof webhookEventSchema>;

const HEADERS = ["paypal-auth-algo", "paypal-cert-url", "paypal-transmission-id", "paypal-transmission-sig", "paypal-transmission-time"] as const;

const verifyResponse = z.object({ verification_status: z.string() }).loose();

export type Verification = "verified" | "invalid" | "unavailable";

export async function verifyWebhookSignature(headers: Headers, event: unknown, requestId?: string): Promise<Verification> {
  const webhookId = env().PAYPAL_WEBHOOK_ID;
  if (!webhookId) {
    log.error("webhook.no_webhook_id", { requestId });
    return "unavailable";
  }
  const h = Object.fromEntries(HEADERS.map((k) => [k, headers.get(k)]));
  if (HEADERS.some((k) => !h[k])) return "invalid";
  try {
    const { data } = await paypalRequest(
      {
        method: "POST",
        path: "/v1/notifications/verify-webhook-signature",
        idempotent: true,
        requestId,
        body: {
          auth_algo: h["paypal-auth-algo"],
          cert_url: h["paypal-cert-url"],
          transmission_id: h["paypal-transmission-id"],
          transmission_sig: h["paypal-transmission-sig"],
          transmission_time: h["paypal-transmission-time"],
          webhook_id: webhookId,
          // The parsed body of the raw text, unchanged (L.1 step 1).
          webhook_event: event,
        },
      },
      verifyResponse,
    );
    return data.verification_status === "SUCCESS" ? "verified" : "invalid";
  } catch (err) {
    // PayPal down or rejecting our call: answer 500 so PayPal delivers the event again later.
    log.error("webhook.verify_failed", { requestId, error: err });
    return "unavailable";
  }
}
