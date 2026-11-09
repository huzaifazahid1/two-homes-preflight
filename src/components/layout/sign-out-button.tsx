"use client";

import { LogOut } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { signOut } from "@/hooks/use-auth";

export function SignOutButton({ variant = "outline", className }: { variant?: "outline" | "ghost"; className?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant={variant}
      className={className ?? "h-10 px-3"}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await signOut();
          // Full reload on purpose: drops all client state and Firestore listeners after auth changes.
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination
          window.location.assign("/login");
        } catch {
          setBusy(false);
          toast.error("Could not sign out. Check your connection and try again.");
        }
      }}
    >
      <LogOut aria-hidden />
      Sign out
    </Button>
  );
}
