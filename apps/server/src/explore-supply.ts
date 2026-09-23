import type { BlueprintPlace, ResearchSet, TripBlueprint } from "@c-assistant/core";

export interface ExploreSupplyAssessment {
  destinationDayCount: number;
  scheduledPlaceIds: string[];
  unscheduledPlaceIds: string[];
  actionablePlaceIds: string[];
  logisticsPlaceIds: string[];
  mainAreas: string[];
  uncoveredAreas: string[];
  choiceTypes: string[];
  needsSupplement: boolean;
  reasons: string[];
}

export function assessExploreSupply(blueprint: TripBlueprint): ExploreSupplyAssessment {
  const placeById = new Map(blueprint.places.map((place) => [place.id, place] as const));
  const scheduledPlaceIds = [...new Set(blueprint.days.flatMap((day) => day.stops.map((stop) => stop.placeId)))];
  const scheduled = new Set(scheduledPlaceIds);
  const logisticsPlaceIds = blueprint.places.filter(isLogisticsPlace).map((place) => place.id);
  const logistics = new Set(logisticsPlaceIds);
  const destinationDays = blueprint.days.filter((day) => day.kind === "scheduled" && day.stops.some((stop) => !logistics.has(stop.placeId)));
  const unscheduledPlaces = blueprint.places.filter((place) => !scheduled.has(place.id) && !isLogisticsPlace(place) && place.guideDisplay?.showInGuide !== false && place.schedulingEligibility?.decision !== "informational");
  const actionablePlaces = unscheduledPlaces.filter((place) => {
    const decision = place.schedulingEligibility?.decision;
    return hasCoordinates(place) && decision !== "blocked" && decision !== "informational";
  });
  const areaCounts = new Map<string, number>();
  for (const placeId of scheduledPlaceIds) {
    const place = placeById.get(placeId);
    if (!place || isLogisticsPlace(place)) continue;
    const area = exploreArea(place);
    if (area) areaCounts.set(area, (areaCounts.get(area) ?? 0) + 1);
  }
  const mainAreas = [...areaCounts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).slice(0, 3).map(([area]) => area);
  const uncoveredAreas = mainAreas.filter((area) => !actionablePlaces.some((place) => placeMatchesArea(place, area)));
  const choiceTypes = [...new Set(actionablePlaces.map((place) => place.display?.type ?? inferredChoiceType(place)))];
  const reasons: string[] = [];
  if (destinationDays.length >= 3 && actionablePlaces.length === 0) reasons.push("The formal itinerary uses every map-ready non-logistics place.");
  if (destinationDays.length >= 3 && uncoveredAreas.length) reasons.push(`No plan-outside choices remain for ${uncoveredAreas.join(", ")}.`);
  if (destinationDays.length >= 5 && actionablePlaces.length < 4 && choiceTypes.length < 2) reasons.push("The remaining choices are too narrow to support a meaningful itinerary decision.");
  return {
    destinationDayCount: destinationDays.length,
    scheduledPlaceIds,
    unscheduledPlaceIds: unscheduledPlaces.map((place) => place.id),
    actionablePlaceIds: actionablePlaces.map((place) => place.id),
    logisticsPlaceIds,
    mainAreas,
    uncoveredAreas,
    choiceTypes,
    needsSupplement: reasons.length > 0,
    reasons
  };
}

export function buildExploreSupplyResearchRequest(baseRequest: string, blueprint: TripBlueprint, research: ResearchSet, assessment: ExploreSupplyAssessment): string {
  const scheduled = new Set(assessment.scheduledPlaceIds);
  return [
    baseRequest,
    "",
    "Bounded Explore-supply research after the formal itinerary has been accepted:",
    "The main itinerary is already valid. Research one small, plan-serving set of additional local choices only; do not redesign or restate the itinerary.",
    `Primary trip areas: ${JSON.stringify(assessment.mainAreas)}.`,
    `Areas without a useful plan-outside choice: ${JSON.stringify(assessment.uncoveredAreas)}.`,
    `Current scheduled places: ${JSON.stringify(research.places.filter((place) => scheduled.has(place.id)).map(compactPlace))}.`,
    `Current unscheduled places: ${JSON.stringify(research.places.filter((place) => !scheduled.has(place.id)).map(compactPlace))}.`,
    `Supply gaps: ${JSON.stringify(assessment.reasons)}.`,
    "Find relevant choices around the trip's actual areas, interests, party, and pace. Prefer complementary attractions, dining, local experiences, light activities, rainy-day or low-energy alternatives. Add shopping only when it fits the confirmed traveler preferences.",
    "For a multi-day trip, roughly six to eight genuinely distinct plan-outside choices may be useful, but this is context guidance, not a quota. Return fewer when only fewer strong choices can be sourced.",
    "This pass must produce choices the traveler can actually add. For every ordinary schedulable or high-impact place, verify its exact identity and return valid latitude/longitude coordinates in the coordinates field. Use informational only for genuinely useful written context that cannot be made map-ready; informational items do not satisfy this supply gap. Never guess coordinates.",
    "Do not return airports, hotels, pure transport nodes, distant generic highlights, duplicate aliases, or a place already listed above. Preserve stable external identity and source evidence through the normal Research Batch fields.",
    "All returned places are guide candidates. Keep them unscheduled; the existing formal itinerary must remain unchanged and the traveler will decide whether to add or replace anything.",
    "Return a normal rich Research Batch only. Do not return itinerary days, narrative-only recommendations, or unsupported facts."
  ].join("\n");
}

export function isLogisticsPlace(place: Pick<BlueprintPlace, "name" | "category" | "visitRole">): boolean {
  return /\b(airport|airfield|station|terminal|flight|railway|train|metro|subway|bus depot|ferry terminal|transfer|transport hub|hotel|accommodation|lodging|villa|resort|guesthouse|hostel)\b/i
    .test(`${place.name} ${place.category} ${place.visitRole ?? ""}`);
}

function compactPlace(place: BlueprintPlace) {
  return { id: place.id, name: place.name, city: place.city, area: place.area, category: place.category, displayType: place.display?.type };
}

function hasCoordinates(place: BlueprintPlace): boolean {
  return Boolean(place.coordinates && Number.isFinite(place.coordinates[0]) && Number.isFinite(place.coordinates[1]));
}

function exploreArea(place: BlueprintPlace): string {
  return (place.area ?? place.city ?? "").trim();
}

function placeMatchesArea(place: BlueprintPlace, area: string): boolean {
  const target = normalize(area);
  return [place.area, place.city, place.locationLabel].some((value) => normalize(value ?? "").includes(target));
}

function inferredChoiceType(place: BlueprintPlace): string {
  const text = `${place.category} ${place.visitRole ?? ""} ${place.name}`.toLocaleLowerCase();
  if (/restaurant|dining|food|cafe|coffee|bar|bakery|market/.test(text)) return "dining";
  if (/shop|craft|boutique|bookstore|mall/.test(text)) return "shopping";
  if (/class|workshop|tour|show|performance|spa|ceremony|cruise/.test(text)) return "experience";
  return "attraction";
}

function normalize(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
