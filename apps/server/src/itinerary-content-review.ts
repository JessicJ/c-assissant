import { effectiveBlueprintSchedulingDecision, type BlueprintItineraryDay, type BlueprintPlace, type TripBlueprint } from "@c-assistant/core";
import { isGateway } from "./gateway-node-completion.js";

export interface ContentFinding {
  code: string;
  date?: string;
  explanation: string;
  repairInstruction: string;
}

const cityKey = (value: string) => value.normalize("NFKC").toLocaleLowerCase().replace(/[\p{P}\p{Z}]+/gu, " ").trim();
const committed = (day: BlueprintItineraryDay) => (day.blocks ?? []).filter((block) => block.planRole !== "optional" && block.planRole !== "replacement");

/** Day choices are a view of the catalog, never a reason to delete catalog records. */
export function normalizeDayCandidates(blueprint: TripBlueprint): TripBlueprint {
  const places = new Map(blueprint.places.map((place) => [place.id, place]));
  const next = structuredClone(blueprint);
  for (const day of next.days) {
    const blocks = committed(day);
    const scheduled = new Set([...day.stops.map((stop) => stop.placeId), ...blocks.flatMap((block) => block.placeId ? [block.placeId] : [])]);
    const anchors = [...scheduled].flatMap((id) => places.get(id) ? [places.get(id)!] : []);
    const accepted: BlueprintPlace[] = [];
    const cities = new Set([
      day.city,
      ...day.city.split(/\s+(?:to|and|via)\s+|\s*[→/、]\s*/iu),
      ...[...scheduled].flatMap((id) => places.get(id)?.city ? [places.get(id)!.city!] : [])
    ].map(cityKey).filter(Boolean));
    const inFlight = day.kind === "transit" && !scheduled.size && /in.flight|overnight.*flight|international transit|跨日飞行|飞行中/iu.test(`${day.city} ${day.title} ${day.summary}`);
    day.candidatePlaceIds = [...new Set(day.candidatePlaceIds)].filter((id) => {
      const place = places.get(id);
      if (inFlight || !place || scheduled.has(id) || [...anchors, ...accepted].some((other) => samePlace(place, other))) return false;
      const eligibility = place.schedulingEligibility;
      if (["blocked", "informational"].includes(effectiveBlueprintSchedulingDecision(place) ?? "")) return false;
      if (eligibility?.blockedDayIds?.includes(day.id)) return false;
      if (eligibility?.suitableDayIds?.length && !eligibility.suitableDayIds.includes(day.id)) return false;
      const connected = (blueprint.guideRelationshipGraph?.relationships ?? []).some((link) =>
        (!link.dayIds?.length || link.dayIds.includes(day.id)) && link.kind !== "similar" &&
        ((link.fromPlaceId === id && scheduled.has(link.toPlaceId)) || (link.toPlaceId === id && scheduled.has(link.fromPlaceId))));
      // A researched day-specific relationship may describe a genuine out-of-town excursion.
      const nearby = anchors.some((anchor) => distanceKm(place, anchor) <= 25);
      // Unknown city does not justify silently excluding useful research.
      const eligible = connected || eligibility?.suitableDayIds?.includes(day.id) || nearby || !place.city?.trim() || cities.has(cityKey(place.city));
      if (eligible) accepted.push(place);
      return eligible;
    });
  }
  return next;
}

/** Practical content checks supplement the structural and timing validators. */
export function reviewItineraryContent(blueprint: TripBlueprint): ContentFinding[] {
  const findings: ContentFinding[] = [];
  const places = new Map(blueprint.places.map((place) => [place.id, place]));
  for (const day of blueprint.days) {
    if (day.kind === "rest" || day.kind === "free_time") continue;
    const blocks = committed(day).sort((a, b) => a.order - b.order);
    const formalPlaceIds = new Set(blocks.filter((block) => block.kind !== "transfer").flatMap((block) => block.placeId ? [block.placeId] : []));
    const implicitGateways = [...new Set(blocks.filter((block) => block.kind === "transfer" && block.placeId &&
      places.get(block.placeId) && (isGateway(places.get(block.placeId)!, "airport") || isGateway(places.get(block.placeId)!, "station")) && !formalPlaceIds.has(block.placeId))
      .map((block) => block.placeId!))];
    if (implicitGateways.length) findings.push({ code: "missing_transport_occurrence", date: day.date,
      explanation: `${day.date} mentions ${implicitGateways.map((id) => places.get(id)!.name).join(" / ")} only inside transfer blocks, so the formal route omits the actual boarding or arrival node.`,
      repairInstruction: "Add the referenced airport/station as a formal stop at the correct position between ground and intercity legs. Connect the actual adjacent physical nodes; keep unbooked service times provisional. Do not substitute an airport hotel for a terminal." });
    const timed = blocks.filter((block) => block.kind !== "lodging" && block.startTime);
    const starts = timed.map((block) => minutes(block.startTime)).filter((time): time is number => time !== undefined);
    const ends = timed.map((block) => minutes(block.endTime) ?? (minutes(block.startTime)! + (block.durationMinutes ?? (block.placeId ? places.get(block.placeId)?.durationMinutes : undefined) ?? 0)));
    const visits = blocks.filter((block) => ["stop", "event", "meal"].includes(block.kind));
    const mealOrBreak = blocks.some((block) => block.kind === "meal" || block.kind === "rest" ||
      /\b(?:lunch|picnic|meal break|food stop)\b|午餐|午饭|野餐|用餐休息/iu.test(`${block.title ?? ""} ${block.summary ?? ""}`) ||
      (block.placeId && isDining(places.get(block.placeId))));
    if (visits.length >= 2 && starts.length && Math.min(...starts) <= 11 * 60 && Math.max(...ends) >= 15 * 60 && Math.max(...ends) - Math.min(...starts) >= 6 * 60 && !mealOrBreak) {
      findings.push({ code: "missing_midday_break", date: day.date,
        explanation: `${day.date} spans at least six daytime hours across lunch with several visits, but its timeline has no meal or rest arrangement.`,
        repairInstruction: "Add a practical meal arrangement between compatible activities, preferring a concrete researched restaurant near the adjacent attraction or current area. Respect dietary needs and budget; avoid detours and duplicate meal blocks. A recommendation is not a booking. If a tour supplies lunch or a remote excursion needs packed food, retain that arrangement. Only use a generic meal window when no credible nearby candidate exists; do not invent a restaurant or force a quota. Preserve verified and traveler-confirmed commitments." });
    }
    const luggageClaim = /(?:drop|leave|store)[^.。]{0,45}(?:luggage|bags)[^.。]{0,45}(?:hotel|accommodation)|(?:hotel|accommodation)[^.。]{0,45}(?:drop|leave|store)[^.。]{0,45}(?:luggage|bags)|酒店[^。]{0,30}(?:寄存|放下|存放)行李/iu.test(day.summary);
    const firstVisit = blocks.findIndex((block) => block.kind === "stop" && block.placeId && !isGateway(places.get(block.placeId), "airport") && !isGateway(places.get(block.placeId), "station"));
    const implicitHotel = blocks.slice(0, firstVisit < 0 ? 0 : firstVisit).find((block) => block.kind === "transfer" && block.placeId && places.get(block.placeId)?.accommodation && !formalPlaceIds.has(block.placeId));
    // A hotel appearing only at the end still needs a distinct luggage-drop occurrence before sightseeing.
    const hotelDropTransfer = blocks.slice(0, firstVisit < 0 ? 0 : firstVisit).find((block) => block.kind === "transfer" && block.placeId && places.get(block.placeId)?.accommodation &&
      !blocks.slice(0, firstVisit).some((earlier) => earlier.kind === "lodging" && earlier.placeId === block.placeId));
    if (firstVisit >= 0 && ((luggageClaim && !blocks.slice(0, firstVisit).some((block) => block.kind === "lodging")) || implicitHotel || hotelDropTransfer)) findings.push({
      code: "missing_luggage_drop_node", date: day.date,
      explanation: `${day.date} promises a hotel luggage drop before sightseeing, but the timeline goes straight from the arrival gateway to the visit.`,
      repairInstruction: "Include the selected/recommended hotel as the luggage-drop occurrence before the first visit and connect both ground legs. Keep early check-in conditional; luggage storage does not imply the room is available." });
  }
  return findings;
}

function minutes(time?: string): number | undefined {
  if (!time || !/^\d{2}:\d{2}$/u.test(time)) return undefined;
  const [hour, minute] = time.split(":").map(Number);
  return hour! < 24 && minute! < 60 ? hour! * 60 + minute! : undefined;
}

function isDining(place?: BlueprintPlace): boolean {
  return Boolean(place && (place.display?.type === "dining" || /restaurant|cafe|café|dining|餐厅|餐馆/iu.test(place.category)));
}

function samePlace(a: BlueprintPlace, b: BlueprintPlace): boolean {
  if (cityKey(a.name) !== cityKey(b.name)) return false;
  if (distanceKm(a, b) < 0.15) return true;
  return Boolean(a.city && b.city && cityKey(a.city) === cityKey(b.city) && a.officialUrl && b.officialUrl && a.officialUrl.replace(/\/$/u, "") === b.officialUrl.replace(/\/$/u, ""));
}

/** Geographic proximity supports candidate locality only; it never becomes a road time or route. */
function distanceKm(a: BlueprintPlace, b: BlueprintPlace): number {
  if (!a.coordinates || !b.coordinates) return Infinity;
  const radians = Math.PI / 180;
  const [lat1, lon1] = a.coordinates.map((value) => value * radians);
  const [lat2, lon2] = b.coordinates.map((value) => value * radians);
  const h = Math.sin((lat2! - lat1!) / 2) ** 2 + Math.cos(lat1!) * Math.cos(lat2!) * Math.sin((lon2! - lon1!) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}

export const ITINERARY_CONTENT_REQUIREMENTS = `Before returning the itinerary, review the full trip as a traveler would use it. Compare viable regional sequences and avoid unexplained repeated base changes; preserve confirmed arrival/departure, bookings, party size and date boundaries. A purposeful return for a fixed flight is valid. Give each day a coherent purpose and realistic transport burden, not a numeric attraction quota. Include lunch/rest opportunities in the timeline, hotel luggage drops mentioned in prose, and the operator's real meeting/boarding point (not merely the physical attraction). State an unresolved service or meeting point honestly rather than inventing one. Ordinary overnight days use a researched recommended or user-selected hotel; camping and overnight transport remain explicit exceptions. Candidate lists contain distinct, day-compatible alternatives, excluding already scheduled places. Preserve the complete Research Set catalog. Same-place cards and details use the shared place images. Missing images or noncritical evidence do not invalidate a useful route.`;
