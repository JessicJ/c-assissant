import { randomUUID } from "node:crypto";
import type { PlanningMessage, PlanningSession } from "@c-assistant/core";
import type { PlanningConversationTurn } from "@c-assistant/agent-adapters";
import {
  completeArrivalFromPartialFacts,
  completeTravelDates,
  extractFacts,
  fact,
  missingGenerationQuestions,
  missingQuestions,
  planningTravelDateRange,
  summarizeFacts,
  upsertFact,
  validBudgetScope,
  validPartySize,
  valueOf
} from "./planning-session-facts.js";
import {
  buildProposal,
  formatProposalReply
} from "./planning-session-proposal.js";

const MAX_MESSAGE_LENGTH = 1500;

function budgetScopeFromShortReply(session: PlanningSession, message: string): string | undefined {
  if (!missingGenerationQuestions(session.facts, session.messages).some((item) => item.key === "budget_scope")) return undefined;
  const reply = message.trim().replace(/[。.!！?？\s]+$/u, "").toLowerCase();
  if (/^(?:不含|不包括|不包含|不算|否|不是|no)$/u.test(reply)) return "excludes international flights";
  if (/^(?:含|包括|包含|算上|是|对|yes)$/u.test(reply)) return "includes international flights";
  return undefined;
}

function budgetFactFromMessage(message: string, timestamp: string) {
  const phrases = [message.match(/(?:预算|budget|人民币|RMB|CNY)[^。；;，\n]{0,45}/iu)?.[0], message.match(/\d[\d,.]*\s*(?:万|千|元|人民币|RMB|CNY)[^。；;，\n]{0,25}(?:预算|budget)/iu)?.[0]];
  const phrase = phrases.find((item) => item && /\d/u.test(item));
  return phrase ? fact("constraints", phrase.trim(), timestamp) : undefined;
}

function lastUserBudgetFact(session: PlanningSession, timestamp: string) {
  return [...session.messages].reverse()
    .filter((item) => item.role === "user")
    .map((item) => budgetFactFromMessage(item.text, timestamp))
    .find((fact) => Boolean(fact));
}

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
  const unresolved = missingGenerationQuestions(session.facts, session.messages);
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
    status: collectingGenerationDetails ? session.status : "collecting",
    updatedAt: timestamp,
    messages: [...session.messages, messageFrom("user", message, timestamp)]
  };
  const extracted = extractFacts(message, next.facts, timestamp, now.getFullYear());
  const shortBudgetScope = budgetScopeFromShortReply(session, message);
  if (shortBudgetScope && !extracted.some((item) => item.key === "budget_scope")) extracted.push(fact("budget_scope", shortBudgetScope, timestamp));
  const rememberedBudget = budgetFactFromMessage(message, timestamp) ?? lastUserBudgetFact(session, timestamp);
  if (rememberedBudget && !next.facts.some((item) => item.confirmed && item.value.includes(rememberedBudget.value)) && !extracted.some((item) => item.key === "constraints")) {
    const existingConstraint = next.facts.find((item) => item.key === "constraints")?.value;
    extracted.push(fact("constraints", existingConstraint ? `${existingConstraint}; ${rememberedBudget.value}` : rememberedBudget.value, timestamp));
  }
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
    const unresolved = missingGenerationQuestions(next.facts, next.messages);
    next.unresolved = unresolved;
    const acknowledged = summarizeFacts(extracted);
    const reply = unresolved.length
      ? acknowledged
        ? `Got it: ${acknowledged}\n\n${unresolved[0]!.question}`
        : `Got it. ${unresolved[0]!.question}`
      : "Got it. I have enough to start building the plan.";
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
  next.unresolved = missingGenerationQuestions(next.facts, next.messages);
  const reply = next.unresolved.length
    ? `${formatProposalReply(proposal)}\n\nBefore I can generate the plan: ${next.unresolved[0]!.question}`
    : formatProposalReply(proposal);
  next.messages = [...next.messages, messageFrom("assistant", reply, timestamp)];
  return { session: next, reply };
}

export function applyAgentPlanningTurn(session: PlanningSession, rawMessage: string, agentTurn: PlanningConversationTurn, now = new Date()): PlanningTurnResult {
  const message = rawMessage.trim();
  if (!message) throw new Error("Please tell Landi a little about what you want to plan.");
  const timestamp = now.toISOString();
  const collectingGenerationDetails = session.status === "proposal_confirmed" || session.status === "proposal_ready";
  const previousProposalVersion = session.proposal?.version ?? 0;
  const previousDestination = valueOf(session.facts, "destination");
  const previousPurpose = valueOf(session.facts, "purpose");
  const { proposal: _proposal, confirmedProposalVersion: _confirmedProposalVersion, ...sessionWithoutProposal } = session;
  const next: PlanningSession = {
    ...(collectingGenerationDetails ? session : sessionWithoutProposal),
    status: collectingGenerationDetails ? session.status : "collecting",
    updatedAt: timestamp,
    messages: [...session.messages, messageFrom("user", message, timestamp)]
  };
  const dateFacts = extractFacts(message, next.facts, timestamp, now.getFullYear())
    .filter((item) => ["travel_dates", "travel_year", "budget_scope", "constraints", "party_size", "arrival_origin", "arrival_status", "departure_destination"].includes(item.key));
  const userDates = dateFacts.find((item) => item.key === "travel_dates");
  const userYear = dateFacts.find((item) => item.key === "travel_year")?.value;
  const shortBudgetScope = budgetScopeFromShortReply(session, message);
  const userBudgetScope = dateFacts.find((item) => item.key === "budget_scope")
    ?? (shortBudgetScope ? fact("budget_scope", shortBudgetScope, timestamp) : undefined);
  const selectedYear = userYear ?? valueOf(next.facts, "travel_year") ?? String(now.getFullYear());
  const userTransportUnbooked = dateFacts.some((item) => item.key === "arrival_status" && item.value === "not_booked");
  const normalizedFacts = agentTurn.facts
    .filter((item) => item.key !== "travel_year")
    .filter((item) => !userTransportUnbooked || !["arrival", "departure"].includes(item.key))
    .map((item) => item.key === "travel_dates"
      ? { ...item, value: userDates?.value ?? completeTravelDates(item.value, selectedYear) ?? item.value }
      : item);
  if (userBudgetScope) {
    const index = normalizedFacts.findIndex((item) => item.key === "budget_scope");
    if (index >= 0) normalizedFacts[index] = { key: "budget_scope", value: userBudgetScope.value };
    else normalizedFacts.push({ key: "budget_scope", value: userBudgetScope.value });
  }
  const userBudgetConstraint = budgetFactFromMessage(message, timestamp) ?? lastUserBudgetFact(session, timestamp);
  if (userBudgetConstraint) {
    const index = normalizedFacts.findIndex((item) => item.key === "constraints");
    if (index < 0) {
      const previous = next.facts.find((item) => item.key === "constraints")?.value;
      normalizedFacts.push({ key: "constraints", value: previous && !previous.includes(userBudgetConstraint.value) && !/(?:预算|budget|人民币|RMB|CNY)/iu.test(previous)
        ? `${previous}; ${userBudgetConstraint.value}` : userBudgetConstraint.value });
    }
    else if (!normalizedFacts[index]!.value.includes(userBudgetConstraint.value)) normalizedFacts[index] = { key: "constraints", value: `${normalizedFacts[index]!.value}; ${userBudgetConstraint.value}` };
  }
  if (userDates && !normalizedFacts.some((item) => item.key === "travel_dates") && agentTurn.clarification?.key !== "travel_dates") {
    normalizedFacts.push({ key: "travel_dates", value: userDates.value });
  }
  if (userYear) normalizedFacts.push({ key: "travel_year", value: userYear });
  for (const userFact of dateFacts.filter((item) => ["party_size", "arrival_origin", "arrival_status", "departure_destination"].includes(item.key))) {
    const index = normalizedFacts.findIndex((item) => item.key === userFact.key);
    if (index >= 0) normalizedFacts[index] = { key: userFact.key, value: userFact.value };
    else normalizedFacts.push({ key: userFact.key, value: userFact.value });
  }
  const invalidDate = normalizedFacts.find((item) => item.key === "travel_dates" && !planningTravelDateRange(item.value));
  const invalidParty = normalizedFacts.find((item) => item.key === "party_size" && !validPartySize(item.value));
  const invalidBudgetScope = normalizedFacts.find((item) => item.key === "budget_scope" && !validBudgetScope(item.value));
  const invalidQuestion = invalidDate
    ? "I could not reconcile those travel dates. Please check the departure and return month/day and that the return is after departure. I’ll use this year unless you specify another year."
    : invalidParty
      ? "How many people are travelling? Please give a positive number."
      : invalidBudgetScope
        ? "Does your total budget include the international round-trip flights?"
      : undefined;
  const clarification = agentTurn.clarification?.key === "budget_scope" && userBudgetScope
    || userTransportUnbooked && ["arrival", "departure"].includes(agentTurn.clarification?.key ?? "")
    ? undefined : agentTurn.clarification;
  const clarificationUnknown = clarification ? { key: clarification.key, question: clarification.question, impact: "high" as const, status: "open" as const } : undefined;
  const extracted = normalizedFacts.filter((item) => item !== invalidDate && item !== invalidParty && item !== invalidBudgetScope && item.key !== clarification?.key).map((item) => fact(item.key, item.value, timestamp));
  for (const item of extracted) next.facts = upsertFact(next.facts, item);
  if (invalidDate) next.facts = next.facts.filter((item) => item.key !== "travel_dates");
  if (invalidParty) next.facts = next.facts.filter((item) => item.key !== "party_size");
  if (invalidBudgetScope) next.facts = next.facts.filter((item) => item.key !== "budget_scope");
  next.facts = completeArrivalFromPartialFacts(next.facts, timestamp);
  if (clarification) {
    const invalidatedKeys = clarification.key === "destination"
      ? ["destination", "arrival", "arrival_origin", "arrival_node", "arrival_time", "departure"]
      : clarification.key === "arrival"
        ? ["arrival", "arrival_origin", "arrival_node", "arrival_time"]
        : clarification.key.startsWith("arrival_")
          ? [clarification.key, "arrival"]
          : [clarification.key];
    next.facts = next.facts.filter((item) => !invalidatedKeys.includes(item.key));
  }
  const nextDestination = extracted.find((item) => item.key === "destination")?.value;
  const nextPurpose = extracted.find((item) => item.key === "purpose")?.value;
  const directionChanged = Boolean(previousDestination && nextDestination && previousDestination !== nextDestination)
    || Boolean(previousPurpose && nextPurpose && previousPurpose !== nextPurpose)
    || Boolean(session.proposal && nextDestination && !previousDestination && session.unresolved.some((item) => item.key === "destination"))
    || Boolean(session.proposal && nextPurpose && !previousPurpose && session.unresolved.some((item) => item.key === "purpose"));
  if (previousDestination && nextDestination && previousDestination !== nextDestination && !extracted.some((item) => item.key === "arrival")) {
    next.facts = next.facts.filter((item) => !["arrival", "arrival_origin", "arrival_node", "arrival_time", "departure"].includes(item.key));
  }
  if (collectingGenerationDetails && directionChanged) {
    next.proposal = buildProposal(next, previousProposalVersion);
    next.status = "proposal_ready";
    delete next.confirmedProposalVersion;
    const missing = [...missingQuestions(next.facts), ...missingGenerationQuestions(next.facts, next.messages)];
    next.unresolved = clarificationUnknown ? [clarificationUnknown, ...missing.filter((item) => item.key !== clarificationUnknown.key)] : missing;
    const reply = invalidQuestion ?? (clarification ? agentTurn.reply : next.unresolved.length
      ? replyWithSingleGenerationQuestion(agentTurn.reply, next.unresolved[0]!.question)
      : agentTurn.reply);
    next.messages = [...next.messages, messageFrom("assistant", reply, timestamp)];
    return { session: next, reply };
  }
  const unresolved = collectingGenerationDetails ? [...missingQuestions(next.facts), ...missingGenerationQuestions(next.facts, next.messages)] : missingQuestions(next.facts);
  next.unresolved = clarificationUnknown ? [clarificationUnknown, ...unresolved.filter((item) => item.key !== clarificationUnknown.key)] : unresolved;
  if (!collectingGenerationDetails && !unresolved.length) {
    next.proposal = buildProposal(next, previousProposalVersion);
    next.status = "proposal_ready";
    delete next.confirmedProposalVersion;
    const missing = missingGenerationQuestions(next.facts, next.messages);
    next.unresolved = clarificationUnknown ? [clarificationUnknown, ...missing.filter((item) => item.key !== clarificationUnknown.key)] : missing;
  }
  const reply = invalidQuestion ?? (clarification ? agentTurn.reply : next.status === "proposal_ready" && next.unresolved.length
    ? replyWithSingleGenerationQuestion(agentTurn.reply, next.unresolved[0]!.question)
    : next.status === "proposal_ready" && !next.unresolved.length
      ? "I have the essential trip details. Review them above, correct anything that looks wrong, then select Generate plan."
      : agentTurn.reply);
  next.messages = [...next.messages, messageFrom("assistant", reply, timestamp)];
  return { session: next, reply };
}

function replyWithSingleGenerationQuestion(agentReply: string, question: string): string {
  // Model replies can already contain a follow-up. The deterministic intake gate owns
  // the next required question, so never show two competing questions in one turn.
  if (/[?？]/u.test(agentReply)) return question;
  return `${agentReply}\n\nBefore I can generate the plan: ${question}`;
}

function messageFrom(role: PlanningMessage["role"], text: string, createdAt: string): PlanningMessage {
  return { id: randomUUID(), role, text, createdAt };
}
