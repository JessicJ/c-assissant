import type { BlueprintPreparationChecklistItem, BlueprintSource } from "./trip-blueprint.js";

/** Research context only. No passport numbers, documents, or eligibility decision. */
export interface PolicyResearchInput {
  destination: string;
  transitCountries: string[];
  nationality: string;
  passportCountry: string;
  purpose: string;
  startDate: string;
  endDate: string;
  checkedAt: string;
  sourceUrls: string[];
  missingInformation: string[];
  findings: string[];
}

export interface PolicyResearchSummary {
  status: "not_assessed" | "needs_input" | "needs_recheck";
  context?: PolicyResearchInput;
  issues: string[];
}

const textKeys = ["destination", "nationality", "passportCountry", "purpose", "startDate", "endDate", "checkedAt"] as const;
const listKeys = ["transitCountries", "sourceUrls", "missingInformation", "findings"] as const;
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

/** Invalid or absent optional research remains a review item, never a generation gate. */
export function assessPolicyResearch(value: unknown, sources: BlueprintSource[], now: string): PolicyResearchSummary {
  if (value === undefined || value === null) return { status: "not_assessed", issues: ["Entry and transit requirements have not been assessed for this trip."] };
  if (typeof value !== "object" || Array.isArray(value)) return invalid();
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => ![...textKeys, ...listKeys].includes(key as never))
    || textKeys.some((key) => typeof input[key] !== "string" || (input[key] as string).length > 500)
    || listKeys.some((key) => !Array.isArray(input[key]) || (input[key] as unknown[]).length > 30 || (input[key] as unknown[]).some((item) => typeof item !== "string" || item.length > 1000))) return invalid();
  const context = Object.fromEntries([
    ...textKeys.map((key) => [key, (input[key] as string).trim()]),
    ...listKeys.map((key) => [key, [...new Set((input[key] as string[]).map((item) => item.trim()).filter(Boolean))]])
  ]) as unknown as PolicyResearchInput;
  const missing = ["destination", "nationality", "passportCountry", "purpose"].filter((key) => !context[key as keyof PolicyResearchInput] || /unknown|to be confirmed|not sure/i.test(String(context[key as keyof PolicyResearchInput])));
  const issues = [...context.missingInformation];
  if (missing.length) issues.push("Confirm the destination, nationality, passport country and travel purpose needed for the entry check.");
  if (!validDate(context.startDate) || !validDate(context.endDate) || context.endDate < context.startDate) issues.push("Confirm the travel dates before checking which requirements apply.");
  const nowMs = Date.parse(now), checked = Date.parse(context.checkedAt);
  if (!Number.isFinite(checked) || !Number.isFinite(nowMs) || checked > nowMs) issues.push("The policy research check date needs review.");
  const matched = sources.filter((source) => context.sourceUrls.includes(source.url));
  if (!context.sourceUrls.length || context.sourceUrls.some((url) => !/^https:\/\//.test(url) || !matched.some((source) => source.url === url))) issues.push("Find recorded official sources for the entry and transit requirements.");
  if (matched.some((source) => source.official !== true || source.status !== "verified" || !Number.isFinite(Date.parse(source.retrievedAt)) || Date.parse(source.retrievedAt) > nowMs)) issues.push("The authority, freshness and supporting evidence of the policy sources need review.");
  // Even complete metadata cannot establish applicability, current law, or permission to travel.
  issues.push("Recheck official requirements against the traveler, destination, transit route and travel dates before relying on them.");
  return { status: missing.length || context.missingInformation.length ? "needs_input" : "needs_recheck", context, issues: [...new Set(issues)] };
}

function invalid(): PolicyResearchSummary {
  return { status: "needs_recheck", issues: ["The policy research summary is incomplete or unreadable and needs a fresh check."] };
}

/** Re-evaluate old persisted research without rewriting it. */
export function policyResearchForTrip(value: PolicyResearchSummary | undefined, sources: BlueprintSource[], now: string, startDate: string, endDate: string): PolicyResearchSummary {
  if (!value) return assessPolicyResearch(undefined, sources, now);
  const result = value.context ? assessPolicyResearch(value.context, sources, now) : structuredClone(value);
  if (result.context && (result.context.startDate !== startDate || result.context.endDate !== endDate)) {
    result.status = "needs_recheck";
    result.issues.push("The trip dates differ from the policy research; check the requirements for the current dates.");
  }
  return result;
}

export function policyPreparationItem(summary: PolicyResearchSummary, id: string, sources: BlueprintSource[] = []): BlueprintPreparationChecklistItem {
  return {
    id, title: summary.status === "not_assessed" ? "Check entry and transit requirements" : "Review entry and transit requirements",
    description: summary.issues.join(" "), group: "documents",
    completionCondition: "Review the applicable official requirements for your travel documents, route and dates. Confirm any necessary actions separately.",
    evidence: sources.filter((source) => summary.context?.sourceUrls.includes(source.url)).map((source) => ({ sourceId: source.id, status: "recheck" as const }))
  };
}
