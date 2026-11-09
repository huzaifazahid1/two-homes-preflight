# Architecture

## System

```mermaid
flowchart LR
  subgraph Browser
    Owner["Owner (signed in)"]
    Guest["Co-parent (link + email code)"]
  end
  subgraph Render["Next.js 16 on Render"]
    Pages["Server Components (reads)"]
    API["Route Handlers via route()"]
    Lib["lib: state machines, transition(), links, OTP, notifications"]
  end
  Owner -- "Firebase Auth sign-in" --> FAuth[(Firebase Auth)]
  Owner -- "session cookie" --> Pages
  Owner -- "fetch" --> API
  Owner -. "read-only listeners (notifications)" .-> FS[(Cloud Firestore)]
  Guest -- "fetch (no Firebase session)" --> API
  Pages --> Lib
  API --> Lib
  Lib -- "Admin SDK: all writes" --> FS
  Lib -- "verify session" --> FAuth
  Lib -- "invite, codes" --> Resend[Resend]
  Lib -- "Log in with PayPal, later Orders/Payouts" --> PayPal[PayPal sandbox]
  Lib --> Gemini[Gemini]
  Lib -. "Phase 3" .-> Cloudinary[Cloudinary]
```

- All writes go through the Admin SDK on the server. Firestore rules deny every client write and allow members to read only their own family's documents.
- `transition()` (`src/lib/state/transition.ts`) is the only writer of `approval.state` and `settlement.state`. It runs one transaction: read, apply time-derived rules, check the table row and guard, write with `version + 1`, append one `events` row, write the audit log, create notification docs.
- Time decisions go through `src/lib/clock.ts` and `src/lib/state/effective.ts`.

## Invite and link flow (Phase 1)

```mermaid
sequenceDiagram
  participant O as Owner
  participant A as API
  participant F as Firestore
  participant R as Resend
  participant C as Co-parent (phone)
  O->>A: POST /api/family/invite
  A->>F: tx: revoke old, create linkTokens/{sha256(token)}, notification, audit
  A->>R: invite email (Reply-To owner)
  A-->>O: { link, email.status } (copy link if the email failed)
  C->>A: GET /api/links/:token (read-only summary)
  C->>A: POST /otp (code to invited email only)
  C->>A: POST /otp/verify -> thp_link cookie (30 min)
  C->>A: POST /accept -> token used, owner notified in-app
```

## Connect PayPal (Phase 1)

```mermaid
sequenceDiagram
  participant U as Parent
  participant A as API
  participant P as PayPal sandbox
  U->>A: GET /api/paypal/connect/start
  A-->>U: { url } + signed state cookie
  U->>P: authorize (openid email paypalattributes)
  P-->>U: /connect/paypal/callback?code&state
  U->>A: POST /api/paypal/connect/callback
  A->>P: code -> token (Basic auth), userinfo
  A->>A: save payerId, email, verified discard token
```

## Agreement extraction and preflight (Phase 2)

```mermaid
sequenceDiagram
  participant O as Owner (browser)
  participant API as Next.js route handlers
  participant FS as Firestore
  participant G as Gemini
  O->>API: POST /api/agreements (PDF or text)
  API->>API: unpdf per-page text, size/page/magic checks, scanned check
  API->>FS: agreements/{id} + pages/{n} (PDF not stored)
  O->>API: POST /api/agreements/{id}/extract
  API->>G: page text with PAGE markers, JSON schema, temperature 0
  G-->>API: rules with quote + page, parties
  API->>API: zod parse, verify every quote, value-in-quote check, conflicts
  API->>FS: ruleVersions/{id} DRAFT
  O->>API: PATCH rules (confirm / edit / reject), POST activate
  API->>FS: one transaction: DRAFT to ACTIVE, old ACTIVE to SUPERSEDED, family pointer
  O->>API: POST /api/expenses/preflight (live) then POST /api/expenses
  API->>API: rules engine evaluate() (no AI): verdict, citations, shares
  API->>FS: expenses/{id} + events row (pinned to the rule version)
```
