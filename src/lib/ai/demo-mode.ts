import "server-only";
import demoExtraction from "../../../fixtures/ai/demo-agreement-extraction.json";
import { env } from "@/lib/env";
import { verifyQuote, type PageText } from "@/lib/quote-verify";
import { aiExtractionSchema, type AiExtraction } from "./schemas";

// Demo mode (Phase 2): a cached extraction for the fixture agreement, used only when
// DEMO_MODE=true AND the live Gemini call failed AND the uploaded text is the fixture
// agreement (its cached quotes are found in this document). Labelled in the UI as
// "Demo mode: cached extraction". It is never used for any other document.

const MIN_FOUND = 0.8;

export function demoModeEnabled(): boolean {
  return env().DEMO_MODE;
}

export function demoExtractionFor(pages: PageText[]): AiExtraction | null {
  if (!demoModeEnabled()) return null;
  const cached = aiExtractionSchema.parse(demoExtraction);
  const found = cached.rules.filter((r) => verifyQuote(r.quote, pages, r.page).match !== "none").length;
  return cached.rules.length > 0 && found / cached.rules.length >= MIN_FOUND ? cached : null;
}
