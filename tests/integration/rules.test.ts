import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deleteApp, initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from "firebase/auth";
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  setDoc,
  terminate,
  updateDoc,
  where,
  type Firestore,
} from "firebase/firestore";
import { adminAuth, db, Timestamp } from "@/lib/firebase/admin";
import { AUTH_HOST, EMULATOR_PROJECT, FIRESTORE_HOST, resetEmulators } from "../helpers/emulator";

// Security rules (Section E.4) tested with the real client SDK against the emulators,
// signed in as test users. Data is seeded with the Admin SDK (which bypasses rules).

const apps: FirebaseApp[] = [];
const stores: Firestore[] = [];

async function clientAs(email: string): Promise<Firestore> {
  const app = initializeApp({ apiKey: "demo-api-key", projectId: EMULATOR_PROJECT, appId: "demo" }, `app-${email}-${apps.length}`);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${AUTH_HOST}`, { disableWarnings: true });
  await signInWithEmailAndPassword(auth, email, "Passw0rd!long");
  const fs = getFirestore(app);
  const [host, port] = FIRESTORE_HOST.split(":");
  connectFirestoreEmulator(fs, host, Number(port));
  stores.push(fs);
  return fs;
}

function anonymous(): Firestore {
  const app = initializeApp({ apiKey: "demo-api-key", projectId: EMULATOR_PROJECT, appId: "demo" }, `anon-${apps.length}`);
  apps.push(app);
  const fs = getFirestore(app);
  const [host, port] = FIRESTORE_HOST.split(":");
  connectFirestoreEmulator(fs, host, Number(port));
  stores.push(fs);
  return fs;
}

let aUid = "";
let bUid = "";
let A: Firestore;
let B: Firestore;

beforeAll(async () => {
  await resetEmulators();
  aUid = (await adminAuth().createUser({ email: "a@rules.test", password: "Passw0rd!long" })).uid;
  bUid = (await adminAuth().createUser({ email: "b@rules.test", password: "Passw0rd!long" })).uid;
  const t = Timestamp.now();
  await db().doc(`users/${aUid}`).set({ uid: aUid, familyId: "famA" });
  await db().doc(`users/${bUid}`).set({ uid: bUid, familyId: "famB" });
  await db().doc("families/famA").set({ ownerUid: aUid, memberUids: [aUid] });
  await db().doc("families/famB").set({ ownerUid: bUid, memberUids: [bUid] });
  await db().doc("expenses/expA").set({ familyId: "famA", memberUids: [aUid], updatedAt: t });
  await db().doc("expenses/expA/events/e1").set({ type: "x", at: t });
  await db().doc("expenses/expB").set({ familyId: "famB", memberUids: [bUid], updatedAt: t });
  await db().doc("expenses/expB/events/e1").set({ type: "x", at: t });
  await db().doc("notifications/nA").set({ toUid: aUid, familyId: "famA", createdAt: t });
  await db().doc("notifications/nB").set({ toUid: bUid, familyId: "famB", createdAt: t });
  await db().doc("linkTokens/hash1").set({ familyId: "famA" });
  await db().doc("otpChallenges/hash1").set({ attempts: 0 });
  await db().doc("auditLogs/l1").set({ familyId: "famA" });
  await db().doc("payments/expA").set({ familyId: "famA", memberUids: [aUid] });
  A = await clientAs("a@rules.test");
  B = await clientAs("b@rules.test");
});

afterAll(async () => {
  await Promise.all(stores.map((s) => terminate(s)));
  await Promise.all(apps.map((a) => deleteApp(a)));
});

const denied = async (p: Promise<unknown>) => {
  await expect(p).rejects.toMatchObject({ code: "permission-denied" });
};

describe("reads", () => {
  it("members read their own family, expense, events and notifications", async () => {
    expect((await getDoc(doc(A, "users", aUid))).exists()).toBe(true);
    expect((await getDoc(doc(A, "families/famA"))).exists()).toBe(true);
    expect((await getDoc(doc(A, "expenses/expA"))).exists()).toBe(true);
    expect((await getDoc(doc(A, "expenses/expA/events/e1"))).exists()).toBe(true);
    expect((await getDoc(doc(A, "notifications/nA"))).exists()).toBe(true);
  });

  it("AZ-6: another family's expense, events, family doc, user doc or notification is denied", async () => {
    await denied(getDoc(doc(A, "expenses/expB")));
    await denied(getDoc(doc(A, "expenses/expB/events/e1")));
    await denied(getDoc(doc(A, "families/famB")));
    await denied(getDoc(doc(A, `users/${bUid}`)));
    await denied(getDoc(doc(A, "notifications/nB")));
  });

  it("server-only collections are never readable", async () => {
    for (const p of ["linkTokens/hash1", "otpChallenges/hash1", "auditLogs/l1", "payments/expA"]) await denied(getDoc(doc(A, p)));
  });

  it("signed-out clients read nothing", async () => {
    const anon = anonymous();
    await denied(getDoc(doc(anon, "families/famA")));
    await denied(getDoc(doc(anon, "expenses/expA")));
  });

  it("AZ-7: queries must carry the rule's constraint", async () => {
    const ok = await getDocs(query(collection(A, "expenses"), where("memberUids", "array-contains", aUid), orderBy("updatedAt", "desc"), limit(30)));
    expect(ok.docs.map((d) => d.id)).toEqual(["expA"]);
    await denied(getDocs(query(collection(A, "expenses"), limit(30))));
    await denied(getDocs(query(collection(A, "expenses"), where("familyId", "==", "famA"), limit(30))));
    const notes = await getDocs(query(collection(A, "notifications"), where("toUid", "==", aUid), orderBy("createdAt", "desc"), limit(20)));
    expect(notes.size).toBe(1);
    await denied(getDocs(query(collection(A, "notifications"), limit(20))));
  });
});

describe("writes", () => {
  it("AZ-5: every client write is denied, including to the user's own documents", async () => {
    await denied(setDoc(doc(A, "expenses/new1"), { familyId: "famA", memberUids: [aUid] }));
    await denied(updateDoc(doc(A, "expenses/expA"), { "approval.state": "APPROVED" }));
    await denied(updateDoc(doc(A, `users/${aUid}`), { onboardingStep: "done" }));
    await denied(updateDoc(doc(A, "families/famA"), { memberUids: [aUid, bUid] }));
    await denied(updateDoc(doc(A, "notifications/nA"), { read: true }));
    await denied(setDoc(doc(B, "linkTokens/x"), { a: 1 }));
    await denied(setDoc(doc(A, "rateLimits/x"), { count: 0 }));
  });
});
