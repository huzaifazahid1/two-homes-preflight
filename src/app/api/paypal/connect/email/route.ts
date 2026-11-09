import { requestMeta } from "@/lib/audit";
import { saveConnection } from "@/lib/paypal/connect";
import { resolveConnector } from "@/lib/paypal/connector";
import { route } from "@/lib/route";
import { paypalEmailSchema } from "@/schemas";

// Fallback: the parent types their PayPal email twice (PC-4). Payouts then use recipient_type EMAIL.
export const POST = route({ name: "POST /api/paypal/connect/email", auth: "userOrLink", body: paypalEmailSchema }, async (ctx) => {
  const who = await resolveConnector({ for: ctx.body.for, token: ctx.body.token }, ctx);
  await saveConnection(
    who.familyId,
    who.role,
    { method: "email", email: ctx.body.email },
    { kind: who.role, uid: who.uid, tokenHash: who.tokenHash },
    requestMeta(ctx.req),
  );
  return { connected: true, method: "email", email: ctx.body.email };
});
