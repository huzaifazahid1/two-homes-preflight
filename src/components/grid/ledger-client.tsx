"use client";

import { useRouter } from "next/navigation";
import type { LedgerView } from "@/types/views";
import { LedgerGrid } from "./ledger-grid";

// Re-reads the server rows after an action (rows are never patched on the client).
export function LedgerClient({ view }: { view: LedgerView }) {
  const router = useRouter();
  return <LedgerGrid view={view} onChanged={() => router.refresh()} />;
}
