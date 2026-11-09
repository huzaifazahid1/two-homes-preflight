"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authErrorMessage, destinationFor, signInWithGoogle, signInWithPassword, signUpWithPassword, type SessionMe } from "@/hooks/use-auth";

// Email/password and Google sign-in (Section F.1). One component for both /signup and /login.

export function AuthForm({ mode }: { mode: "signup" | "login" }) {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next");
  const expired = params.get("reason") === "expired";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<null | "password" | "google">(null);
  const [error, setError] = useState<string | null>(null);

  async function finish(p: Promise<SessionMe>, which: "password" | "google") {
    setBusy(which);
    setError(null);
    try {
      const { me } = await p;
      router.replace(destinationFor(me, next));
      router.refresh();
    } catch (e) {
      setError(authErrorMessage(e));
      setBusy(null);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === "signup" && password.length < 8) {
      setError("Use a password with at least 8 characters.");
      return;
    }
    void finish(mode === "signup" ? signUpWithPassword(email.trim(), password) : signInWithPassword(email.trim(), password), "password");
  }

  return (
    <div className="mx-auto w-full max-w-sm px-4 py-10 sm:py-16">
      <h1 className="t-h1">{mode === "signup" ? "Create your family account" : "Sign in"}</h1>
      <p className="mt-2 text-muted-foreground">
        {mode === "signup"
          ? "You set up the family and invite the other parent. They never need an account."
          : "Welcome back. Sign in to see your family's expenses."}
      </p>

      {expired ? (
        <p role="status" className="t-small mt-4 rounded-md bg-approval-bg px-3 py-2 text-approval">
          Your session ended. Sign in again to continue where you left off.
        </p>
      ) : null}

      <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="h-11" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-11"
            aria-describedby={mode === "signup" ? "pw-hint" : undefined}
          />
          {mode === "signup" ? (
            <p id="pw-hint" className="t-small text-muted-foreground">
              At least 8 characters.
            </p>
          ) : null}
        </div>
        <div aria-live="polite">{error ? <p className="t-small rounded-md bg-danger-bg px-3 py-2 text-danger">{error}</p> : null}</div>
        <Button type="submit" className="h-11 w-full text-[15px]" disabled={busy !== null}>
          {busy === "password" ? "Please wait…" : mode === "signup" ? "Create account" : "Sign in"}
        </Button>
      </form>

      <div className="my-5 flex items-center gap-3 text-sm text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        or
        <span className="h-px flex-1 bg-border" />
      </div>

      <Button variant="outline" className="h-11 w-full text-[15px]" disabled={busy !== null} onClick={() => void finish(signInWithGoogle(), "google")}>
        <GoogleIcon />
        {busy === "google" ? "Opening Google…" : "Continue with Google"}
      </Button>

      <p className="t-small mt-6 text-muted-foreground">
        {mode === "signup" ? (
          <>
            Already have an account?{" "}
            <Link className="font-medium text-primary underline-offset-4 hover:underline" href="/login">
              Sign in
            </Link>
          </>
        ) : (
          <>
            New here?{" "}
            <Link className="font-medium text-primary underline-offset-4 hover:underline" href="/signup">
              Create a family account
            </Link>
          </>
        )}
      </p>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-4">
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.7Z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9H1.4v3.1A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.4 14.4a7.2 7.2 0 0 1 0-4.7V6.6h-4a12 12 0 0 0 0 10.8l4-3Z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.4 6.6l4 3.1C6.3 6.9 8.9 4.8 12 4.8Z" />
    </svg>
  );
}
