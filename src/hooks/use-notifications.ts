"use client";

import { onAuthStateChanged, signOut } from "firebase/auth";
import { collection, limit, onSnapshot, orderBy, query, where, type Timestamp } from "firebase/firestore";
import { useCallback, useEffect, useState } from "react";
import { clientAuth, clientDb } from "@/lib/firebase/client";
import type { NotificationType } from "@/types/firestore";

// Live in-app notification feed (Section E.8): toUid == uid, newest first, limit 20.
// permission-denied signs the client out and goes to login; other errors pause live updates.

export type FeedItem = { id: string; type: NotificationType; title: string; body: string; link?: string; read: boolean; createdAt: Date | null };
export type FeedState = { status: "connecting" | "live" | "paused" | "signed-out"; items: FeedItem[] };

export function useNotifications(): FeedState & { retry: () => void } {
  const [state, setState] = useState<FeedState>({ status: "connecting", items: [] });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let unsubFeed: (() => void) | null = null;
    const unsubAuth = onAuthStateChanged(clientAuth(), (user) => {
      unsubFeed?.();
      unsubFeed = null;
      if (!user) {
        setState({ status: "signed-out", items: [] });
        return;
      }
      const q = query(collection(clientDb(), "notifications"), where("toUid", "==", user.uid), orderBy("createdAt", "desc"), limit(20));
      unsubFeed = onSnapshot(
        q,
        (snap) => {
          setState({
            status: "live",
            items: snap.docs.map((d) => {
              const x = d.data();
              return { id: d.id, type: x.type, title: x.title, body: x.body, link: x.link, read: x.read === true, createdAt: (x.createdAt as Timestamp | null)?.toDate() ?? null };
            }),
          });
        },
        (err) => {
          if (err.code === "permission-denied") {
            // Full reload on purpose: drops all client state and Firestore listeners after auth changes.
            // eslint-disable-next-line @next/next/no-location-assign-relative-destination
            void signOut(clientAuth()).finally(() => window.location.assign("/login?reason=expired"));
            return;
          }
          setState((s) => ({ ...s, status: "paused" }));
        },
      );
    });
    return () => {
      unsubFeed?.();
      unsubAuth();
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setState((s) => ({ ...s, status: "connecting" }));
    setAttempt((a) => a + 1);
  }, []);

  return { ...state, retry };
}
