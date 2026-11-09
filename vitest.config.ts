import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { defineConfig } from "vitest/config";

// Tests load only .env.test (emulator settings, no secrets). .env.local is never read here,
// so a test can never reach the real Firebase project or a real provider by accident.
const testEnv = parseEnv(
  readFileSync(fileURLToPath(new URL("./.env.test", import.meta.url)), "utf8"),
) as Record<string, string>;

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    env: testEnv,
    passWithNoTests: true,
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts", "tests/api/**/*.test.ts"],
          environment: "node",
          // Integration tests share one emulator instance; run files one at a time.
          fileParallelism: false,
        },
      },
    ],
  },
});
