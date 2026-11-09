# API reference

Kept in sync with `src/app/api`. Every handler uses `route()` (`src/lib/route.ts`): request id, auth, zod validation of body/query/params, rate limit, error mapping. Error shape:

```json
{ "error": { "code": "STATE_CONFLICT", "message": "...", "requestId": "...", "details": {} } }
```

Statuses: 400 `INVALID` / `OTP_INVALID` / `OTP_EXPIRED` / `PAYPAL_STATE_MISMATCH`, 401 `UNAUTHENTICATED` / `LINK_SESSION_REQUIRED`, 402 `PLAN_REQUIRED`, 403 `FORBIDDEN` / `EMAIL_NOT_VERIFIED`, 404 `NOT_FOUND`, 409 `STATE_CONFLICT` / `DUPLICATE`, 410 `LINK_GONE`, 423 `LOCKED`, 429 `RATE_LIMITED` (with `retry-after`), 502 `UPSTREAM_FAILED`, 503 `DB_UNAVAILABLE`.

Auth column: **user** = session cookie `thp_session` (checkRevoked). **link** = possession of the link token; action endpoints also need the `thp_link` session from a correct OTP. **user or link** = either.

## Endpoints

| Method | Path | Auth | Purpose | Phase |
| --- | --- | --- | --- | --- |
| POST | `/api/auth/session` | none | Body `{ idToken, timeZone? }`. Verifies a fresh Firebase ID token, sets the 5-day session cookie, creates the profile on first sign-in. Returns `{ me }` | 1 |
| DELETE | `/api/auth/session` | none | Clears the cookie; revokes refresh tokens when the session is still valid | 1 |
| GET | `/api/me` | user | Profile, family view, onboarding step. Re-checks email verification live | 1 |
| PATCH | `/api/me` | user | `{ displayName?, timeZone?, notificationPrefs?, theme?, completeStep?, plan? }`. `completeStep` checks the step's prerequisites and advances (409 with `details.onboardingStep` otherwise) | 1 |
| POST | `/api/family` | user (verified) | Create the family if missing; set co-parent `{ name, email }` (400 if equal to the owner's email) | 1 |
| POST | `/api/family/children` | owner | `{ firstName, birthYear? }` (max 10 children) | 1 |
| PATCH | `/api/family/children/:id` | owner | Edit a child | 1 |
| DELETE | `/api/family/children/:id` | owner | Remove a child (409 once it has expenses) | 1 |
| POST | `/api/family/invite` | owner (verified) | Create the invite token and email it. Returns `{ link, expiresAt, email: { status } }`. 409 if an invite is already active. 10/hour/user | 1 |
| POST | `/api/family/invite/resend` | owner (verified) | Revoke the active invite and send a new one in one transaction | 1 |
| DELETE | `/api/family/invite` | owner | Revoke the active invite | 1 |
| GET | `/api/links/:token` | link | Read-only summary. PayPal details only with a link session. 404 unknown, 410 expired/used/revoked | 1 |
| POST | `/api/links/:token/otp` | link | Email a 6-digit code to the invited address. 3/hour/token (429); 423 while locked | 1 |
| POST | `/api/links/:token/otp/verify` | link | `{ code }`. Sets the 30-minute `thp_link` cookie. 5 wrong codes lock for 15 minutes (423) | 1 |
| POST | `/api/links/:token/accept` | link + OTP | `{ perRule? }`. Accepts the invite, records rule acknowledgements, marks the token used, notifies the owner in-app | 1 |
| GET | `/api/paypal/connect/start` | user or link | Query `{ for, returnTo, token? }`. Returns `{ url }` (PayPal authorize) and sets the signed `thp_pp_state` cookie | 1 |
| POST | `/api/paypal/connect/callback` | user or link | `{ code?, state, error? }`. Verifies state + caller, exchanges the code, reads userinfo, saves `families.payout.{role}`, discards the token. Cancel returns `{ status: "cancelled" }` and saves nothing | 1 |
| POST | `/api/paypal/connect/email` | user or link | Fallback `{ for, email, confirmEmail, token? }` (emails must match) | 1 |
| DELETE | `/api/paypal/connect` | user | Disconnect your own PayPal (409 while a payout is processing) | 1 |
| POST | `/api/notifications/read` | user | `{ ids }`. Marks your own notifications read | 1 |
