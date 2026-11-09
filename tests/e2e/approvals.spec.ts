import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalScroll, latestCodeFor, latestLinkFor, onboardOwner } from "./helpers";

// P3 E2E: demo steps 3 to 7 (Appendix 2) and the Free-plan loop closed outside the app.
// Owner asks for approval; the co-parent approves on /a/[token] with an email code in a separate
// browser (no account); the owner sees it live; receipt upload and confirm; payment request;
// co-parent reports paying outside the app on /p/[token]; owner confirms it (AP-1, CL-6, CL-7, UI-1, UI-2).

const SHOTS = process.env.E2E_SHOTS_DIR;
async function shot(page: Page, name: string, project: string) {
  if (!SHOTS) return;
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/${project}-${name}.png`, fullPage: true });
}

// A real 1x1 PNG: correct magic bytes, so the server accepts it as a receipt photo.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

test("approval by link, receipt, claim and settled outside the app", async ({ page, browser, isMobile }, info) => {
  const p = info.project.name;
  const { coParentEmail } = await onboardOwner(page);

  // Step 3: the $350 camp needs approval.
  await page.goto("/app/expenses/new");
  await page.getByLabel("Kind of expense").selectOption("extracurricular");
  await page.getByLabel("What is it for?").fill("Riverside FC soccer camp");
  await page.getByLabel("Amount (USD)").fill("350");
  await page.getByRole("button", { name: "Save planned expense" }).click();
  await page.waitForURL((u) => /^\/app\/expenses\/[A-Za-z0-9]{12,}$/.test(u.pathname));
  const expenseUrl = page.url();
  await page.getByRole("button", { name: /Ask .* for approval/ }).click();
  await expect(page.getByText(/Waiting for .* to answer/)).toBeVisible();
  await expect(page.getByText(/Email sent to/)).toBeVisible();
  await shot(page, "approval-requested", p);

  // Step 5: the co-parent's phone. No install, no account: link + email code.
  const guest = await browser.newContext({ viewport: page.viewportSize() ?? undefined, isMobile, hasTouch: isMobile });
  const sara = await guest.newPage();
  await sara.goto(await latestLinkFor(coParentEmail, "a"));
  await expect(sara.getByRole("heading", { name: /asks for your approval/ })).toBeVisible();
  await expect(sara.getByText("$140.00").first()).toBeVisible();
  await expect(sara.getByText(/above \$200/).first()).toBeVisible();
  await expectNoHorizontalScroll(sara);
  await shot(sara, "approval-link", p);
  let asked = Date.now() - 2000;
  await sara.getByRole("button", { name: "Email me a code" }).click();
  await sara.locator("#otp").fill(await latestCodeFor(coParentEmail, asked));
  await expect(sara.getByRole("button", { name: "Approve $350.00" })).toBeVisible({ timeout: 15_000 });
  await shot(sara, "approval-decide", p);
  await sara.getByRole("button", { name: "Approve $350.00" }).click();
  await expect(sara.getByRole("heading", { name: "You approved this" })).toBeVisible();
  await shot(sara, "approval-done", p);

  // Step 6: Alex's screen updates without a reload (listener).
  await expect(page.getByText(/approved it/)).toBeVisible({ timeout: 15_000 });
  await shot(page, "approved-live", p);

  // Step 7: receipt upload, manual values (no AI in E2E), match OK -> ready.
  await page.getByRole("link", { name: "Add the receipt" }).click();
  await expect(page).toHaveURL(/\/receipt$/);
  await page.locator('input[type=file][accept*="pdf"]').setInputFiles({ name: "receipt.png", mimeType: "image/png", buffer: PNG });
  await page.getByRole("button", { name: "Upload receipt" }).click();
  await expect(page.getByText(/Type the values from the receipt/)).toBeVisible({ timeout: 20_000 });
  await page.getByLabel("Store").fill("Riverside FC");
  await page.getByLabel("Date on the receipt").fill(new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()));
  await page.getByLabel("Total paid").fill("350.00");
  await expectNoHorizontalScroll(page);
  await shot(page, "receipt-confirm", p);
  await page.getByRole("button", { name: "Confirm receipt" }).click();
  await expect(page).toHaveURL(expenseUrl);
  await expect(page.getByRole("button", { name: /Request \$140\.00 from/ })).toBeVisible();

  // Payment request with the due date from the agreement.
  await page.getByRole("button", { name: /Request \$140\.00 from/ }).click();
  await expect(page.getByText(/Payment request emailed to/)).toBeVisible();
  await expect(page.locator("article").getByText("Waiting for payment").first()).toBeVisible();
  await shot(page, "claim-sent", p);

  // The co-parent says they paid outside the app (Free plan).
  await sara.goto(await latestLinkFor(coParentEmail, "p"));
  await expect(sara.getByRole("heading", { name: /asks for your share/ })).toBeVisible();
  asked = Date.now() - 2000;
  await sara.getByRole("button", { name: "Email me a code" }).click();
  await sara.locator("#otp").fill(await latestCodeFor(coParentEmail, asked));
  await expect(sara.getByRole("button", { name: /I paid/ })).toBeVisible({ timeout: 15_000 });
  await expectNoHorizontalScroll(sara);
  await shot(sara, "payment-link", p);
  await sara.getByLabel("How").selectOption("Zelle");
  await sara.getByRole("button", { name: /I paid/ }).click();
  await expect(sara.getByText(/Waiting for .* to confirm/)).toBeVisible();

  // Still outstanding until Alex confirms (CL-6); then settled (CL-7).
  await expect(page.getByText(/says they paid you by Zelle/)).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "I received it" }).click();
  await expect(page.locator("article").getByText(/Settled outside the app/).first()).toBeVisible();
  await shot(page, "settled", p);
  await expect(sara.getByRole("heading", { name: "Settled" })).toBeVisible({ timeout: 15_000 });

  await page.goto("/app/money");
  await expect(page.getByRole("heading", { name: /Closed/ })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await shot(page, "money", p);
  await page.goto("/app");
  await expect(page.getByText("Owed to you")).toBeVisible();
  await shot(page, "home", p);
  await guest.close();
});
