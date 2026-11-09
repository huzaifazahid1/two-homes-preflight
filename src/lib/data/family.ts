import "server-only";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { requireFamily, requireUserFromCookie, SESSION_COOKIE, type FamilyContext } from "@/lib/auth/session";
import { agreementsCol, agreementView, ruleVersionsCol } from "@/lib/agreements";
import { FREE_EXTRACTION_RUNS, familyEntitled } from "@/lib/entitlement";
import { isAppError } from "@/lib/errors";
import { getExpense, listExpenses } from "@/lib/expenses";
import { ruleVersionView } from "@/lib/rule-version-view";
import type { AgreementDoc, RuleVersionDoc } from "@/types/firestore";

// Server-only reads for /app and onboarding pages (always inside <Suspense>).

export async function familyContext(currentPath: string): Promise<FamilyContext> {
  await connection();
  const value = (await cookies()).get(SESSION_COOKIE)?.value;
  try {
    const user = await requireUserFromCookie(value);
    return await requireFamily(user);
  } catch (err) {
    if (isAppError(err) && (err.code === "UNAUTHENTICATED" || err.code === "NOT_FOUND")) redirect(`/login?next=${encodeURIComponent(currentPath)}`);
    throw err;
  }
}

/** Active rules, the open draft (if any) and plan limits for the agreement pages and onboarding. */
export async function agreementOverview(ctx: FamilyContext) {
  const [activeSnap, agreementsSnap, entitled] = await Promise.all([
    ctx.family.activeRuleVersionId ? ruleVersionsCol().doc(ctx.family.activeRuleVersionId).get() : Promise.resolve(null),
    agreementsCol().where("familyId", "==", ctx.familyId).get(),
    familyEntitled(ctx.familyId),
  ]);
  const agreements = agreementsSnap.docs.map((d) => ({ id: d.id, doc: d.data() as AgreementDoc })).sort((a, b) => b.doc.createdAt.toMillis() - a.doc.createdAt.toMillis());
  const withDraft = agreements.find((a) => a.doc.draftRuleVersionId);
  const draftSnap = withDraft ? await ruleVersionsCol().doc(withDraft.doc.draftRuleVersionId!).get() : null;
  const active = activeSnap?.exists ? ruleVersionView(activeSnap.id, activeSnap.data() as RuleVersionDoc) : null;
  const draft = draftSnap?.exists && (draftSnap.data() as RuleVersionDoc).status === "DRAFT" ? ruleVersionView(draftSnap.id, draftSnap.data() as RuleVersionDoc) : null;
  const activeAgreement = active ? agreements.find((a) => a.id === active.agreementId) : undefined;
  const draftAgreement = draft ? agreements.find((a) => a.id === draft.agreementId) : undefined;
  const latest = agreements[0];
  const runsUsed = agreements.reduce((n, a) => n + (a.doc.extractionRuns ?? 0), 0);
  return {
    active,
    activeAgreement: activeAgreement ? agreementView(activeAgreement.id, activeAgreement.doc) : null,
    draft,
    draftAgreement: draftAgreement ? agreementView(draftAgreement.id, draftAgreement.doc) : null,
    /** Latest upload that has no draft yet (e.g. extraction failed): the UI offers retry or manual entry. */
    pending: latest && !latest.doc.draftRuleVersionId && latest.id !== active?.agreementId ? agreementView(latest.id, latest.doc) : null,
    entitled,
    runsLeft: entitled ? null : Math.max(0, FREE_EXTRACTION_RUNS - runsUsed),
  };
}
export type AgreementOverview = Awaited<ReturnType<typeof agreementOverview>>;

export { getExpense, listExpenses };
