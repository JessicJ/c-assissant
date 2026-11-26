import type { BlueprintPlace, PlanningSession, ResearchSet, TripBlueprint } from "@c-assistant/core";

export type GatewayNodeGap = { date: string; direction: "arrival" | "departure"; description: string; nodeKind: "airport" | "station" };

const airportPattern = /\bairport\b|机场|\b(?:Haneda|Kansai|Narita|Heathrow|Gatwick|Changi|Incheon|HND|KIX|NRT|CDG|LHR|DPS|WLG|AKL)\b/iu;
const stationPattern = /\b(?:railway|train|rail)\s+station\b|\bstation\b|火车站|高铁站|动车站|铁路站|车站|(?<!机)站/iu;

function gatewayKind(value: string): GatewayNodeGap["nodeKind"] | undefined {
  if (airportPattern.test(value)) return "airport";
  if (stationPattern.test(value) || /(?:高铁|火车|动车)[^，。；;,]{0,24}[\p{Script=Han}]{2,}[东西南北](?:出发|乘车)|\b(?:train|rail)\b[^,.!?;]{0,35}\b(?:east|west|north|south|central)\b/iu.test(value)) return "station";
  return undefined;
}

/** A traveler-supplied airport or railway station must be a formal endpoint, not only prose in a transfer. */
export function gatewayNodeGaps(blueprint: TripBlueprint, session: Pick<PlanningSession, "facts">): GatewayNodeGap[] {
  const places = new Map(blueprint.places.map((place) => [place.id, place] as const));
  return (["arrival", "departure"] as const).flatMap((direction) => {
    const fact = session.facts.find((item) => item.key === direction && item.confirmed && gatewayKind(item.value));
    if (!fact) return [];
    const nodeKind = gatewayKind(fact.value)!;
    const dated = fact.value.match(/\b20\d{2}-\d{2}-\d{2}\b/u)?.[0];
    if (!dated && (nodeKind === "airport" || direction === "arrival")) return [];
    if (!dated && nodeKind === "station" && !specificStationMention(fact.value)
      && !matchesGateway(blueprint.places.filter((place) => isGateway(place, "station")), fact.value, "station")) return [];
    const date = dated ?? (direction === "arrival" ? blueprint.startDate : blueprint.endDate);
    const day = blueprint.days.find((item) => item.date === date);
    if (!day) return [];
    const blocks = [...(day.blocks ?? [])].sort((left, right) => left.order - right.order);
    const endpoint = direction === "arrival" ? blocks[0] : blocks.at(-1);
    const place = endpoint?.placeId ? places.get(endpoint.placeId) : undefined;
    const genericStation = nodeKind === "station" && !specificStationMention(fact.value);
    const plannedStationInDayCity = genericStation && Boolean(place?.city && day.city.toLocaleLowerCase().includes(place.city.toLocaleLowerCase()));
    const anchored = isGateway(place, nodeKind) && (plannedStationInDayCity || matchesGateway([place!], fact.value, nodeKind) === place);
    return anchored ? [] : [{ date, direction, description: fact.value, nodeKind }];
  });
}

function specificStationMention(value: string): boolean {
  return /[\p{Script=Han}]{2,}(?:东|西|南|北)站|[\p{Script=Han}]{2,}(?:火车|高铁|铁路)站|\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3}\s+(?:(?:Railway|Train)\s+)?Station\b/u.test(value);
}

/** Complete traveler-supplied gateway facts with researched, exact airport or station identities. */
export function addResearchedGatewayNodes(blueprint: TripBlueprint, research: ResearchSet, session: Pick<PlanningSession, "facts">): { blueprint: TripBlueprint; unresolved: GatewayNodeGap[] } {
  const gaps = gatewayNodeGaps(blueprint, session);
  if (!gaps.length) return { blueprint, unresolved: [] };
  const next = structuredClone(blueprint);
  const unresolved: GatewayNodeGap[] = [];
  for (const gap of gaps) {
    const airport = researchedGatewayForGap(blueprint, research, gap);
    const day = next.days.find((item) => item.date === gap.date);
    if (!airport || !day?.blocks?.length) { unresolved.push(gap); continue; }
    if (!next.places.some((place) => place.id === airport.id)) next.places.push(airport);
    const blocks = [...day.blocks].sort((left, right) => left.order - right.order);
    if (gap.direction === "arrival") {
      blocks.unshift({ id: `${day.id}-arrival-gateway`, kind: "stop", order: 0, placeId: airport.id,
        title: `Arrive at ${airport.name}`, summary: `Traveler-provided arrival: ${gap.description}. Allow time for arrival formalities before the first transfer.`,
        role: `arrival ${gap.nodeKind}`, evidence: airport.evidence ?? [] });
      day.stops = [{ placeId: airport.id, order: 1, role: `arrival ${gap.nodeKind}` }, ...day.stops.filter((stop) => stop.placeId !== airport.id && !next.places.find((place) => place.id === stop.placeId)?.accommodation)
        .map((stop, index) => ({ ...stop, order: index + 2 }))];
      day.startContext = { label: airport.name, status: "transport_node", placeId: airport.id };
    } else {
      while (blocks.length > 1 && blocks.at(-1)?.kind === "lodging") blocks.pop();
      const existingIndex = blocks.findIndex((block) => block.kind === "stop" && block.placeId === airport.id);
      if (existingIndex >= 0) {
        const [existing] = blocks.splice(existingIndex, 1);
        blocks.push(existing!);
      } else blocks.push({ id: `${day.id}-departure-gateway`, kind: "stop", order: blocks.length + 1, placeId: airport.id,
        title: `Depart from ${airport.name}`, summary: `Traveler-provided departure: ${gap.description}. Confirm the service, check-in deadline, and transfer margin; the service time is not arrival at the terminal.`,
        role: `departure ${gap.nodeKind}`, evidence: airport.evidence ?? [] });
      day.stops = [...day.stops.filter((stop) => !next.places.find((place) => place.id === stop.placeId)?.accommodation && stop.placeId !== airport.id), { placeId: airport.id, order: 0, role: `departure ${gap.nodeKind}` }]
        .map((stop, index) => ({ ...stop, order: index + 1 }));
      day.endContext = { label: airport.name, status: "transport_node", placeId: airport.id };
    }
    day.blocks = blocks.map((block, index) => ({ ...block, order: index + 1 }));
    const anchors = day.blocks.filter((block) => block.placeId && block.kind !== "transfer" && block.kind !== "flexible" && block.planRole !== "optional" && block.planRole !== "replacement")
      .map((block) => block.placeId!).filter((id, index, all) => !index || all[index - 1] !== id);
    next.movements = next.movements.filter((movement) => movement.dayId !== day.id || anchors.some((origin, index) => origin === movement.originPlaceId && anchors[index + 1] === movement.destinationPlaceId));
    for (let index = 0; index < anchors.length - 1; index++) {
      const originPlaceId = anchors[index]!;
      const destinationPlaceId = anchors[index + 1]!;
      if (next.movements.some((movement) => movement.dayId === day.id && movement.originPlaceId === originPlaceId && movement.destinationPlaceId === destinationPlaceId)) continue;
      let id = `${day.id}-${gap.direction}-gateway-route-${index + 1}`;
      for (let suffix = 2; next.movements.some((movement) => movement.id === id); suffix++) id = `${day.id}-${gap.direction}-gateway-route-${index + 1}-${suffix}`;
      next.movements.push({ id, dayId: day.id, originPlaceId, destinationPlaceId, mode: "unknown", status: "recheck", label: `Transfer to ${next.places.find((place) => place.id === destinationPlaceId)?.name ?? "next stop"}`,
        detail: "Confirm the local transfer and allow a practical buffer; no booked service time is implied.", evidence: [] });
    }
  }
  return { blueprint: next, unresolved };
}

/** A generic recommendation can reuse one local researched station or the station already selected in this day's route. */
export function researchedGatewayForGap(blueprint: TripBlueprint, research: Pick<ResearchSet, "places">, gap: GatewayNodeGap): BlueprintPlace | undefined {
  const candidates = research.places.filter((place) => isGateway(place, gap.nodeKind));
  const named = matchesGateway(candidates, gap.description, gap.nodeKind);
  if (named || gap.nodeKind !== "station" || specificStationMention(gap.description)) return named;
  const day = blueprint.days.find((item) => item.date === gap.date);
  if (!day) return undefined;
  const local = candidates.filter((place) => place.city && day.city.toLocaleLowerCase().includes(place.city.toLocaleLowerCase()));
  const selectedIds = new Set([...(day.blocks ?? []).flatMap((block) => block.placeId && block.planRole !== "optional" && block.planRole !== "replacement" ? [block.placeId] : []), ...day.stops.map((stop) => stop.placeId)]);
  const selected = local.filter((place) => selectedIds.has(place.id));
  return selected.length === 1 ? selected[0] : local.length === 1 ? local[0] : undefined;
}

export function correctImpossibleFlightMovements(blueprint: TripBlueprint): TripBlueprint {
  const next = structuredClone(blueprint);
  const places = new Map(next.places.map((place) => [place.id, place] as const));
  for (const movement of next.movements) {
    if (movement.mode !== "flight") continue;
    if (isAirport(places.get(movement.originPlaceId)) && isAirport(places.get(movement.destinationPlaceId))) continue;
    movement.mode = "unknown";
    movement.status = "recheck";
    movement.label = `Transfer to ${places.get(movement.destinationPlaceId)?.name ?? "next stop"}`;
    movement.detail = "Confirm the actual transport mode and duration; this is not an airport-to-airport flight leg.";
    delete movement.durationMinutes;
    delete movement.distanceMeters;
    delete movement.display;
  }
  return next;
}

export function matchesGateway(candidates: BlueprintPlace[], description: string, nodeKind: GatewayNodeGap["nodeKind"]): BlueprintPlace | undefined {
  if (nodeKind === "airport") {
    const requested = airportIdentities(description);
    // Match stable airport identity across languages; duplicate research records
    // for the same airport are not competing airports. Never infer from a city.
    if (requested.length > 1) return undefined;
    if (requested.length === 1) return candidates.find((place) => isGateway(place, "airport") && airportIdentities(place.name).includes(requested[0]!));
  }
  const normalized = description.toLocaleLowerCase().replace(/\s+/gu, " ");
  const matches = candidates.flatMap((place) => {
    const name = place.name.toLocaleLowerCase().replace(/\s+/gu, " ");
    if (normalized.includes(name)) return [{ place, score: name.length + 100 }];
    const core = name.replace(/\b(?:international|railway|train|rail|airport|station|terminal)\b|(?:国际)?机场|(?:火车|高铁|动车|铁路|车)站|站/giu, " ").trim();
    if (nodeKind === "station" && core === place.city?.toLocaleLowerCase()) return [];
    if (core.length >= 2 && normalized.includes(core)) return [{ place, score: core.length }];
    if (nodeKind === "station") return [];
    return name.split(/[^\p{L}\p{N}]+/u).some((part) => part.length >= 4 && part !== "airport" && normalized.includes(part))
      ? [{ place, score: 1 }] : [];
  });
  matches.sort((left, right) => right.score - left.score);
  if (matches[0] && (!matches[1] || matches[0].score > matches[1].score)) return matches[0].place;
  if (nodeKind === "station") return undefined;
  const cityMatches = candidates.filter((place) => place.city && normalized.includes(place.city.toLocaleLowerCase()));
  return cityMatches.length === 1 ? cityMatches[0] : undefined;
}

function airportIdentities(value: string): string[] {
  // Operator-published bilingual identities, not a city-to-airport assumption:
  // https://www.tokyo-haneda.com/zh-CHS/index.html (Haneda / 羽田 / HND)
  // https://www.kansai-airport.or.jp/cn (Kansai / 关西 / KIX)
  return [
    { id: "HND", pattern: /\b(?:Haneda|HND)\b|羽田(?:机场|機場|空港)/iu },
    { id: "KIX", pattern: /\b(?:Kansai|KIX)\b|(?:关西|關西|関西)(?:国际|國際|国際)?(?:机场|機場|空港)/iu }
  ].filter((identity) => identity.pattern.test(value)).map((identity) => identity.id);
}

export function isGateway(place: BlueprintPlace | undefined, nodeKind: GatewayNodeGap["nodeKind"]): boolean {
  return Boolean(place && !place.accommodation && !/\b(?:hotel|motel|lodge|hostel)\b/iu.test(place.category)
    && (nodeKind === "airport" ? /\bairport\b|机场/iu : /\b(?:railway|train|rail)\s+station\b|\bstation\b|火车站|高铁站|动车站|铁路站|车站|(?<!机)站/iu).test(`${place.category} ${place.name}`));
}

function isAirport(place: BlueprintPlace | undefined): boolean {
  return isGateway(place, "airport");
}
