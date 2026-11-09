"use client";

import { useState } from "react";
import type { RuleVersionView } from "@/types/views";
import { AgreementUpload } from "./agreement-upload";
import { RuleReview } from "./rule-review";

// Upload -> extraction -> review -> activate, on one screen (onboarding and /app/agreement).

export function AgreementFlow({
  draft: initialDraft,
  pendingAgreementId,
  onActivated,
  uploadTitle,
  activateLabel,
}: {
  draft: RuleVersionView | null;
  pendingAgreementId?: string | null;
  onActivated: (rv: RuleVersionView) => void;
  uploadTitle?: string;
  activateLabel?: string;
}) {
  const [draft, setDraft] = useState(initialDraft);
  if (!draft) return <AgreementUpload onDraft={setDraft} pendingAgreementId={pendingAgreementId} title={uploadTitle} />;
  return <RuleReview key={draft.id} draft={draft} onActivated={onActivated} activateLabel={activateLabel} />;
}
