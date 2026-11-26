import type { PlanningSession, TransportPreference, TravelBooking } from "@c-assistant/core";
import { LANDI_TRAVELER_COPY_RULES } from "@c-assistant/agent-adapters";
import {
  partySizeNumber,
  firstMatch,
  missingGenerationQuestions,
  planningSingleDate,
  planningStartDate,
  planningTravelDateRange
} from "./planning-session-facts.js";
import { formatBookingConstraintsForGeneration } from "./planning-session-proposal.js";

export function planningGenerationReuse(session: PlanningSession, currentPlanId: string): "reuse" | "conflict" | "continue" {
  if (session.status !== "draft_ready" || !session.outputPlanId) return "continue";
  return session.outputPlanId === currentPlanId ? "reuse" : "conflict";
}

export function planningPartySize(session: PlanningSession): number | undefined {
  const value = session.facts.find(fact => fact.key === "party_size" && fact.confirmed)?.value;
  const numeric = partySizeNumber(value);
  return numeric !== undefined && numeric <= 20 ? numeric : undefined;
}

export function planningTransportPreference(session: PlanningSession): TransportPreference | undefined {
  const value = session.facts.find((fact) => fact.key === "transport_preference" && fact.confirmed)?.value;
  if (!value) return undefined;
  if (value === "打车") return "taxi";
  if (value === "公共交通") return "public_transit";
  if (value === "步行") return "walking";
  if (value === "Landi推荐") return "plan_recommended";
  return undefined;
}

export function planningArrivalLocalDateTime(session: PlanningSession): string | undefined {
  const dates = session.facts.find((fact) => fact.key === "travel_dates" && fact.confirmed)?.value;
  const arrival = session.facts.find((fact) => fact.key === "arrival" && fact.confirmed)?.value;
  if (!dates || !arrival) return undefined;
  const range = planningTravelDateRange(dates);
  const arrivalClause = /(?:抵达|到达|落地|arriv(?:e|ing|al))[^；;\n]{0,160}/iu.exec(arrival)?.[0];
  const prefixedArrivalClause = /(?:^|[；;。\n])[^；;。\n]{0,100}?(?:[01]?\d|2[0-3])[:：][0-5]\d\s*(?:抵达|到达|落地|arriv(?:e|ing|al))[^；;\n]{0,160}/iu.exec(arrival)?.[0];
  const arrivalContext = prefixedArrivalClause ?? arrivalClause ?? arrival;
  const arrivalDate = planningSingleDate(arrivalContext) ?? planningSingleDate(arrival) ?? planningStartDate(dates);
  const time = firstMatch(arrivalContext, [/((?:[01]?\d|2[0-3])[:：][0-5]\d)/u]);
  if (!range || !arrivalDate || arrivalDate < range.startDate || arrivalDate > range.endDate || !time) return undefined;
  return `${arrivalDate}T${time.replace("：", ":").padStart(5, "0")}`;
}

/** 生成与恢复共享版本确认断言；生命周期状态不能替代精确版本确认。 */
export function assertPlanningGenerationProposal(session: PlanningSession): asserts session is PlanningSession & {
  proposal: NonNullable<PlanningSession["proposal"]>;
  confirmedProposalVersion: number;
} {
  if (!session.proposal || !["proposal_confirmed", "generating"].includes(session.status)
    || !Number.isInteger(session.confirmedProposalVersion) || (session.confirmedProposalVersion ?? 0) < 1
    || session.confirmedProposalVersion !== session.proposal.version) {
    throw new Error("A confirmed planning proposal is required before Plan generation.");
  }
}

/** Same-day trips need lodging only when the traveler explicitly requested it. */
export function planningAccommodationRequired(session: Pick<PlanningSession, "facts">): boolean {
  const dates = session.facts.find(fact => fact.key === 'travel_dates' && fact.confirmed && fact.source === 'user');
  const range = dates ? planningTravelDateRange(dates.value) : undefined;
  if (!range || range.startDate !== range.endDate) return true;
  const accommodation = session.facts.find(fact => fact.key === 'accommodation' && fact.confirmed && fact.source === 'user');
  if (!accommodation?.value.trim()) return false;
  return !/^(?:(?:当天|当日|本次|这次|今日)\s*)?(?:不需要|无需|不需|不用)(?:安排)?(?:住宿|酒店|住酒店)[。.!！]?$/u.test(accommodation.value.trim())
    && !/^(?:(?:no|without)\s+(?:overnight\s+)?(?:accommodation|lodging|hotel)(?:\s+(?:is\s+)?(?:needed|required))?|(?:accommodation|lodging|hotel)(?:\s+is)?\s+not\s+(?:needed|required))[.!]?$/iu.test(accommodation.value.trim());
}

export function planningRequestForGeneration(session: PlanningSession): string {
  return planningRequestForGenerationWithBookings(session);
}

export function planningRequestForGenerationWithBookings(session: PlanningSession, bookings: TravelBooking[] = []): string {
  assertPlanningGenerationProposal(session);
  const unresolved = missingGenerationQuestions(session.facts, session.messages);
  if (unresolved.length) throw new Error(`Complete the generation-critical facts before Plan generation: ${unresolved.map((item) => item.key).join(", ")}.`);
  const facts = session.facts.map((fact) => `- ${fact.key}: ${fact.value}`).join("\n");
  const travelDates = session.facts.find((fact) => fact.key === "travel_dates" && fact.confirmed)?.value;
  const dateRange = travelDates ? planningTravelDateRange(travelDates) : undefined;
  if (!dateRange) throw new Error("Complete the generation-critical facts before Plan generation: travel_dates.");
  const proposal = session.proposal;
  const bookingConstraints = formatBookingConstraintsForGeneration(bookings);
  return [
    "Generate the complete Landi Plan from this user-approved planning proposal.",
    LANDI_TRAVELER_COPY_RULES,
    "Do not change the approved objective or scope. Make reasonable assumptions explicit in the Plan.",
    "Treat accepted hard booking constraints as fixed real-world commitments that outrank natural-language preferences. Soft booking constraints are review context only. Never include confirmation codes, traveler names, payment details, or original email bodies in the Plan.",
    planningAccommodationRequired(session) || bookings.some(booking => booking.status !== 'cancelled' && booking.segments.some(segment => segment.status !== 'cancelled' && segment.segmentType === 'hotel_stay'))
      ? "Accommodation continuity rule: each destination night needs an overnight base, and the next morning starts there. Preserve any accepted hotel booking. If no hotel was supplied, use a specific researched recommended property as a provisional, not-booked base; do not ask the traveler to name a hotel just to plan the route."
      : "Same-day trip rule: this confirmed trip has no destination night and no requested accommodation. Use the confirmed arrival and departure points as its route boundaries. Do not research or add hotel recommendations, overnight anchors, or accommodation-selection placeholders.",
    "Unbooked transport rule: when tickets are not booked, use the confirmed origin and return destination to make a provisional route. Do not invent a booked train, flight, exact station, terminal, arrival time, or departure time. End the final day's route at a sensible transport node if one is known; otherwise label the departure point to confirm, and never route back to a hotel after departure.",
    "Budget fidelity rule: use a confirmed budget_scope fact exactly. Never assume whether a stated total includes international flights. If priced route options cannot be shown to fit, describe the cost gap and offer a smaller route rather than declaring the plan affordable.",
    "Destination strategy rule: first identify the destination's defining travel experiences and the regions that provide them. Compare plausible regional routes against the trip length, confirmed gateways, transport and complete party-level costs before selecting overnight bases or daily stops. An entry/exit city is a transport constraint, not an instruction to stay in that city throughout. Do not narrow a country trip to its gateway solely because intercity costs are unknown.",
    `Objective: ${proposal.objective}`,
    `Theme: ${proposal.theme}`,
    `Known facts:\n${facts}`,
    `Confirmed internal travel date range (date-only; authoritative for itinerary days): ${dateRange.startDate} to ${dateRange.endDate}`,
    `Accepted booking constraints:\n${bookingConstraints || "- None imported."}`,
    `Approved segments:\n${proposal.segments.map((item) => `- ${item}`).join("\n")}`,
    `Approved skeleton:\n${proposal.skeleton.map((item) => `- ${item}`).join("\n")}`,
    `Trade-offs to preserve:\n${proposal.tradeoffs.map((item) => `- ${item}`).join("\n")}`,
    `Open assumptions:\n${proposal.assumptions.map((item) => `- ${item}`).join("\n")}`
  ].join("\n\n");
}

export function planningResearchScopes(session: Pick<PlanningSession, "facts" | "proposal">): string[] {
  const destination = session.facts.find((fact) => fact.key === "destination" && fact.confirmed)?.value.trim()
    || session.proposal?.objective.trim()
    || "Confirmed destination";
  const gateway = planningCountryGatewayContext(session);
  if (gateway) {
    if (planningExplicitGatewayOnly(session, gateway.city)) return [gateway.city];
    const signatureScope = `${gateway.country}: signature travel regions and route options (entry/exit ${gateway.city})`;
    const dates = session.facts.find((fact) => fact.key === "travel_dates" && fact.confirmed)?.value;
    const range = dates ? planningTravelDateRange(dates) : undefined;
    const tripDays = range ? Math.round((Date.parse(range.endDate) - Date.parse(range.startDate)) / 86_400_000) + 1 : undefined;
    return tripDays !== undefined && tripDays < 8 ? [signatureScope] : [
      signatureScope,
      `${gateway.country}: representative regions beyond ${gateway.city} (candidate overnight bases)`
    ];
  }
  const qualified = /^[^,，]+[,，]\s*(?:mainly|especially|including|重点是?|主要是?|包括)\s*(.+)$/iu.exec(destination)?.[1];
  const list = qualified ?? destination;
  const separator = qualified ? /\s*(?:[,，;；、+\/]|→|->|\band\b|和)\s*/iu : /\s*(?:[、+\/]|→|->|\band\b|和)\s*/iu;
  const parts = list.split(separator)
    .map((value) => value.replace(/^(?:mainly|especially|including|重点是?|主要是?|包括)\s*/iu, "").trim())
    .filter(Boolean);
  const unique = parts.filter((value, index) => parts.findIndex((candidate) => normalizedDestination(candidate) === normalizedDestination(value)) === index);
  return unique.length ? unique : [destination];
}

/** A named entry/exit city is a transport constraint, not the whole destination. */
export function planningCountryGatewayContext(session: Pick<PlanningSession, "facts">): { country: string; city: string } | undefined {
  const destination = session.facts.find((fact) => fact.key === "destination" && fact.confirmed)?.value.trim();
  if (!destination) return undefined;
  const match = /^(.+?)[,，]\s*with\s+(.+?)\s+as\s+the\s+(?:entry|arrival)\s+and\s+(?:exit|departure)\s+cit(?:y|ies)(?:\s*[;；].*)?$/iu.exec(destination)
    ?? /^(.+?)[,，]\s*(.+?)\s*(?:进出|入境和离境|作为入境和离境城市)(?:\s*[;；].*)?$/u.exec(destination);
  const country = match?.[1]?.trim();
  const city = match?.[2]?.trim();
  if (country && city) return { country, city };
  if (!isCountryDestination(destination)) return undefined;
  const arrival = session.facts.find((fact) => fact.key === "arrival_node" && fact.confirmed)?.value;
  const departure = session.facts.find((fact) => fact.key === "departure" && fact.confirmed)?.value;
  const arrivalCity = airportCity(arrival);
  const departureCity = airportCity(departure);
  return arrivalCity && departureCity && normalizedLocation(arrivalCity) === normalizedLocation(departureCity)
    ? { country: destination, city: arrivalCity }
    : undefined;
}

function airportCity(value: string | undefined): string | undefined {
  return value?.match(/^([\p{L}\p{M} .'-]+?)\s+(?:International\s+)?Airport\b/iu)?.[1]?.trim()
    ?? value?.match(/^([\p{L}\p{M}]+?)机场/u)?.[1]?.trim();
}

function isCountryDestination(value: string): boolean {
  const destination = normalizedLocation(value);
  for (const locale of ["en", "zh-CN"]) {
    const names = new Intl.DisplayNames([locale], { type: "region" });
    for (let first = 65; first <= 90; first += 1) for (let second = 65; second <= 90; second += 1) {
      const code = String.fromCharCode(first, second);
      const name = names.of(code);
      if (name && name !== code && normalizedLocation(name) === destination) return true;
    }
  }
  return false;
}

export function planningExplicitGatewayOnly(session: Pick<PlanningSession, "facts">, gatewayCity: string): boolean {
  const city = gatewayCity.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const text = session.facts.filter((fact) => fact.confirmed && ["destination", "purpose", "interests", "constraints"].includes(fact.key)).map((fact) => fact.value).join(" ");
  return new RegExp(`\\b(?:only|solely|exclusively)\\s+(?:visit\\s+|stay\\s+in\\s+|in\\s+)?${city}\\b|\\b${city}[- ]only\\b`, "iu").test(text)
    || new RegExp(`(?:只|仅)(?:去|玩|在|游览)?${city}(?:一地|一个城市)?`, "u").test(text);
}

export function planningAccommodationDestinationConflicts(
  session: Pick<PlanningSession, "facts" | "proposal">,
  bookings: TravelBooking[]
): string[] {
  const destination = session.facts.find((fact) => fact.key === "destination" && fact.confirmed);
  if (!destination) return [];
  // A country trip may legitimately use any researched regional base, not only
  // its named entry/exit gateway.
  if (planningCountryGatewayContext(session)) return [];
  const localityTokens = planningResearchScopes(session)
    .map((scope) => scope.split(/[,，]/u)[0]?.trim())
    .filter((value): value is string => Boolean(value))
    .map(normalizedLocation);
  return bookings
    .filter((booking) => booking.status !== "cancelled")
    .flatMap((booking) => booking.segments)
    .filter((segment) => segment.status !== "cancelled" && segment.segmentType === "hotel_stay")
    .map((segment) => segment.location ?? segment.destination)
    .filter((value): value is string => Boolean(value?.trim()))
    .filter((location) => !localityTokens.some((token) => normalizedLocation(location).includes(token)));
}

function normalizedDestination(value: string): string {
  return value.toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

function normalizedLocation(value: string): string {
  return value.toLocaleLowerCase().normalize("NFKD").replace(/[\p{M}\p{P}\p{S}]+/gu, " ").replace(/\s+/g, " ").trim();
}
