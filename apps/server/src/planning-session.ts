import { randomUUID } from "node:crypto";
import type { PlanningMessage, PlanningSession } from "@c-assistant/core";
import type { PlanningConversationTurn } from "@c-assistant/agent-adapters";
import {
  completeArrivalFromPartialFacts,
  extractFacts,
  fact,
  missingGenerationQuestions,
  missingQuestions,
  summarizeFacts,
  upsertFact,
  valueOf
} from "./planning-session-facts.js";
import {
  buildProposal,
  formatProposalReply
} from "./planning-session-proposal.js";

const MAX_MESSAGE_LENGTH = 1500;

export type PlanningTurnResult = {
  session: PlanningSession;
  reply: string;
};

export function createPlanningSession(now = new Date()): PlanningSession {
  const timestamp = now.toISOString();
  return {
    id: randomUUID(),
    status: "collecting",
    objectiveType: "travel",
    messages: [],
    facts: [],
    unresolved: [],
    deferred: [],
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

export function prepareConfirmedPlanningSession(session: PlanningSession, now = new Date()): PlanningTurnResult {
  if (!session.proposal || session.status !== "proposal_confirmed") throw new Error("A confirmed planning proposal is required before collecting generation details.");
  const timestamp = now.toISOString();
  const unresolved = missingGenerationQuestions(session.facts);
  const next: PlanningSession = { ...session, unresolved, updatedAt: timestamp };
  const reply = unresolved.length
    ? `The plan direction is confirmed. Before creating the final plan, please confirm: ${unresolved[0]!.question}`
    : "The plan direction and required details are confirmed. The complete plan can now be created.";
  next.messages = [...next.messages, messageFrom("assistant", reply, timestamp)];
  return { session: next, reply };
}

export function applyPlanningTurn(session: PlanningSession, rawMessage: string, now = new Date()): PlanningTurnResult {
  const message = rawMessage.trim();
  if (!message) throw new Error("Please tell Landi a little about what you want to plan.");
  if (message.length > MAX_MESSAGE_LENGTH) throw new Error(`The message must be ${MAX_MESSAGE_LENGTH} characters or fewer.`);

  const timestamp = now.toISOString();
  const collectingGenerationDetails = session.status === "proposal_confirmed";
  const previousProposalVersion = session.proposal?.version ?? 0;
  const { proposal: _proposal, confirmedProposalVersion: _confirmedProposalVersion, ...sessionWithoutProposal } = session;
  const next: PlanningSession = {
    ...(collectingGenerationDetails ? session : sessionWithoutProposal),
    status: collectingGenerationDetails ? "proposal_confirmed" : "collecting",
    updatedAt: timestamp,
    messages: [...session.messages, messageFrom("user", message, timestamp)]
  };
  const extracted = extractFacts(message, next.facts, timestamp);
  const previousDestination = valueOf(next.facts, "destination");
  const previousPurpose = valueOf(next.facts, "purpose");
  const nextDestination = extracted.find((item) => item.key === "destination")?.value;
  if (previousDestination && nextDestination && previousDestination !== nextDestination && !extracted.some((item) => item.key === "arrival")) {
    next.facts = next.facts.filter((item) => item.key !== "arrival" && item.key !== "arrival_status" && item.key !== "departure");
  }
  if (extracted.some((item) => item.key === "arrival")) next.facts = next.facts.filter((item) => item.key !== "arrival_status");
  for (const fact of extracted) next.facts = upsertFact(next.facts, fact);
  next.facts = completeArrivalFromPartialFacts(next.facts, timestamp);

  if (collectingGenerationDetails) {
    const nextPurpose = extracted.find((item) => item.key === "purpose")?.value;
    const directionChanged = Boolean(previousDestination && nextDestination && previousDestination !== nextDestination)
      || Boolean(previousPurpose && nextPurpose && previousPurpose !== nextPurpose);
    if (directionChanged) {
      next.status = "proposal_ready";
      delete next.confirmedProposalVersion;
      next.proposal = buildProposal(next, previousProposalVersion);
      next.unresolved = [];
      const reply = `The plan direction changed, so I created proposal V${next.proposal.version}. Confirm the direction again before creating the final plan.`;
      next.messages = [...next.messages, messageFrom("assistant", reply, timestamp)];
      return { session: next, reply };
    }
    const unresolved = missingGenerationQuestions(next.facts);
    next.unresolved = unresolved;
    const acknowledged = summarizeFacts(extracted);
    const reply = unresolved.length
      ? acknowledged
        ? `Got it: ${acknowledged}\n\n${unresolved[0]!.question}`
        : `Got it. ${unresolved[0]!.question}`
      : "All details required for the final plan are complete. Select “Create Complete Plan” and Landi will verify the information and build the workspace plan.";
    next.messages = [...next.messages, messageFrom("assistant", reply, timestamp)];
    return { session: next, reply };
  }

  const unresolved = missingQuestions(next.facts);
  next.unresolved = unresolved;
  next.deferred = next.deferred.filter((item) => !unresolved.some((current) => current.key === item.key));
  if (unresolved.length) {
    const question = unresolved[0]!.question;
    const reply = `I noted: ${summarizeFacts(next.facts)}\n\nOne more detail will help set the plan direction: ${question}`;
    next.messages = [...next.messages, messageFrom("assistant", reply, timestamp)];
    return { session: next, reply };
  }

  const proposal = buildProposal(next, previousProposalVersion);
  next.status = "proposal_ready";
  next.proposal = proposal;
  const reply = formatProposalReply(proposal);
  next.messages = [...next.messages, messageFrom("assistant", reply, timestamp)];
  return { session: next, reply };
}

export function applyAgentPlanningTurn(session: PlanningSession, rawMessage: string, agentTurn: PlanningConversationTurn, now = new Date()): PlanningTurnResult {
  const message = rawMessage.trim();
  if (!message) throw new Error("Please tell Landi a little about what you want to plan.");
  const timestamp = now.toISOString();
  const collectingGenerationDetails = session.status === "proposal_confirmed";
  const previousProposalVersion = session.proposal?.version ?? 0;
  const previousDestination = valueOf(session.facts, "destination");
  const previousPurpose = valueOf(session.facts, "purpose");
  const { proposal: _proposal, confirmedProposalVersion: _confirmedProposalVersion, ...sessionWithoutProposal } = session;
  const next: PlanningSession = {
    ...(collectingGenerationDetails ? session : sessionWithoutProposal),
    status: collectingGenerationDetails ? "proposal_confirmed" : "collecting",
    updatedAt: timestamp,
    messages: [...session.messages, messageFrom("user", message, timestamp)]
  };
  const extracted = agentTurn.facts.map((item) => fact(item.key, item.value, timestamp));
  for (const item of extracted) next.facts = upsertFact(next.facts, item);
  next.facts = completeArrivalFromPartialFacts(next.facts, timestamp);
  const nextDestination = extracted.find((item) => item.key === "destination")?.value;
  const nextPurpose = extracted.find((item) => item.key === "purpose")?.value;
  const directionChanged = Boolean(previousDestination && nextDestination && previousDestination !== nextDestination)
    || Boolean(previousPurpose && nextPurpose && previousPurpose !== nextPurpose);
  if (collectingGenerationDetails && directionChanged) {
    next.proposal = buildProposal(next, previousProposalVersion);
    next.status = "proposal_ready";
    delete next.confirmedProposalVersion;
    next.unresolved = [];
    const reply = agentTurn.reply;
    next.messages = [...next.messages, messageFrom("assistant", reply, timestamp)];
    return { session: next, reply };
  }
  const unresolved = collectingGenerationDetails ? missingGenerationQuestions(next.facts) : missingQuestions(next.facts);
  next.unresolved = unresolved;
  if (!collectingGenerationDetails && !unresolved.length) {
    next.proposal = buildProposal(next, previousProposalVersion);
    next.status = "proposal_ready";
    delete next.confirmedProposalVersion;
    next.unresolved = [];
  }
  const reply = collectingGenerationDetails && !next.unresolved.length
    ? "The details are complete. I am creating the final plan now."
    : agentTurn.reply;
  next.messages = [...next.messages, messageFrom("assistant", reply, timestamp)];
  return { session: next, reply };
}

function messageFrom(role: PlanningMessage["role"], text: string, createdAt: string): PlanningMessage {
  return { id: randomUUID(), role, text, createdAt };
}
