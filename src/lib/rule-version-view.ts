import type { RuleVersionDoc } from "@/types/firestore";

// Client-safe serialisation of a rule version (ISO dates instead of Timestamps).

export function ruleVersionView(id: string, rv: RuleVersionDoc) {
  return {
    id,
    agreementId: rv.agreementId,
    version: rv.version,
    status: rv.status,
    rules: rv.rules,
    extractedParties: rv.extractedParties ?? { parents: [], children: [] },
    extraction: rv.extraction ? { mode: rv.extraction.mode, model: rv.extraction.model ?? null, at: rv.extraction.at.toDate().toISOString() } : null,
    confirmedAt: rv.confirmedAt?.toDate().toISOString() ?? null,
    coParentAck: rv.coParentAck ? { at: rv.coParentAck.at.toDate().toISOString(), perRule: rv.coParentAck.perRule } : null,
    createdAt: rv.createdAt.toDate().toISOString(),
  };
}
export type RuleVersionView = ReturnType<typeof ruleVersionView>;
