# Authentication, links and PayPal connection

Part of the Two Homes Preflight spec. Source sections: F. Read `CLAUDE.md` first; it maps section letters to files.

# F. Authentication and authorization

Three separate things. Never mix them.

| Mechanism | Who | Proves | Implementation |
| --- | --- | --- | --- |
| **App authentication** | Owner, joined co-parent | Identity in our app | Firebase Auth + httpOnly session cookie |
| **Link access** | Guest co-parent (or any recipient) | Possession of a link + control of the recipient's mailbox | Link token + email OTP + link session cookie |
| **PayPal connection** | Any parent who receives money | Which PayPal account receives payouts | Log in with PayPal (or confirmed email fallback). **This is not app authentication** and never signs the user in |

## F.1 App authentication

- Providers: email + password, Google. Email-link sign-in only for joined co-parent [Should].
- Firebase setting: one account per email address.
- Flow: client signs in with the Firebase client SDK, gets an ID token, `POST /api/auth/session` verifies it with the Admin SDK and sets an httpOnly, Secure, SameSite=Lax session cookie created with `createSessionCookie` (expiry 5 days). The client SDK stays signed in too, for Firestore listeners.
- `DELETE /api/auth/session` clears the cookie and revokes refresh tokens; the client SDK signs out.
- Email verification: Firebase `sendEmailVerification`. Required before sending invites or payment requests.
- Server checks: `requireUser()` verifies the session cookie with `checkRevoked: true`; `requireFamily()` loads the user's family and checks membership; `requireOwner()` for agreement and billing routes.
- `src/proxy.ts` only redirects signed-out users away from `/app` and `/onboarding` and signed-in users away from `/login`. It never authorizes.

## F.2 Authorization matrix

| Action | Owner | Joined co-parent | Guest via link | Other family |
| --- | --- | --- | --- | --- |
| Upload agreement, confirm rules, billing | yes | no | no | no |
| Create expense, upload receipt | yes | yes | no | no |
| Request approval | yes (buyer) | yes (buyer) | no | no |
| Decide approval | only if they are the requested approver | same | yes (link `approval`) | no |
| Send payment request, remind, mark received, waive | owed parent only | owed parent only | no | no |
| Pay, report outside payment, dispute | paying parent | paying parent | yes (link `payment`) | no |
| Connect PayPal | yes (own) | yes (own) | yes (own, via link session) | no |
| Read ledger | yes | yes | no | no |

Every handler checks this server-side. The UI hiding a button is not authorization.

## F.3 Link access [Agreed]

- Token: 32 random bytes, base64url. Stored only as SHA-256 hash in `linkTokens`. Bound to `purpose`, `resourcePath`, `recipientEmail`, `allowedActions`.
- Expiry: invite 7 days, approval 14 days, payment 14 days. Revocable. Approval and invite tokens are marked used after the decision; payment tokens after capture.
- Opening a link shows a minimal read-only summary only (amount, split, clause, child's first name, requester's name). No agreement text beyond the clause, no addresses, no history.
- Any action requires an OTP: 6 digits, sent to `recipientEmail` on file (never to an email typed on the page), 10-minute expiry, stored hashed (SHA-256 with a server pepper), max 5 wrong attempts then 15-minute lock, max 3 sends per hour per token.
- Correct OTP sets a link session cookie: HMAC-SHA256 signed (`LINK_SESSION_SECRET`), httpOnly, Secure, SameSite=Lax, 30 minutes, containing the token hash and expiry.
- A signed-in joined co-parent skips OTP.
- Expired, used or revoked token: HTTP 410 with a friendly page ("This link has expired. Ask Alex to send a new one.").
- Security question based on birth dates was evaluated and **rejected** [Agreed]: guessable by exactly the people a forwarded link reaches, and it would require storing a child's birth date.

## F.4 PayPal connection ("Connect your PayPal account") [Agreed]

Purpose: connect once, reuse for every payout. Shown in onboarding step 5 and in Settings ("Connected as sara@example.com, verified" with Reconnect / Disconnect). Not used for sign-in. Not seller onboarding. **Partner Referrals is not used** [Agreed]: parents have personal PayPal accounts; the platform's business account does the payouts.

Primary method: **Log in with PayPal** (OAuth 2 / OpenID Connect, sandbox).
1. App settings (PayPal developer dashboard, per app): enable Log in with PayPal, set the Return URL (`{APP_URL}/connect/paypal/callback`), request Email, Account verification status and PayPal account ID (payer ID).
2. `GET /api/paypal/connect/start?for=owner|coparent` creates a random `state` (stored in an httpOnly cookie with the target role and family) and redirects to PayPal's authorize URL with `scope=openid email https://uri.paypal.com/services/paypalattributes`.
3. Callback `/connect/paypal/callback?code&state` calls `POST /api/paypal/connect/callback`: verify `state`, exchange the code for an access token (server side, Basic auth with client id and secret), call the userinfo endpoint, read payer ID, email and verified status.
4. Save `families.payout.{role} = { method: 'login_with_paypal', payerId, email, verifiedAccount, connectedAt }`. Discard the PayPal access token immediately (we do not need ongoing access).
5. Payouts use `recipient_type: 'PAYPAL_ID'` with `receiver: payerId`.

Exact authorize, token and userinfo URLs and response field names must be confirmed in sandbox before coding the parser (use the APIMatic context plugin or PayPal identity docs; log the raw userinfo response once in development, without tokens). Make the parser tolerant and validated with zod.

Eligibility risk [Confirm in sandbox, Phase 1 hour 1]: PayPal's Payouts-specific "Assisted Account Creation" component requires PayPal to enable identity services for the account. The standard Log in with PayPal app setting is usually self-serve. If the sandbox app cannot enable it or the flow fails, use the fallback and tell the owner.

Fallback method: the parent types their PayPal email twice; we store `{ method: 'email', email }` and payouts use `recipient_type: 'EMAIL'`. The UI says "If this email has no PayPal account, the payout will wait until you claim it."

Who must connect:
- Owner: mandatory during onboarding.
- Co-parent: optional at invite acceptance; mandatory before the first payout to them (the payout waits in `PAID` with a banner "Sara needs to connect PayPal to receive this" until connected, then creates the payout).
