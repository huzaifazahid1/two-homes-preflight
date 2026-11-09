# Environment variables

Part of the Two Homes Preflight spec. Source sections: O. Read `CLAUDE.md` first; it maps section letters to files.

# O. Environment variables

All variables are validated at startup by `src/lib/env.ts`. Server variables have no prefix; only `NEXT_PUBLIC_*` reach the browser. The app refuses to start in production if a required server variable is missing.

| Variable | Side | Secret | Source | Required |
| --- | --- | --- | --- | --- |
| `APP_URL` | server | no | `http://localhost:3000`, ngrok URL, or Render URL | yes |
| `NEXT_PUBLIC_APP_URL` | client | no | same | yes |
| `NODE_ENV` | both | no | set by Next | auto |
| `DEMO_MODE` | server | no | `true` only for the demo deployment | no (default false) |
| `DEV_SECRET` | server | yes | random 32+ chars | if `DEMO_MODE` |
| `JOB_SECRET` | server | yes | random 32+ chars; same value in GitHub Actions secret | yes |
| `LINK_SESSION_SECRET` | server | yes | random 32+ chars (HMAC) | yes |
| `OTP_PEPPER` | server | yes | random 32+ chars | yes |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | client | no (public by design, protected by rules) | Firebase console, web app config | yes |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | client | no | same | yes |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | client | no | same | yes |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | client | no | same | yes |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | client | no | same | yes |
| `NEXT_PUBLIC_USE_FIREBASE_EMULATORS` | client | no | `true` only in `.env.test` (set by the test setup); never in `.env.local` | tests only |
| `FIREBASE_PROJECT_ID` | server | no | Firebase | yes |
| `FIREBASE_CLIENT_EMAIL` | server | yes | service account JSON | yes |
| `FIREBASE_PRIVATE_KEY` | server | yes | service account JSON (keep `\n` escapes; `env.ts` converts) | yes |
| `FIRESTORE_EMULATOR_HOST`, `FIREBASE_AUTH_EMULATOR_HOST` | server | no | `127.0.0.1:8080`, `127.0.0.1:9099`, **only in `.env.test`**. If these are present in `.env.local`, the Admin SDK silently talks to the emulator instead of the real project | tests only |
| `GEMINI_API_KEY` | server | yes | Google AI Studio | yes |
| `GEMINI_MODEL` | server | no | current Flash model id from AI Studio | yes |
| `PAYPAL_ENV` | server | no | `sandbox` | yes |
| `PAYPAL_API_BASE` | server | no | `https://api-m.sandbox.paypal.com` | yes |
| `PAYPAL_CLIENT_ID` | server | no | sandbox app (dev or prod app per environment) | yes |
| `NEXT_PUBLIC_PAYPAL_CLIENT_ID` | client | no | same value | yes |
| `PAYPAL_CLIENT_SECRET` | server | yes | sandbox app | yes |
| `PAYPAL_WEBHOOK_ID` | server | no (but environment specific) | webhook created on that app | yes |
| `PAYPAL_FAMILY_PLAN_ID` | server + client copy | no | output of `scripts/setup-paypal-plans.ts` | Phase 4 |
| `NEXT_PUBLIC_PAYPAL_FAMILY_PLAN_ID` | client | no | same | Phase 4 |
| `PAYPAL_CONNECT_RETURN_URL` | server | no | `{APP_URL}/connect/paypal/callback` (must match app settings exactly) | yes |
| `PLAN_COVERED_VOLUME_CENTS` | server | no | default `20000` [Confirm] | yes |
| `FEE_PERCENT_BPS`, `FEE_FIXED_CENTS` | server | no | estimated fee for fee line [Confirm after sandbox test] | yes |
| `RESEND_API_KEY` | server | yes | Resend dashboard | yes |
| `EMAIL_FROM` | server | no | `Two Homes Preflight <notifications@mail.huzaifalabs.site>` | yes |
| `EMAIL_TRANSPORT` | server | no | `resend` or `outbox` | yes |
| `CLOUDINARY_CLOUD_NAME` | server | no | Cloudinary dashboard | yes |
| `CLOUDINARY_API_KEY` | server | no | Cloudinary dashboard | yes |
| `CLOUDINARY_API_SECRET` | server | yes | Cloudinary dashboard | yes |
| `CLOUDINARY_FOLDER_PREFIX` | server | no | `two-homes/dev` or `two-homes/prod` | yes |

`.env.example` (placeholders only; commit this file):

```dotenv
# App
APP_URL=http://localhost:3000
NEXT_PUBLIC_APP_URL=http://localhost:3000
DEMO_MODE=false
DEV_SECRET=replace-with-32-random-chars
JOB_SECRET=replace-with-32-random-chars
LINK_SESSION_SECRET=replace-with-32-random-chars
OTP_PEPPER=replace-with-32-random-chars

# Firebase (client, public)
NEXT_PUBLIC_FIREBASE_API_KEY=your-web-api-key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project-id
NEXT_PUBLIC_FIREBASE_APP_ID=your-app-id
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your-sender-id

# Firebase (server, secret)
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project-id.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nreplace\n-----END PRIVATE KEY-----\n"

# Gemini
GEMINI_API_KEY=replace
GEMINI_MODEL=replace-with-current-flash-model-id

# PayPal (sandbox)
PAYPAL_ENV=sandbox
PAYPAL_API_BASE=https://api-m.sandbox.paypal.com
PAYPAL_CLIENT_ID=replace
NEXT_PUBLIC_PAYPAL_CLIENT_ID=replace
PAYPAL_CLIENT_SECRET=replace
PAYPAL_WEBHOOK_ID=replace
PAYPAL_FAMILY_PLAN_ID=replace-after-running-setup-script
NEXT_PUBLIC_PAYPAL_FAMILY_PLAN_ID=replace-after-running-setup-script
PAYPAL_CONNECT_RETURN_URL=http://localhost:3000/connect/paypal/callback
PLAN_COVERED_VOLUME_CENTS=20000
FEE_PERCENT_BPS=349
FEE_FIXED_CENTS=49

# Resend
RESEND_API_KEY=replace
EMAIL_FROM="Two Homes Preflight <notifications@mail.huzaifalabs.site>"
EMAIL_TRANSPORT=outbox

# Cloudinary
CLOUDINARY_CLOUD_NAME=replace
CLOUDINARY_API_KEY=replace
CLOUDINARY_API_SECRET=replace
CLOUDINARY_FOLDER_PREFIX=two-homes/dev
```
`.env.test` (committed, no secrets; loaded only by Vitest and Playwright):

```dotenv
NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
FIREBASE_PROJECT_ID=demo-two-homes
NEXT_PUBLIC_FIREBASE_PROJECT_ID=demo-two-homes
EMAIL_TRANSPORT=outbox
```
A project id starting with `demo-` tells the emulators never to reach a real project.

`FEE_PERCENT_BPS` and `FEE_FIXED_CENTS` above are placeholders for the fee-line estimate only, [Confirm] against a real sandbox capture's `paypal_fee`. Render gets the production values in its dashboard; GitHub Actions gets `JOB_SECRET` and `APP_URL` as repository secrets.
