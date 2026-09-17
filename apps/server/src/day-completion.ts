import type {
  BlueprintItineraryDay,
  BlueprintMovement,
  BlueprintPlace,
  BlueprintPlaceRelationship,
  ResearchSet,
  TripBlueprint
} from "@c-assistant/core";

export type DayPlanningClassification = "WELL_PLANNED" | "INTENTIONALLY_LIGHT" | "UNDER_PLANNED" | "OVER_PLANNED";
export type UnderPlannedCause = "CANDIDATE_GAP" | "DEPENDENCY_GAP" | "COMPOSITION_FAILURE";

export interface DayPlanningAssessment {
  dayId: string;
  date: string;
  classification: DayPlanningClassification;
  visitMinutes: number;
  movementMinutes: number;
  usefulCapacityMinutes: number;
  remainingUsefulCapacityMinutes: number;
  fixedCommitmentMinutes: number;
  experienceIntensity: "light" | "moderate" | "high";
  reason: string;
  cause?: UnderPlannedCause;
}

export interface DayCompletionTarget {
  assessment: DayPlanningAssessment;
  day: BlueprintItineraryDay;
  anchors: BlueprintPlace[];
  existingCandidates: BlueprintPlace[];
  rejectedCandidateIds: string[];
  researchScopeLabel?: string;
}

const DAY_INTERNAL_BUFFER_MINUTES = 120;
const NORMAL_SIGHTSEEING_WINDOW_MINUTES = 480;
const ARRIVAL_DEPARTURE_WINDOW_MINUTES = 180;
const MEANINGFUL_UNUSED_CAPACITY_MINUTES = 150;
const MIN_SUBSTANTIVE_DAY_MINUTES = 210;
const OVERPLANNED_TOTAL_MINUTES = 620;

export function assessBlueprintDayReasonableness(blueprint: TripBlueprint): DayPlanningAssessment[] {
  const placeById = new Map(blueprint.places.map((place) => [place.id, place] as const));
  return blueprint.days.map((day) => assessDay(day, blueprint.movements, placeById));
}

export function completionTargetsForBlueprint(blueprint: TripBlueprint, research: ResearchSet): DayCompletionTarget[] {
  const assessments = assessBlueprintDayReasonableness(blueprint);
  const dayById = new Map(blueprint.days.map((day) => [day.id, day] as const));
  const scheduledPlaceIds = new Set(blueprint.days.flatMap((day) => day.stops.map((stop) => stop.placeId)));
  const placeById = new Map(research.places.map((place) => [place.id, place] as const));
  const relationships = research.guideRelationships ?? [];
  return assessments.flatMap((assessment) => {
    if (assessment.classification !== "UNDER_PLANNED" || assessment.cause !== "CANDIDATE_GAP") return [];
    const day = dayById.get(assessment.dayId);
    if (!day) return [];
    const anchors = day.stops.map((stop) => placeById.get(stop.placeId)).filter((place): place is BlueprintPlace => Boolean(place));
    const candidates = existingCompletionCandidates(day, anchors, research, relationships, scheduledPlaceIds, assessment);
    const acceptedIds = new Set(candidates.map((place) => place.id));
    const rejectedCandidateIds = day.candidatePlaceIds.filter((id) => !acceptedIds.has(id));
    return [{
      assessment,
      day,
      anchors,
      existingCandidates: candidates,
      rejectedCandidateIds,
      ...(candidates.length ? {} : { researchScopeLabel: targetedCompletionScopeLabel(day, anchors) })
    }];
  });
}

export function buildCompletionItineraryRequest(baseRequest: string, targets: DayCompletionTarget[], researchCalled: boolean): string {
  const targetBriefs = targets.map((target) => ({
    date: target.day.date,
    dayId: target.day.id,
    title: target.day.title,
    kind: target.day.kind,
    city: target.day.city,
    classification: target.assessment.classification,
    cause: target.assessment.cause,
    currentAnchors: target.anchors.map(compactPlace),
    currentVisitMinutes: target.assessment.visitMinutes,
    currentMovementMinutes: target.assessment.movementMinutes,
    remainingUsefulCapacityMinutes: target.assessment.remainingUsefulCapacityMinutes,
    existingCompletionCandidates: target.existingCandidates.map(compactPlace),
    rejectedCandidateIds: target.rejectedCandidateIds
  }));
  return [
    baseRequest,
    "",
    "Stage 3.10 post-itinerary day completion:",
    "The previous itinerary draft was evaluated for day-by-day reasonableness. Re-compose only the listed under-planned day(s) unless a necessary movement adjustment touches an adjacent day. Preserve already well-planned and intentionally light days, especially long/full-day anchors.",
    "Do not add generic lunch, generic dinner, rest, free time, flexible afternoon, slow morning, early night, or return-to-hotel blocks. Internal meals, rest, navigation, and buffer consume capacity but must remain internal unless tied to a concrete place or execution dependency.",
    "A sparse day is acceptable only for concrete reasons such as arrival, departure, long transport, a full-day experience, fixed commitment, explicit user preference, actual party/physical constraint, or real recovery requirement. Do not rely on relaxed pace, preserve energy, avoid rushing, easy day, or before departure by itself.",
    researchCalled ? "Supplemental targeted research has been merged into the Research Set. Choose normally from all eligible places; do not auto-schedule every new candidate." : "Use the existing Research Set candidates first. Choose only candidates that improve geographic coherence and experience complementarity.",
    `Completion targets: ${JSON.stringify(targetBriefs)}`
  ].join("\n");
}

export function buildTargetedCompletionResearchRequest(baseRequest: string, target: DayCompletionTarget): string {
  const anchorAreas = target.anchors.map((place) => [place.name, place.area, place.city, place.locationLabel].filter(Boolean).join(" / "));
  return [
    baseRequest,
    "",
    "Targeted Stage 3.10 day-completion research. Research this day's area only; do not perform generic broad destination research.",
    `Target date: ${target.day.date}`,
    `Day type: ${target.day.kind}`,
    `Day intent/theme: ${target.day.title} - ${target.day.summary}`,
    `Current anchors: ${JSON.stringify(target.anchors.map(compactPlace))}`,
    `Anchor area/city/coordinates: ${JSON.stringify(anchorAreas)}`,
    `Current timing/duration: ${target.assessment.visitMinutes} visit minutes plus ${target.assessment.movementMinutes} movement minutes.`,
    `Remaining useful capacity: ${target.assessment.remainingUsefulCapacityMinutes} minutes after internal buffer.`,
    `User pace/preferences and party context: infer from the confirmed request above; choose comfortable, coherent, substantive additions for the same area or same direction.`,
    `Already scheduled places: ${JSON.stringify(target.day.stops.map((stop) => stop.placeId))}`,
    `Rejected or inappropriate existing candidates: ${JSON.stringify(target.rejectedCandidateIds)}`,
    "Return normal Research Batch places with coordinates, evidence, schedulingEligibility, relationships, place intelligence, and stable identities. Research finds candidates only; the planner will decide what to schedule."
  ].join("\n");
}

function assessDay(day: BlueprintItineraryDay, movements: BlueprintMovement[], placeById: Map<string, BlueprintPlace>): DayPlanningAssessment {
  const visitMinutes = visitDurationMinutes(day, placeById);
  const movementMinutes = movements.filter((movement) => movement.dayId === day.id).reduce((sum, movement) => sum + (movement.durationMinutes ?? 0), 0);
  const fixedCommitmentMinutes = fixedCommitmentDurationMinutes(day);
  const usefulCapacityMinutes = usefulCapacityForDay(day);
  const consumed = visitMinutes + movementMinutes + fixedCommitmentMinutes + DAY_INTERNAL_BUFFER_MINUTES;
  const remainingUsefulCapacityMinutes = Math.max(0, usefulCapacityMinutes - consumed);
  const intensity = experienceIntensity(day, placeById, visitMinutes);
  const lightReason = intentionalLightReason(day, visitMinutes, fixedCommitmentMinutes, intensity);
  if (consumed > OVERPLANNED_TOTAL_MINUTES) {
    return assessment(day, "OVER_PLANNED", visitMinutes, movementMinutes, usefulCapacityMinutes, remainingUsefulCapacityMinutes, fixedCommitmentMinutes, intensity, "The visible plan plus movement and internal buffer exceeds a comfortable day.");
  }
  if (lightReason) {
    return assessment(day, "INTENTIONALLY_LIGHT", visitMinutes, movementMinutes, usefulCapacityMinutes, remainingUsefulCapacityMinutes, fixedCommitmentMinutes, intensity, lightReason);
  }
  if (day.kind === "scheduled" && day.stops.length > 0 && visitMinutes === 0) {
    return assessment(day, "UNDER_PLANNED", visitMinutes, movementMinutes, usefulCapacityMinutes, remainingUsefulCapacityMinutes, fixedCommitmentMinutes, intensity, "Scheduled day is missing enough duration information for automatic day-completion research.", "COMPOSITION_FAILURE");
  }
  if (day.kind !== "scheduled") {
    const cause: UnderPlannedCause = hasDependencyGap(day) ? "DEPENDENCY_GAP" : "COMPOSITION_FAILURE";
    return assessment(day, "UNDER_PLANNED", visitMinutes, movementMinutes, usefulCapacityMinutes, remainingUsefulCapacityMinutes, fixedCommitmentMinutes, intensity, "Non-sightseeing day lacks enough concrete logistics to justify preserving the full day.", cause);
  }
  if (remainingUsefulCapacityMinutes >= MEANINGFUL_UNUSED_CAPACITY_MINUTES && visitMinutes + movementMinutes < MIN_SUBSTANTIVE_DAY_MINUTES) {
    const cause: UnderPlannedCause = hasDependencyGap(day) ? "DEPENDENCY_GAP" : "CANDIDATE_GAP";
    return assessment(day, "UNDER_PLANNED", visitMinutes, movementMinutes, usefulCapacityMinutes, remainingUsefulCapacityMinutes, fixedCommitmentMinutes, intensity, "Normal sightseeing day has material unused capacity after internal buffer.", cause);
  }
  return assessment(day, "WELL_PLANNED", visitMinutes, movementMinutes, usefulCapacityMinutes, remainingUsefulCapacityMinutes, fixedCommitmentMinutes, intensity, "The day has enough concrete place time and movement for its usable window.");
}

function assessment(
  day: BlueprintItineraryDay,
  classification: DayPlanningClassification,
  visitMinutes: number,
  movementMinutes: number,
  usefulCapacityMinutes: number,
  remainingUsefulCapacityMinutes: number,
  fixedCommitmentMinutes: number,
  experienceIntensity: DayPlanningAssessment["experienceIntensity"],
  reason: string,
  cause?: UnderPlannedCause
): DayPlanningAssessment {
  return { dayId: day.id, date: day.date, classification, visitMinutes, movementMinutes, usefulCapacityMinutes, remainingUsefulCapacityMinutes, fixedCommitmentMinutes, experienceIntensity, reason, ...(cause ? { cause } : {}) };
}

function visitDurationMinutes(day: BlueprintItineraryDay, placeById: Map<string, BlueprintPlace>): number {
  if (day.blocks?.length) {
    return day.blocks
      .filter((block) => block.kind === "stop" || block.kind === "meal" || block.kind === "event")
      .reduce((sum, block) => sum + (block.durationMinutes ?? (block.placeId ? placeById.get(block.placeId)?.durationMinutes ?? 0 : 0)), 0);
  }
  return day.stops.reduce((sum, stop) => sum + (placeById.get(stop.placeId)?.durationMinutes ?? 0), 0);
}

function fixedCommitmentDurationMinutes(day: BlueprintItineraryDay): number {
  return (day.blocks ?? []).reduce((sum, block) => {
    if (block.kind !== "transfer" && block.kind !== "lodging" && block.kind !== "event") return sum;
    return sum + (block.durationMinutes ?? 0);
  }, 0);
}

function usefulCapacityForDay(day: BlueprintItineraryDay): number {
  const text = dayText(day);
  if (day.kind === "rest" || day.kind === "free_time") return ARRIVAL_DEPARTURE_WINDOW_MINUTES;
  if (/\b(arriv|depart|airport|flight|check-?out|immigration|customs)\b/i.test(text)) return ARRIVAL_DEPARTURE_WINDOW_MINUTES;
  return NORMAL_SIGHTSEEING_WINDOW_MINUTES;
}

function intentionalLightReason(day: BlueprintItineraryDay, visitMinutes: number, fixedCommitmentMinutes: number, intensity: DayPlanningAssessment["experienceIntensity"]): string | undefined {
  const text = dayText(day);
  if (/\b(arriv|airport|immigration|customs)\b/i.test(text)) return "Arrival logistics create a short usable travel window.";
  if (/\b(depart|flight leaves|checkout|check-out|airport journey)\b/i.test(text)) return "Departure logistics create a short usable travel window.";
  if (visitMinutes >= 360 || intensity === "high") return "A long or high-intensity scheduled experience consumes the practical sightseeing day.";
  if (fixedCommitmentMinutes >= 240) return "A fixed commitment consumes most of the practical sightseeing day.";
  if (day.kind === "rest" && /\b(user requested|explicit|medical|mobility|recovery from overnight|overnight flight)\b/i.test(text)) return "The rest day is tied to an explicit traveler or physical constraint.";
  return undefined;
}

function hasDependencyGap(day: BlueprintItineraryDay): boolean {
  return /\b(lodging not selected|hotel not selected|base|baggage|check-?in|check-?out|transfer pending|pickup pending|route pending|meeting point|reservation required|ticket required)\b/i.test(dayText(day));
}

function experienceIntensity(day: BlueprintItineraryDay, placeById: Map<string, BlueprintPlace>, visitMinutes: number): DayPlanningAssessment["experienceIntensity"] {
  const text = normalize(`${day.title} ${day.summary} ${(day.blocks ?? []).map((block) => `${block.title ?? ""} ${block.summary ?? ""}`).join(" ")}`);
  if (visitMinutes >= 360 || /\b(waterbom|water park|full-day|cooking class|class|workshop|hike|trek|festival|performance)\b/.test(text)) return "high";
  if (day.stops.some((stop) => /\b(temple|museum|rice|terrace|archaeological|sanctuary|palace|forest)\b/.test(normalize(`${placeById.get(stop.placeId)?.category ?? ""} ${placeById.get(stop.placeId)?.visitRole ?? ""}`)))) return "moderate";
  return visitMinutes >= 180 ? "moderate" : "light";
}

function existingCompletionCandidates(
  day: BlueprintItineraryDay,
  anchors: BlueprintPlace[],
  research: ResearchSet,
  relationships: BlueprintPlaceRelationship[],
  scheduledPlaceIds: Set<string>,
  assessment: DayPlanningAssessment
): BlueprintPlace[] {
  const explicit = new Set(day.candidatePlaceIds);
  const related = new Set<string>();
  for (const relationship of relationships) {
    if (!["same_area", "same_direction", "supports_anchor", "rainy_day_alternative", "low_energy_alternative", "similar"].includes(relationship.kind)) continue;
    for (const anchor of anchors) {
      if (relationship.fromPlaceId === anchor.id) related.add(relationship.toPlaceId);
      if (relationship.toPlaceId === anchor.id) related.add(relationship.fromPlaceId);
    }
  }
  return research.places
    .filter((place) => !scheduledPlaceIds.has(place.id))
    .filter((place) => eligibleForCompletion(place, day, assessment))
    .map((place) => ({ place, score: completionCandidateScore(place, anchors, explicit, related) }))
    .filter((item) => item.score >= 2)
    .sort((left, right) => right.score - left.score)
    .slice(0, 4)
    .map((item) => item.place);
}

function eligibleForCompletion(place: BlueprintPlace, day: BlueprintItineraryDay, assessment: DayPlanningAssessment): boolean {
  const decision = place.schedulingEligibility?.decision;
  if (decision === "blocked" || decision === "high_impact" || decision === "informational") return false;
  const duration = place.durationMinutes ?? 90;
  if (duration > Math.max(90, assessment.remainingUsefulCapacityMinutes + 60)) return false;
  const blocked = place.schedulingEligibility?.blockedDayIds ?? [];
  if (blocked.includes(day.id)) return false;
  const suitable = place.schedulingEligibility?.suitableDayIds ?? [];
  if (suitable.length && !suitable.includes(day.id)) return false;
  return true;
}

function completionCandidateScore(place: BlueprintPlace, anchors: BlueprintPlace[], explicit: Set<string>, related: Set<string>): number {
  let score = 0;
  if (explicit.has(place.id)) score += 3;
  if (related.has(place.id)) score += 3;
  for (const anchor of anchors) {
    if (sameText(place.area, anchor.area)) score += 2;
    if (sameText(place.city, anchor.city)) score += 1;
    if (coordinatesNearby(place, anchor)) score += 2;
  }
  if (place.priority === "must" || place.priority === "preferred") score += 1;
  if (isComplementary(place, anchors)) score += 1;
  return score;
}

function isComplementary(place: BlueprintPlace, anchors: BlueprintPlace[]): boolean {
  const category = normalize(place.category);
  return anchors.some((anchor) => normalize(anchor.category) !== category);
}

function targetedCompletionScopeLabel(day: BlueprintItineraryDay, anchors: BlueprintPlace[]): string {
  const anchor = anchors[0];
  const area = anchor?.area || anchor?.city || day.city;
  return `${day.date} day completion near ${area}`;
}

function compactPlace(place: BlueprintPlace) {
  return {
    id: place.id,
    name: place.name,
    area: place.area,
    city: place.city,
    category: place.category,
    coordinates: place.coordinates,
    durationMinutes: place.durationMinutes,
    visitRole: place.visitRole,
    schedulingEligibility: place.schedulingEligibility
  };
}

function coordinatesNearby(left: BlueprintPlace, right: BlueprintPlace): boolean {
  if (!left.coordinates || !right.coordinates) return false;
  return haversineKm(left.coordinates, right.coordinates) <= 18;
}

function haversineKm([lat1, lon1]: [number, number], [lat2, lon2]: [number, number]): number {
  const radius = 6371;
  const dLat = radians(lat2 - lat1);
  const dLon = radians(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLon / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function radians(value: number): number {
  return value * Math.PI / 180;
}

function sameText(left: string | undefined, right: string | undefined): boolean {
  return Boolean(left?.trim() && right?.trim() && normalize(left) === normalize(right));
}

function dayText(day: BlueprintItineraryDay): string {
  return `${day.kind} ${day.title} ${day.summary} ${(day.blocks ?? []).map((block) => `${block.kind} ${block.title ?? ""} ${block.summary ?? ""} ${block.role ?? ""}`).join(" ")}`;
}

function normalize(value: string | undefined): string {
  return (value ?? "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}
