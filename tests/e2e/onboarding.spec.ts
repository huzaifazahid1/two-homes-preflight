import { expect, test } from "@playwright/test";
import { completeAgreementStep, expectNoHorizontalScroll, latestCodeFor, uniqueEmail, verifyEmailInEmulator } from "./helpers";

// P1 E2E: owner signs up, verifies, completes onboarding (ON-1 Phase 1 part), invites the co-parent;
// the co-parent opens the invite on a phone, gets a code and accepts (LK-1, LK-3). UI-1 / UI-2 checks.

test("owner onboarding and co-parent invite acceptance", async ({ page, browser, isMobile }) => {
  const ownerEmail = uniqueEmail("alex");
  const coEmail = uniqueEmail("sara");

  // AU-1: sign up -> /verify-email
  await page.goto("/signup");
  await expectNoHorizontalScroll(page);
  await page.getByLabel("Email").fill(ownerEmail);
  await page.getByLabel("Password").fill("Passw0rd!long");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/verify-email$/, { timeout: 20_000 }); // first request warms the server

  // AU-8: /app before onboarding is done is not reachable.
  await verifyEmailInEmulator(ownerEmail);
  await page.getByRole("button", { name: "I have verified my email" }).click();
  await expect(page).toHaveURL(/\/onboarding\/profile$/);

  // ON-2: skipping ahead by URL returns to the saved step.
  await page.goto("/onboarding/invite");
  await expect(page).toHaveURL(/\/onboarding\/profile$/);
  await page.goto("/app");
  await expect(page).toHaveURL(/\/onboarding\/profile$/);

  await page.getByLabel("Your name").fill("Alex Rivera");
  await page.getByRole("button", { name: "Save and continue" }).click();
  await completeAgreementStep(page);

  // ON-5: names from the agreement prefill the family step, with their quotes.
  await expect(page).toHaveURL(/\/onboarding\/family$/);
  await expect(page.getByRole("region", { name: "Found in your agreement" })).toBeVisible();
  await page.getByRole("button", { name: "Add Mia" }).click();
  await expect(page.getByRole("button", { name: "Remove Mia" })).toBeVisible();
  const other = page.getByRole("region", { name: "The other parent" });
  await expect(other.getByLabel("Name", { exact: true })).toHaveValue("Sara Rivera");
  // ON-4: same email as the owner is refused.
  await other.getByLabel("Email", { exact: true }).fill(ownerEmail);
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page.getByText("must be different from yours").first()).toBeVisible();
  await other.getByLabel("Email", { exact: true }).fill(coEmail);
  await page.getByRole("button", { name: "Save and continue" }).click();

  await expect(page).toHaveURL(/\/onboarding\/invite$/);
  // ON-3: leaving and returning resumes at the saved step.
  await page.goto("/onboarding");
  await expect(page).toHaveURL(/\/onboarding\/invite$/);
  await page.getByRole("button", { name: "Send invite" }).click();
  const linkInput = page.getByLabel("Invite link (works for 7 days)");
  await expect(linkInput).toBeVisible();
  const inviteUrl = await linkInput.inputValue();
  expect(inviteUrl).toMatch(/\/r\/[A-Za-z0-9_-]{43}$/);
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page).toHaveURL(/\/onboarding\/paypal$/);
  await page.getByRole("button", { name: "Use my PayPal email instead" }).click();
  await page.getByLabel("PayPal email").fill("alex.pp@example.com");
  await page.getByLabel("Type it again").fill("alex.pp@example.co");
  await page.getByRole("button", { name: "Save PayPal email" }).click();
  await expect(page.getByText("The two emails do not match.")).toBeVisible(); // PC-4
  await page.getByLabel("Type it again").fill("alex.pp@example.com");
  await page.getByRole("button", { name: "Save PayPal email" }).click();
  await expect(page.getByText("Connected as alex.pp@example.com")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page).toHaveURL(/\/onboarding\/plan$/);
  await page.getByRole("button", { name: "Continue with Free" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("heading", { name: "Hi Alex" })).toBeVisible();
  await expectNoHorizontalScroll(page);

  // UI-1 / UI-2: bottom tabs on phone, sidebar on desktop.
  if (isMobile) {
    await expect(page.getByRole("link", { name: "New expense" })).toBeVisible();
    const tab = await page.getByRole("navigation", { name: "Main" }).last().getByRole("link", { name: "Home" }).boundingBox();
    expect(tab!.height).toBeGreaterThanOrEqual(44);
  } else {
    await expect(page.locator("aside").getByRole("link", { name: "Settings" })).toBeVisible();
  }

  // Co-parent on a phone, no account (LK-1, LK-3).
  const phone = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  const co = await phone.newPage();
  await co.goto(inviteUrl);
  await expect(co.getByRole("heading", { name: "Alex Rivera invited you to Two Homes Preflight" })).toBeVisible();
  await expect(co.getByRole("button", { name: "Accept the invitation" })).toHaveCount(0);
  await expectNoHorizontalScroll(co);
  await co.getByRole("button", { name: "Email me a code" }).click();
  const code = await latestCodeFor(coEmail);
  await co.getByLabel("Digit 1").fill(code); // fills all six digits
  await expect(co.getByRole("button", { name: "Accept the invitation" })).toBeVisible();
  // The co-parent answers per rule; disagreeing with one is saved right away (rules-ack).
  await co.getByRole("group", { name: "Clothing" }).getByText("Disagree").click();
  await expect(co.getByText("Answer saved.")).toBeVisible();
  await co.getByRole("button", { name: "Accept the invitation" }).click();
  await expect(co.getByRole("heading", { name: "You are connected" })).toBeVisible();

  // LK-7: the used link is gone.
  await co.goto(inviteUrl);
  await expect(co.getByRole("heading", { name: "This link no longer works" })).toBeVisible();
  await phone.close();

  // Owner sees the acceptance (in-app notification via listener, and status in settings).
  await page.goto("/app/settings");
  await expect(page.getByText("Joined").first()).toBeVisible();
  await page.getByRole("button", { name: /Notifications/ }).click();
  await expect(page.getByText("Sara Rivera accepted your invite")).toBeVisible();
});
