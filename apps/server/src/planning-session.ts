import { randomUUID } from "node:crypto";
import type { PlanningFact, PlanningMessage, PlanningProposal, PlanningSession, PlanningUnknown, TransportPreference, TravelBooking } from "@c-assistant/core";
import type { PlanningConversationTurn } from "@c-assistant/agent-adapters";

const MAX_MESSAGE_LENGTH = 1500;

export type PlanningTurnResult = {
  session: PlanningSession;
  reply: string;
};

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
  const reply = formatProposalReply(next, proposal);
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

function messageFrom(role: PlanningMessage["role"], text: string, createdAt: string): PlanningMessage {
  return { id: randomUUID(), role, text, createdAt };
}

function extractFacts(message: string, existing: PlanningFact[], updatedAt: string): PlanningFact[] {
  const facts: PlanningFact[] = [];
  const hasExisting = (key: string) => existing.some((item) => item.key === key);
  const destinationMatch = firstMatch(message, [
    /(?:目的地(?:改成|改为|换成|是|为|：|:)?|改去|改到|换到)\s*([\p{Script=Han}A-Za-z][^，。；;,!！?？\n]{1,36})/u,
    ...(!hasExisting("destination") ? [/(?:前往|去|到)\s*([\p{Script=Han}A-Za-z][^，。；;,!！?？\n]{1,36})/u] : []),
    ...(!hasExisting("destination") ? [/(?:在|于)\s*([\p{Script=Han}A-Za-z][^，。；;,!！?？\n]{1,36}?)(?:旅行|旅游|出行|度假|旅居|留学|工作)/u] : [])
  ]);
  const destination = destinationMatch ? normalizeDestination(destinationMatch) : undefined;
  if (destination) facts.push(fact("destination", destination, updatedAt));

  const timing = firstMatch(message, [
    /((?:20\d{2}[年\/-])?\d{1,2}月\d{1,2}[日号]?(?:到|至|-|—)(?:20\d{2}[年\/-])?(?:\d{1,2}月)?\d{1,2}[日号]?)/,
    /((?:大约|差不多|计划)?\s*(?:\d+|[一二三四五六七八九十两]+)\s*(?:天|晚|周|个月))/i,
    /((?:周末|下周|本周|暑假|国庆|春节)[^，。；;,!！?？\n]{0,12})/,
    /((?:20\d{2}[年\/-])?\d{1,2}月\d{1,2}[日号]?)/,
    /(待定|还没定|暂时不确定)/
  ]);
  if (timing) facts.push(fact("timing", timing, updatedAt));
  const travelDates = firstMatch(message, [
    /((?:20\d{2})年\s*\d{1,2}月\d{1,2}[日号]?(?:到|至|-|—)(?:(?:20\d{2})年\s*)?(?:\d{1,2}月)?\d{1,2}[日号]?)/,
    /((?:20\d{2})[-/]\d{1,2}[-/]\d{1,2}\s*(?:到|至|to|-|—)\s*(?:20\d{2})[-/]\d{1,2}[-/]\d{1,2})/i,
    /((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}\s*(?:to|-|—)\s*(?:(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+)?\d{1,2},?\s+20\d{2})/i
  ]);
  const year = extractTravelYear(message);
  if (year) facts.push(fact("travel_year", year, updatedAt));
  const partialDateRange = firstMatch(message, [/(\d{1,2}月\d{1,2}[日号]?(?:到|至|-|—)(?:\d{1,2}月)?\d{1,2}[日号]?)/]);
  const knownYear = year ?? valueOf(existing, "travel_year");
  const completedTravelDates = travelDates ?? (partialDateRange && knownYear ? `${knownYear}年${partialDateRange}` : undefined);
  if (completedTravelDates) facts.push(fact("travel_dates", completedTravelDates, updatedAt));

  const explicitPurpose = firstMatch(message, [/(?:目的(?!地)|目标|主要想|最想|这次想)(?:改成|改为|换成|是|为|：|:)?\s*([^，。；;,!！?？\n]{2,80})/u]);
  const purpose = explicitPurpose ?? message.replace(/^(我想|我准备|计划|想要|希望|打算)\s*/u, "").trim();
  const explicitlyChangesPurpose = /(?:目的(?!地)|目标|主要想|最想|这次想)(?:改成|改为|换成|是|为|：|:)?/u.test(message);
  const introducesPurpose = !hasExisting("purpose") && /(?:旅行|旅游|出行|度假|探亲|留学|工作|展会|活动|体验|主要)/u.test(message);
  if (purpose && (explicitlyChangesPurpose || introducesPurpose)) {
    facts.push(fact("purpose", purpose, updatedAt));
  }

  const interests = firstMatch(message, [/(?:喜欢|偏好|想看|重点是|重点想)\s*([^。；;,!！?？\n]{2,40})/u]);
  if (interests) facts.push(fact("interests", interests, updatedAt));
  const constraints = firstMatch(message, [/(?:不吃|不想|不要|避免|预算|限制|行李|带着孩子|带娃)[^。；;,!！?？\n]{0,40}/u]);
  if (constraints) facts.push(fact("constraints", constraints, updatedAt));

  const transport = firstMatch(message, [/(?:交通(?:方式|偏好|倾向)?|出行(?:方式|偏好)?|更想|优先|倾向于?|主要)\s*(?:是|为|用|选择|坐|乘|：|:)?\s*(打车|出租车|网约车|地铁|公交|公共交通|步行|骑行|自驾|(?:交给\s*)?Landi\s*推荐)/iu]);
  if (transport) facts.push(fact("transport_preference", normalizeTransport(transport), updatedAt));

  const party = firstMatch(message, [/(\d+|[一二三四五六七八九十两]+)\s*(?:个人|人)(?:出行|旅行|同行)?/u]);
  if (party) facts.push(fact("party_size", `${party}人`, updatedAt));

  const accommodation = firstMatch(message, [/(?:住宿|酒店|民宿)[^。；;,!！?？\n]{0,40}/u]);
  if (accommodation) facts.push(fact("accommodation", accommodation, updatedAt));

  const arrivalOrigin = firstMatch(message, [/(?:从|由)\s*([^，。；;,!！?？\n]{1,50}?)(?:出发|启程)/u, /(?:departing|leaving|flying|travelling|traveling)\s+from\s+([^,.!?;\n]{1,50})/i]);
  const arrivalNode = firstMatch(message, [/(?:抵达|到达|落地|降落(?:在|于)?)\s*([^，。；;,!！?？\n]{0,32}?(?:机场|航站楼|火车站|高铁站|车站|港口|码头))/u, /(?:arriv(?:e|ing|al)(?:\s+at|\s+in)?)\s+([^,.!?;\n]{1,50}?(?:airport|terminal|railway station|train station|port))/i, ...((hasExisting("arrival_origin") || hasExisting("arrival_time")) ? [/^\s*([^，。；;,!！?？\n]{1,32}?(?:机场|航站楼|火车站|高铁站|车站|港口|码头))\s*$/u] : [])]);
  const arrivalTime = firstMatch(message, [/(?:抵达|到达|落地|降落)[^，。；;,!！?？\n]{0,50}?(?:预计|大约|约)?\s*((?:[01]?\d|2[0-3])[:：][0-5]\d|(?:上午|下午|晚上|凌晨)?\s*\d{1,2}\s*[点時时](?:\s*\d{1,2}\s*分)?)/u, /(?:预计|大约|约)\s*((?:[01]?\d|2[0-3])[:：][0-5]\d|(?:上午|下午|晚上|凌晨)?\s*\d{1,2}\s*[点時时](?:\s*\d{1,2}\s*分)?)\s*(?:钟|鐘)?\s*(?:抵达|到达|落地|降落)/u]);
  if (arrivalOrigin) facts.push(fact("arrival_origin", arrivalOrigin, updatedAt));
  if (arrivalNode) facts.push(fact("arrival_node", arrivalNode, updatedAt));
  if (arrivalTime) facts.push(fact("arrival_time", arrivalTime.replace(/\s+/g, ""), updatedAt));

  if (/(?:还没|尚未|暂未|没有).{0,8}(?:订票|订航班|订机票|订火车票)|(?:flight|train).{0,12}(?:not booked|not decided)|haven't booked/i.test(message)) {
    facts.push(fact("arrival_status", "not_booked", updatedAt));
  } else if (hasArrivalOrigin(message) && hasArrivalNode(message) && hasArrivalTime(message)) {
    facts.push(fact("arrival", message.slice(0, 240), updatedAt));
  }
  if (hasDepartureIntent(message) && hasDepartureNode(message) && hasArrivalTime(message)) facts.push(fact("departure", message.slice(0, 240), updatedAt));

  if (!facts.some((item) => item.key === "destination") && !existing.some((item) => item.key === "destination") && isLikelyDestination(message)) {
    facts.push(fact("destination", message, updatedAt));
  }
  return facts;
}

function missingQuestions(facts: PlanningFact[]): PlanningUnknown[] {
  const known = new Set(facts.map((fact) => fact.key));
  const questions: PlanningUnknown[] = [];
  if (!known.has("destination")) questions.push({ key: "destination", question: "Where would you like to go, or where does this need to happen?", impact: "high", status: "open" });
  if (!known.has("timing") && !known.has("travel_dates")) questions.push({ key: "timing", question: "Roughly when will you go, and for how long? Exact dates are not required yet.", impact: "high", status: "open" });
  if (!known.has("purpose")) questions.push({ key: "purpose", question: "What do you most want to accomplish or experience on this trip?", impact: "high", status: "open" });
  return questions;
}

function missingGenerationQuestions(facts: PlanningFact[]): PlanningUnknown[] {
  const known = new Set(facts.map((fact) => fact.key));
  const questions: PlanningUnknown[] = [];
  if (!known.has("travel_dates")) {
    const year = valueOf(facts, "travel_year");
    questions.push({ key: "travel_dates", question: year ? `I have the year ${year}. What are the exact departure and return dates? For example, October 6–16.` : "Share the exact departure and return dates, including the year. For example, October 6–16, 2026.", impact: "high", status: "open" });
  }
  if (!known.has("arrival")) questions.push({ key: "arrival", question: arrivalFollowUpQuestion(facts), impact: "high", status: "open" });
  if (!known.has("departure")) questions.push({ key: "departure", question: "Which airport or station will you use for the return trip, and at about what time?", impact: "high", status: "open" });
  if (!known.has("party_size")) questions.push({ key: "party_size", question: "How many people are travelling?", impact: "high", status: "open" });
  if (!known.has("transport_preference")) questions.push({ key: "transport_preference", question: "Do you prefer rides, public transport, walking, or Landi's route-based recommendation?", impact: "high", status: "open" });
  return questions;
}

function buildProposal(session: PlanningSession, previousVersion: number): PlanningProposal {
  const destination = valueOf(session.facts, "destination") ?? "this destination";
  const timing = valueOf(session.facts, "travel_dates") ?? valueOf(session.facts, "timing") ?? "dates to be confirmed";
  const purpose = valueOf(session.facts, "purpose") ?? "complete the trip goal";
  const interests = valueOf(session.facts, "interests");
  return {
    version: previousVersion + 1,
    title: `${destination} · ${purpose.slice(0, 28)}`,
    objective: `${purpose} (destination: ${destination}; timing: ${timing})`,
    theme: interests ?? purpose,
    segments: ["Pre-departure preparation and key milestones", `Core experiences and daily rhythm in ${destination}`, "Backup options for transport, accommodation, and unexpected changes"],
    skeleton: [`Arrival and adjustment: shape the first day around ${timing}`, "Core itinerary: place the most important goal at the best time for energy and access", "Flexibility and alternatives: leave room for weather, transport, and changing preferences"],
    tradeoffs: ["Protect the core goal first, then balance depth with a comfortable pace", "Mark uncertain details for confirmation instead of presenting assumptions as facts"],
    assumptions: ["Accommodation, budget, and other unbooked items can be added after the complete plan is generated; confirmed arrival details will anchor the first-day route"],
    decisionPoints: ["Whether the goal and scope are right", "Whether the current pace and backup tradeoffs work", "Which unknowns should be resolved first after generation"]
  };
}

function formatProposalReply(session: PlanningSession, proposal: PlanningProposal): string {
  return `I organized your ideas into a plan proposal:\n\n**${proposal.title}**\nGoal: ${proposal.objective}\n\nThe plan will cover:\n${proposal.segments.map((item) => `- ${item}`).join("\n")}\n\nThese tradeoffs will remain explicit:\n${proposal.tradeoffs.map((item) => `- ${item}`).join("\n")}\n\nIf this direction is right, select “Confirm Proposal and Create Plan.” Otherwise, tell me what to change about the destination, timing, goal, or pace.`;
}

function summarizeFacts(facts: PlanningFact[]): string {
  const keys = new Set(facts.map((item) => item.key));
  const labels: Record<string, string> = {
    destination: "Destination",
    timing: "Trip timing",
    travel_year: "Year",
    travel_dates: "Travel dates",
    purpose: "Trip goal",
    interests: "Preferences",
    constraints: "Constraints",
    transport_preference: "Local transport",
    party_size: "Travelers",
    accommodation: "Accommodation",
    arrival_origin: "Departure point",
    arrival_node: "Arrival point",
    arrival_time: "Expected arrival",
    arrival: "Arrival plan",
    departure: "Return plan",
    arrival_status: "Transport booking"
  };
  return facts
    .filter((item) => !(item.key === "timing" && keys.has("travel_dates")))
    .filter((item) => !(item.key.startsWith("arrival_") && keys.has("arrival")))
    .map((item) => item.key === "arrival_status" ? "Flight or train ticket not booked yet" : `${labels[item.key] ?? item.key}: ${item.value}`)
    .join("；");
}

function formatBookingConstraintsForGeneration(bookings: TravelBooking[]): string {
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

function extractTravelYear(message: string): string | undefined {
  const full = /(?:^|[^\d])(20\d{2})\s*年/u.exec(message)?.[1];
  if (full) return full;
  const short = /(?:^|[^\d])(\d{2})\s*年/u.exec(message)?.[1];
  if (!short) return undefined;
  const numeric = Number(short);
  return numeric >= 20 && numeric <= 99 ? `20${short}` : undefined;
}

function completeArrivalFromPartialFacts(facts: PlanningFact[], updatedAt: string): PlanningFact[] {
  if (valueOf(facts, "arrival")) return facts;
  const origin = valueOf(facts, "arrival_origin");
  const node = valueOf(facts, "arrival_node");
  const time = valueOf(facts, "arrival_time");
  if (!origin || !node || !time) return facts;
  return upsertFact(facts, fact("arrival", `Depart from ${origin}, arrive at ${node} at about ${time}`, updatedAt));
}

function arrivalFollowUpQuestion(facts: PlanningFact[]): string {
  if (valueOf(facts, "arrival_status") === "not_booked") return "After booking, share the departure point, arrival airport or station, and expected arrival time.";
  const origin = valueOf(facts, "arrival_origin");
  const node = valueOf(facts, "arrival_node");
  const time = valueOf(facts, "arrival_time");
  const remembered = [origin ? `departing from ${origin}` : "", time ? `arriving at about ${time}` : ""].filter(Boolean).join(", ");
  if (!origin) return `${remembered ? `I noted ${remembered}. ` : ""}Where will you depart from?`;
  if (!node) return `${remembered ? `I noted ${remembered}. ` : ""}Which airport or station will you arrive at?`;
  if (!time) return `I noted departure from ${origin} and arrival at ${node}. About what time will you arrive?`;
  return "Where will you depart from, which airport or station will you arrive at, and at about what time?";
}

function fact(key: string, value: string, updatedAt: string): PlanningFact {
  return { key, value, source: "user", confirmed: true, updatedAt };
}

function upsertFact(facts: PlanningFact[], next: PlanningFact): PlanningFact[] {
  return [...facts.filter((fact) => fact.key !== next.key), next];
}

function valueOf(facts: PlanningFact[], key: string): string | undefined { return facts.find((fact) => fact.key === key)?.value; }

function firstMatch(value: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = pattern.exec(value);
    if (match?.[1] || match?.[0]) return (match?.[1] ?? match[0]).trim();
  }
  return undefined;
}

function normalizeDestination(value: string): string {
  return value
    .replace(/(?:旅行|旅游|出行|度假|玩|旅居)?\s*(?:大约|约)?\s*(?:\d+|[一二三四五六七八九十两]+)\s*(?:天|晚|周|个月).*$/u, "")
    .replace(/(?:旅行|旅游|出行|玩|度假)$/u, "")
    .trim();
}

function normalizeTransport(value: string): string {
  if (/打车|出租车|网约车/u.test(value)) return "打车";
  if (/地铁|公交|公共交通/u.test(value)) return "公共交通";
  if (/Landi\s*推荐/iu.test(value)) return "Landi推荐";
  return value.trim();
}

function chinesePartyNumber(value: string): number {
  const digits: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (value === "十") return 10;
  if (!value.includes("十")) return digits[value] ?? Number.NaN;
  const [tens, ones] = value.split("十");
  return (tens ? digits[tens] ?? Number.NaN : 1) * 10 + (ones ? digits[ones] ?? Number.NaN : 0);
}

function planningStartDate(value: string): string | undefined {
  const iso = /\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/.exec(value);
  if (iso) return `${iso[1]}-${iso[2]!.padStart(2, "0")}-${iso[3]!.padStart(2, "0")}`;
  const chinese = /(20\d{2})年\s*(\d{1,2})月\s*(\d{1,2})[日号]?/.exec(value);
  if (chinese) return `${chinese[1]}-${chinese[2]!.padStart(2, "0")}-${chinese[3]!.padStart(2, "0")}`;
  const english = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d{2})\b/i.exec(value);
  if (!english) return undefined;
  const month = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"].indexOf(english[1]!.toLowerCase()) + 1;
  return `${english[3]}-${String(month).padStart(2, "0")}-${english[2]!.padStart(2, "0")}`;
}

function hasArrivalNode(message: string): boolean {
  return /机场|航站楼|火车站|高铁站|车站|港口|码头|自驾|开车抵达|airport|terminal|railway station|train station|ferry terminal|port|driv(?:e|ing)/i.test(message)
    || /\b[A-Z]{3}\b/.test(message);
}

function hasArrivalOrigin(message: string): boolean {
  return /从[^，。；;,!！?？\n]{1,40}(?:出发|启程)|(?:departing|leaving|flying|travelling|traveling)\s+from\s+[^,.!?;\n]{1,40}/i.test(message);
}

function hasDepartureIntent(message: string): boolean {
  return /返程|回程|离开|起飞|出发回|depart(?:ure|ing)?|leav(?:e|ing)|return flight/i.test(message);
}

function hasDepartureNode(message: string): boolean {
  return /(?:从|由)[^，。；;,!！?？\n]{0,32}(?:机场|航站楼|火车站|高铁站|车站|港口|码头)|(?:机场|航站楼|火车站|高铁站|车站|港口|码头)[^，。；;,!！?？\n]{0,16}(?:离开|出发|起飞)|(?:from\s+)?[^,.!?;\n]{1,40}(?:airport|terminal|railway station|train station|port)/i.test(message)
    || /\b[A-Z]{3}\b/.test(message);
}

function hasArrivalTime(message: string): boolean {
  return /(?:[01]?\d|2[0-3])[:：][0-5]\d|(?:上午|下午|晚上|凌晨)?\s*\d{1,2}\s*[点時时](?:\s*\d{1,2}\s*分)?|\b(?:1[0-2]|0?[1-9])(?::[0-5]\d)?\s*(?:am|pm)\b/i.test(message);
}

function isLikelyDestination(message: string): boolean {
  return message.length <= 28 && !/[，。；;,!！?？\s]/u.test(message) && !/^(我|想|计划|去|到|还|没有|嗯|好的)/u.test(message);
}
