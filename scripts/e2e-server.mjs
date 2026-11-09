// Builds and starts the app for Playwright against the Firebase emulators (Section N.1:
// "next build && next start with emulators and outbox"). Works in Windows PowerShell.
// Values from .env.test are put in the process environment, which Next.js gives priority over
// .env.local, so the build talks only to the emulators and the dev outbox.
import { spawnSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";

const testEnv = parseEnv(readFileSync(new URL("../.env.test", import.meta.url), "utf8"));
const env = {
  ...process.env,
  ...testEnv,
  E2E: "true",
  DEMO_MODE: "true",
  DEV_SECRET: "e2e-dev-secret-0123456789abcdef0123456789",
  RESEND_API_KEY: "",
  NEXT_DIST_DIR: ".next-e2e",
  NEXT_TELEMETRY_DISABLED: "1",
};

const next = process.platform === "win32" ? "node_modules\\.bin\\next.cmd" : "node_modules/.bin/next";
if (process.env.E2E_SKIP_BUILD !== "1") {
  const build = spawnSync(next, ["build"], { env, stdio: "inherit", shell: process.platform === "win32" });
  if (build.status !== 0) process.exit(build.status ?? 1);
}
const server = spawn(next, ["start", "-p", "3100"], { env, stdio: "inherit", shell: process.platform === "win32" });
const stop = () => server.kill();
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
server.on("exit", (code) => process.exit(code ?? 0));
