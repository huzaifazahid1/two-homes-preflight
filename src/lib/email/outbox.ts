import "server-only";
import { db, FieldValue } from "@/lib/firebase/admin";
import { newId } from "@/lib/ids";

// Dev email outbox (Section H.2). Labelled exception to "no fake integrations":
// in tests the rendered email is kept in memory; in local development it is written to
// the `devOutbox` collection so /dev/demo can show it. Never used in production unless DEMO_MODE.

export type OutboxEmail = {
  id: string;
  to: string;
  from: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
  at: Date;
};

const memory: OutboxEmail[] = [];

export async function writeOutbox(email: Omit<OutboxEmail, "id" | "at">): Promise<string> {
  const id = `outbox_${newId(12)}`;
  const entry = { ...email, id, at: new Date() };
  // Vitest keeps emails in memory. E2E (Playwright) and local dev write to the emulator or dev project.
  if (process.env.VITEST) {
    memory.push(entry);
    return id;
  }
  await db().collection("devOutbox").doc(id).set({ ...email, at: FieldValue.serverTimestamp() });
  return id;
}

/** Tests only. */
export function readMemoryOutbox(): readonly OutboxEmail[] {
  return memory;
}

/** Tests only. */
export function clearMemoryOutbox() {
  memory.length = 0;
}
