import "server-only";
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { env } from "@/lib/env";

// Admin SDK (server only). With FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST set
// (tests only, from .env.test) the SDK talks to the emulators and needs no credentials.

let app: App | null = null;
let firestore: Firestore | null = null;

function adminApp(): App {
  if (app) return app;
  const existing = getApps()[0];
  if (existing) {
    app = existing;
    return app;
  }
  const e = env();
  app = e.FIRESTORE_EMULATOR_HOST
    ? initializeApp({ projectId: e.FIREBASE_PROJECT_ID })
    : initializeApp({
        projectId: e.FIREBASE_PROJECT_ID,
        credential: cert({
          projectId: e.FIREBASE_PROJECT_ID,
          clientEmail: e.FIREBASE_CLIENT_EMAIL,
          privateKey: e.FIREBASE_PRIVATE_KEY,
        }),
      });
  return app;
}

// Next.js bundles route handlers and pages separately, so this module can be evaluated more than
// once in one process while firebase-admin's Firestore instance is shared. settings() may only be
// called once per instance, so the configured instance is cached on globalThis.
const GLOBAL_KEY = Symbol.for("two-homes.firestore");
type WithFirestore = typeof globalThis & { [GLOBAL_KEY]?: Firestore };

export function db(): Firestore {
  if (firestore) return firestore;
  const g = globalThis as WithFirestore;
  if (!g[GLOBAL_KEY]) {
    const instance = getFirestore(adminApp());
    instance.settings({ ignoreUndefinedProperties: true });
    g[GLOBAL_KEY] = instance;
  }
  firestore = g[GLOBAL_KEY]!;
  return firestore;
}

export function adminAuth(): Auth {
  return getAuth(adminApp());
}

export { FieldValue, Timestamp } from "firebase-admin/firestore";
