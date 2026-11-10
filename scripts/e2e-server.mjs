// Builds and starts the app for Playwright against the Firebase emulators (Section N.1:
// "next build && next start with emulators and outbox"). Works in Windows PowerShell.
// Values from .env.test are put in the process environment, which Next.js gives priority over
// .env.local, so the build talks only to the emulators and the dev outbox.
import { spawnSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

// Receipt storage stub for E2E only (tests never reach the real Cloudinary account): answers
// signed uploads like Cloudinary does and serves a small image for the 5-minute view URL.
const CLOUD_PORT = 3199;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
let version = 1700000000;
const cloud = createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks).toString("latin1");
  const field = (name) => new RegExp(`name="${name}"\r\n\r\n([^\r]*)\r\n`).exec(body)?.[1] ?? null;
  const url = new URL(req.url ?? "/", "http://stub");
  if (req.method === "POST" && url.pathname.endsWith("/image/upload")) {
    const id = field("public_id");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ public_id: `${field("folder")}/${id}`, version: ++version, format: /application\/pdf/.test(body) ? "pdf" : "jpg", bytes: body.length, width: 800, height: 1200, asset_id: `asset_${id}`, type: "private", resource_type: "image" }));
    return;
  }
  if (req.method === "POST" && url.pathname.endsWith("/image/destroy")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ result: "ok" }));
    return;
  }
  if (req.method === "GET" && url.pathname.endsWith("/image/download")) {
    res.writeHead(200, { "content-type": "image/png" });
    res.end(PNG);
    return;
  }
  res.writeHead(404).end();
});
cloud.listen(CLOUD_PORT, "127.0.0.1");

const testEnv = parseEnv(readFileSync(new URL("../.env.test", import.meta.url), "utf8"));
const overrides = {
  E2E: "true",
  DEMO_MODE: "true",
  DEV_SECRET: "e2e-dev-secret-0123456789abcdef0123456789",
  RESEND_API_KEY: "",
  // No real AI in E2E: extraction falls back to the labelled demo-mode cache (DEMO_MODE=true).
  GEMINI_API_KEY: "",
  CLOUDINARY_CLOUD_NAME: "e2e-cloud",
  CLOUDINARY_API_KEY: "123456789012345",
  CLOUDINARY_API_SECRET: "e2e-cloudinary-secret",
  CLOUDINARY_FOLDER_PREFIX: "two-homes/e2e",
  CLOUDINARY_API_BASE: `http://127.0.0.1:${CLOUD_PORT}`,
  NEXT_DIST_DIR: ".next-e2e",
  NEXT_TELEMETRY_DISABLED: "1",
  // Fee and plan constants pinned to the env.ts defaults so local and CI runs match.
  PLAN_COVERED_VOLUME_CENTS: "20000",
  FEE_PERCENT_BPS: "349",
  FEE_FIXED_CENTS: "49",
};

// `next build` / `next start` also load .env.local, filling every key not already in the process
// environment (an empty value counts as set). Blank each .env.local key that neither .env.test nor
// the overrides set, so a local run sees the same configuration as CI, where .env.local is absent.
const blanked = {};
try {
  for (const key of Object.keys(parseEnv(readFileSync(new URL("../.env.local", import.meta.url), "utf8")))) {
    if (!(key in testEnv) && !(key in overrides)) blanked[key] = "";
  }
} catch (err) {
  if (err?.code !== "ENOENT") throw err;
}
const env = { ...process.env, ...blanked, ...testEnv, ...overrides };

// Next's own JS entry run by this Node binary: no shell on any platform (no DEP0190 warning), and
// stop() then ends `next start` itself rather than only a cmd.exe wrapper on Windows.
const next = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));
if (process.env.E2E_SKIP_BUILD !== "1") {
  const build = spawnSync(process.execPath, [next, "build"], { env, stdio: "inherit" });
  if (build.status !== 0) process.exit(build.status ?? 1);
}
// `npm run test:e2e:build`: build alone (less memory pressure than building while the emulators
// start), then run `npm run test:e2e` with E2E_SKIP_BUILD=1.
if (process.argv.includes("--build-only")) process.exit(0);
const server = spawn(process.execPath, [next, "start", "-p", "3100"], { env, stdio: "inherit" });
const stop = () => {
  server.kill();
  cloud.close();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
server.on("exit", (code) => process.exit(code ?? 0));
