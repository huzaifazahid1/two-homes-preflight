import { handleWebhook } from "@/lib/paypal/webhook-dispatch";
import { route } from "@/lib/route";

// Node runtime and per-request execution are the defaults for Route Handlers with
// cacheComponents (segment configs like `runtime`/`dynamic` are not allowed; decision 4.x).
// PayPal webhooks (Section L.1). The raw text is read before anything parses it, so the event sent
// for verification is exactly what PayPal signed. 400 = bad signature (no state change, SE-3);
// 500 = PayPal retries (PY-18); 200 for duplicates and unknown resources (PY-10, PY-17).
export const POST = route({ name: "POST /api/webhooks/paypal", auth: "none" }, async ({ req, requestId }) => {
  const raw = await req.text();
  const result = await handleWebhook(raw, req.headers, requestId);
  return Response.json({ received: result.status === 200, outcome: result.outcome, requestId }, { status: result.status });
});
