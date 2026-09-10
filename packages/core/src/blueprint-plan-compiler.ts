import type { Plan, PlanBlueprintLineage, Stage, StagePresentationKind, Task } from "./index.js";
import { assertTripBlueprintIntegrity, type BlueprintActionRequirement, type BlueprintBookingConstraint, type BlueprintBookingSegment, type TripBlueprint } from "./trip-blueprint.js";

export const BLUEPRINT_PLAN_COMPILER_VERSION = "1.0.0";

export interface BlueprintPlanCompilerInput {
  createdAt: string;
  compilerVersion?: string;
  completedRequirementIds?: Iterable<string>;
}

export interface BlueprintPlanCompilation {
  plan: Plan;
  lineage: PlanBlueprintLineage;
}

export function compileTripBlueprint(blueprint: TripBlueprint, input: BlueprintPlanCompilerInput): BlueprintPlanCompilation {
  assertTripBlueprintIntegrity(blueprint);
  if (!Number.isFinite(Date.parse(input.createdAt))) throw new Error("Plan compilation needs a valid creation time.");
  const compilerVersion = input.compilerVersion ?? BLUEPRINT_PLAN_COMPILER_VERSION;
  if (!compilerVersion.trim()) throw new Error("Plan compilation needs a compiler version.");
  const compilationKey = `${blueprint.id}:${blueprint.version}:${compilerVersion}`;
  const planId = stableId("plan", compilationKey);
  const completed = new Set(input.completedRequirementIds ?? []);
  const bookingConstraints = blueprint.bookingConstraints ?? [];
  const stages = [...compileBookingStages(bookingConstraints, compilationKey), ...compilePackingStages(blueprint, compilationKey, completed), ...compileStages(blueprint.actionRequirements, compilationKey, completed)];
  const recheckCount = countRechecks(blueprint);
  const bookingKnown = bookingConstraints.flatMap(bookingKnownInformation);
  const bookingAssumptions = bookingConstraints.flatMap(bookingAssumptionsForConstraint);
  const configuration = bookingConfiguration(bookingConstraints);
  const plan: Plan = {
    id: planId,
    version: 1,
    title: blueprint.title,
    location: blueprint.destinations.join(" / "),
    dates: `${blueprint.startDate} – ${blueprint.endDate}`,
    status: "draft",
    knownInformation: [
      `Trip Blueprint: ${blueprint.id} v${blueprint.version}`,
      `Destinations: ${blueprint.destinations.join(", ")}`,
      `Travel dates: ${blueprint.startDate} to ${blueprint.endDate}`,
      `Place Catalog: ${blueprint.places.length} places across ${blueprint.days.length} itinerary days`,
      ...bookingKnown
    ],
    assumptions: [
      ...(recheckCount ? [`${recheckCount} travel fact${recheckCount === 1 ? "" : "s"} or map detail${recheckCount === 1 ? "" : "s"} remain marked for recheck.`] : []),
      ...bookingAssumptions
    ],
    nextAction: "Review the complete Trip Blueprint and execution work. Confirm this Draft Plan only when both are correct.",
    configuration,
    stages,
    sources: blueprint.sources.map((source) => ({ title: source.title, authority: source.authority, url: source.url, retrievedAt: source.retrievedAt })),
    createdAt: input.createdAt
  };
  return {
    plan,
    lineage: {
      planId,
      planVersion: plan.version,
      blueprintId: blueprint.id,
      blueprintVersion: blueprint.version,
      compilerVersion,
      compilationKey,
      createdAt: input.createdAt
    }
  };
}

function compileBookingStages(constraints: BlueprintBookingConstraint[], compilationKey: string): Stage[] {
  const tasks = constraints
    .filter((constraint) => constraint.status !== "cancelled")
    .flatMap((constraint) => constraint.segments
      .filter((segment) => segment.constraintStrength !== "ignored")
      .map((segment) => compileBookingTask(constraint, segment, compilationKey)));
  if (!tasks.length) return [];
  return [{
    id: stableId("stage", `${compilationKey}:booking-constraints`),
    title: "Imported booking constraints",
    description: "Confirmed or reviewed bookings that shape the trip. These records come from traveler-imported confirmations, not from Landi booking on your behalf.",
    presentationKind: "reservations",
    tasks
  }];
}

function compileBookingTask(constraint: BlueprintBookingConstraint, segment: BlueprintBookingSegment, compilationKey: string): Task {
  const hard = segment.constraintStrength === "hard";
  const timing = [segment.startAtLocal ? `Starts ${segment.startAtLocal}` : "", segment.endAtLocal ? `ends ${segment.endAtLocal}` : ""].filter(Boolean).join("; ");
  const location = [segment.origin ? `from ${segment.origin}` : "", segment.destination ? `to ${segment.destination}` : "", segment.location ? `at ${segment.location}` : ""].filter(Boolean).join("; ");
  const reminder = hard ? bookingReminder(segment, constraint) : undefined;
  return {
    id: stableId("task", `${compilationKey}:booking:${constraint.id}:${segment.id}`),
    requirementId: `booking:${constraint.id}:${segment.id}`,
    title: hard ? `Use confirmed ${bookingTypeLabel(constraint.type)}: ${segment.title}` : `Review imported ${bookingTypeLabel(constraint.type)}: ${segment.title}`,
    description: [constraint.title, timing, location, segment.needsReviewReasons.join(" ")].filter(Boolean).join(" · "),
    owner: hard ? "external" : "user",
    status: hard ? "scheduled" : "waiting_user",
    dueLabel: segment.startAtLocal ?? segment.endAtLocal ?? "Before this booking affects the itinerary",
    preparationCategory: "booking",
    ...(reminder ? { reminder } : {})
  };
}

function bookingReminder(segment: BlueprintBookingSegment, constraint: BlueprintBookingConstraint): Task["reminder"] | undefined {
  const at = segment.startAtLocal ?? segment.endAtLocal;
  const timeZone = segment.startTimeZone ?? segment.endTimeZone;
  if (!at || !timeZone) return undefined;
  const scheduledAtLocal = subtractHoursLocal(at, 24);
  if (!scheduledAtLocal) return undefined;
  return {
    scheduledAtLocal,
    timeZone,
    purpose: `Check ${constraint.title} before it affects the trip. Landi has not changed, booked, paid, or checked in for anything.`,
    refreshFacts: []
  };
}

function bookingKnownInformation(constraint: BlueprintBookingConstraint): string[] {
  return constraint.segments
    .filter((segment) => segment.constraintStrength === "hard")
    .map((segment) => `Confirmed ${bookingTypeLabel(constraint.type)}: ${constraint.title}${segment.startAtLocal ? ` starts ${segment.startAtLocal}` : ""}${segment.endAtLocal ? ` ends ${segment.endAtLocal}` : ""}${segment.location ? ` at ${segment.location}` : ""}${segment.origin || segment.destination ? ` (${[segment.origin, segment.destination].filter(Boolean).join(" to ")})` : ""}`);
}

function bookingAssumptionsForConstraint(constraint: BlueprintBookingConstraint): string[] {
  return constraint.segments
    .filter((segment) => segment.constraintStrength === "soft")
    .map((segment) => `Imported ${bookingTypeLabel(constraint.type)} '${constraint.title}' needs review before it can constrain the itinerary.${segment.needsReviewReasons.length ? ` ${segment.needsReviewReasons.join(" ")}` : ""}`);
}

function bookingConfiguration(constraints: BlueprintBookingConstraint[]): Plan["configuration"] {
  const configuration: Plan["configuration"] = { accommodation: { status: "not_set" }, arrival: {}, transport: { preference: "plan_recommended" }, travelContext: { luggage: "unknown" } };
  const hardSegments = constraints.flatMap((constraint) => constraint.segments.map((segment) => ({ constraint, segment }))).filter(({ constraint, segment }) => constraint.status !== "cancelled" && segment.constraintStrength === "hard");
  const accommodation = hardSegments.find(({ segment }) => segment.segmentType === "hotel_stay" && (segment.location || segment.destination));
  if (accommodation) {
    configuration.accommodation = {
      status: "confirmed",
      name: accommodation.constraint.title,
      ...(accommodation.segment.location ? { address: accommodation.segment.location, location: accommodation.segment.location } : accommodation.segment.destination ? { location: accommodation.segment.destination } : {}),
      source: "user",
      updatedAt: accommodation.constraint.importedAt
    };
  }
  const arrival = hardSegments.find(({ segment }) => (segment.segmentType === "flight_leg" || segment.segmentType === "train_leg") && (segment.endAtLocal || segment.startAtLocal));
  if (arrival) {
    const expectedAtLocal = arrival.segment.endAtLocal ?? arrival.segment.startAtLocal;
    const timeZone = arrival.segment.endTimeZone ?? arrival.segment.startTimeZone;
    if (expectedAtLocal) configuration.arrival.expectedAtLocal = expectedAtLocal;
    if (timeZone) configuration.arrival.timeZone = timeZone;
  }
  if (hardSegments.some(({ segment }) => segment.segmentType === "rental_pickup" || segment.segmentType === "rental_return")) configuration.transport.preference = "plan_recommended";
  return configuration;
}

function subtractHoursLocal(value: string, hours: number): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) return undefined;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5])));
  date.setUTCHours(date.getUTCHours() - hours);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}T${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
}

type PackingItem = { id: string; title: string; description: string };

function compilePackingStages(blueprint: TripBlueprint, compilationKey: string, completed: Set<string>): Stage[] {
  const items = packingItemsForBlueprint(blueprint);
  if (!items.length) return [];
  return [{
    id: stableId("stage", `${compilationKey}:packing`),
    title: "Packing list",
    description: "Physical items to carry for this trip, derived from the trip dates, places, activities, and movement pattern.",
    presentationKind: "details",
    tasks: items.map((item) => ({
      id: stableId("task", `${compilationKey}:packing:${item.id}`),
      requirementId: `packing:${item.id}`,
      title: item.title,
      description: item.description,
      owner: "user",
      status: completed.has(`packing:${item.id}`) ? "completed" : "waiting_user",
      dueLabel: blueprint.startDate ? `Before ${blueprint.startDate}` : "Before departure",
      preparationCategory: "packing_item"
    }))
  }];
}

function packingItemsForBlueprint(blueprint: TripBlueprint): PackingItem[] {
  const text = [
    blueprint.title,
    blueprint.summary,
    blueprint.destinations.join(" "),
    ...blueprint.days.flatMap((day) => [day.city, day.title, day.summary]),
    ...blueprint.places.flatMap((place) => [place.name, place.localizedName, place.category, place.area, place.whyWorthIt, place.plan, place.tip])
  ].filter(Boolean).join(" ");
  const normalized = text.toLocaleLowerCase();
  const months = monthNumbers(blueprint);
  const multiCity = new Set(blueprint.destinations.map((destination) => destination.trim().toLocaleLowerCase()).filter(Boolean)).size > 1;
  const items: PackingItem[] = [
    { id: "passport-wallet", title: "Passport, payment cards, and a small cash wallet", description: "Keep the items you need for hotel check-in, rail tickets, reservations, and small cash-only stops in one reachable pouch." },
    { id: "phone-power", title: "Charged phone, cable, and power bank", description: "The itinerary depends on maps, booking pages, translation, and live route checks throughout the day." },
    { id: "walking-shoes-socks", title: "Broken-in walking shoes and spare socks", description: "The route combines transfers, neighborhoods, cultural stops, meals, and outdoor walking." },
    { id: "day-bag", title: "Light day bag", description: "Carry essentials while larger luggage is stored, forwarded, or left at the accommodation." }
  ];
  if (months.some((month) => month >= 9 && month <= 11)) {
    items.push({ id: "light-layer", title: "Light jacket, cardigan, or thin overshirt", description: "Autumn sightseeing can move from warm afternoons to cooler river, garden, and evening routes." });
  }
  if (months.some((month) => month >= 6 && month <= 10) || /rain|typhoon|river|garden|park|outdoor|walk/.test(normalized)) {
    items.push({ id: "rain-gear", title: "Compact umbrella or packable rain shell", description: "Useful for station transfers, gardens, and outdoor walks until a date-specific forecast is confirmed." });
  }
  if (/bath|spa|onsen|sento|laqua|hot spring/.test(normalized)) {
    items.push({ id: "bath-kit", title: "Bath kit: small towel, fresh socks, and hair tie if needed", description: "Spa and public-bath stops are easier when you can reset afterward without relying on rentals." });
  }
  if (/temple|shrine|tatami|shoes off/.test(normalized)) {
    items.push({ id: "temple-socks", title: "Clean socks for shoes-off stops", description: "Some temples, traditional spaces, and dining rooms may ask you to remove shoes." });
  }
  if (/museum|gallery|restaurant|reservation|ticket|booking|official/.test(normalized)) {
    items.push({ id: "reservation-copies", title: "Offline reservation and ticket screenshots", description: "Save timed-entry, restaurant, hotel, and transport details before each long day." });
  }
  if (multiCity || /shinkansen|rail|train|station|luggage|forward/.test(normalized)) {
    items.push({ id: "luggage-transfer-kit", title: "Luggage tag and compact lock", description: "Helpful if you use luggage forwarding, station storage, or a hotel luggage room between trip areas." });
  }
  return dedupePackingItems(items);
}

function monthNumbers(blueprint: TripBlueprint): number[] {
  const values = [blueprint.startDate, blueprint.endDate, ...blueprint.days.map((day) => day.date)];
  return values.flatMap((value) => {
    const match = /^\d{4}-(\d{2})-\d{2}$/.exec(value);
    return match ? [Number(match[1])] : [];
  });
}

function dedupePackingItems(items: PackingItem[]): PackingItem[] {
  const seen = new Set<string>();
  return items.filter((item) => !seen.has(item.id) && Boolean(seen.add(item.id)));
}

function compileStages(requirements: BlueprintActionRequirement[], compilationKey: string, completed: Set<string>): Stage[] {
  const groups = new Map<string, BlueprintActionRequirement[]>();
  for (const requirement of requirements) groups.set(stageKey(requirement), [...(groups.get(stageKey(requirement)) ?? []), requirement]);
  return [...groups.entries()].map(([key, items]) => {
    const descriptor = stageDescriptor(key);
    return {
      id: stableId("stage", `${compilationKey}:${key}`),
      title: descriptor.title,
      description: descriptor.description,
      presentationKind: descriptor.presentationKind,
      tasks: items.map((requirement) => compileTask(requirement, compilationKey, completed.has(requirement.id)))
    };
  });
}

function compileTask(requirement: BlueprintActionRequirement, compilationKey: string, isCompleted: boolean): Task {
  return {
    id: stableId("task", `${compilationKey}:${requirement.id}`),
    requirementId: requirement.id,
    title: requirement.title,
    description: requirement.description,
    owner: requirement.accountableParty === "traveler" ? "user" : requirement.accountableParty,
    status: isCompleted ? "completed" : requirement.accountableParty === "traveler" ? "waiting_user" : "scheduled",
    dueLabel: requirement.relevantAt ?? "Before this requirement affects the trip",
    preparationCategory: preparationCategory(requirement)
  };
}

function stageKey(requirement: BlueprintActionRequirement): string {
  if (requirement.kind === "reservation") return "reservations";
  if (requirement.kind === "travel_authorization") return "travel-authorization";
  if (requirement.kind === "transport") return "transport";
  if (requirement.kind === "preparation") return "preparation";
  if (requirement.kind === "time_sensitive_recheck") return "rechecks";
  return "other";
}

function stageDescriptor(key: string): { title: string; description: string; presentationKind: StagePresentationKind } {
  if (key === "reservations") return { title: "Reservations", description: "Bookings or slots that require an accountable decision or external completion.", presentationKind: "reservations" };
  if (key === "travel-authorization") return { title: "Travel authorization", description: "Entry or visa preparation whose applicability and evidence must remain explicit.", presentationKind: "details" };
  if (key === "transport") return { title: "Transport preparation", description: "Travel movements that require preparation beyond the itinerary itself.", presentationKind: "transport" };
  if (key === "preparation") return { title: "Before departure", description: "Concrete traveler or Landi preparation required before the trip.", presentationKind: "details" };
  if (key === "rechecks") return { title: "Time-sensitive rechecks", description: "Facts that Landi should verify again near their use date.", presentationKind: "details" };
  return { title: "Other trip actions", description: "Additional accountable work associated with this trip.", presentationKind: "details" };
}

function preparationCategory(requirement: BlueprintActionRequirement): NonNullable<Task["preparationCategory"]> {
  if (requirement.kind === "reservation") return "booking";
  if (requirement.kind === "travel_authorization") return "documents";
  if (requirement.kind === "preparation") return "other_predeparture";
  return "not_applicable";
}

function bookingTypeLabel(type: BlueprintBookingConstraint["type"]): string {
  return type === "accommodation" ? "accommodation"
    : type === "flight" ? "flight"
      : type === "train" ? "train"
        : type === "rental_car" ? "rental car"
          : type === "restaurant" ? "restaurant"
            : type === "event" ? "event"
              : type === "tour" ? "tour"
                : type === "ticket" ? "ticket" : "booking";
}

function countRechecks(blueprint: TripBlueprint): number {
  return blueprint.places.filter((place) => !place.coordinates || place.evidence.some((evidence) => evidence.status !== "verified")).length
    + blueprint.events.filter((event) => event.evidence.some((evidence) => evidence.status !== "verified")).length
    + blueprint.movements.filter((movement) => movement.status !== "verified").length
    + blueprint.actionRequirements.filter((requirement) => requirement.evidence.some((evidence) => evidence.status !== "verified")).length;
}

function stableId(prefix: string, value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${prefix}-${(hash >>> 0).toString(36)}`;
}
