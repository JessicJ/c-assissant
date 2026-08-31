import type { ConnectorResult, PlaceFact } from "@c-assistant/connectors";
import type { Plan, PlanPlace } from "@c-assistant/core";

interface VenueMonitorDependencies {
  searchPlaces(input: { query: string; region?: string; limit?: number }): Promise<ConnectorResult<PlaceFact[]>>;
}

export interface VenueStatusAttention {
  placeId: string;
  placeName: string;
  status: "temporarily_closed" | "permanently_closed";
  observedAt: string;
  title: string;
  body: string;
  officialUrl?: string;
}

/** Limits monitoring to important venues scheduled within the next fourteen days. */
export function upcomingVenueChecks(plan: Plan, now = new Date()): Array<{ place: PlanPlace; city?: string }> {
  if (!plan.presentation || plan.presentation.kind !== "itinerary") return [];
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const end = start + 14 * 24 * 60 * 60_000;
  const places = new Map(plan.presentation.places.map((place) => [place.id, place]));
  const checks = new Map<string, { place: PlanPlace; city?: string }>();
  for (const day of plan.presentation.days) {
    const dayStart = parseDay(day.date ?? day.shortLabel ?? day.label, plan.presentation.startDate);
    if (dayStart === undefined || dayStart < start || dayStart > end) continue;
    for (const placeId of day.placeIds) {
      const place = places.get(placeId);
      if (!place || !isMonitorableVenue(place)) continue;
      checks.set(place.id, { place, ...(day.city || place.city ? { city: day.city || place.city } : {}) });
    }
  }
  return [...checks.values()].slice(0, 8);
}

/** Checks provider business status and emits only temporary or permanent closure attention. */
export async function checkPlanVenueStatuses(input: { plan: Plan; now?: Date; dependencies: VenueMonitorDependencies }): Promise<{ checked: number; attentions: VenueStatusAttention[] }> {
  const checks = upcomingVenueChecks(input.plan, input.now);
  const attentions: VenueStatusAttention[] = [];
  for (const { place, city } of checks) {
    const result = await input.dependencies.searchPlaces({ query: place.name, ...(city ? { region: city } : {}), limit: 3 });
    if (result.status !== "available" || !result.data) continue;
    const match = result.data.find((candidate) => sameVenue(candidate.name, place.name));
    if (!match || (match.businessStatus !== "temporarily_closed" && match.businessStatus !== "permanently_closed")) continue;
    const permanent = match.businessStatus === "permanently_closed";
    attentions.push({
      placeId: place.id,
      placeName: place.localizedName ?? place.name,
      status: match.businessStatus,
      observedAt: result.observedAt,
      title: `${place.localizedName ?? place.name} may be ${permanent ? "permanently closed" : "temporarily closed"}`,
      body: `Google Places currently marks this location as ${permanent ? "permanently closed" : "temporarily closed"}. Landi has not removed it automatically. Check the official listing before deciding whether to replace the day's activity.`,
      ...(place.officialUrl || place.bookingUrl ? { officialUrl: place.officialUrl ?? place.bookingUrl } : {})
    });
  }
  return { checked: checks.length, attentions };
}

function isMonitorableVenue(place: PlanPlace): boolean {
  if (place.priority !== "must" && place.priority !== "preferred" && place.priority !== "booked") return false;
  return !/accommodation|hotel|lodging|airport|station|住宿|酒店|机场|车站/i.test(`${place.category} ${place.name}`);
}

function sameVenue(left: string, right: string): boolean {
  const normalize = (value: string) => value.toLocaleLowerCase().replace(/[^a-z0-9\p{L}\p{N}]+/gu, "");
  const a = normalize(left);
  const b = normalize(right);
  return Boolean(a && b && (a === b || a.includes(b) || b.includes(a)));
}

function parseDay(value: string, startDate?: string): number | undefined {
  const iso = value.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const year = startDate?.match(/^\s*(\d{4})-/)?.[1];
  const monthDay = value.match(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})\b/i);
  if (!year || !monthDay) return undefined;
  const month = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(monthDay[1]!.slice(0, 3).toLowerCase());
  return month < 0 ? undefined : Date.UTC(Number(year), month, Number(monthDay[2]));
}
