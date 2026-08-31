import type { Plan, Profile, SourceSnapshot } from "./index.js";

/**
 * This is an evidence-preparation check, not a policy decision. It deliberately
 * does not read or interpret source content, and must never claim eligibility.
 */
export type PolicyPreparationStatus = "needs_input" | "needs_evidence" | "ready_for_review";

export interface PolicyPreparationItem {
  field: "profile.nationality" | "profile.immigrationStatus" | "plan.location" | "plan.dates" | "official_source.nia-english";
  label: string;
  reason: string;
}

export interface PolicyPreparationAssessment {
  status: PolicyPreparationStatus;
  knownInformation: string[];
  missingInformation: PolicyPreparationItem[];
  evidence: SourceSnapshot[];
  nextAction: string;
  warning: string;
}

const OFFICIAL_EVIDENCE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;

export function assessPolicyPreparation(input: { profile: Profile; plan: Plan; sourceSnapshots: SourceSnapshot[]; now?: Date }): PolicyPreparationAssessment {
  const now = input.now ?? new Date();
  const missingInformation: PolicyPreparationItem[] = [];
  const knownInformation: string[] = [];

  if (isConfirmed(input.profile.nationality)) {
    knownInformation.push(`Nationality: ${input.profile.nationality}`);
  } else {
    missingInformation.push({ field: "profile.nationality", label: "Nationality", reason: "Official immigration guidance can depend on nationality." });
  }

  if (input.profile.immigrationStatus !== "unknown") {
    knownInformation.push(input.profile.immigrationStatus === "no_visa" ? "No China visa or residence permit has been obtained yet." : "China visa or residence status is recorded.");
  } else {
    missingInformation.push({ field: "profile.immigrationStatus", label: "China visa or residence status", reason: "Choose the status you know, or update it when it becomes clear." });
  }

  if (isConfirmed(input.plan.location)) {
    knownInformation.push(`Plan destination: ${input.plan.location}`);
  } else {
    missingInformation.push({ field: "plan.location", label: "Plan destination", reason: "A location is needed to prepare local policy research." });
  }

  if (isConfirmed(input.plan.dates)) {
    knownInformation.push(`Plan dates: ${input.plan.dates}`);
  } else {
    missingInformation.push({ field: "plan.dates", label: "Plan dates", reason: "Dates are needed to decide when current official evidence should be refreshed." });
  }

  const latestNiaEvidence = latestSnapshot(input.sourceSnapshots, "nia-english");
  const evidence = latestNiaEvidence ? [latestNiaEvidence] : [];
  const evidenceIsFresh = latestNiaEvidence ? Date.parse(latestNiaEvidence.retrievedAt) >= now.getTime() - OFFICIAL_EVIDENCE_MAX_AGE_MS : false;
  if (!evidenceIsFresh) {
    missingInformation.push({
      field: "official_source.nia-english",
      label: "Current National Immigration Administration evidence",
      reason: latestNiaEvidence ? "The saved official snapshot is more than seven days old. Refresh it before review." : "Refresh the approved National Immigration Administration source before review."
    });
  }

  const status: PolicyPreparationStatus = missingInformation.some((item) => item.field.startsWith("profile.") || item.field.startsWith("plan."))
    ? "needs_input"
    : evidenceIsFresh
      ? "ready_for_review"
      : "needs_evidence";

  return {
    status,
    knownInformation,
    missingInformation,
    evidence,
    nextAction: status === "needs_input"
      ? "Save the missing Profile or Plan details, then refresh the approved official source."
      : status === "needs_evidence"
        ? "Refresh the approved National Immigration Administration source in Settings before review."
        : "The basic information and current official evidence are ready for a separate policy review.",
    warning: "This preparation check does not determine visa, residence, or policy eligibility."
  };
}

function latestSnapshot(snapshots: SourceSnapshot[], sourceId: string): SourceSnapshot | undefined {
  return snapshots
    .filter((snapshot) => snapshot.sourceId === sourceId)
    .sort((left, right) => Date.parse(right.retrievedAt) - Date.parse(left.retrievedAt))[0];
}

function isConfirmed(value: string): boolean {
  const normalized = value.trim().toLocaleLowerCase();
  return Boolean(normalized) && !normalized.includes("to be confirmed") && !normalized.includes("not sure");
}
