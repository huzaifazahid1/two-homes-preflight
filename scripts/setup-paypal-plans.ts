// npm run paypal:setup-plans: run once per sandbox app (Section G.6). Creates the catalog product
// and the Family plan (monthly USD price, free trial, payment_failure_threshold 1), then prints
// the plan id for PAYPAL_FAMILY_PLAN_ID and NEXT_PUBLIC_PAYPAL_FAMILY_PLAN_ID.
// Uses the credentials in .env.local. Sandbox only (env.ts refuses anything else).
import { IntervalUnit, PlanRequestStatus, TenureType } from "@paypal/paypal-server-sdk";
import { z } from "zod";
import { centsToDecimalString } from "../src/lib/money";
import { paypalRequest } from "../src/lib/paypal/http";
import { sdkCall, subscriptions } from "../src/lib/paypal/sdk";
import { FAMILY_PRICE_CENTS, FAMILY_TRIAL_DAYS, PLAN_NAME } from "../src/lib/plans";

async function main() {
  const product = await paypalRequest(
    {
      method: "POST",
      path: "/v1/catalogs/products",
      idempotent: true,
      headers: { "PayPal-Request-Id": "two-homes-product-v1" },
      body: { name: "Two Homes Preflight", description: "Co-parenting expense checks and settlement", type: "SERVICE", category: "SOFTWARE" },
    },
    z.object({ id: z.string() }).loose(),
  );
  console.log(`Product: ${product.data.id}`);

  const price = { currencyCode: "USD", value: centsToDecimalString(FAMILY_PRICE_CENTS) };
  const { result } = await sdkCall("plans.create", () =>
    subscriptions().createBillingPlan({
      paypalRequestId: `two-homes-family-plan-${product.data.id}`,
      prefer: "return=representation",
      body: {
        productId: product.data.id,
        name: PLAN_NAME,
        description: "In-app PayPal settlement, covered fees, automatic reminders. Illustrative sandbox pricing.",
        status: PlanRequestStatus.Active,
        billingCycles: [
          { tenureType: TenureType.Trial, sequence: 1, totalCycles: 1, frequency: { intervalUnit: IntervalUnit.Day, intervalCount: FAMILY_TRIAL_DAYS } },
          { tenureType: TenureType.Regular, sequence: 2, totalCycles: 0, frequency: { intervalUnit: IntervalUnit.Month, intervalCount: 1 }, pricingScheme: { fixedPrice: price } },
        ],
        paymentPreferences: { autoBillOutstanding: true, paymentFailureThreshold: 1 },
      },
    }),
  );
  const plan = z.object({ id: z.string(), status: z.string().optional() }).loose().parse(result);
  console.log(`Plan: ${plan.id} (${plan.status ?? "unknown status"})`);
  console.log("\nAdd to .env.local (and Render):");
  console.log(`PAYPAL_FAMILY_PLAN_ID=${plan.id}`);
  console.log(`NEXT_PUBLIC_PAYPAL_FAMILY_PLAN_ID=${plan.id}`);
}

main().catch((err: unknown) => {
  console.error("Setup failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
