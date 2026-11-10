// npm run reset: deletes every seeded demo family (families with demo: true) and its demo users.
// Needs DEMO_MODE=true in .env.local. Never touches families that the seed did not create.
import { resetDemo } from "../src/lib/dev/demo";
import { env } from "../src/lib/env";

async function main() {
  if (!env().DEMO_MODE) throw new Error("Set DEMO_MODE=true first (demo tooling only).");
  const r = await resetDemo();
  console.log(`Removed ${r.families} demo famil${r.families === 1 ? "y" : "ies"}.`);
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    console.error("Reset failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
