import { z } from "zod";

// One zod schema per contract, shared by client forms and route handlers (Section R.8).

export const onboardingStepSchema = z.enum(["profile", "agreement", "family", "invite", "paypal", "plan", "done"]);
export const roleSchema = z.enum(["owner", "coparent"]);

const name = z.string().trim().min(1, "Enter a name").max(60, "Keep it under 60 characters");
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address")).pipe(z.string().max(254));

export const sessionCreateSchema = z.object({
  idToken: z.string().min(10).max(5000),
  timeZone: z.string().max(64).optional(),
});

export const mePatchSchema = z
  .object({
    displayName: name.optional(),
    timeZone: z.string().min(1).max(64).optional(),
    notificationPrefs: z.object({ approvals: z.boolean(), payments: z.boolean(), reminders: z.boolean() }).partial().optional(),
    theme: z.enum(["system", "light", "dark"]).optional(),
    /** Marks the current onboarding step complete; the server checks its prerequisites and advances. */
    completeStep: onboardingStepSchema.exclude(["done"]).optional(),
    /** Plan step only. Family is wired in Phase 4. */
    plan: z.enum(["free"]).optional(),
  })
  .strict();
export type MePatch = z.infer<typeof mePatchSchema>;

export const coParentSchema = z.object({ name, email: emailSchema });

export const familyUpsertSchema = z.object({ coParent: coParentSchema.optional() }).strict();
export type FamilyUpsert = z.infer<typeof familyUpsertSchema>;

const thisYear = new Date().getUTCFullYear();
export const childCreateSchema = z
  .object({
    firstName: z.string().trim().min(1, "Enter a first name").max(40),
    birthYear: z.number().int().min(thisYear - 26, "Check the birth year").max(thisYear, "Check the birth year").optional(),
  })
  .strict();
export const childPatchSchema = childCreateSchema.partial().strict();
export const childIdParams = z.object({ id: z.string().regex(/^[A-Za-z0-9]{6,32}$/) });

export const tokenParams = z.object({ token: z.string().min(10).max(128) });

export const otpVerifySchema = z.object({ code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code") }).strict();

export const acceptInviteSchema = z
  .object({ perRule: z.record(z.string().max(64), z.enum(["agree", "disagree"])).optional() })
  .strict();

export const paypalEmailSchema = z
  .object({
    for: roleSchema,
    email: emailSchema,
    confirmEmail: emailSchema,
    /** Link token when a guest co-parent connects from /r/[token]. */
    token: z.string().max(128).optional(),
  })
  .strict()
  .refine((v) => v.email === v.confirmEmail, { path: ["confirmEmail"], message: "The two emails do not match" });

export const RETURN_TO_RE = /^\/(onboarding\/paypal|app\/settings|r\/[A-Za-z0-9_-]{43})$/;

export const connectStartQuery = z.object({
  for: roleSchema,
  returnTo: z.string().regex(RETURN_TO_RE, "Invalid return path"),
  token: z.string().max(128).optional(),
});

export const connectCallbackSchema = z
  .object({
    code: z.string().min(1).max(2048).optional(),
    state: z.string().min(1).max(256),
    error: z.string().max(200).optional(),
  })
  .strict();
