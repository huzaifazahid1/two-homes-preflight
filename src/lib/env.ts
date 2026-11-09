import "server-only";
import { z } from "zod";

// Server environment (Section O). Parsed once, lazily, so build steps that never touch
// the server env (static pages) do not fail. In production a missing required variable
// throws on first access, which fails the request loudly instead of running half-configured.

const secret = z.string().min(32, "must be at least 32 characters");
const bool = z
  .enum(["true", "false"])
  .default("false")
  .transform((v) => v === "true");
const cents = z.coerce.number().int().nonnegative();

const usingEmulators = () => Boolean(process.env.FIRESTORE_EMULATOR_HOST);

const serverSchema = z
  .object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    APP_URL: z.url(),
    DEMO_MODE: bool,
    DEV_SECRET: z.string().optional(),
    JOB_SECRET: secret,
    LINK_SESSION_SECRET: secret,
    OTP_PEPPER: secret,

    FIREBASE_PROJECT_ID: z.string().min(1),
    FIREBASE_CLIENT_EMAIL: z.string().optional(),
    FIREBASE_PRIVATE_KEY: z
      .string()
      .optional()
      .transform((v) => v?.replace(/\\n/g, "\n")),
    FIRESTORE_EMULATOR_HOST: z.string().optional(),
    FIREBASE_AUTH_EMULATOR_HOST: z.string().optional(),

    GEMINI_API_KEY: z.string().optional(),
    GEMINI_MODEL: z.string().optional(),
    /** Tests only: points the Gemini SDK at a local stub server. */
    GEMINI_BASE_URL: z.url().optional(),
    GEMINI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(180_000).default(90_000),

    PAYPAL_ENV: z.enum(["sandbox"]).default("sandbox"),
    PAYPAL_API_BASE: z.url().default("https://api-m.sandbox.paypal.com"),
    PAYPAL_CLIENT_ID: z.string().min(1),
    PAYPAL_CLIENT_SECRET: z.string().min(1),
    PAYPAL_WEBHOOK_ID: z.string().optional(),
    PAYPAL_FAMILY_PLAN_ID: z.string().optional(),
    PAYPAL_CONNECT_RETURN_URL: z.url(),
    PLAN_COVERED_VOLUME_CENTS: cents.default(20000),
    FEE_PERCENT_BPS: cents.default(349),
    FEE_FIXED_CENTS: cents.default(49),

    RESEND_API_KEY: z.string().optional(),
    EMAIL_FROM: z.string().min(3),
    EMAIL_TRANSPORT: z.enum(["resend", "outbox"]).default("outbox"),

    CLOUDINARY_CLOUD_NAME: z.string().optional(),
    CLOUDINARY_API_KEY: z.string().optional(),
    CLOUDINARY_API_SECRET: z.string().optional(),
    CLOUDINARY_FOLDER_PREFIX: z.string().default("two-homes/dev"),
  })
  .superRefine((env, ctx) => {
    if (env.DEMO_MODE && (!env.DEV_SECRET || env.DEV_SECRET.length < 32)) {
      ctx.addIssue({ code: "custom", path: ["DEV_SECRET"], message: "required (32+ chars) when DEMO_MODE=true" });
    }
    if (!usingEmulators() && (!env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY)) {
      ctx.addIssue({ code: "custom", path: ["FIREBASE_PRIVATE_KEY"], message: "service account required outside the emulators" });
    }
    if (env.EMAIL_TRANSPORT === "resend" && !env.RESEND_API_KEY) {
      ctx.addIssue({ code: "custom", path: ["RESEND_API_KEY"], message: "required when EMAIL_TRANSPORT=resend" });
    }
    if (env.NODE_ENV === "production" && env.EMAIL_TRANSPORT === "outbox" && !env.DEMO_MODE) {
      ctx.addIssue({ code: "custom", path: ["EMAIL_TRANSPORT"], message: "outbox is not allowed in production unless DEMO_MODE=true" });
    }
    // E2E=true is set only by scripts/e2e-server.mjs, which runs a production build against the emulators.
    if (env.NODE_ENV === "production" && process.env.E2E !== "true" && (env.FIRESTORE_EMULATOR_HOST || env.FIREBASE_AUTH_EMULATOR_HOST)) {
      ctx.addIssue({ code: "custom", path: ["FIRESTORE_EMULATOR_HOST"], message: "emulator variables must never be set in production" });
    }
  });

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | null = null;

export function env(): ServerEnv {
  if (cached) return cached;
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    // Only variable names and messages are printed, never values.
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid server environment: ${problems}`);
  }
  cached = parsed.data;
  return cached;
}

/** Tests only: drop the cached env after changing process.env. */
export function resetEnvCache() {
  cached = null;
}
