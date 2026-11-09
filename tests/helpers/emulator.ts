// Emulator helpers for integration tests. Only ever talk to the local emulators (project demo-two-homes).

const PROJECT = process.env.FIREBASE_PROJECT_ID ?? "demo-two-homes";
const FS = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";

if (!PROJECT.startsWith("demo-")) throw new Error("Integration tests must run against a demo- project (emulators only).");

export async function clearFirestore() {
  const res = await fetch(`http://${FS}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });
  if (!res.ok) throw new Error(`clearFirestore failed: ${res.status}`);
}

export async function clearAuth() {
  const res = await fetch(`http://${AUTH}/emulator/v1/projects/${PROJECT}/accounts`, { method: "DELETE" });
  if (!res.ok) throw new Error(`clearAuth failed: ${res.status}`);
}

export async function resetEmulators() {
  await Promise.all([clearFirestore(), clearAuth()]);
}

/** Signs in through the Auth emulator REST API and returns a fresh ID token. */
export async function signInWithPassword(email: string, password: string): Promise<string> {
  const res = await fetch(`http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const body = (await res.json()) as { idToken?: string };
  if (!body.idToken) throw new Error(`sign-in failed for ${email}`);
  return body.idToken;
}

export const EMULATOR_PROJECT = PROJECT;
export const FIRESTORE_HOST = FS;
export const AUTH_HOST = AUTH;
