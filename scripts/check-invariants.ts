// npm run invariants: read-only check of Section E.7 against the project in .env.local.
// Exit code 1 when any invariant is violated. Never writes.
import { checkInvariants } from "../src/lib/invariants";

const familyId = process.argv.find((a) => a.startsWith("--family="))?.slice("--family=".length);

checkInvariants({ familyId })
  .then(({ checked, violations }) => {
    console.log(`Checked ${checked.expenses} expenses, ${checked.tokens} link tokens, ${checked.families} families.`);
    if (violations.length === 0) {
      console.log("No invariant violations.");
      process.exit(0);
    }
    for (const v of violations) console.log(`Invariant ${v.invariant}: ${v.target}: ${v.detail}`);
    console.log(`${violations.length} violation(s).`);
    process.exit(1);
  })
  .catch((err: unknown) => {
    console.error("Invariant check failed to run:", err instanceof Error ? err.message : err);
    process.exit(2);
  });
