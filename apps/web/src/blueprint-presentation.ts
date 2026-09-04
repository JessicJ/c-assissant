import type { PlanPresentation, TripBlueprint } from "@c-assistant/core";

/** Read adapter only. Trip Blueprint remains the source of truth. */
export function blueprintPresentation(blueprint: TripBlueprint): PlanPresentation {
  const sources = new Map(blueprint.sources.map((source) => [source.id, source]));
  const placeIds = new Set(blueprint.places.map((place) => place.id));
  const requirementsByPlace = new Map<string, TripBlueprint["actionRequirements"]>();
  for (const requirement of blueprint.actionRequirements) {
    if (!requirement.placeId) continue;
    requirementsByPlace.set(requirement.placeId, [...(requirementsByPlace.get(requirement.placeId) ?? []), requirement]);
  }
  const days = blueprint.days.map((day) => {
    const stops = [...day.stops]
      .sort((left, right) => left.order - right.order)
      .filter((stop, index, all) => placeIds.has(stop.placeId) && all.findIndex((candidate) => candidate.placeId === stop.placeId) === index)
      .map((stop, index) => ({ ...stop, order: index + 1 }));
    const scheduled = new Set(stops.map((stop) => stop.placeId));
    const candidates = day.candidatePlaceIds.filter((id, index, all) => placeIds.has(id) && !scheduled.has(id) && all.indexOf(id) === index);
    return {
      id: day.id,
      label: day.date,
      placeIds: stops.map((stop) => stop.placeId),
      date: day.date,
      shortLabel: day.date.slice(5),
      city: day.city,
      title: day.title,
      summary: day.summary,
      candidates,
      stops,
      ...(day.blocks ? { blocks: structuredClone(day.blocks) } : {})
    };
  });
  const dayById = new Map(days.map((day) => [day.id, day] as const));
  const routeByKey = new Map(blueprint.movements.flatMap((movement) => {
    const day = dayById.get(movement.dayId);
    if (!day || !placeIds.has(movement.originPlaceId) || !placeIds.has(movement.destinationPlaceId)) return [];
    const originIndex = day.placeIds.indexOf(movement.originPlaceId);
    if (originIndex < 0 || day.placeIds[originIndex + 1] !== movement.destinationPlaceId) return [];
    return [[`${day.id}\0${movement.originPlaceId}\0${movement.destinationPlaceId}`, movement] as const];
  }));
  const routeSegments = days.flatMap((day) => day.placeIds.slice(0, -1).map((originPlaceId, index) => {
    const destinationPlaceId = day.placeIds[index + 1]!;
    const movement = routeByKey.get(`${day.id}\0${originPlaceId}\0${destinationPlaceId}`);
    return {
      id: movement?.id ?? `${day.id}-route-${index + 1}`,
      originPlaceId,
      destinationPlaceId,
      mode: movement?.mode ?? "unknown" as const,
      verification: movement?.status === "verified" ? "verified" as const : movement?.status === "stale" ? "stale" as const : "needs_verification" as const,
      ...(movement?.durationMinutes ? { durationMinutes: movement.durationMinutes } : {}),
      ...(movement?.distanceMeters ? { distanceMeters: movement.distanceMeters } : {}),
      sourceRefs: movement?.evidence.flatMap((ref) => sources.get(ref.sourceId)?.url ?? []) ?? [],
      dayId: day.id,
      label: movement?.label ?? "Route needs verification",
      detail: movement?.detail ?? "This adjacent movement is reconstructed from the itinerary order and needs route verification before execution."
    };
  }));
  return {
    kind: "itinerary",
    summary: blueprint.summary,
    language: blueprint.language,
    startDate: blueprint.startDate,
    endDate: blueprint.endDate,
    cities: blueprint.destinations,
    ...(blueprint.moduleIdentity ? { moduleIdentity: structuredClone(blueprint.moduleIdentity) } : {}),
    ...(blueprint.guideTheme ? { guideTheme: structuredClone(blueprint.guideTheme) } : {}),
    ...(blueprint.guideRelationshipGraph ? { guideRelationshipGraph: structuredClone(blueprint.guideRelationshipGraph) } : {}),
    ...(blueprint.fieldEvidence ? { fieldEvidence: structuredClone(blueprint.fieldEvidence) } : {}),
    places: blueprint.places.map((place) => {
      const evidenceSources = place.evidence.flatMap((ref) => {
        const source = sources.get(ref.sourceId);
        return source ? [{
          title: source.title,
          url: source.url,
          role: "Trip Blueprint evidence",
          ...(ref.supports ? { supports: ref.supports } : {}),
          ...(ref.checkedAt ? { checkedAt: ref.checkedAt } : {}),
          status: ref.status
        }] : [];
      });
      const reservation = requirementsByPlace.get(place.id)?.find((requirement) => requirement.kind === "reservation");
      return {
        id: place.id,
        name: place.name,
        ...(place.localizedName ? { localizedName: place.localizedName } : {}),
        locationLabel: place.locationLabel,
        ...(place.coordinates ? { coordinates: place.coordinates } : {}),
        ...(place.city ? { city: place.city } : {}),
        ...(place.area ? { area: place.area } : {}),
        category: place.category,
        priority: place.priority,
        ...(place.display ? { display: structuredClone(place.display) } : {}),
        ...(place.schedulingEligibility ? { schedulingEligibility: structuredClone(place.schedulingEligibility) } : {}),
        ...(place.fieldEvidence ? { fieldEvidence: structuredClone(place.fieldEvidence) } : {}),
        ...(place.contentTier ? { contentTier: place.contentTier } : {}),
        ...(place.visitRole ? { visitRole: place.visitRole } : {}),
        ...(place.durationMinutes ? { durationMinutes: place.durationMinutes } : {}),
        whyWorthIt: place.whyWorthIt,
        plan: place.plan,
        ...(place.tip ? { tip: place.tip } : {}),
        detailSections: place.detailSections ?? [],
        ...(place.officialUrl ? { officialUrl: place.officialUrl } : {}),
        ...(place.bookingUrl ? { bookingUrl: place.bookingUrl } : {}),
        ...(place.mapUrl ? { mapUrl: place.mapUrl } : {}),
        ...(place.experienceUrl ? { experienceUrl: place.experienceUrl } : {}),
        ...(reservation ? { reservation: { requirement: "required" as const, verification: reservation.evidence.some((item) => item.status === "verified") ? "verified" as const : "needs_recheck" as const, note: reservation.description } } : {}),
        ...(evidenceSources.length ? { evidenceSources } : {}),
        sourceRefs: evidenceSources.map((source) => source.url)
      };
    }),
    events: blueprint.events.map((event) => ({
      id: event.id,
      title: event.title,
      description: event.description,
      ...(event.startDate ? { startDate: event.startDate } : {}),
      ...(event.endDate ? { endDate: event.endDate } : {}),
      ...(event.locationLabel ? { locationLabel: event.locationLabel } : {}),
      ...(event.placeId ? { placeId: event.placeId } : {}),
      sourceRefs: event.evidence.flatMap((ref) => sources.get(ref.sourceId)?.url ?? [])
    })),
    days,
    routeSegments
  };
}
