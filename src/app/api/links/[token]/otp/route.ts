import { sendLinkOtp } from "@/lib/links/actions";
import { route } from "@/lib/route";
import { tokenParams } from "@/schemas";

// Sends a code to the recipient email on file. 3 sends per hour per token (LK-5) inside sendLinkOtp.
export const POST = route({ name: "POST /api/links/:token/otp", auth: "link", params: tokenParams }, async ({ params, requestId }) => {
  return sendLinkOtp(params.token, requestId);
});
