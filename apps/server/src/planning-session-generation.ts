import type { PlanningSession, TransportPreference, TravelBooking } from "@c-assistant/core";
import {
  chinesePartyNumber,
  firstMatch,
  missingGenerationQuestions,
  planningStartDate
} from "./planning-session-facts.js";
import { formatBookingConstraintsForGeneration } from "./planning-session-proposal.js";

export function planningGenerationReuse(session: PlanningSession, currentPlanId: string): "reuse" | "conflict" | "continue" {
  if (session.status !== "draft_ready" || !session.outputPlanId) return "continue";
  return session.outputPlanId === currentPlanId ? "reuse" : "conflict";
}

export function planningPartySize(session: PlanningSession): number | undefined {
  const value = session.facts.find((fact) => fact.key === "party_size" && fact.confirmed)?.value.replace(/\s*(?:个人|人).*$/u, "").trim();
  if (!value) return undefined;
  const numeric = /^\d+$/.test(value) ? Number(value) : chinesePartyNumber(value);
  return Number.isInteger(numeric) && numeric >= 1 && numeric <= 20 ? numeric : undefined;
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
  const startDate = planningStartDate(dates);
  const time = firstMatch(arrival, [/(?:抵达|到达|arrival|arrive)[^，。；;,\n]{0,80}?(?:预计|大约|约|at)?\s*((?:[01]?\d|2[0-3])[:：][0-5]\d)/iu, /((?:[01]?\d|2[0-3])[:：][0-5]\d)/u]);
  if (!startDate || !time) return undefined;
  return `${startDate}T${time.replace("：", ":").padStart(5, "0")}`;
}

export function planningRequestForGeneration(session: PlanningSession): string {
  return planningRequestForGenerationWithBookings(session);
}

export function planningRequestForGenerationWithBookings(session: PlanningSession, bookings: TravelBooking[] = []): string {
  if (!session.proposal || session.status !== "proposal_confirmed") throw new Error("A confirmed planning proposal is required before Plan generation.");
  const unresolved = missingGenerationQuestions(session.facts);
  if (unresolved.length) throw new Error(`Complete the generation-critical facts before Plan generation: ${unresolved.map((item) => item.key).join(", ")}.`);
  const facts = session.facts.map((fact) => `- ${fact.key}: ${fact.value}`).join("\n");
  const proposal = session.proposal;
  const bookingConstraints = formatBookingConstraintsForGeneration(bookings);
  return [
    "Generate the complete Landi Plan from this user-approved planning proposal.",
    "Do not change the approved objective or scope. Make reasonable assumptions explicit in the Plan.",
    "Treat accepted hard booking constraints as fixed real-world commitments that outrank natural-language preferences. Soft booking constraints are review context only. Never include confirmation codes, traveler names, payment details, or original email bodies in the Plan.",
    `Objective: ${proposal.objective}`,
    `Theme: ${proposal.theme}`,
    `Known facts:\n${facts}`,
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
  const qualifiedList = destination.replace(/^[^,，]+[,，]\s*(?=(?:mainly|especially|including|重点|主要|包括)\b)/iu, "");
  const commaParts = qualifiedList.split(/\s*[,，;；]\s*/u)
    .flatMap((value) => value.split(/\s*(?:\band\b|和)\s*/iu))
    .map((value) => value.replace(/^(?:mainly|especially|including|重点是?|主要是?|包括)\s*/iu, "").trim())
    .filter(Boolean);
  const parts = (qualifiedList !== destination ? commaParts.length >= 2 : commaParts.length >= 3)
    ? commaParts
    : qualifiedList.split(/\s*(?:、|\/|→|->|\band\b|和)\s*/iu).map((value) => value.trim()).filter(Boolean);
  return [...new Set(parts.length ? parts : [destination])];
}
