"use client";

import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, type Auth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore, type Firestore } from "firebase/firestore";
import { publicEnv } from "@/lib/public-env";

// Client SDK: sign-in and read-only listeners (Section E.1). Every client write is denied by rules.
// Emulators only when NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true (tests, from .env.test).

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let firestore: Firestore | null = null;

function clientApp(): FirebaseApp {
  if (app) return app;
  const e = publicEnv();
  app = getApps().length
    ? getApp()
    : initializeApp({
        apiKey: e.NEXT_PUBLIC_FIREBASE_API_KEY,
        authDomain: e.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
        projectId: e.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
        appId: e.NEXT_PUBLIC_FIREBASE_APP_ID,
        messagingSenderId: e.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
      });
  return app;
}

export function clientAuth(): Auth {
  if (auth) return auth;
  auth = getAuth(clientApp());
  if (publicEnv().NEXT_PUBLIC_USE_FIREBASE_EMULATORS) connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  return auth;
}

export function clientDb(): Firestore {
  if (firestore) return firestore;
  firestore = getFirestore(clientApp());
  if (publicEnv().NEXT_PUBLIC_USE_FIREBASE_EMULATORS) connectFirestoreEmulator(firestore, "127.0.0.1", 8080);
  return firestore;
}
