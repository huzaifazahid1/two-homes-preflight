import "server-only";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { adminAuth, db, FieldValue } from "@/lib/firebase/admin";
import type { SessionUser } from "@/lib/auth/session";
import { ensureFamilyInTx, familyView } from "@/lib/family";
import type { MePatch } from "@/schemas";
import { ONBOARDING_STEPS, type FamilyDoc, type OnboardingStep, type UserDoc } from "@/types/firestore";

// Profile, preferences and the onboarding step machine (Section A.5.1).
// Steps are mandatory and in order; the server checks each step's prerequisites before advancing.

export function usersCol() {
  return db().collection("users");
}

function validTimeZone(tz: string | undefined): string {
  if (!tz) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    // Unknown zone from the browser: fall back to UTC instead of failing sign-in.
    return "UTC";
  }
}

/** Called on every sign-in. Creates the profile on first sign-in; keeps email/verified in sync. */
export async function ensureUserDoc(user: SessionUser, timeZone?: string): Promise<UserDoc> {
  const ref = usersCol().doc(user.uid);
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) {
      const current = snap.data() as UserDoc;
      if (current.email !== user.email || (user.emailVerified && !current.emailVerified)) {
        tx.update(ref, { email: user.email, emailVerified: current.emailVerified || user.emailVerified, updatedAt: FieldValue.serverTimestamp() });
      }
      return { ...current, email: user.email, emailVerified: current.emailVerified || user.emailVerified };
    }
    const doc = {
      uid: user.uid,
      email: user.email,
      emailVerified: user.emailVerified,
      displayName: "",
      timeZone: validTimeZone(timeZone),
      familyId: null,
      role: "owner" as const,
      onboardingStep: "profile" as const,
      notificationPrefs: { approvals: true, payments: true, reminders: true },
      theme: "system" as const,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    tx.create(ref, doc);
    return doc as unknown as UserDoc;
  });
}

/**
 * The session cookie's email_verified claim is stale right after the user clicks the Firebase
 * verification link, so an unverified profile is re-checked live against Firebase Auth.
 */
export async function syncEmailVerified(user: UserDoc): Promise<UserDoc> {
  if (user.emailVerified) return user;
  const record = await adminAuth().getUser(user.uid);
  if (!record.emailVerified) return user;
  await usersCol().doc(user.uid).update({ emailVerified: true, updatedAt: FieldValue.serverTimestamp() });
  return { ...user, emailVerified: true };
}

/** Client-safe profile view returned by /api/me and /api/auth/session. */
export async function meView(user: UserDoc) {
  let family = null;
  if (user.familyId) {
    const snap = await db().collection("families").doc(user.familyId).get();
    if (snap.exists) family = familyView(user.familyId, snap.data() as FamilyDoc);
  }
  return {
    uid: user.uid,
    email: user.email,
    emailVerified: user.emailVerified,
    displayName: user.displayName,
    timeZone: user.timeZone,
    role: user.role,
    onboardingStep: user.onboardingStep,
    notificationPrefs: user.notificationPrefs,
    theme: user.theme,
    familyId: user.familyId,
    family,
    placeholderSteps: placeholderStepsAllowed(),
  };
}
export type MeView = Awaited<ReturnType<typeof meView>>;

/** The Family plan (Phase 4) is not wired yet; outside production (or in DEMO_MODE) the plan step says so. */
export function placeholderStepsAllowed(): boolean {
  const e = env();
  return e.NODE_ENV !== "production" || e.DEMO_MODE;
}

export function nextStep(step: OnboardingStep): OnboardingStep {
  const i = ONBOARDING_STEPS.indexOf(step);
  return ONBOARDING_STEPS[Math.min(i + 1, ONBOARDING_STEPS.length - 1)];
}

export function stepIndex(step: OnboardingStep): number {
  return ONBOARDING_STEPS.indexOf(step);
}

function prerequisiteError(step: OnboardingStep, user: UserDoc, family: FamilyDoc | null, patch: MePatch): string | null {
  switch (step) {
    case "profile":
      if (!(patch.displayName ?? user.displayName)?.trim()) return "Enter your name first.";
      if (!user.emailVerified) return "Verify your email address first.";
      return null;
    case "agreement":
      return family?.activeRuleVersionId ? null : "Upload your agreement and confirm its rules first.";
    case "family":
      if (!family) return "Create your family first.";
      if (family.children.length === 0) return "Add at least one child.";
      if (!family.coParent.email || !family.coParent.name) return "Add the other parent's name and email.";
      return null;
    case "invite":
      return family && family.coParent.inviteStatus !== "not_sent" ? null : "Send the invite first.";
    case "paypal":
      return family?.payout.owner ? null : "Connect your PayPal account first.";
    case "plan":
      // "family" finishes onboarding and opens Billing, where PayPal confirms the subscription.
      return patch.plan === "free" || patch.plan === "family" ? null : "Choose a plan.";
    default:
      return "Onboarding is already complete.";
  }
}

export async function patchMe(sessionUser: SessionUser, patch: MePatch): Promise<UserDoc> {
  const ref = usersCol().doc(sessionUser.uid);
  const existing = await ref.get();
  if (existing.exists) await syncEmailVerified(existing.data() as UserDoc);
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new AppError("UNAUTHENTICATED", "Your profile was not found. Please sign in again.");
    const user = snap.data() as UserDoc;
    if (sessionUser.emailVerified && !user.emailVerified) user.emailVerified = true;

    const familyRef = user.familyId ? db().collection("families").doc(user.familyId) : null;
    const familySnap = familyRef ? await tx.get(familyRef) : null;
    const family = familySnap?.exists ? (familySnap.data() as FamilyDoc) : null;

    const updates: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
    if (sessionUser.emailVerified) updates.emailVerified = true;
    if (patch.displayName !== undefined) updates.displayName = patch.displayName;
    if (patch.timeZone !== undefined) updates.timeZone = validTimeZone(patch.timeZone);
    if (patch.theme !== undefined) updates.theme = patch.theme;
    if (patch.notificationPrefs) {
      for (const [k, v] of Object.entries(patch.notificationPrefs)) updates[`notificationPrefs.${k}`] = v;
    }

    if (patch.completeStep) {
      const current = user.onboardingStep;
      // Completing an earlier step again is a no-op (the user went back to edit). Skipping ahead is refused.
      if (stepIndex(patch.completeStep) > stepIndex(current)) {
        throw new AppError("STATE_CONFLICT", "Finish the current step first.", { details: { onboardingStep: current } });
      }
      if (patch.completeStep === current) {
        const problem = prerequisiteError(current, user, family, patch);
        if (problem) throw new AppError("STATE_CONFLICT", problem, { details: { onboardingStep: current } });
        updates.onboardingStep = nextStep(current);
        if (current === "profile") {
          // The family shell is created with the profile so the agreement step has a family to attach to.
          ensureFamilyInTx(tx, { uid: user.uid, email: user.email, displayName: patch.displayName ?? user.displayName }, user.familyId, updates);
        }
        // Display tier only; "family" is written when PayPal confirms the subscription (entitlement.ts).
        if (current === "plan" && familyRef && patch.plan === "free") {
          tx.update(familyRef, { "plan.tier": "free", updatedAt: FieldValue.serverTimestamp() });
        }
      }
    }
    if (patch.displayName !== undefined && familyRef && family?.ownerUid === user.uid) {
      tx.update(familyRef, { "owner.name": patch.displayName, updatedAt: FieldValue.serverTimestamp() });
    }
    tx.update(ref, updates);
  });
  const fresh = await ref.get();
  return fresh.data() as UserDoc;
}
