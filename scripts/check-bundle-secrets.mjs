// SE-1: no server secret names in the client bundle. Scans the static chunks of a build
// (default .next, or the folder given as the first argument, e.g. .next-e2e) and exits 1 on a hit.
// Usage: node scripts/check-bundle-secrets.mjs .next-e2e
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const dist = process.argv[2] ?? ".next";
const root = join(dist, "static");
if (!existsSync(root)) {
  console.error(`No build found at ${root}. Build first.`);
  process.exit(1);
}

const NAMES = [
  "PAYPAL_CLIENT_SECRET", "PAYPAL_WEBHOOK_ID", "FIREBASE_PRIVATE_KEY", "FIREBASE_CLIENT_EMAIL", "GEMINI_API_KEY",
  "RESEND_API_KEY", "CLOUDINARY_API_SECRET", "CLOUDINARY_API_KEY", "JOB_SECRET", "DEV_SECRET", "LINK_SESSION_SECRET", "OTP_PEPPER",
  "firebase-admin", "BEGIN PRIVATE KEY",
];

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (/\.(js|mjs|css|json|html)$/.test(name)) yield p;
  }
}

let count = 0;
const hits = [];
for (const file of files(root)) {
  count++;
  const text = readFileSync(file, "utf8");
  for (const n of NAMES) if (text.includes(n)) hits.push(`${file}: ${n}`);
}
if (hits.length) {
  console.error(`SE-1 failed, server-only names found in the client bundle:\n${hits.join("\n")}`);
  process.exit(1);
}
console.log(`SE-1 ok: ${count} client files scanned, no server secret names.`);
