# Phase 1

Read `CLAUDE.md` first (always loaded). Then read only these before writing code:

- `docs/spec/product.md` (A.3, A.4, A.5.1, A.5.2, A.8)
- `docs/spec/data-model.md`
- `docs/spec/state-machine.md`
- `docs/spec/auth-and-links.md`
- `docs/spec/email-resend.md`
- `docs/spec/ui-design.md`
- `docs/spec/env.md`
- `docs/spec/testing.md` (N.1 only)

Read other spec files only if a task in this phase needs them.

## Phase 1: Foundation

1. **Objective:** deployed shell with design system, sign-in, onboarding (profile, family, invite, PayPal connect), secure links with OTP, email, and the state core every later phase writes through.
2. **Features:** `env.ts`; `clock.ts`; `money.ts`; `route()` wrapper with error mapping; logging with request ids; rate limiter; audit log; design tokens, fonts, `AppShell` (bottom tabs < 1024 px, sidebar >= 1024 px), core domain components (`Money`, `StatusBadge`, `OtpInput`, `ClauseCard` static); auth (email/password, Google), session cookie, email verification screen; onboarding wizard with steps profile, family, invite, PayPal connect (agreement step and plan step are wired in Phases 2 and 4; until then the wizard shows them as "coming in this build" only in development); settings page; link tokens, OTP, link session; email transport (Resend + outbox) with `invite` and `otp` templates; notifications collection + in-app bell (listener); Log in with PayPal + email fallback; `state/machines.ts`, `state/effective.ts`, `state/transition.ts` fully tested; Firestore rules + emulator tests, then deploy rules and indexes to the real project with `npm run firebase:deploy-rules` (ask the owner first); Render deploy.
3. **Files:** `src/lib/{env,clock,money,ids,route,errors,log,rate-limit,audit}.ts`, `src/lib/firebase/*`, `src/lib/auth/session.ts`, `src/lib/links/*`, `src/lib/email/*`, `src/lib/notifications.ts`, `src/lib/paypal/{http,connect}.ts`, `src/lib/state/*`, `src/components/layout/*`, `src/components/domain/*`, `src/app/(public)/*`, `src/app/onboarding/*`, `src/app/(app)/app/{page,settings}`, `src/app/r/[token]`, `src/app/connect/paypal/callback`, `src/app/api/{auth,me,family,links,paypal/connect}/*`, `firestore.rules`, `firestore.indexes.json`, `tests/**`.
4. **Endpoints:**

| Method and path | Purpose | Auth |
| --- | --- | --- |
| `POST /api/auth/session` / `DELETE /api/auth/session` | Session cookie | none / user |
| `GET /api/me`, `PATCH /api/me` | Profile, preferences, onboarding step | user |
| `POST /api/family` | Create family | user (verified) |
| `POST /api/family/children`, `PATCH`/`DELETE /api/family/children/:id` | Children | owner |
| `POST /api/family/invite`, `POST /api/family/invite/resend`, `DELETE /api/family/invite` | Invite token + email; resend revokes old | owner (verified) |
| `GET /api/links/:token` | Read-only summary (410 if unusable) | link |
| `POST /api/links/:token/otp`, `POST /api/links/:token/otp/verify` | OTP | link |
| `POST /api/links/:token/accept` | Accept invite | link + OTP |
| `GET /api/paypal/connect/start`, `POST /api/paypal/connect/callback` | Log in with PayPal | user or link session |
| `POST /api/paypal/connect/email` | Fallback email connection | user or link session |
| `DELETE /api/paypal/connect` | Disconnect (blocked while a payout is processing) | user |

5. **Dependencies:** setup complete (Phase 0).
6. **Deliverables:** public Render URL; owner can sign up, verify email, create family, invite co-parent, connect PayPal; co-parent can open invite on a phone, get a code, accept.
7. **Testing:** P1 tests in Section N (unit: transition tables, effective rules, OTP, tokens, money; integration: invite token hashed, OTP flows, 401/403/410, notification dedupe, rules; E2E phone + desktop onboarding and invite).
8. **Edge cases:** co-parent email equals owner's; invite before email verified (blocked); resend revokes old token atomically; Resend failure (copy link shown); 5 wrong codes lock; 3 sends/hour; Google vs password same email; onboarding resume; session expiry mid-flow; Log in with PayPal cancelled by user or `state` mismatch (error, nothing saved); PayPal returns an unverified account (save, show "unverified" warning, payouts may be held).
9. **Completion criteria:** all P1 tests green; Firestore rules tests green; a real invite email from `mail.huzaifalabs.site` reaches a second inbox; Log in with PayPal works in sandbox (or fallback documented and owner informed); no server secrets in the client bundle (search the `.next/static` output for secret names); README updated.

## Test cases for this phase

Full list with all phases: `docs/spec/testing.md`. Rows below are the ones this phase must make pass (rows marked for several phases are listed in each).

### Authentication and session
| ID | Scenario | Expected | Phase |
| --- | --- | --- | --- |
| AU-1 | Sign up with email/password | Account created, verification email sent, redirected to `/verify-email` | 1 |
| AU-2 | Sign in with Google | Session cookie set, onboarding step resumed | 1 |
| AU-3 | Google sign-in with an email already used by a password account | Clear message to use original method; no duplicate account | 1 |
| AU-4 | Expired session cookie on API call | 401 `UNAUTHENTICATED`; UI redirects to login and back | 1 |
| AU-5 | Tampered or revoked session cookie | 401 | 1 |
| AU-6 | Sign out | Cookie cleared, refresh tokens revoked, listeners stopped | 1 |
| AU-7 | Unverified email tries to send invite or payment request | 403 `EMAIL_NOT_VERIFIED` | 1 |
| AU-8 | Visiting `/app` before onboarding done | Redirect to `/onboarding` at saved step | 1 |

### Authorization and security
| ID | Scenario | Expected | Phase |
| --- | --- | --- | --- |
| AZ-1 | Every endpoint without session | 401 (generated matrix) | 1-4 |
| AZ-2 | User of family A reads/writes family B resource | 403, audit logged | 1-4 |
| AZ-5 | Client Firestore write to any collection | Denied by rules | 1 |
| AZ-6 | Client reads another family's expense / notification of another user | Denied | 1 |
| AZ-7 | Query without the rule constraint (no `array-contains`) | Rejected | 1 |
| SE-1 | Secret names in client bundle | None found | 1,4 |
| SE-2 | Stored link token is plain text anywhere | Never; only hash | 1 |
| SE-6 | Rate limits (OTP sends, quick add, uploads) | 429 with retry-after | 1-3 |

### Onboarding and family
| ID | Scenario | Expected | Phase |
| --- | --- | --- | --- |
| ON-1 | Complete all 6 steps | `onboardingStep = done`, `/app` reachable | 1-4 |
| ON-2 | Try to skip a step via URL | Redirect back to current step | 1 |
| ON-3 | Leave at step 3 and return | Resumes at step 3 with saved data | 1 |
| ON-4 | Co-parent email equals owner email | 400 validation | 1 |
| ON-7 | Invite email fails | Step still completes; copy link shown | 1 |

### Links and OTP
| ID | Scenario | Expected | Phase |
| --- | --- | --- | --- |
| LK-1 | Open valid link | Read-only summary, no action without OTP | 1 |
| LK-2 | Action without OTP session | 401 | 1 |
| LK-3 | Correct OTP | Link session cookie 30 min; actions allowed | 1 |
| LK-4 | 5 wrong codes | Locked 15 min (423 or 429), lock shown | 1 |
| LK-5 | 4th code send in an hour | 429 | 1 |
| LK-6 | OTP after 10 minutes | Rejected, ask new code | 1 |
| LK-7 | Expired / used / revoked token | 410 page | 1-4 |
| LK-8 | Forwarded link opened by third party | Can view summary only; cannot act (OTP goes to original email) | 1 |
| LK-9 | Resend invite | Old token 410, new token works | 1 |

### PayPal connection
| ID | Scenario | Expected | Phase |
| --- | --- | --- | --- |
| PC-1 | Connect with Log in with PayPal (sandbox personal) | payerId + email + verified flag saved; token discarded | 1 |
| PC-2 | User cancels on PayPal | Back to step with "Not connected"; nothing saved | 1 |
| PC-3 | `state` mismatch or reused code | 400; nothing saved | 1 |
| PC-4 | Fallback email entered twice, mismatch | Validation error | 1 |

### Firestore, listeners, network
| ID | Scenario | Expected | Phase |
| --- | --- | --- | --- |
| DB-1 | Transaction contention (two transitions at once) | One wins, other retried by Firestore or 409 | 1 |
| DB-2 | Firestore unavailable on write | 503 `DB_UNAVAILABLE`, no partial state | 1 |
| NW-1 | Browser offline during submit | Button disabled, retry message; no duplicate on resubmit (server idempotency where money is involved) | 1-4 |

### UI and empty states
| ID | Scenario | Expected | Phase |
| --- | --- | --- | --- |
| UI-1 | Phone width 375 px | Bottom tabs, no horizontal scroll, touch targets >= 44 px | 1-4 |
| UI-2 | Desktop 1440 px | Sidebar, master-detail on expenses, grids | 1-4 |


## End of phase

1. All tests above green; `npm run typecheck` and `npm run lint` clean.
2. Run the app on phone width (375 px) and desktop (1440 px) and check every screen touched in this phase.
3. Run the `web-design-guidelines` skill on the UI files changed in this phase and fix real issues.
4. Update `README.md`, `docs/progress.md`, `docs/api.md`, `docs/decisions.md`.
5. Report to the owner and wait for approval before the next phase.
