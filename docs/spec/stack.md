# Technical stack

Part of the Two Homes Preflight spec. Source sections: B. Read `CLAUDE.md` first; it maps section letters to files.

# B. Technical stack

Versions were checked on npm on Nov 8, 2026. Pin exact versions (no `^` or `~`) and commit `package-lock.json`.

| Technology | Why | Where | Integrates with | Limitations | Free tier |
| --- | --- | --- | --- | --- | --- |
| **Next.js 16.4.5** (App Router, TypeScript) [Agreed] | One codebase for UI and backend; Server Components for reads, Route Handlers for writes | Whole app | Everything | Must be 16.4.5 or later (Nov 3, 2026 security release). `proxy.ts` is Next 16's name for middleware | Open source |
| **Node.js 24 LTS** [Recommended] | Runtime for Next and Route Handlers (`export const runtime = 'nodejs'`) | Local + Render | | Next needs 20.9+ | Free |
| **TypeScript 6.0.3** [Recommended] | Type safety for state machines and money | All code | | TS 7 exists; only switch if `next build` passes cleanly on it. Default 6.0.3 | Free |
| **React 19.3.1** | UI | Client + server components | Next | | Free |
| **Tailwind CSS 4.3.5** + **shadcn/ui** (CLI 4.23.0, Radix primitives) | Fast, consistent, accessible design system with tokens in CSS variables | All UI | Theme tokens (Section P.9) | shadcn components are copied into `src/components/ui` and owned by us | Free |
| **Firebase Authentication** [Agreed] | Sign-in (email/password, Google; email-link for joined co-parent) | Client sign-in, server session cookies | Firestore rules (`request.auth`) | Firebase sends verification emails from its own domain | Free on Spark for these providers |
| **Cloud Firestore** [Agreed] | Primary database + real-time listeners | Server (Admin SDK) for all writes; client SDK for read-only listeners | Rules, Auth, every module | 1 MiB per document; listeners count as reads | Spark: 1 GiB stored, 50,000 reads/day, 20,000 writes/day, 20,000 deletes/day. Listeners must be scoped tightly |
| **Firebase Admin SDK 14.5.0** | Server access to Firestore and Auth, session cookies | `src/lib/firebase/admin.ts` | | Server only | Free |
| **Cloudinary** (SDK 2.11.0) [Agreed] | Receipt file storage (Firebase Storage needs the paid Blaze plan for new projects) | Receipt upload + private download URLs | Firestore stores `publicId` + metadata | Free accounts block PDF/ZIP **delivery** by default (enable "Allow delivery of PDF and ZIP files" in Security settings). Time-limited URLs via the download API are not CDN cached and cost double bandwidth (fine at our volume) | Free plan credits on a rolling 30-day window (1 credit = 1 GB storage or 1 GB bandwidth or 1,000 transformations) |
| **Gemini API** via `@google/genai` 2.32.0 [Agreed] | Rule extraction, receipt reading, quick add, family prefill | `src/lib/ai/*` (server only) | Rules engine consumes validated output | Model in env `GEMINI_MODEL` (a current Flash model). Do not use `@google/genai` 3.0.0 (published Nov 6, 2026) | Free tier with rate limits; free-tier data may be used by Google to improve products, so **synthetic data only** |
| **unpdf 2.1.0** | Per-page text extraction from the agreement PDF | `src/lib/pdf.ts` | Quote verification | Scanned PDFs have no text; offer paste-text | Free |
| **PayPal REST APIs (sandbox)** [Agreed] | Orders v2 (payer to platform), Payouts (platform to receiver), Subscriptions (Family plan), Log in with PayPal (connect), Webhooks | `src/lib/paypal/*`, payment and billing pages | Settlement state machine | See Section G for eligibility notes | Sandbox free |
| **@paypal/paypal-server-sdk 2.5.0** | Typed client for Orders, Payments (refunds), Subscriptions | `src/lib/paypal/orders.ts`, `subscriptions.ts` | | **No Payouts controller**; Payouts, webhook verification, identity and catalog/plan creation use our typed `fetch` client | Free |
| **@paypal/react-paypal-js 10.6.1** | PayPal Buttons for checkout and subscription | `/p/[token]`, `/app/billing` | | Load with `intent=capture` on the payment page and `intent=subscription&vault=true` on billing; never both on one page | Free |
| **Resend 6.37.0** [Agreed] | Transactional email | `src/lib/email/*` | Notifications collection | `resend.dev` sender can only send to the Resend account's own address, so a verified domain is required. Using subdomain `mail.huzaifalabs.site` | Free: 100 emails/day, 3,000/month, 3 domains, 10 requests/second, 30-day data retention |
| **AG Grid Community 36.3.0** (`ag-grid-community`, `ag-grid-react`) [Agreed] | Data tables on desktop | Ledger, desktop expense table, dashboard tables | Data from server functions | Enterprise features unavailable (Section K) | MIT, free |
| **APIMatic PayPal Context Plugin** [Agreed: plugin only] | Gives Claude Code current PayPal Server SDK docs through MCP | Development only | Claude Code | Beta. No Payouts coverage (SDK has none). Not a runtime dependency. APIMatic dashboard, portal and SDK generation are **not** used | Plugin install is free via `npx context-plugins install paypal` |
| **Zod 4.6.7** | Validation for request bodies, AI output, env vars | Everywhere | | | Free |
| **Render** (free web service) [Agreed] | Hosting | Production deploy | GitHub | Free instances spin down after 15 minutes idle; first request can take about a minute. Warm up before demos | Free (750 instance hours/month) |
| **GitHub Actions** | CI and the daily job (scheduled workflow calling `/api/jobs/daily`) | `.github/workflows` | | Schedules can be delayed by several minutes | Free minutes on GitHub Free |
| **ngrok** (free) | Public HTTPS URL for local webhooks and Log in with PayPal return URL | Local development only | PayPal sandbox app (dev) | One free static dev domain (stays the same across restarts), 1 GB/month, 20,000 requests/month, 500 webhook verifications/month; browser interstitial does not affect API calls | Free |
| **Vitest 5.1.0**, **Playwright 1.65.0**, **MSW 3.0.4**, **Firebase Emulator Suite** (firebase-tools 15.35.0) | Unit, integration, API and E2E tests | `tests/` | | Emulators are for tests only; they need Java (owner installs JDK 21) | Free |
| **Geist 1.9.2** + **Source Serif 4** (via `next/font/google`) + **lucide-react 1.70.0** | Typography and icons | UI | | | Free |

Not used, on purpose [Agreed]: Firebase Storage, Firebase Realtime Database, PayPal Partner Referrals, PayPal Invoicing, Transaction Search, a second AI provider, a dedicated OCR service, a separate Express backend, Redux, tRPC, Prisma, XState, TanStack Query, Docker (optional only).
