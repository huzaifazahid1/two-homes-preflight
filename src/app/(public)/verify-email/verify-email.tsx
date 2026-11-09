"use client";

import { onAuthStateChanged, type User } from "firebase/auth";
import { MailCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/hooks/api";
import { authErrorMessage, destinationFor, reloadVerified, resendVerification, type SessionMe } from "@/hooks/use-auth";
import { clientAuth } from "@/lib/firebase/client";

// AU-1: after sign-up the user lands here. Firebase sends the verification email.
// "I have verified" reloads the Firebase user and asks the server, which re-checks live.

export function VerifyEmail() {
  const router = useRouter();
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  useEffect(() => onAuthStateChanged(clientAuth(), setUser), []);

  async function check() {
    setBusy(true);
    setMessage(null);
    try {
      await reloadVerified();
      const { me } = await api<SessionMe>("/api/me");
      if (me.emailVerified) {
        router.replace(destinationFor(me));
        return;
      }
      setMessage({ tone: "error", text: "Your email is not verified yet. Open the link in the email, then try again." });
    } catch (e) {
      setMessage({ tone: "error", text: errorMessage(e) });
    }
    setBusy(false);
  }

  async function resend() {
    setBusy(true);
    setMessage(null);
    try {
      await resendVerification();
      setMessage({ tone: "ok", text: "We sent a new verification email." });
    } catch (e) {
      setMessage({ tone: "error", text: authErrorMessage(e) });
    }
    setBusy(false);
  }

  return (
    <div className="mx-auto w-full max-w-md px-4 py-10 sm:py-16">
      <MailCheck aria-hidden className="size-10 text-primary" />
      <h1 className="t-h1 mt-4">Verify your email</h1>
      <p className="mt-3 text-muted-foreground">
        We sent a verification link to <span className="font-medium text-foreground">{user?.email ?? "your email address"}</span>. You
        need a verified email before you can invite the other parent.
      </p>
      <div aria-live="polite" className="mt-4 min-h-6">
        {message ? (
          <p className={`t-small rounded-md px-3 py-2 ${message.tone === "ok" ? "bg-eligible-bg text-eligible" : "bg-danger-bg text-danger"}`}>{message.text}</p>
        ) : null}
      </div>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <Button className="h-11 text-[15px]" onClick={() => void check()} disabled={busy || user === null}>
          I have verified my email
        </Button>
        <Button variant="outline" className="h-11 text-[15px]" onClick={() => void resend()} disabled={busy || !user}>
          Send the email again
        </Button>
      </div>
      {user === null ? (
        <p className="t-small mt-4 text-muted-foreground">
          You are signed out.{" "}
          <a className="font-medium text-primary underline-offset-4 hover:underline" href="/login?next=/verify-email">
            Sign in
          </a>{" "}
          to continue.
        </p>
      ) : null}
    </div>
  );
}
