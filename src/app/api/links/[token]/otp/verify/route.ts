import { NextResponse } from "next/server";
import { verifyLinkOtp } from "@/lib/links/actions";
import { cookieOptions, LINK_SESSION_COOKIE, LINK_SESSION_TTL_MS } from "@/lib/links/session";
import { route } from "@/lib/route";
import { otpVerifySchema, tokenParams } from "@/schemas";

// Correct code sets the 30-minute link session cookie (LK-3). 5 wrong codes lock for 15 minutes (LK-4).
export const POST = route(
  { name: "POST /api/links/:token/otp/verify", auth: "link", params: tokenParams, body: otpVerifySchema },
  async ({ params, body }) => {
    const s = await verifyLinkOtp(params.token, body.code);
    const res = NextResponse.json({ ok: true, sessionExpiresAt: new Date(s.expiresAt).toISOString() });
    res.cookies.set(LINK_SESSION_COOKIE, s.cookie, cookieOptions(LINK_SESSION_TTL_MS / 1000));
    return res;
  },
);
