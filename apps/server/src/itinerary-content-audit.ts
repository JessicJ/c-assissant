import { createHash } from "node:crypto";
import { buildSkillItineraryReviewPrompt, parseSkillItineraryReview, type SkillItineraryReviewFinding, type SkillItineraryReviewRequest } from "@c-assistant/agent-adapters";
import type { SqliteWorkspaceStore } from "@c-assistant/storage";

/** Cache a bounded editorial verdict by its exact input; corrections and changed facts invalidate it. */
export async function auditItineraryContent(input: {
  store: SqliteWorkspaceStore;
  generationKey: string;
  request: SkillItineraryReviewRequest;
  review: (request: SkillItineraryReviewRequest) => Promise<SkillItineraryReviewFinding[]>;
  onStart?: (cached: boolean) => void;
  useCache?: boolean;
}): Promise<SkillItineraryReviewFinding[]> {
  const key = createHash("sha256").update(buildSkillItineraryReviewPrompt(input.request)).digest("hex");
  const dates = new Set(input.request.itinerary.days.map((day) => day.date));
  for (const entry of input.useCache === false ? [] : input.store.listDiagnosticArtifacts(input.generationKey).reverse()) {
    if (Date.parse(entry.expiresAt) <= Date.now()) continue;
    try {
      const cached = JSON.parse(entry.rawResponse);
      if (cached.type !== "blueprint_content_review_v1" || cached.inputKey !== key) continue;
      const findings = parseSkillItineraryReview(JSON.stringify({ issues: cached.issues }), dates);
      input.onStart?.(true);
      return findings;
    } catch { /* Ignore a corrupt or incompatible cache entry; never accept its verdict. */ }
  }
  input.onStart?.(false);
  const started = Date.now();
  const issues = await input.review(input.request);
  // Validate injected Runtime results as strictly as model responses.
  const findings = parseSkillItineraryReview(JSON.stringify({ issues: issues.map((finding) => ({ ...finding, date: finding.date ?? null })) }), dates);
  input.store.saveDiagnosticArtifact({ generationKey: input.generationKey,
    createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60_000).toISOString(),
    rawResponse: JSON.stringify({ type: "blueprint_content_review_v1", inputKey: key, runtimeMs: Date.now() - started,
      issues: findings.map((finding) => ({ ...finding, date: finding.date ?? null })) }) });
  return findings;
}
