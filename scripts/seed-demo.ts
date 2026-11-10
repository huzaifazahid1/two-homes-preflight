// npm run seed -- --coparent=sara@example.com [--paypal=alex-sandbox@example.com]
// Seeds the synthetic demo family through the real route handlers (src/lib/dev/demo.ts).
// Needs DEMO_MODE=true in .env.local, like POST /api/dev/seed.
import { seedDemo } from "../src/lib/dev/demo";
import { env } from "../src/lib/env";

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

async function main() {
  if (!env().DEMO_MODE) throw new Error("Set DEMO_MODE=true first (demo tooling only).");
  const coParentEmail = arg("coparent");
  if (!coParentEmail) throw new Error("Pass --coparent=<email> (Sara's inbox for the invite and links).");
  const r = await seedDemo({ coParentEmail, ownerPayPalEmail: arg("paypal") });
  console.log(`Seeded family ${r.familyId} with ${r.expenses.length} expenses.`);
  console.log(`Sign in as ${r.ownerEmail} / ${r.ownerPassword}`);
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    console.error("Seed failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
