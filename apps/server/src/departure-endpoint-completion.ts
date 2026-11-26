import type { PlanningSession, TripBlueprint } from "@c-assistant/core";
import { isGateway } from "./gateway-node-completion.js";

export function isProvisionalDepartureTransfer(block: NonNullable<TripBlueprint["days"][number]["blocks"]>[number]): boolean {
  const text = `${block.title ?? ""} ${block.role ?? ""} ${block.summary ?? ""}`;
  return block.kind === "transfer" && !block.placeId
    && /\b(?:station|airport|terminal|train|flight)\b|车站|机场|高铁|火车|航班/iu.test(text)
    && /\b(?:depart(?:ure|ing)?|return|outbound|bound)\b|返程|返回|出发|离开/iu.test(text);
}

/** A provisional return train/flight still leaves from its planned terminal, never from the hotel after it. */
export function completeDepartureEndpoint(blueprint: TripBlueprint, session: Pick<PlanningSession, "facts">): TripBlueprint {
  if (!session.facts.some((fact) => fact.confirmed && ["departure", "departure_destination"].includes(fact.key))) return blueprint;
  const lastDay = blueprint.days.at(-1);
  if (!lastDay?.blocks?.length || lastDay.date !== blueprint.endDate) return blueprint;
  const places = new Map(blueprint.places.map((place) => [place.id, place] as const));
  const blocks = [...lastDay.blocks].sort((left, right) => left.order - right.order);
  if (blocks.at(-1)?.kind !== "lodging") return blueprint;
  const gatewayIndex = blocks.map((block, index) => {
    const place = block.placeId ? places.get(block.placeId) : undefined;
    return isGateway(place, "station") || isGateway(place, "airport") ? index : -1;
  }).filter((index) => index >= 0).at(-1) ?? -1;
  if (gatewayIndex < 0) {
    const transferIndex = blocks.map((block, index) => isProvisionalDepartureTransfer(block) ? index : -1).filter(index => index >= 0).at(-1) ?? -1;
    if (transferIndex < 0 || blocks.slice(transferIndex + 1).some(block => block.kind !== "lodging" || block.role !== "overnight accommodation return")) return blueprint;
    const next = structuredClone(blueprint);
    const day = next.days.find(item => item.id === lastDay.id)!;
    day.blocks = blocks.slice(0, transferIndex + 1).map((block, index) => ({ ...block, order: index + 1 }));
    const text = `${blocks[transferIndex]!.title ?? ""} ${blocks[transferIndex]!.role ?? ""}`;
    day.endContext = { label: /airport|flight|机场|航班/iu.test(text) ? "Departure airport" : "Departure station", status: "transport_node" };
    return next;
  }
  if (gatewayIndex === blocks.length - 1) return blueprint;
  const gatewayBlock = blocks[gatewayIndex]!;
  const gateway = places.get(gatewayBlock.placeId!);
  if (!gateway) return blueprint;
  const later = blocks.slice(gatewayIndex + 1);
  if (later.some((block) => block.kind !== "lodging" && block.kind !== "transfer")) return blueprint;
  const next = structuredClone(blueprint);
  const day = next.days.find((item) => item.id === lastDay.id)!;
  const kept = blocks.slice(0, gatewayIndex + 1);
  if (gatewayBlock.kind !== "stop") kept.push({
    id: `${day.id}-provisional-departure-gateway`, kind: "stop", order: kept.length + 1,
    placeId: gateway.id, title: gateway.name,
    summary: "Use this as the provisional departure point. Confirm the actual station or airport and departure time after booking; no ticket is claimed.",
    role: "provisional departure gateway", evidence: gateway.evidence ?? []
  });
  day.blocks = kept.map((block, index) => ({ ...block, order: index + 1 }));
  day.stops = [...day.stops.filter((stop) => stop.placeId !== gateway.id && !places.get(stop.placeId)?.accommodation),
    { placeId: gateway.id, order: 0, role: "provisional departure gateway" }]
    .map((stop, index) => ({ ...stop, order: index + 1 }));
  day.endContext = { label: gateway.name, status: "transport_node", placeId: gateway.id };
  const anchors = day.blocks
    .filter((block) => block.placeId && block.planRole !== "optional" && block.planRole !== "replacement" && block.kind !== "transfer" && block.kind !== "flexible")
    .map((block) => block.placeId!)
    .filter((placeId, index, all) => index === 0 || all[index - 1] !== placeId);
  // Removing the false return also removes only movements no longer adjacent
  // in the committed physical route. Earlier legitimate hotel visits survive.
  next.movements = next.movements.filter((movement) => movement.dayId !== day.id ||
    anchors.some((origin, index) => origin === movement.originPlaceId && anchors[index + 1] === movement.destinationPlaceId));
  const before = anchors.at(-2);
  if (before && !next.movements.some((movement) => movement.dayId === day.id && movement.originPlaceId === before && movement.destinationPlaceId === gateway.id)) {
    next.movements.push({ id: `${day.id}-to-provisional-departure-gateway`, dayId: day.id,
      originPlaceId: before, destinationPlaceId: gateway.id, mode: "unknown", status: "recheck",
      label: `Travel to ${gateway.name}`, detail: "Confirm the transfer and departure time after booking.", evidence: [] });
  }
  return next;
}

export function departureReturnsToLodging(blueprint: TripBlueprint, session: Pick<PlanningSession, "facts">): boolean {
  if (!session.facts.some((fact) => fact.confirmed && ["departure", "departure_destination"].includes(fact.key))) return false;
  const day = blueprint.days.at(-1);
  if (!day?.blocks?.length || day.date !== blueprint.endDate) return false;
  const blocks = [...day.blocks].sort((left, right) => left.order - right.order);
  if (blocks.at(-1)?.kind !== "lodging") return false;
  const places = new Map(blueprint.places.map((place) => [place.id, place] as const));
  return blocks.slice(0, -1).some((block) => {
    const place = block.placeId ? places.get(block.placeId) : undefined;
    return isGateway(place, "station") || isGateway(place, "airport");
  });
}
