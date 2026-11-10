import { expect, test, type Page } from "@playwright/test";
import { doc, latestCode, latestLink, need, reset, say, seed, waitFor, webhookEventsFor } from "./helpers";

// @sandbox: the real PayPal sandbox journey (Section N, Phase 4 completion criterion), run three
// times in a row from a fresh reset, then `npm run invariants`. Manual by design: a person logs
// in to PayPal in the popup (no buyer credentials are stored). See docs/testing.md.
//
// Needs: `npm run dev` on :3000 with DEMO_MODE=true and EMAIL_TRANSPORT=outbox (process env, not
// .env.local), the ngrok tunnel on APP_URL (webhooks), and in .env.local (or the process env)
// SANDBOX_PAYER_EMAIL (sandbox personal account that pays) and SANDBOX_PAYOUT_EMAIL (the one that
// receives and subscribes). Optional SANDBOX_PAYER_PASSWORD / SANDBOX_PAYOUT_PASSWORD let the run
// log in to the PayPal popup by itself; without them it waits for a person.
//
// Roles: the owner is the parent who is owed (only the owed parent can request payment), the
// guest co-parent pays through /p/[token]. PayPal sends the payout to the owner's PayPal email.

const MINUTES = 60_000;
const OWED_CENTS = 6000; // $120 dentist, 50/50 medical rule
const today = () => new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

type Login = { email: string; password: string | undefined };

/**
 * Clicks the PayPal button inside the SDK iframe, then approves in the popup. With a password in
 * .env.local the popup is filled automatically; without one, or when PayPal shows a CAPTCHA or an
 * extra security check, the run waits for a person (it never tries to get past such a check).
 */
async function approveInPayPal(page: Page, what: string, login: Login) {
  const frame = page.locator('iframe[title*="PayPal"]').first().contentFrame();
  const button = frame.locator('[data-funding-source="paypal"]').first();
  await expect(button).toBeVisible({ timeout: 60_000 });
  const popup = page.context().waitForEvent("page", { timeout: 60_000 });
  await button.click();
  const win = await popup;
  const closed = win.waitForEvent("close", { timeout: 10 * MINUTES }).then(() => true);

  const manual = async (why: string) => {
    say(`ACTION NEEDED (${why}): finish the ${what} in the PayPal popup as ${login.email}. Waiting up to 10 minutes.`);
    await closed;
  };
  if (!login.password) await manual("no password in .env.local");
  else {
    say(`PayPal popup open, logging in as ${login.email}`);
    const outcome = await Promise.race([closed.then(() => "closed" as const), autoApprove(win, login.email, login.password)]);
    if (outcome === "challenge") await manual("PayPal asks for a security check");
    else if (outcome === "stuck") await manual("the popup did not reach a known step");
  }
  say(`PayPal popup closed (${what}).`);
}

const PAYPAL_CONFIRM = /^(complete purchase|pay now|pay|agree & subscribe|agree and subscribe|agree & continue|continue|continue to review order|subscribe)$/i;

/** Drives the sandbox popup: email, password, then the confirm button. Returns when the popup closes or needs a person. */
async function autoApprove(win: Page, email: string, password: string): Promise<"closed" | "challenge" | "stuck"> {
  const end = Date.now() + 4 * MINUTES;
  let lastProgress = Date.now();
  while (Date.now() < end) {
    if (win.isClosed()) return "closed";
    try {
      await win.waitForLoadState("domcontentloaded", { timeout: 15_000 });
      if (await win.locator('iframe[src*="captcha"], iframe[title*="recaptcha" i], #captcha-standalone, [data-testid="challenge"]').first().isVisible().catch(() => false)) return "challenge";
      if (await win.getByText(/security challenge|quick security check|confirm it'?s you|verify it'?s you/i).first().isVisible().catch(() => false)) return "challenge";

      const cookies = win.locator("#acceptAllButton");
      if (await cookies.isVisible().catch(() => false)) await cookies.click();

      const emailBox = win.locator('input[name="login_email"], #email').first();
      const pwBox = win.locator('input[name="login_password"], #password').first();
      if ((await emailBox.isVisible().catch(() => false)) && (await emailBox.inputValue()) === "") {
        await emailBox.fill(email);
        const next = win.locator("#btnNext");
        if (await next.isVisible().catch(() => false)) await next.click();
        lastProgress = Date.now();
      } else if ((await pwBox.isVisible().catch(() => false)) && (await pwBox.inputValue()) === "") {
        await pwBox.fill(password);
        await win.locator('#btnLogin, button[type="submit"]').first().click();
        say("PayPal login submitted");
        lastProgress = Date.now();
      } else {
        const confirm = win.locator("#payment-submit-btn, #consentButton, [data-testid='submit-button-initial']").or(win.getByRole("button", { name: PAYPAL_CONFIRM })).first();
        if (await confirm.isVisible().catch(() => false)) {
          if (await confirm.isEnabled()) {
            await confirm.click();
            say("PayPal confirm clicked");
            lastProgress = Date.now();
            await win.waitForTimeout(4000);
          }
        }
      }
    } catch (e) {
      // The popup closing mid-step is the normal end of the flow.
      if (win.isClosed()) return "closed";
      say(`popup step retry: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`);
    }
    const idle = Date.now() - lastProgress;
    if (idle > 90_000) return "stuck";
    if (idle > 10_000 && idle % 15_000 < 1500) say(`popup waiting on: "${await win.title().catch(() => "?")}"`);
    await win.waitForTimeout(1500).catch(() => undefined);
  }
  return "stuck";
}

test("@sandbox real PayPal: subscribe, pay a claim, payout settles", async ({ page, browser, baseURL }) => {
  test.setTimeout(40 * MINUTES);
  const payerEmail = need("SANDBOX_PAYER_EMAIL");
  const payoutEmail = need("SANDBOX_PAYOUT_EMAIL");
  // The owner (the parent who is owed) subscribes with their own sandbox account; the co-parent pays with theirs.
  const ownerLogin: Login = { email: payoutEmail, password: process.env.SANDBOX_PAYOUT_PASSWORD };
  const payerLogin: Login = { email: payerEmail, password: process.env.SANDBOX_PAYER_PASSWORD };
  const base = baseURL!;

  // 0. Fresh reset (removes only demo: true families) and seed.
  await reset(base);
  const s = await seed(base, { coParentEmail: payerEmail, ownerPayPalEmail: payoutEmail, ownerName: "Sara Rivera", coParentName: "Alex Rivera" });
  const expenseId = s.expenses[0]; // Bright Smile Dental, $120, purchased by the owner
  say(`seeded family ${s.familyId}, dentist expense ${expenseId}`);

  // 1. Owner signs in.
  await page.goto("/login");
  await page.getByLabel("Email").fill(s.ownerEmail);
  await page.getByLabel("Password").fill(s.ownerPassword);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 30_000 });

  // 2. Family plan through PayPal Subscriptions (SB-1: ACTIVE only after the server GET check).
  await page.goto("/app/billing");
  await expect(page.getByRole("heading", { name: "Free" })).toBeVisible();
  await approveInPayPal(page, "Family plan subscription", ownerLogin);
  await expect(page.getByRole("heading", { name: "Family" })).toBeVisible({ timeout: 2 * MINUTES });
  const sub = await waitFor("subscription ACTIVE", async () => {
    const d = await doc<{ status: string; paypalSubscriptionId: string }>(`subscriptions/${s.familyId}`);
    return d?.status === "ACTIVE" ? d : null;
  });
  say(`subscription ${sub.paypalSubscriptionId} ACTIVE`);

  // 3. Receipt: real Cloudinary upload + Gemini reading, confirmed by the owner.
  await page.goto(`/app/expenses/${expenseId}`);
  await page.getByRole("link", { name: "Add the receipt" }).click();
  await page.locator('input[type=file][accept*="pdf"]').setInputFiles("fixtures/receipts/bright-smile-dental.jpg");
  await page.getByRole("button", { name: "Upload receipt" }).click();
  await expect(page.getByLabel("Total paid")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByLabel("Total paid")).toHaveValue(/^120(\.00)?$/, { timeout: 30_000 });
  // The fixture is dated Nov 12, 2026; before that day the app refuses a future date.
  await page.getByLabel("Date on the receipt").fill(today());
  await page.getByRole("button", { name: "Confirm receipt" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/expenses/${expenseId}$`), { timeout: 30_000 });

  // 4. Payment request (emailed to the payer through the dev outbox).
  const requested = Date.now() - 2000;
  await page.getByRole("button", { name: /Request \$60\.00 from/ }).click();
  await expect(page.getByText(/Payment request emailed to/)).toBeVisible();

  // 5. The payer opens /p/[token] as a guest, enters the emailed code and pays with PayPal.
  const payerCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const payer = await payerCtx.newPage();
  await payer.goto(await latestLink(payerEmail, "p", requested));
  await expect(payer.getByRole("heading", { name: /asks for your share/ })).toBeVisible();
  const asked = Date.now() - 2000;
  await payer.getByRole("button", { name: "Email me a code" }).click();
  await payer.locator("#otp").fill(await latestCode(payerEmail, asked));
  await expect(payer.getByRole("heading", { name: /with PayPal/ })).toBeVisible({ timeout: 30_000 });
  await expect(payer.getByText("Covered by the Family plan")).toBeVisible();
  await approveInPayPal(payer, "$60.00 payment", payerLogin);
  await expect(payer.getByRole("heading", { name: /^(Paid|Settled)$/ })).toBeVisible({ timeout: 2 * MINUTES });

  // 6. Capture recorded, payout sent; PayPal webhooks (verified) move the claim to SETTLED.
  const payment = await waitFor("capture COMPLETED", async () => {
    const d = await doc<{ captureId?: string; captureStatus?: string; capturedCents?: number; feeLineCents?: number; paypalFeeCents?: number | null; netCents?: number | null }>(`payments/${expenseId}`);
    return d?.captureStatus === "COMPLETED" ? d : null;
  });
  expect(payment.capturedCents).toBe(OWED_CENTS + (payment.feeLineCents ?? 0));
  say(`capture ${payment.captureId}: captured ${payment.capturedCents}c, fee line ${payment.feeLineCents}c, PayPal fee ${payment.paypalFeeCents}c, net ${payment.netCents}c`);

  const settled = await waitFor(
    "settlement SETTLED (payout webhook)",
    async () => {
      const e = await doc<{ settlement: { state: string } }>(`expenses/${expenseId}`);
      if (e && ["PAYOUT_FAILED", "PAYOUT_UNCLAIMED", "REFUNDED"].includes(e.settlement.state)) throw new Error(`settlement ended in ${e.settlement.state}`);
      return e?.settlement.state === "SETTLED" ? e : null;
    },
    15 * MINUTES,
    5000,
  );
  expect(settled.settlement.state).toBe("SETTLED");
  await expect(payer.getByRole("heading", { name: "Settled" })).toBeVisible({ timeout: 60_000 });

  const payout = await doc<{ status: string; attempts: { senderBatchId: string; payoutBatchId?: string; payoutItemId?: string; amountCents?: number }[] }>(`payouts/${expenseId}`);
  expect(payout?.status).toBe("SUCCESS");
  expect(payout?.attempts).toHaveLength(1);
  const attempt = payout!.attempts[0];
  say(`payout batch ${attempt.payoutBatchId} item ${attempt.payoutItemId} SUCCESS, sender_batch_id ${attempt.senderBatchId}`);

  // Webhook delivery through ngrok with a verified signature (events are stored only after verification).
  const captureEvents = await webhookEventsFor(payment.captureId!);
  const payoutEvents = [...(attempt.payoutItemId ? await webhookEventsFor(attempt.payoutItemId) : []), ...(attempt.payoutBatchId ? await webhookEventsFor(attempt.payoutBatchId) : [])];
  const subEvents = await webhookEventsFor(sub.paypalSubscriptionId);
  for (const [name, list] of [["capture", captureEvents], ["payout", payoutEvents], ["subscription", subEvents]] as const) {
    say(`webhooks ${name}: ${list.map((w) => `${w.type}=${w.outcome}`).join(", ") || "none yet"}`);
  }
  expect(captureEvents.map((w) => w.type)).toContain("PAYMENT.CAPTURE.COMPLETED");
  expect(payoutEvents.map((w) => w.type)).toContain("PAYMENT.PAYOUTS-ITEM.SUCCEEDED");
  for (const w of [...captureEvents, ...payoutEvents, ...subEvents]) expect(w.outcome, `${w.type} ${w.id}`).not.toBe("error");

  // 7. Owner sees it settled and in the ledger.
  await page.goto(`/app/expenses/${expenseId}`);
  await expect(page.getByText(/Settled/).first()).toBeVisible();
  await page.goto("/app/ledger");
  await expect(page.getByText("Bright Smile cleaning").first()).toBeVisible();

  // 8. Cancel the plan so sandbox subscriptions do not pile up (SB-3: entitled until paidThrough).
  await page.goto("/app/billing");
  await page.getByRole("button", { name: "Cancel the Family plan" }).click();
  const dialog = page.getByRole("dialog", { name: "Cancel the Family plan?" });
  await dialog.getByRole("button", { name: "Cancel the plan" }).click();
  await waitFor("subscription CANCELLED", async () => ((await doc<{ status: string }>(`subscriptions/${s.familyId}`))?.status === "CANCELLED" ? true : null));
  say("Family plan cancelled. Run `npm run invariants` next.");
  await payerCtx.close();
});
