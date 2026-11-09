import { NextResponse } from "next/server";
import { requestMeta } from "@/lib/audit";
import { AppError, isAppError } from "@/lib/errors";
import { cookieOptions } from "@/lib/links/session";
import { completeConnect, PP_STATE_COOKIE } from "@/lib/paypal/connect";
import { errorResponse, route } from "@/lib/route";
import { connectCallbackSchema } from "@/schemas";

// Completes Log in with PayPal. The state cookie is cleared on every outcome, so a reused
// code or state fails (PC-3). Cancel saves nothing (PC-2).
export const POST = route({ name: "POST /api/paypal/connect/callback", auth: "userOrLink", body: connectCallbackSchema }, async (ctx) => {
  const clear = (res: NextResponse | Response) => {
    const r = res instanceof NextResponse ? res : new NextResponse(res.body, res);
    r.cookies.set(PP_STATE_COOKIE, "", { ...cookieOptions(0), maxAge: 0 });
    return r;
  };
  try {
    const outcome = await completeConnect(
      ctx.body,
      ctx.cookies.get(PP_STATE_COOKIE),
      { uid: ctx.user?.uid, tokenHash: ctx.linkSession?.tokenHash },
      { requestId: ctx.requestId, ...requestMeta(ctx.req) },
    );
    return clear(NextResponse.json(outcome));
  } catch (err) {
    if (!isAppError(err)) throw err;
    ctx.log.info("paypal.connect_failed", { errorCode: err.code });
    return clear(errorResponse(err as AppError, ctx.requestId));
  }
});
