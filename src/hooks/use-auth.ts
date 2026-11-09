"use client";

import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as fbSignOut,
  type User,
} from "firebase/auth";
import { clientAuth } from "@/lib/firebase/client";
import type { OnboardingStep } from "@/types/firestore";
import { api, ApiError } from "./api";

// App authentication on the client (Section F.1): Firebase signs in, then the server mints the
// httpOnly session cookie. The client SDK stays signed in for Firestore listeners.

export type SessionMe = { me: { emailVerified: boolean; onboardingStep: OnboardingStep } };

const FIREBASE_MESSAGES: Record<string, string> = {
  "auth/email-already-in-use": "This email already has an account. Sign in with the method you used when you created it.",
  "auth/account-exists-with-different-credential": "This email already has an account with a different sign-in method. Sign in with the method you used first.",
  "auth/invalid-credential": "The email or password is not right.",
  "auth/wrong-password": "The email or password is not right.",
  "auth/user-not-found": "The email or password is not right.",
  "auth/weak-password": "Use a password with at least 8 characters.",
  "auth/invalid-email": "Enter a valid email address.",
  "auth/too-many-requests": "Too many attempts. Wait a few minutes and try again.",
  "auth/popup-closed-by-user": "Google sign-in was closed before it finished.",
  "auth/cancelled-popup-request": "Google sign-in was closed before it finished.",
  "auth/popup-blocked": "Your browser blocked the Google window. Allow pop-ups for this site and try again.",
  "auth/network-request-failed": "You appear to be offline. Check your connection and try again.",
};

export function authErrorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  const code = (e as { code?: string })?.code;
  return (code && FIREBASE_MESSAGES[code]) || "Sign-in did not work. Please try again.";
}

function timeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

async function createServerSession(user: User): Promise<SessionMe> {
  const idToken = await user.getIdToken(true);
  return api<SessionMe>("/api/auth/session", { method: "POST", body: { idToken, timeZone: timeZone() }, redirectOn401: false });
}

export function destinationFor(me: SessionMe["me"], next?: string | null): string {
  if (!me.emailVerified) return "/verify-email";
  if (me.onboardingStep !== "done") return `/onboarding/${me.onboardingStep}`;
  return next && next.startsWith("/app") ? next : "/app";
}

export async function signUpWithPassword(email: string, password: string): Promise<SessionMe> {
  const cred = await createUserWithEmailAndPassword(clientAuth(), email, password);
  await sendEmailVerification(cred.user, { url: `${window.location.origin}/verify-email` });
  return createServerSession(cred.user);
}

export async function signInWithPassword(email: string, password: string): Promise<SessionMe> {
  const cred = await signInWithEmailAndPassword(clientAuth(), email, password);
  return createServerSession(cred.user);
}

export async function signInWithGoogle(): Promise<SessionMe> {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  const cred = await signInWithPopup(clientAuth(), provider);
  return createServerSession(cred.user);
}

export async function resendVerification(): Promise<void> {
  const user = clientAuth().currentUser;
  if (!user) throw new ApiError(401, "UNAUTHENTICATED", "Please sign in again to resend the email.");
  await sendEmailVerification(user, { url: `${window.location.origin}/verify-email` });
}

/** Reloads the Firebase user; true when the email is now verified. */
export async function reloadVerified(): Promise<boolean> {
  const user = clientAuth().currentUser;
  if (!user) return false;
  await user.reload();
  return user.emailVerified;
}

export async function signOut(): Promise<void> {
  // Server first (clears cookie, revokes refresh tokens), then the client SDK (stops listeners).
  try {
    await api("/api/auth/session", { method: "DELETE", redirectOn401: false });
  } finally {
    await fbSignOut(clientAuth());
  }
}
