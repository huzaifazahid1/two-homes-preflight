import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll, onboardOwner } from "./helpers";

// P2 E2E: the demo expenses (soccer camp $350 Needs approval citing p. 4; dentist $120 Eligible),
// the source view, duplicate confirmation and the empty and agreement screens (PF-12, UI-1, UI-2).

const SHOTS = process.env.E2E_SHOTS_DIR;
async function shot(page: import("@playwright/test").Page, name: string, project: string) {
  if (!SHOTS) return;
  await page.waitForTimeout(600); // let entrance animations (<= 400 ms) finish
  await page.screenshot({ path: `${SHOTS}/${project}-${name}.png`, fullPage: true });
}

test("preflight verdicts, source view, duplicate check", async ({ page, isMobile }, info) => {
  const p = info.project.name;
  await onboardOwner(page);
  await shot(page, "home-empty", p);

  // PF-12: empty expenses list with the next action.
  await page.goto("/app/expenses");
  await expect(page.getByText("No expenses yet")).toBeVisible();
  await shot(page, "expenses-empty", p);

  await page.getByRole("link", { name: "Add your first expense" }).click();
  await expect(page).toHaveURL(/\/app\/expenses\/new$/);
  await expectNoHorizontalScroll(page);

  // Quick add without AI configured: a real error, the form stays usable (NW-2).
  await page.getByLabel("Quick add from a note").fill("Mia soccer camp $350 next Saturday at Riverside FC");
  await page.getByRole("button", { name: "Fill the form" }).click();
  await expect(page.getByText(/Fill in the form instead/)).toBeVisible();

  await page.getByLabel("Kind of expense").selectOption("extracurricular");
  await page.getByLabel("What is it for?").fill("Riverside FC soccer camp");
  await page.getByLabel("Amount (USD)").fill("350");
  const verdict = page.getByRole("region", { name: "Preflight check" });
  await expect(verdict.getByText("Needs approval", { exact: true })).toBeVisible();
  await expect(verdict.getByText(/above \$200\.00 needs the other parent's written approval \(p\. 4\)/)).toBeVisible();
  await expect(verdict.getByText("$140.00")).toBeVisible();
  await shot(page, "new-needs-approval", p);

  // Source view: the quote highlighted on page 4.
  await verdict.getByRole("button", { name: "Open page 4 of the agreement" }).click();
  await expect(page.getByRole("dialog").getByText("Agreement, page 4")).toBeVisible();
  await expect(page.getByRole("dialog").locator("mark")).toContainText("above $200");
  await shot(page, "source-sheet", p);
  await page.keyboard.press("Escape");

  // PF-1 boundary in the UI: exactly $200 is eligible with "gt".
  await page.getByLabel("Amount (USD)").fill("200");
  await expect(verdict.getByText("Eligible", { exact: true })).toBeVisible();
  await page.getByLabel("Amount (USD)").fill("350");
  await expect(verdict.getByText("Needs approval", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Save planned expense" }).click();
  await expect(page).toHaveURL(/\/app\/expenses\/[A-Za-z0-9]+$/);
  await expect(page.getByRole("heading", { name: "Riverside FC soccer camp" })).toBeVisible();
  await expect(page.getByText("Approval needed").first()).toBeVisible();
  await expect(page.getByText("Expense added")).toBeVisible();
  await expectNoHorizontalScroll(page);
  await shot(page, "detail", p);

  // Dentist $120: eligible, no approval.
  await page.goto("/app/expenses/new");
  await page.getByLabel("Kind of expense").selectOption("dental");
  await page.getByLabel("What is it for?").fill("Bright Smile Dental cleaning");
  await page.getByLabel("Amount (USD)").fill("120");
  await expect(verdict.getByText("Eligible", { exact: true })).toBeVisible();
  await expect(verdict.getByText("$60.00").first()).toBeVisible();
  await page.getByRole("button", { name: "Save planned expense" }).click();
  await expect(page.getByText("No approval needed").first()).toBeVisible();

  // PF-7: the same dentist expense again asks for confirmation.
  await page.goto("/app/expenses/new");
  await page.getByLabel("Kind of expense").selectOption("dental");
  await page.getByLabel("What is it for?").fill("Bright Smile Dental cleaning");
  await page.getByLabel("Amount (USD)").fill("120");
  await page.getByRole("button", { name: "Save planned expense" }).click();
  await expect(page.getByText("This looks like an expense you added in the last 24 hours.")).toBeVisible();
  await page.getByRole("button", { name: "It is different, save it" }).click();
  await expect(page.getByText("Saved as a separate purchase from a similar one")).toBeVisible();

  // Not covered: travel.
  await page.goto("/app/expenses/new");
  await page.getByLabel("Kind of expense").selectOption("travel");
  await page.getByLabel("Amount (USD)").fill("420");
  await expect(verdict.getByText("Not covered", { exact: true })).toBeVisible();

  await page.goto("/app/expenses");
  await expect(page.getByRole("link", { name: /Riverside FC soccer camp/ })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await shot(page, "expenses-list", p);

  await page.goto("/app/agreement");
  await expect(page.getByRole("heading", { name: "Expense rules" })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await shot(page, "agreement", p);

  await page.goto("/app");
  await expect(page.getByRole("heading", { name: "Needs your action" })).toBeVisible();
  await shot(page, "home", p);
  if (isMobile) await expect(page.getByRole("link", { name: "New expense" })).toBeVisible();
});
