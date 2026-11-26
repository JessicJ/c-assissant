import type {
  PlanningProposal,
  PlanningSession,
  TravelBooking
} from "@c-assistant/core";
import { valueOf } from "./planning-session-facts.js";

export function buildProposal(session: PlanningSession, previousVersion: number): PlanningProposal {
  const destination = valueOf(session.facts, "destination") ?? "this destination";
  const timing = valueOf(session.facts, "travel_dates") ?? valueOf(session.facts, "timing") ?? "dates to be confirmed";
  const purpose = valueOf(session.facts, "purpose") ?? "complete the trip goal";
  const interests = valueOf(session.facts, "interests");
  const constraints = valueOf(session.facts, "constraints");
  const budgetScope = valueOf(session.facts, "budget_scope");
  return {
    version: previousVersion + 1,
    title: `${destination} · ${purpose.slice(0, 28)}`,
    objective: `${purpose} (destination: ${destination}; timing: ${timing})`,
    theme: interests ?? purpose,
    segments: ["Pre-departure preparation and key milestones", `Core experiences and daily rhythm in ${destination}`, "Backup options for transport, accommodation, and unexpected changes"],
    skeleton: [`Arrival and adjustment: shape the first day around ${timing}`, "Core itinerary: place the most important goal at the best time for energy and access", "Flexibility and alternatives: leave room for weather, transport, and changing preferences"],
    tradeoffs: ["Protect the core goal first, then balance depth with a comfortable pace", ...(constraints ? [`Respect the stated constraints: ${constraints}`] : []), "Mark uncertain details for confirmation instead of presenting assumptions as facts"],
    assumptions: [budgetScope ? `Confirmed budget coverage: ${budgetScope}` : "If a total budget is stated, confirm whether it includes international flights before generation.", "Unbooked accommodation and transport remain recommendations; the confirmed arrival details anchor the first-day route"],
    decisionPoints: ["Whether the goal and scope are right", "Whether the current pace and backup tradeoffs work", "Which unknowns should be resolved first after generation"]
  };
}

export function formatProposalReply(proposal: PlanningProposal): string {
  return `I organized your ideas into a plan proposal:\n\n**${proposal.title}**\nGoal: ${proposal.objective}\n\nThe plan will cover:\n${proposal.segments.map((item) => `- ${item}`).join("\n")}\n\nThese tradeoffs will remain explicit:\n${proposal.tradeoffs.map((item) => `- ${item}`).join("\n")}\n\nIf this direction is right, select “Confirm Proposal and Create Plan.” Otherwise, tell me what to change about the destination, timing, goal, or pace.`;
}

export function formatBookingConstraintsForGeneration(bookings: TravelBooking[]): string {
  return bookings
    .filter((booking) => booking.status !== "cancelled")
    .flatMap((booking) => booking.segments
      .filter((segment) => segment.constraintStrength !== "ignored")
      .map((segment) => {
        const timing = [segment.startAtLocal ? `start ${segment.startAtLocal}` : "", segment.endAtLocal ? `end ${segment.endAtLocal}` : ""].filter(Boolean).join("; ");
        const location = [segment.origin ? `from ${segment.origin}` : "", segment.destination ? `to ${segment.destination}` : "", segment.location ? `at ${segment.location}` : ""].filter(Boolean).join("; ");
        const review = segment.needsReviewReasons.length ? `; needs review: ${segment.needsReviewReasons.join(" ")}` : "";
        return `- ${segment.constraintStrength.toUpperCase()} ${booking.type}: ${booking.title} / ${segment.title}${timing ? `; ${timing}` : ""}${location ? `; ${location}` : ""}; source ${booking.sourceLabel}${review}`;
      }))
    .join("\n");
}
