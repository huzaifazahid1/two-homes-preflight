"use client";

import { onAuthStateChanged, signOut } from "firebase/auth";
import { collection, doc, limit, onSnapshot, orderBy, query, where, type Unsubscribe } from "firebase/firestore";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { clientAuth, clientDb } from "@/lib/firebase/client";

// Real-time listeners (Section E.8). The listener only detects a change; the page data itself is
// re-read on the server (router.refresh), so totals and views always come from the server.
// permission-denied signs the client out; other errors pause and refetch on focus / reconnect.

export type LiveTarget = { kind: "expense"; id: string } | { kind: "list" };
export type LiveStatus = "connecting" | "live" | "paused";

export function useLiveRefresh(target: LiveTarget): { status: LiveStatus; retry: () => void } {
  const router = useRouter();
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const [attempt, setAttempt] = useState(0);
  const baseline = useRef<string | null>(null);
  const key = target.kind === "expense" ? `expense:${target.id}` : "list";

  useEffect(() => {
    let unsub: Unsubscribe | null = null;
    baseline.current = null;
    const onChange = (signature: string) => {
      setStatus("live");
      if (baseline.current === null) {
        baseline.current = signature;
        return;
      }
      if (signature !== baseline.current) {
        baseline.current = signature;
        router.refresh();
      }
    };
    const onError = (err: { code: string }) => {
      if (err.code === "permission-denied") {
        // Full reload on purpose: drops all client state and Firestore listeners after auth changes.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        void signOut(clientAuth()).finally(() => window.location.assign("/login?reason=expired"));
        return;
      }
      setStatus("paused");
    };
    const unsubAuth = onAuthStateChanged(clientAuth(), (user) => {
      unsub?.();
      unsub = null;
      if (!user) {
        setStatus("paused");
        return;
      }
      if (key === "list") {
        const q = query(collection(clientDb(), "expenses"), where("memberUids", "array-contains", user.uid), orderBy("updatedAt", "desc"), limit(30));
        unsub = onSnapshot(q, (snap) => onChange(snap.docs.map((d) => `${d.id}:${d.get("version")}`).join(",")), onError);
      } else {
        unsub = onSnapshot(doc(clientDb(), "expenses", key.slice("expense:".length)), (snap) => onChange(String(snap.get("version") ?? "")), onError);
      }
    });
    return () => {
      unsub?.();
      unsubAuth();
    };
  }, [key, attempt, router]);

  const retry = useCallback(() => {
    setStatus("connecting");
    router.refresh();
    setAttempt((a) => a + 1);
  }, [router]);

  // Paused: refetch when the tab gets focus or the network comes back (DB-4).
  useEffect(() => {
    if (status !== "paused") return;
    const again = () => retry();
    window.addEventListener("online", again);
    window.addEventListener("focus", again);
    return () => {
      window.removeEventListener("online", again);
      window.removeEventListener("focus", again);
    };
  }, [status, retry]);

  return { status, retry };
}
