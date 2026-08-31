import type { PlanCompilationProposal, SourceEvidenceRef, TransportPreference } from "@c-assistant/core";
import type { SkillStatus } from "@c-assistant/skill-runtime";

export const JAPAN_PACK_VERSION = "0.1.0" as const;
export const JAPAN_TIME_ZONE = "Asia/Tokyo" as const;
const VERSION = "0.1.0" as const;
const DAY_MS = 86_400_000;

export interface JapanEvidenceInput {
  id: string;
  sourceId: string;
  authority: string;
  titleOriginal: string;
  url: string;
  retrievedAt: string;
  contentHash: string;
}

interface Envelope {
  skill: { id: string; version: typeof VERSION };
  status: SkillStatus;
  summary: string;
  facts: unknown[];
  assumptions: unknown[];
  recommendations: unknown[];
  proposedPlanChanges: unknown[];
  proposedTasks: unknown[];
  proposedReminders: unknown[];
  actionCards: unknown[];
  sources: JapanEvidenceInput[] | unknown[];
  warnings: string[];
}

function envelope(id: string, status: SkillStatus, summary: string): Envelope {
  return { skill: { id, version: VERSION }, status, summary, facts: [], assumptions: [], recommendations: [], proposedPlanChanges: [], proposedTasks: [], proposedReminders: [], actionCards: [], sources: [], warnings: [] };
}

export interface JapanPolicyResult extends Envelope {
  skill: { id: "japan-policy-applicability"; version: typeof VERSION };
  status: "success" | "needs_input" | "blocked" | "failed";
  sources: JapanEvidenceInput[];
  needsInput: Array<{ field: "nationality" | "travelPurpose" | "stayDays" | "departureDate" | "arrivalDate" | "passportConfirmed" | "officialEvidence"; reason: string }>;
  preparationState: "ready_for_official_confirmation" | "needs_input" | "needs_evidence" | "invalid";
  nextAction: string;
}

const policySourceIds = ["jp-mofa-visa-exemption", "jp-mofa-visa-faq"] as const;

/** A conservative evidence and identity gate; it never decides visa or landing eligibility. */
export function runJapanPolicyApplicabilitySkill(input: {
  nationality?: string;
  travelPurpose?: string;
  stayDays?: number;
  departureDate?: string;
  arrivalDate?: string;
  passportConfirmed?: boolean;
  evidence: JapanEvidenceInput[];
  now: string;
}): JapanPolicyResult {
  const base = envelope("japan-policy-applicability", "failed", "The Japan policy input did not pass the Skill contract.") as JapanPolicyResult;
  base.skill.id = "japan-policy-applicability";
  base.needsInput = [];
  base.preparationState = "invalid";
  base.nextAction = "Correct the malformed preparation context.";
  const nowMs = Date.parse(input.now);
  if (!Number.isFinite(nowMs) || !Array.isArray(input.evidence) || (input.stayDays !== undefined && (!Number.isInteger(input.stayDays) || input.stayDays < 1 || input.stayDays > 3650))) return base;

  const needsInput: JapanPolicyResult["needsInput"] = [];
  const facts: string[] = [];
  if (confirmed(input.nationality)) facts.push(`Nationality supplied by the user: ${input.nationality!.trim()}`); else needsInput.push({ field: "nationality", reason: "Japan entry preparation depends on user-confirmed nationality; it is never inferred." });
  if (confirmed(input.travelPurpose)) facts.push(`Travel purpose: ${input.travelPurpose!.trim()}`); else needsInput.push({ field: "travelPurpose", reason: "Travel purpose can change which official process must be reviewed." });
  if (input.stayDays !== undefined) facts.push(`Expected stay: ${input.stayDays} days`); else needsInput.push({ field: "stayDays", reason: "Expected stay length is required for a bounded official review." });
  if (isoDate(input.departureDate)) facts.push(`Departure date: ${input.departureDate}`); else needsInput.push({ field: "departureDate", reason: "A departure date is needed to schedule later policy checks." });
  if (isoDate(input.arrivalDate)) facts.push(`Arrival date: ${input.arrivalDate}`); else needsInput.push({ field: "arrivalDate", reason: "An arrival date is needed to evaluate evidence freshness and timing." });
  if (input.passportConfirmed === true) facts.push("The user confirmed that passport status was reviewed."); else needsInput.push({ field: "passportConfirmed", reason: "Confirm passport status without storing a passport number or image." });

  const validEvidence = input.evidence.filter((item) => validJapanEvidence(item, nowMs, 7));
  const latestBySource = new Map<string, JapanEvidenceInput>();
  for (const item of validEvidence) {
    const current = latestBySource.get(item.sourceId);
    if (!current || Date.parse(item.retrievedAt) > Date.parse(current.retrievedAt)) latestBySource.set(item.sourceId, item);
  }
  const sources = policySourceIds.flatMap((id) => latestBySource.get(id) ? [latestBySource.get(id)!] : []);
  if (sources.length !== policySourceIds.length) needsInput.push({ field: "officialEvidence", reason: "Fresh, Plan-linked MOFA visa exemption and visa FAQ snapshots are both required." });
  const identityMissing = needsInput.some((item) => item.field !== "officialEvidence");
  const status = identityMissing ? "needs_input" : sources.length !== policySourceIds.length ? "blocked" : "success";
  return {
    ...base,
    status,
    summary: status === "success"
      ? "Current official material and explicit traveler facts are ready for final user verification; no immediate visa action is asserted."
      : status === "needs_input" ? "Traveler facts are still needed before Japan entry preparation can be assessed." : "Current linked MOFA evidence is required before Japan entry preparation can continue.",
    facts,
    sources,
    warnings: [
      "This preparation does not decide visa exemption, visa issuance, landing permission, or legal eligibility.",
      "The result depends on nationality, travel purpose, stay length, dates, passport status, and current official material; complete final confirmation on the official page."
    ],
    needsInput,
    preparationState: status === "success" ? "ready_for_official_confirmation" : status === "needs_input" ? "needs_input" : "needs_evidence",
    nextAction: status === "success" ? "Complete the final check on the linked MOFA pages before departure." : "Supply the missing facts and refresh the approved Japan sources."
  };
}

export interface JapanWeatherResult extends Envelope {
  skill: { id: "japan-weather-and-packing"; version: typeof VERSION };
}

export function runJapanWeatherAndPackingSkill(input: { availability: "available" | "not_supported" | "unavailable"; locationName: string; retrievedAt: string; targetDate?: string; daily?: Array<{ date: string; conditionDay: string; conditionNight: string; highC: number; lowC: number; precipitationMm: number; uvIndex: number }>; provider?: "google_weather" }): JapanWeatherResult {
  const base = envelope("japan-weather-and-packing", "failed", "The weather input did not pass the Skill contract.") as JapanWeatherResult;
  base.skill.id = "japan-weather-and-packing";
  if (!confirmed(input.locationName) || !Number.isFinite(Date.parse(input.retrievedAt)) || (input.targetDate !== undefined && !isoDate(input.targetDate))) return base;
  if (input.availability !== "available") return { ...base, status: "degraded", summary: `Reliable weather facts are ${input.availability === "not_supported" ? "not supported" : "unavailable"} for ${input.locationName}; an explicit check remains scheduled near departure.`, warnings: ["No distant or missing forecast was invented."] };
  const daily = Array.isArray(input.daily) ? input.daily.filter(validDaily) : [];
  const matched = input.targetDate ? daily.find((day) => day.date === input.targetDate) : undefined;
  if (input.targetDate && !matched) return { ...base, status: "degraded", summary: `No exact-date forecast is available for ${input.targetDate}; check again near departure.`, warnings: ["Seasonal expectations are not presented as a forecast."] };
  const facts = matched ? [matched] : daily.slice(0, 3);
  const recommendations: string[] = [];
  if (facts.some((day) => day.precipitationMm > 0)) recommendations.push("Consider rain protection.");
  if (facts.some((day) => day.lowC <= 10)) recommendations.push("Consider a warm layer.");
  if (facts.some((day) => day.highC >= 30)) recommendations.push("Plan for heat and hydration.");
  return { ...base, status: "success", summary: `${facts.length} traceable weather ${facts.length === 1 ? "fact is" : "facts are"} available for packing review.`, facts, recommendations, sources: [{ provider: input.provider ?? "google_weather", observedAt: input.retrievedAt }], warnings: ["Weather changes; refresh it near the relevant day."] };
}

export interface JapanHousingResult extends Envelope { skill: { id: "japan-housing-area-recommendation"; version: typeof VERSION } }
export function runJapanHousingAreaRecommendationSkill(input: { centreName?: string; candidates: Array<{ id: string; name: string; address: string; distanceMeters: number }>; observedAt: string }): JapanHousingResult {
  const base = envelope("japan-housing-area-recommendation", "failed", "The housing input did not pass the Skill contract.") as JapanHousingResult;
  base.skill.id = "japan-housing-area-recommendation";
  if (!confirmed(input.centreName)) return { ...base, status: "needs_input", summary: "A confirmed itinerary anchor is needed before accommodation access can be assessed." };
  if (!Number.isFinite(Date.parse(input.observedAt)) || !Array.isArray(input.candidates)) return base;
  const facts = input.candidates.filter((item) => confirmed(item.id) && confirmed(item.name) && confirmed(item.address) && Number.isFinite(item.distanceMeters) && item.distanceMeters >= 0).slice(0, 5);
  return { ...base, status: facts.length ? "success" : "degraded", summary: facts.length ? `${facts.length} accommodation candidates can be compared with ${input.centreName}.` : "No usable accommodation-area facts are available.", facts, recommendations: facts.slice(0, 3).map((item) => ({ candidateId: item.id, reason: `${Math.round(item.distanceMeters)} m straight-line distance from the selected anchor; compare actual routes before choosing.` })), sources: [{ provider: "google_maps", observedAt: input.observedAt }], warnings: ["Price, inventory, booking, quality, and guest acceptance are not verified."] };
}

export interface JapanTransportResult extends Envelope { skill: { id: "japan-transport-planner"; version: typeof VERSION } }
export function runJapanTransportPlannerSkill(input: { routeFacts: Array<{ mode: "driving" | "walking" | "transit"; distanceMeters: number; durationSeconds?: number }>; observedAt: string; preference?: TransportPreference }): JapanTransportResult {
  const base = envelope("japan-transport-planner", "failed", "The transport input did not pass the Skill contract.") as JapanTransportResult;
  base.skill.id = "japan-transport-planner";
  if (!Number.isFinite(Date.parse(input.observedAt)) || !Array.isArray(input.routeFacts)) return base;
  const facts = input.routeFacts.filter((item) => ["driving", "walking", "transit"].includes(item.mode) && Number.isFinite(item.distanceMeters) && item.distanceMeters >= 0 && (item.durationSeconds === undefined || item.durationSeconds >= 0));
  const preferredMode = input.preference === "taxi" ? "driving" : input.preference === "public_transit" ? "transit" : input.preference === "walking" ? "walking" : undefined;
  const preferred = preferredMode ? facts.find((item) => item.mode === preferredMode) : undefined;
  const selected = preferred ?? (facts.length ? [...facts].sort((a, b) => (a.durationSeconds ?? Infinity) - (b.durationSeconds ?? Infinity))[0] : undefined);
  return { ...base, status: facts.length ? "success" : "degraded", summary: facts.length ? `${facts.length} current route modes are available for arrival and accommodation review.` : "No current airport-to-accommodation route fact is available; transport remains unverified.", facts, recommendations: selected ? [{ mode: selected.mode, reason: preferred ? "Matches the transport preference saved on this Plan; live service conditions still apply." : "Shortest returned duration for comparison only; user preference and live service conditions still apply." }] : [], sources: facts.length ? [{ provider: "google_maps", observedAt: input.observedAt }] : [], warnings: [...(preferredMode && !preferred ? [`The saved ${input.preference} preference has no current matching route fact.`] : []), "No ticket, ride, navigation session, booking, or payment was started."] };
}

export interface JapanReferenceItem { id: string; capability: string; nameOriginal: string; nameEnglish: string; explanationEnglish: string; sourceId: string }
export interface JapanFoodFact { id: string; nameOriginal: string; nameEnglish: string; explanationEnglish: string; sourceId: string }
export interface JapanCatalogSkillInput { locationName: string; facts: JapanFoodFact[]; items: JapanReferenceItem[]; sources: JapanEvidenceInput[]; now: string }

export interface JapanFoodResult extends Envelope { skill: { id: "japan-local-food-guide"; version: typeof VERSION }; sources: JapanEvidenceInput[] }
export function runJapanLocalFoodGuideSkill(input: Pick<JapanCatalogSkillInput, "locationName" | "facts" | "sources" | "now">): JapanFoodResult {
  const base = envelope("japan-local-food-guide", "failed", "The food-guide input did not pass the Skill contract.") as JapanFoodResult;
  base.skill.id = "japan-local-food-guide";
  const nowMs = Date.parse(input.now);
  if (!Number.isFinite(nowMs) || !confirmed(input.locationName) || !Array.isArray(input.facts) || !Array.isArray(input.sources)) return base;
  const source = input.sources.find((item) => item.sourceId === "jp-go-tokyo-food" && validJapanEvidence(item, nowMs, 30));
  const facts = source && /(?:^|\W)tokyo(?:\W|$)|東京/i.test(input.locationName) ? input.facts.filter(validFoodFact).slice(0, 5) : [];
  return { ...base, status: facts.length ? "success" : "degraded", summary: facts.length ? `${facts.length} bilingual Tokyo food-culture references are available.` : "No fresh source-backed Tokyo food-culture reference is available.", facts, recommendations: facts.map((fact) => `${fact.nameEnglish} (${fact.nameOriginal}): ${fact.explanationEnglish}`), sources: source && facts.length ? [source] : [], warnings: ["These are cultural references, not restaurant recommendations or claims about hours, prices, inventory, or reservations."] };
}

export interface JapanDigitalResult extends Envelope { skill: { id: "japan-digital-life-setup"; version: typeof VERSION }; sources: JapanEvidenceInput[] }
export function runJapanDigitalLifeSetupSkill(input: Pick<JapanCatalogSkillInput, "items" | "sources" | "now">): JapanDigitalResult {
  const base = envelope("japan-digital-life-setup", "failed", "The Japan reference input did not pass the Skill contract.") as JapanDigitalResult;
  base.skill.id = "japan-digital-life-setup";
  const nowMs = Date.parse(input.now);
  if (!Number.isFinite(nowMs) || !Array.isArray(input.items) || !Array.isArray(input.sources)) return base;
  const sourceById = new Map(input.sources.filter((item) => validJapanEvidence(item, nowMs, 30)).map((item) => [item.sourceId, item]));
  const facts = input.items.filter((item) => validReferenceItem(item) && sourceById.has(item.sourceId)).slice(0, 8);
  const sources = [...new Set(facts.map((item) => item.sourceId))].flatMap((id) => sourceById.get(id) ? [sourceById.get(id)!] : []);
  return { ...base, status: facts.length === input.items.length && facts.length ? "success" : "degraded", summary: `${facts.length} current Japan arrival, transport, payment, digital, or emergency references are available.`, facts, recommendations: facts.map((item) => `${item.nameEnglish} (${item.nameOriginal}): ${item.explanationEnglish}`), actionCards: facts.map((item) => ({ kind: "official_link", itemId: item.id, url: sourceById.get(item.sourceId)!.url, completion: "unknown_until_user_confirms" })), sources, warnings: ["Opening a link does not prove setup, registration, payment readiness, transport use, or completion."] };
}

export interface JapanPreparationTask {
  proposalId: string;
  title: string;
  details: string;
  sourceSkills: Array<{ id: JapanSupportingSkillId; version: string }>;
  sourceEvidenceSkill?: JapanSupportingSkillId;
}
export interface JapanPreparationReminder { taskProposalId: string; dueAt: string; timeZone: typeof JAPAN_TIME_ZONE; purpose: string; refreshFacts: Array<"weather"> }
export interface JapanPreparationResult extends Envelope {
  skill: { id: "japan-arrival-preparation"; version: typeof VERSION };
  status: "success" | "needs_input" | "failed";
  proposedTasks: JapanPreparationTask[];
  proposedReminders: JapanPreparationReminder[];
}

export function runJapanArrivalPreparationSkill(input: { departureAt?: string; arrivalAt?: string; returnAt?: string; timeZone: string; policy: JapanPolicyResult; references: JapanDigitalResult; now: string }): JapanPreparationResult {
  const base = envelope("japan-arrival-preparation", "failed", "The Japan preparation timeline did not pass the Skill contract.") as JapanPreparationResult;
  base.skill.id = "japan-arrival-preparation";
  const departure = Date.parse(input.departureAt ?? "");
  const arrival = Date.parse(input.arrivalAt ?? "");
  const returning = Date.parse(input.returnAt ?? "");
  const now = Date.parse(input.now);
  if (input.timeZone !== JAPAN_TIME_ZONE || !Number.isFinite(now) || !Number.isFinite(departure) || !Number.isFinite(arrival) || !Number.isFinite(returning) || returning <= arrival) return { ...base, status: "needs_input", summary: "Exact departure, arrival, return, and Asia/Tokyo schedule anchors are required." };
  const policySkill = [{ id: input.policy.skill.id as JapanSupportingSkillId, version: input.policy.skill.version }];
  const referenceSkill = [{ id: input.references.skill.id as JapanSupportingSkillId, version: input.references.skill.version }];
  const tasks: JapanPreparationTask[] = [
    { proposalId: "japan-entry-review-90d", title: "Complete the initial Japan entry-policy review", details: input.policy.nextAction, sourceSkills: policySkill, sourceEvidenceSkill: "japan-policy-applicability" },
    { proposalId: "japan-entry-review-30d", title: "Recheck Japan official entry sources and open items", details: "Explicitly refresh and review the linked MOFA material; a source hash change alone is not a policy conclusion.", sourceSkills: policySkill, sourceEvidenceSkill: "japan-policy-applicability" },
    { proposalId: "japan-weather-routes-7d", title: "Check Tokyo weather, reservations, and key routes", details: "Use current weather and route facts; do not treat old observations as the trip forecast.", sourceSkills: [{ id: "japan-weather-and-packing", version: VERSION }, { id: "japan-transport-planner", version: VERSION }] },
    { proposalId: "japan-final-check-72h", title: "Recheck flight, entry rules, and airport transport", details: "Confirm the actual flight, current entry rules, arrival airport, accommodation, and route before leaving.", sourceSkills: policySkill, sourceEvidenceSkill: "japan-policy-applicability" },
    { proposalId: "japan-arrival-route", title: "Review the saved airport-to-accommodation route", details: "Use the confirmed airport, accommodation, and transport preference on arrival day; no ride is automatically called.", sourceSkills: [{ id: "japan-transport-planner", version: VERSION }, ...referenceSkill] },
    { proposalId: "japan-digital-emergency", title: "Review Japan digital, payment, IC-card, and emergency preparation", details: "Review the source-backed Japan reference items and keep payment and communication fallbacks.", sourceSkills: referenceSkill, sourceEvidenceSkill: "japan-digital-life-setup" },
    { proposalId: "japan-return-airport", title: "Recheck the route from accommodation to the departure airport", details: "Use current route facts and the actual departure terminal before leaving the accommodation.", sourceSkills: [{ id: "japan-transport-planner", version: VERSION }] },
    { proposalId: "japan-trip-completion", title: "Complete or archive the Japan Plan", details: "After the trip, explicitly complete or archive the Plan; delivery of this reminder does not complete it.", sourceSkills: referenceSkill }
  ];
  const due = (instant: number, offsetMs: number) => new Date(instant - offsetMs).toISOString();
  const reminders = ([
    { taskProposalId: "japan-entry-review-90d", dueAt: due(departure, 90 * DAY_MS), timeZone: JAPAN_TIME_ZONE, purpose: "Initial Japan entry-policy review", refreshFacts: [] },
    { taskProposalId: "japan-entry-review-30d", dueAt: due(departure, 30 * DAY_MS), timeZone: JAPAN_TIME_ZONE, purpose: "Explicitly recheck official Japan entry sources", refreshFacts: [] },
    { taskProposalId: "japan-weather-routes-7d", dueAt: due(departure, 7 * DAY_MS), timeZone: JAPAN_TIME_ZONE, purpose: "Check weather, reservations, and routes", refreshFacts: ["weather"] },
    { taskProposalId: "japan-final-check-72h", dueAt: due(departure, 72 * 60 * 60_000), timeZone: JAPAN_TIME_ZONE, purpose: "Final flight, entry, and airport transport check", refreshFacts: [] },
    { taskProposalId: "japan-arrival-route", dueAt: new Date(arrival).toISOString(), timeZone: JAPAN_TIME_ZONE, purpose: "Arrival route preparation", refreshFacts: ["weather"] },
    { taskProposalId: "japan-return-airport", dueAt: due(returning, 4 * 60 * 60_000), timeZone: JAPAN_TIME_ZONE, purpose: "Return-airport route check", refreshFacts: ["weather"] },
    { taskProposalId: "japan-trip-completion", dueAt: new Date(returning + DAY_MS).toISOString(), timeZone: JAPAN_TIME_ZONE, purpose: "Complete or archive the Plan", refreshFacts: [] }
  ] satisfies JapanPreparationReminder[]).filter((item) => Date.parse(item.dueAt) > now);
  return { ...base, status: "success", summary: `${tasks.length} Japan preparation Tasks and ${reminders.length} review Reminders are ready for draft compilation.`, facts: tasks, proposedTasks: tasks, proposedReminders: reminders, warnings: ["Policy refresh is an explicit user Task; the current scheduler automatically refreshes weather only when declared.", "All Tasks and Reminders remain inert until the exact draft version is confirmed."] };
}

export const japanArrivalPlanSupportingSkillOrder = [
  "japan-policy-applicability", "japan-weather-and-packing", "japan-housing-area-recommendation", "japan-transport-planner", "japan-local-food-guide", "japan-digital-life-setup", "japan-arrival-preparation"
] as const;
export type JapanSupportingSkillId = typeof japanArrivalPlanSupportingSkillOrder[number];
export type JapanSupportingResult = Envelope & { skill: { id: JapanSupportingSkillId; version: typeof VERSION } };
export interface JapanArrivalPlanResult extends Envelope {
  skill: { id: "japan-arrival-plan"; version: typeof VERSION };
  planRef: { id: string; version: number };
  missingSkills: JapanSupportingSkillId[];
}

export function runJapanArrivalPlanSkill(input: { planId: string; planVersion: number; supportingResults: JapanSupportingResult[] }): JapanArrivalPlanResult {
  const base = envelope("japan-arrival-plan", "failed", "The Japan composition input did not pass the Skill contract.") as JapanArrivalPlanResult;
  base.skill.id = "japan-arrival-plan";
  base.planRef = { id: input.planId, version: input.planVersion };
  base.missingSkills = [...japanArrivalPlanSupportingSkillOrder];
  if (!confirmed(input.planId) || !Number.isInteger(input.planVersion) || input.planVersion < 1 || !Array.isArray(input.supportingResults)) return base;
  const ids = input.supportingResults.map((item) => item.skill.id);
  if (new Set(ids).size !== ids.length || input.supportingResults.some((item) => !japanArrivalPlanSupportingSkillOrder.includes(item.skill.id))) return base;
  const byId = new Map(input.supportingResults.map((item) => [item.skill.id, item]));
  const missingSkills = japanArrivalPlanSupportingSkillOrder.filter((id) => !byId.has(id));
  const ordered = japanArrivalPlanSupportingSkillOrder.flatMap((id) => byId.get(id) ? [byId.get(id)!] : []);
  const blocked = ordered.some((item) => item.status === "blocked" || item.status === "failed" || item.status === "needs_input");
  const degraded = ordered.some((item) => item.status === "degraded" || item.status === "not_supported");
  const status: SkillStatus = missingSkills.length || blocked ? "blocked" : degraded ? "degraded" : "success";
  return { ...base, status, summary: missingSkills.length ? `Japan composition is missing ${missingSkills.length} required supporting results.` : blocked ? "A critical Japan supporting result is not ready; composition failed closed." : degraded ? "Japan composition is ready with explicit non-critical limitations." : "All Japan supporting results are ready for Core compilation.", facts: ordered.map((item) => ({ skillId: item.skill.id, version: item.skill.version, status: item.status, summary: item.summary })), assumptions: ordered.flatMap((item) => item.assumptions), recommendations: ordered.flatMap((item) => item.recommendations), sources: ordered.flatMap((item) => item.sources), warnings: ordered.flatMap((item) => item.warnings), planRef: { id: input.planId, version: input.planVersion }, missingSkills };
}

export function createJapanPlanCompilationProposal(input: { composite: JapanArrivalPlanResult; preparation: JapanPreparationResult; food: JapanFoodResult; sourceEvidenceBySkill: Partial<Record<JapanSupportingSkillId, SourceEvidenceRef[]>> }): { status: "ready"; proposal: PlanCompilationProposal } | { status: "blocked"; reasonCode: string; message: string } {
  if ((input.composite.status !== "success" && input.composite.status !== "degraded") || input.composite.missingSkills.length || input.preparation.status !== "success") return { status: "blocked", reasonCode: "composition_not_ready", message: "The complete Japan composition and preparation timeline must be ready before Core compilation." };
  const reminders = new Map(input.preparation.proposedReminders.map((item) => [item.taskProposalId, item]));
  const sourceEvidence = uniqueEvidence(Object.values(input.sourceEvidenceBySkill).flatMap((items) => items ?? []));
  return {
    status: "ready",
    proposal: {
      planRef: input.composite.planRef,
      countryPack: { id: "japan", version: JAPAN_PACK_VERSION, name: "Japan Country Pack" },
      composition: { skillId: input.composite.skill.id, version: input.composite.skill.version, status: input.composite.status as "success" | "degraded" },
      compilationKey: "japan-arrival-preparation",
      stage: { title: "Japan arrival and Tokyo trip preparation", description: "Version-bound, source-backed preparation for a single-country Japan Plan." },
      sourceEvidence,
      tasks: input.preparation.proposedTasks.map((task) => {
        const reminder = reminders.get(task.proposalId);
        return { proposalId: task.proposalId, title: task.title, description: task.details, owner: "user" as const, dueLabel: reminder ? "At the proposed reminder time" : "During Plan review", sourceSkills: [...task.sourceSkills, { id: input.preparation.skill.id, version: input.preparation.skill.version }], sourceEvidence: task.sourceEvidenceSkill ? input.sourceEvidenceBySkill[task.sourceEvidenceSkill] ?? [] : [], ...(reminder ? { reminder } : {}) };
      }),
      knownInformation: input.food.recommendations.filter((item): item is string => typeof item === "string").map((item) => `Tokyo food culture: ${item}`),
      assumptions: [],
      limitations: [...new Set([...input.composite.warnings, "Japan Pack does not determine visa eligibility, book, pay, buy tickets, or call a ride."])]
    }
  };
}

function validJapanEvidence(item: JapanEvidenceInput, nowMs: number, maxAgeDays: number): boolean {
  if (!confirmed(item.id) || !confirmed(item.sourceId) || !confirmed(item.authority) || !confirmed(item.titleOriginal) || !/^[a-f0-9]{64}$/i.test(item.contentHash)) return false;
  const retrieved = Date.parse(item.retrievedAt);
  if (!Number.isFinite(retrieved) || retrieved > nowMs + 5 * 60_000 || retrieved < nowMs - maxAgeDays * DAY_MS) return false;
  try {
    const url = new URL(item.url);
    const domains = japanSourceDomains[item.sourceId];
    return url.protocol === "https:" && Boolean(domains?.some((domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`)));
  } catch { return false; }
}
const japanSourceDomains: Record<string, string[]> = {
  "jp-mofa-visa-exemption": ["mofa.go.jp"],
  "jp-mofa-visa-faq": ["mofa.go.jp"],
  "jp-visit-japan-web": ["digital.go.jp"],
  "jp-jnto-ic-cards": ["japan.travel"],
  "jp-jreast-welcome-suica": ["jreast.co.jp"],
  "jp-jnto-emergencies": ["japan.travel"],
  "jp-haneda-access": ["tokyo-haneda.com"],
  "jp-go-tokyo-food": ["gotokyo.org"]
};
function validDaily(value: { date: string; conditionDay: string; conditionNight: string; highC: number; lowC: number; precipitationMm: number; uvIndex: number }): boolean { return isoDate(value.date) && confirmed(value.conditionDay) && confirmed(value.conditionNight) && [value.highC, value.lowC, value.precipitationMm, value.uvIndex].every(Number.isFinite); }
function validFoodFact(value: JapanFoodFact): boolean { return confirmed(value.id) && confirmed(value.nameOriginal) && confirmed(value.nameEnglish) && confirmed(value.explanationEnglish) && value.sourceId === "jp-go-tokyo-food"; }
function validReferenceItem(value: JapanReferenceItem): boolean { return confirmed(value.id) && confirmed(value.capability) && confirmed(value.nameOriginal) && confirmed(value.nameEnglish) && confirmed(value.explanationEnglish) && /^jp-/.test(value.sourceId); }
function confirmed(value: string | undefined): boolean { const normalized = value?.trim().toLowerCase() ?? ""; return Boolean(normalized) && !normalized.includes("to be confirmed") && !normalized.includes("not sure"); }
function isoDate(value: string | undefined): value is string { return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`))); }
function uniqueEvidence(items: SourceEvidenceRef[]): SourceEvidenceRef[] { return items.filter((item, index, all) => all.findIndex((candidate) => candidate.sourceSnapshotId === item.sourceSnapshotId && candidate.contentHash === item.contentHash) === index).map((item) => ({ ...item })); }
