import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalScroll, latestCodeFor, latestLinkFor, onboardOwner } from "./helpers";

// P4 accessibility and theme pass (UI-1, UI-3, UI-4; Phase 4 "phone layout and dark mode checked
// on every screen"). Every screen is scanned with axe (WCAG 2.1 A + AA, colour contrast included)
// in light and dark, on phone and desktop, and must not scroll sideways. Violations are collected
// across all screens and reported together.

const SHOTS = process.env.E2E_SHOTS_DIR;
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

test("every screen: axe in light and dark, no sideways scroll, keyboard skip link", async ({ page, browser, isMobile }, info) => {
  test.setTimeout(600_000);
  const project = info.project.name;
  const found: string[] = [];

  async function scan(p: Page, name: string) {
    await expect(p.locator("main").first()).toBeVisible();
    for (const scheme of ["light", "dark"] as const) {
      await p.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await expect(p.locator("html")).toHaveClass(scheme === "dark" ? /\bdark\b/ : /^(?!.*\bdark\b)/);
      await p.waitForTimeout(450); // entrance animations are <= 400 ms
      const result = await new AxeBuilder({ page: p }).withTags(TAGS).analyze();
      for (const v of result.violations) {
        const where = v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ");
        found.push(`${name} [${scheme}] ${v.id} (${v.impact}): ${v.help} -> ${where}`);
      }
      const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (overflow > 0) found.push(`${name} [${scheme}] scrolls sideways by ${overflow}px`);
      if (SHOTS) await p.screenshot({ path: `${SHOTS}/a11y-${project}-${name}-${scheme}.png`, fullPage: true });
    }
    await p.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  }

  // Public screens, signed out.
  for (const [name, path] of [["landing", "/"], ["pricing", "/pricing"], ["login", "/login"], ["signup", "/signup"], ["terms", "/legal/terms"], ["privacy", "/legal/privacy"]] as const) {
    await page.goto(path);
    await scan(page, name);
  }

  // UI-4: the first Tab reaches "Skip to content", which moves focus to the main region.
  await page.goto("/");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press("Enter");
  await expect(page.locator("main#main")).toBeFocused();

  // Onboarding, every step.
  const { coParentEmail } = await onboardOwner(page, (name) => scan(page, name));

  // Empty states (UI-5).
  for (const [name, path] of [["home-empty", "/app"], ["expenses-empty", "/app/expenses"], ["money-empty", "/app/money"], ["ledger-empty", "/app/ledger"]] as const) {
    await page.goto(path);
    await scan(page, name);
  }

  // New expense with a live verdict, then its detail page.
  await page.goto("/app/expenses/new");
  await page.getByLabel("Kind of expense").selectOption("extracurricular");
  await page.getByLabel("What is it for?").fill("Riverside FC soccer camp");
  await page.getByLabel("Amount (USD)").fill("350");
  await expect(page.getByRole("region", { name: "Preflight check" }).getByText("Needs approval", { exact: true })).toBeVisible();
  await scan(page, "expense-new");
  await page.getByRole("button", { name: "Save planned expense" }).click();
  await page.waitForURL((u) => /^\/app\/expenses\/[A-Za-z0-9]{12,}$/.test(u.pathname));
  const campUrl = page.url();
  await page.getByRole("button", { name: /Ask .* for approval/ }).click();
  await expect(page.getByText(/Waiting for .* to answer/)).toBeVisible();
  await scan(page, "expense-detail");
  await page.goto(`${campUrl}/edit`);
  await scan(page, "expense-edit");

  // Guest approval link, before and after the code.
  const guest = await browser.newContext({ viewport: page.viewportSize() ?? undefined, isMobile, hasTouch: isMobile });
  const sara = await guest.newPage();
  await sara.goto(await latestLinkFor(coParentEmail, "a"));
  await expect(sara.getByRole("heading", { name: /asks for your approval/ })).toBeVisible();
  await scan(sara, "approval-link");
  let asked = Date.now() - 2000;
  await sara.getByRole("button", { name: "Email me a code" }).click();
  await expect(sara.locator("#otp")).toBeVisible();
  await scan(sara, "approval-code");
  await sara.locator("#otp").fill(await latestCodeFor(coParentEmail, asked));
  await expect(sara.getByRole("button", { name: "Approve $350.00" })).toBeVisible({ timeout: 15_000 });
  await scan(sara, "approval-decide");
  await sara.getByRole("button", { name: "Approve $350.00" }).click();
  await expect(sara.getByRole("heading", { name: "You approved this" })).toBeVisible();

  // Receipt (manual values, no AI in E2E) and payment request.
  await page.goto(campUrl);
  await expect(page.getByText(/approved it/)).toBeVisible({ timeout: 15_000 });
  await page.getByRole("link", { name: "Add the receipt" }).click();
  await expect(page).toHaveURL(/\/receipt$/);
  await scan(page, "receipt-upload");
  await page.locator('input[type=file][accept*="pdf"]').setInputFiles({ name: "receipt.png", mimeType: "image/png", buffer: PNG });
  await page.getByRole("button", { name: "Upload receipt" }).click();
  await expect(page.getByText(/Type the values from the receipt/)).toBeVisible({ timeout: 20_000 });
  await page.getByLabel("Store").fill("Riverside FC");
  await page.getByLabel("Date on the receipt").fill(new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()));
  await page.getByLabel("Total paid").fill("350.00");
  await scan(page, "receipt-confirm");
  await page.getByRole("button", { name: "Confirm receipt" }).click();
  await expect(page).toHaveURL(campUrl);
  await page.getByRole("button", { name: /Request \$140\.00 from/ }).click();
  await expect(page.locator("article").getByText("Waiting for payment").first()).toBeVisible();
  await scan(page, "claim-sent");

  // Guest payment link (Free plan: report paying outside the app).
  await sara.goto(await latestLinkFor(coParentEmail, "p"));
  await expect(sara.getByRole("heading", { name: /asks for your share/ })).toBeVisible();
  await scan(sara, "payment-link");
  asked = Date.now() - 2000;
  await sara.getByRole("button", { name: "Email me a code" }).click();
  await sara.locator("#otp").fill(await latestCodeFor(coParentEmail, asked));
  await expect(sara.getByRole("button", { name: /I paid/ })).toBeVisible({ timeout: 15_000 });
  await scan(sara, "payment-actions");
  await guest.close();

  // The rest of the app with data in it.
  for (const [name, path] of [["home", "/app"], ["expenses", "/app/expenses"], ["money", "/app/money"], ["ledger", "/app/ledger"], ["agreement", "/app/agreement"], ["billing", "/app/billing"], ["settings", "/app/settings"], ["dev-demo", "/dev/demo"]] as const) {
    await page.goto(path);
    await scan(page, name);
  }

  await expectNoHorizontalScroll(page);
  expect(found, `Accessibility and layout problems:\n${found.join("\n")}`).toEqual([]);
});
