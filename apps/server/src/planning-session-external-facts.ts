import type { PlanningFact, PlanningSession } from "@c-assistant/core";
import {
  completeArrivalFromPartialFacts,
  missingGenerationQuestions,
  missingQuestions,
  upsertFact
} from "./planning-session-facts.js";
import { buildProposal } from "./planning-session-proposal.js";

export function applyExternalPlanningFacts(session: PlanningSession, facts: PlanningFact[], now = new Date()): PlanningSession {
  const timestamp = now.toISOString();
  let nextFacts = session.facts;
  for (const item of facts) nextFacts = upsertFact(nextFacts, { ...item, confirmed: true, updatedAt: timestamp });
  nextFacts = completeArrivalFromPartialFacts(nextFacts, timestamp);
  const previousVersion = session.proposal?.version ?? 0;
  const next: PlanningSession = { ...session, facts: nextFacts, updatedAt: timestamp };
  if (session.status === "proposal_confirmed") {
    next.unresolved = missingGenerationQuestions(next.facts);
    return next;
  }
  if (session.status === "collecting" || session.status === "proposal_ready") {
    const unresolved = missingQuestions(next.facts);
    next.unresolved = unresolved;
    next.deferred = next.deferred.filter((item) => !unresolved.some((current) => current.key === item.key));
    if (!unresolved.length) {
      next.status = "proposal_ready";
      next.proposal = buildProposal(next, previousVersion);
      delete next.confirmedProposalVersion;
    }
  }
  return next;
}
