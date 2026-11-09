import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalScroll, onboardOwner } from "./helpers";

// P4 E2E: ledger (AG Grid on desktop, month cards on phones), billing, dark mode (UI-1, UI-2,
// UI-3, UI-5). Real PayPal checkout is the manual @sandbox journey (docs/testing.md).

const SHOTS = process.env.E2E_SHOTS_DIR;
async function shot(page: Page, name: string, project: string) {
  if (!SHOTS) return;
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/${project}-${name}.png`, fullPage: true });
}

async function addExpense(page: Page, kind: string, what: string, amount: string) {
  await page.goto("/app/expenses/new");
  await page.getByLabel("Kind of expense").selectOption(kind);
  await page.getByLabel("What is it for?").fill(what);
  await page.getByLabel("Amount (USD)").fill(amount);
  await page.getByRole("button", { name: "Save planned expense" }).click();
  await page.waitForURL((u) => /^\/app\/expenses\/[A-Za-z0-9]{12,}$/.test(u.pathname));
}

test("ledger, billing and dark mode", async ({ page, isMobile }, info) => {
  const p = info.project.name;
  await onboardOwner(page);

  // UI-5: empty ledger.
  await page.goto("/app/ledger");
  await expect(page.getByText("The ledger is empty")).toBeVisible();
  await shot(page, "ledger-empty", p);

  await addExpense(page, "dental", "Bright Smile cleaning", "120");
  await addExpense(page, "extracurricular", "Riverside FC soccer camp", "350");

  await page.goto("/app/ledger");
  await expect(page.getByRole("heading", { name: "Ledger" })).toBeVisible();
  if (isMobile) {
    await expect(page.getByRole("link", { name: /Riverside FC soccer camp/ })).toBeVisible();
    await expectNoHorizontalScroll(page);
  } else {
    const grid = page.getByRole("treegrid").or(page.getByRole("grid")).first();
    await expect(grid).toBeVisible();
    await expect(grid.getByText("Riverside FC soccer camp")).toBeVisible();
    await expect(grid.getByText("All 2 expenses")).toBeVisible();
    await expect(grid.getByText("$470.00")).toBeVisible();
    await expect(page.getByRole("button", { name: "Export CSV" })).toBeEnabled();
  }
  // Quick filter and external filter.
  await page.getByLabel("Search the ledger").fill("dentist-nothing");
  await expect(page.getByText("No expenses match these filters.")).toBeVisible();
  await page.getByLabel("Search the ledger").fill("");
  await page.getByRole("button", { name: "Overdue only" }).click();
  await expect(page.getByRole("button", { name: "Overdue only" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Overdue only" }).click();
  await shot(page, "ledger", p);

  await page.emulateMedia({ colorScheme: "dark" });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Ledger" })).toBeVisible();
  await shot(page, "ledger-dark", p);
  await page.emulateMedia({ colorScheme: "light" });

  // Billing: Free plan; the Family plan is not configured in E2E (no PayPal plan id).
  await page.goto("/app/billing");
  await expect(page.getByRole("heading", { name: "Billing" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Free" })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await shot(page, "billing", p);
});
