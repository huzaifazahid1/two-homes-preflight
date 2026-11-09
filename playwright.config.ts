import { defineConfig, devices } from "@playwright/test";

// Two projects per Section N: phone (375 px) and desktop (1440 px).
// Runs a production build against the Firebase emulators with the dev outbox (scripts/e2e-server.mjs).
// Set E2E_SKIP_BUILD=1 to reuse the last .next-e2e build.
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  timeout: 90_000,
  use: {
    baseURL: "http://localhost:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: "npx firebase emulators:start --only firestore,auth --project demo-two-homes",
      port: 9099,
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: "node scripts/e2e-server.mjs",
      url: "http://localhost:3100",
      reuseExistingServer: !process.env.CI,
      timeout: 600_000,
    },
  ],
  projects: [
    {
      name: "phone",
      // iPhone 13 profile (touch, mobile UA, DPR) on Chromium: only Chromium is installed (decision 1.x).
      use: { ...devices["iPhone 13"], browserName: "chromium", viewport: { width: 375, height: 812 } },
    },
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
});
