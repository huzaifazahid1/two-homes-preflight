import { defineConfig, devices } from "@playwright/test";

// Manual @sandbox journey (real PayPal sandbox, real Firebase project). Not part of `npm run test:e2e`
// or CI. Start the dev server and ngrok first (docs/testing.md), then `npm run test:sandbox`.
export default defineConfig({
  testDir: "./tests/sandbox",
  workers: 1,
  retries: 0,
  reporter: "list",
  // `next dev` compiles routes on first use, and PayPal sandbox is slow: wait longer than the defaults.
  expect: { timeout: 45_000 },
  use: {
    baseURL: process.env.SANDBOX_BASE_URL ?? "http://localhost:3000",
    // Headed by default so the owner can watch or step in; SANDBOX_HEADLESS=1 for unattended runs.
    headless: process.env.SANDBOX_HEADLESS === "1",
    navigationTimeout: 90_000,
    // No traces: they record typed text, and the spec types sandbox passwords into the PayPal popup.
    trace: "off",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "sandbox", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } } }],
});
