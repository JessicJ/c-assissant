import assert from "node:assert/strict";
import test from "node:test";
import type { TravelBooking } from "@c-assistant/core";
import { applyAgentPlanningTurn, applyPlanningTurn, createPlanningSession, prepareConfirmedPlanningSession } from "./planning-session.js";
import { applyExternalPlanningFacts } from "./planning-session-external-facts.js";
import { missingGenerationQuestions, planningTravelDateRange, partySizeNumber } from "./planning-session-facts.js";
import { planningAccommodationDestinationConflicts, planningArrivalLocalDateTime, planningGenerationReuse, planningPartySize, planningRequestForGeneration, planningRequestForGenerationWithBookings, planningResearchScopes, planningTransportPreference } from "./planning-session-generation.js";

const now = "2026-09-18T00:00:00.000Z";

test("a stated travel budget needs airfare coverage before generation", () => {
  const facts = [
    ["destination", "New Zealand, with Wellington as the arrival and departure city; other cities may be included"],
    ["purpose", "Representative scenery and culture"],
    ["travel_dates", "2026-12-12 to 2026-12-25"],
    ["arrival", "Shanghai to WLG at 15:00"],
    ["departure", "WLG at 18:00"],
    ["party_size", "2"],
    ["transport_preference", "Landi推荐"],
    ["constraints", "Total budget around RMB 10,000"]
  ].map(([key, value]) => ({ key: key!, value: value!, source: "user" as const, confirmed: true, updatedAt: now }));
  assert.deepEqual(missingGenerationQuestions(facts).map((question) => question.key), ["budget_scope"]);
  const answered = applyPlanningTurn({ ...createPlanningSession(), facts }, "不包含国际机票").session;
  assert.equal(answered.facts.find((fact) => fact.key === "budget_scope")?.value, "excludes international flights");
  assert.equal(missingGenerationQuestions(answered.facts).length, 0);
  assert.deepEqual(planningResearchScopes({ facts }), [
    "New Zealand: signature travel regions and route options (entry/exit Wellington)",
    "New Zealand: representative regions beyond Wellington (candidate overnight bases)"
  ]);

  const awaitingScope = { ...createPlanningSession(), status: "proposal_confirmed" as const, facts, unresolved: missingGenerationQuestions(facts) };
  const shortAnswer = applyPlanningTurn(awaitingScope, "不包含").session;
  assert.equal(shortAnswer.facts.find((item) => item.key === "budget_scope")?.value, "excludes international flights");
  assert.equal(shortAnswer.unresolved.length, 0);
  const agentAnswer = applyAgentPlanningTurn(awaitingScope, "包含", {
    reply: "Please clarify the budget coverage.", facts: [],
    clarification: { key: "budget_scope", question: "Does it include flights?" }
  }).session;
  assert.equal(agentAnswer.facts.find((item) => item.key === "budget_scope")?.value, "includes international flights");
  assert.equal(agentAnswer.unresolved.length, 0);

  const budgetAddedAfterOtherAnswers = applyPlanningTurn({ ...createPlanningSession(), facts: facts.filter((item) => item.key !== "constraints") }, "预算约1万元人民币").session;
  assert.equal(budgetAddedAfterOtherAnswers.status, "proposal_ready");
  assert.deepEqual(budgetAddedAfterOtherAnswers.unresolved.map((item) => item.key), ["budget_scope"]);
});

test("Agent omissions cannot make a user-stated budget look complete", () => {
  const originalMessage = "我们两个人2026年12月12日至12月25日去新西兰；不想频繁换酒店，总预算约1万元人民币。";
  const turn = applyAgentPlanningTurn(createPlanningSession(), originalMessage, {
    reply: "I have the route preferences.",
    facts: [
      { key: "destination", value: "New Zealand" }, { key: "purpose", value: "Holiday" },
      { key: "travel_dates", value: "2026-12-12 to 2026-12-25" },
      { key: "arrival", value: "Shanghai to Wellington Airport at 15:00" },
      { key: "departure", value: "Wellington Airport at 18:00" },
      { key: "party_size", value: "2 people" }, { key: "transport_preference", value: "public transport" },
      { key: "constraints", value: "Avoid frequent hotel changes" }
    ]
  });
  assert.equal(turn.session.status, "proposal_ready");
  assert.match(turn.session.facts.find((item) => item.key === "constraints")?.value ?? "", /1万元人民币/);
  assert.deepEqual(turn.session.unresolved.map((item) => item.key), ["budget_scope"]);

  const stale = { ...turn.session, facts: turn.session.facts.map((item) => item.key === "constraints" ? { ...item, value: "Avoid frequent hotel changes" } : item), unresolved: [] };
  assert.deepEqual(missingGenerationQuestions(stale.facts, stale.messages).map((item) => item.key), ["budget_scope"]);
  const answered = applyAgentPlanningTurn(stale, "不包含", { reply: "Understood.", facts: [] }).session;
  assert.equal(answered.facts.find((item) => item.key === "budget_scope")?.value, "excludes international flights");
  assert.match(answered.facts.find((item) => item.key === "constraints")?.value ?? "", /1万元人民币/);
  assert.match(answered.facts.find((item) => item.key === "constraints")?.value ?? "", /Avoid frequent hotel changes/);
  assert.equal(answered.unresolved.length, 0);
});

test("planning turns collect facts before producing a proposal", () => {
  const first = applyPlanningTurn(createPlanningSession(new Date("2026-08-17T00:00:00.000Z")), "我想去葡萄牙");
  assert.equal(first.session.status, "collecting");
  assert.equal(first.session.proposal, undefined);
  assert.match(first.reply, /when will you go/i);

  const second = applyPlanningTurn(first.session, "大约10天，主要看建筑和当地生活");
  assert.equal(second.session.status, "proposal_ready");
  assert.equal(second.session.proposal?.version, 1);
  assert.equal(second.session.messages.filter((message) => message.role === "user").length, 2);
  assert.match(second.reply, /Confirm Proposal and Create Plan/i);
});

test("external booking facts can complete proposal direction and stay in generation context", () => {
  const session = applyPlanningTurn(createPlanningSession(), "我想去东京看建筑").session;
  const enriched = applyExternalPlanningFacts(session, [
    { key: "purpose", value: "看建筑", source: "inferred", confirmed: true, updatedAt: "2026-08-27T00:00:00.000Z" },
    { key: "travel_dates", value: "2026-10-08 to 2026-10-14", source: "inferred", confirmed: true, updatedAt: "2026-08-27T00:00:00.000Z" },
    { key: "arrival", value: "Depart from SFO, arrive at HND, end 2026-10-09T14:30", source: "inferred", confirmed: true, updatedAt: "2026-08-27T00:00:00.000Z" },
    { key: "departure", value: "Depart from HND, arrive at SFO, start 2026-10-14T17:10", source: "inferred", confirmed: true, updatedAt: "2026-08-27T00:00:00.000Z" }
  ], new Date("2026-08-27T00:00:00.000Z"));
  assert.equal(enriched.status, "proposal_ready");
  const confirmed = { ...enriched, status: "proposal_confirmed" as const, confirmedProposalVersion: enriched.proposal!.version };
  const completed = applyExternalPlanningFacts(confirmed, [
    { key: "party_size", value: "2人", source: "inferred", confirmed: true, updatedAt: "2026-08-27T00:00:00.000Z" },
    { key: "transport_preference", value: "Landi推荐", source: "inferred", confirmed: true, updatedAt: "2026-08-27T00:00:00.000Z" }
  ], new Date("2026-08-27T00:01:00.000Z"));
  const booking: TravelBooking = {
    id: "booking-1", planningSessionId: completed.id, type: "flight", status: "confirmed", title: "UA123 flight", source: "imported_email", sourceHash: "hash", sourceLabel: "United email", importedAt: "2026-08-27T00:00:00.000Z", updatedAt: "2026-08-27T00:00:00.000Z", constraintStrength: "hard",
    segments: [{ id: "segment-1", segmentType: "flight_leg", title: "Outbound", status: "confirmed", startAtLocal: "2026-10-08T10:00", endAtLocal: "2026-10-09T14:30", origin: "SFO", destination: "HND", constraintStrength: "hard", fixedCommitment: true, needsReviewReasons: [] }]
  };
  const request = planningRequestForGenerationWithBookings(completed, [booking]);
  assert.match(request, /Accepted booking constraints/);
  assert.match(request, /HARD flight/);
  assert.doesNotMatch(request, /ABC12345/);
});

test("inferred booking dates and destinations cannot replace user-confirmed trip scope", () => {
  const session = {
    ...createPlanningSession(),
    facts: [
      { key: "destination", value: "Porto, Portugal", source: "user" as const, confirmed: true, updatedAt: now },
      { key: "travel_dates", value: "2026-11-10 to 2026-11-14", source: "user" as const, confirmed: true, updatedAt: now }
    ]
  };
  const updated = applyExternalPlanningFacts(session, [
    { key: "destination", value: "Praca da Batalha, Porto, Portugal", source: "inferred", confirmed: true, updatedAt: now },
    { key: "travel_dates", value: "2026-11-11 to 2026-11-12", source: "inferred", confirmed: true, updatedAt: now },
    { key: "accommodation_location", value: "Praca da Batalha, Porto, Portugal", source: "inferred", confirmed: true, updatedAt: now }
  ], new Date(now));

  assert.equal(updated.facts.find((fact) => fact.key === "destination")?.value, "Porto, Portugal");
  assert.equal(updated.facts.find((fact) => fact.key === "travel_dates")?.value, "2026-11-10 to 2026-11-14");
  assert.equal(updated.facts.find((fact) => fact.key === "accommodation_location")?.value, "Praca da Batalha, Porto, Portugal");
});

test("an imported hotel cannot manufacture a confirmed destination before the user supplies one", () => {
  const session = applyExternalPlanningFacts(createPlanningSession(), [
    { key: "accommodation", value: "Porto hotel at Praca da Batalha, Porto, Portugal", source: "inferred", confirmed: true, updatedAt: now },
    { key: "accommodation_location", value: "Praca da Batalha, Porto, Portugal", source: "inferred", confirmed: true, updatedAt: now }
  ], new Date(now));
  assert.equal(session.facts.some((fact) => fact.key === "destination"), false);
  assert.equal(session.unresolved.some((item) => item.key === "destination"), true);

  const confirmedByUser = applyExternalPlanningFacts(session, [
    { key: "destination", value: "Porto, Portugal", source: "user", confirmed: true, updatedAt: now }
  ], new Date(now));
  assert.equal(confirmedByUser.facts.find((fact) => fact.key === "destination")?.value, "Porto, Portugal");
  assert.equal(confirmedByUser.facts.find((fact) => fact.key === "destination")?.source, "user");
});

test("accepted accommodation bookings add overnight departure continuity to generation context", () => {
  const session = applyPlanningTurn(createPlanningSession(), "我想去巴黎旅行7天，主要看艺术；2026年10月6日至10月12日；3个人出行；交通倾向于Landi推荐；从上海出发，抵达戴高乐机场，预计14:30到达；返程从戴高乐机场预计18:20离开").session;
  const confirmed = { ...session, status: "proposal_confirmed" as const, confirmedProposalVersion: session.proposal!.version };
  const booking: TravelBooking = {
    id: "hotel-booking",
    planningSessionId: confirmed.id,
    type: "accommodation",
    status: "confirmed",
    title: "Hotel A",
    source: "user",
    sourceHash: "hash",
    sourceLabel: "Manual hotel entry",
    importedAt: "2026-08-27T00:00:00.000Z",
    updatedAt: "2026-08-27T00:00:00.000Z",
    constraintStrength: "hard",
    segments: [{
      id: "hotel-segment",
      segmentType: "hotel_stay",
      title: "Hotel A stay",
      status: "confirmed",
      startAtLocal: "2026-10-06T15:00",
      endAtLocal: "2026-10-09T11:00",
      location: "1 Rue Example, Paris",
      constraintStrength: "hard",
      fixedCommitment: true,
      needsReviewReasons: []
    }]
  };
  const request = planningRequestForGenerationWithBookings(confirmed, [booking]);
  assert.match(request, /Accommodation continuity rule/i);
  assert.match(request, /each destination night needs an overnight base, and the next morning starts there/i);
  assert.match(request, /Preserve any accepted hotel booking/i);
  assert.match(request, /Destination strategy rule: first identify the destination's defining travel experiences/i);
  assert.match(request, /HARD accommodation: Hotel A/);
  assert.match(request, /hotel_stay|Hotel A stay|1 Rue Example, Paris/i);
});

test("editing a ready proposal preserves known facts and increments its version", () => {
  const first = applyPlanningTurn(createPlanningSession(), "我想去葡萄牙旅行10天，主要看建筑和当地生活；从上海出发，抵达里斯本机场，预计14:30到达");
  assert.equal(first.session.proposal?.version, 1);

  const revised = applyPlanningTurn(first.session, "改成7天，节奏轻松一些");
  assert.equal(revised.session.status, "proposal_ready");
  assert.equal(revised.session.proposal?.version, 2);
  assert.equal(revised.session.facts.find((fact) => fact.key === "destination")?.value, "葡萄牙");
  assert.equal(revised.session.facts.find((fact) => fact.key === "timing")?.value, "7天");
  assert.doesNotMatch(revised.reply, /这次想去哪里/);
});

test("transport and other follow-up preferences update only their own facts", () => {
  const first = applyPlanningTurn(createPlanningSession(), "我想去巴黎玩，10月6号出发，16号回来，3个人出行；从上海出发，抵达戴高乐机场，预计14:30到达");
  const destination = first.session.facts.find((fact) => fact.key === "destination")?.value;
  const purpose = first.session.facts.find((fact) => fact.key === "purpose")?.value;

  const transport = applyPlanningTurn(first.session, "交通倾向于打车");
  assert.equal(transport.session.facts.find((fact) => fact.key === "destination")?.value, destination);
  assert.equal(transport.session.facts.find((fact) => fact.key === "purpose")?.value, purpose);
  assert.equal(transport.session.facts.find((fact) => fact.key === "transport_preference")?.value, "打车");
  assert.equal(transport.session.facts.find((fact) => fact.key === "party_size")?.value, "3人");
  assert.equal(planningPartySize(transport.session), 3);
  assert.equal(planningTransportPreference(transport.session), "taxi");
  assert.match(transport.session.proposal?.title ?? "", /^巴黎 ·/);

  const accommodation = applyPlanningTurn(transport.session, "住宿还没有预订");
  assert.equal(accommodation.session.facts.find((fact) => fact.key === "destination")?.value, destination);
  assert.equal(accommodation.session.facts.find((fact) => fact.key === "accommodation")?.value, "住宿还没有预订");
});

test("confirmed Chinese party counts become structured Plan context", () => {
  const result = applyPlanningTurn(createPlanningSession(), "我想去巴黎旅行7天，主要看建筑，三个人出行");
  assert.equal(planningPartySize(result.session), 3);
  const twenty = applyPlanningTurn(createPlanningSession(), "我想去巴黎旅行7天，主要看建筑，二十人同行");
  assert.equal(planningPartySize(twenty.session), 20);
});

test("a full date range is retained as one timing fact", () => {
  const at = new Date("2026-09-28T10:00:00");
  const result = applyPlanningTurn(createPlanningSession(at), "我想去巴黎旅行，10月6日至10月16日，主要看艺术和建筑", at);
  assert.equal(result.session.facts.find((fact) => fact.key === "timing")?.value, "10月6日至10月16日");
  assert.equal(result.session.facts.find((fact) => fact.key === "travel_dates")?.value, "2026年10月6日至10月16日");
  assert.equal(result.session.facts.find((fact) => fact.key === "travel_year"), undefined);
});

test("yearless date ranges use the current year, while an explicit year wins", () => {
  const at = new Date("2026-09-28T10:00:00");
  for (const [message, expected] of [
    ["October 6–16", "October 6–16, 2026"],
    ["10/6 to 10/16", "2026-10-06 to 2026-10-16"],
    ["明年10月6日至10月16日", "2027年10月6日至10月16日"],
    ["2027年10月6日至10月16日", "2027年10月6日至10月16日"]
  ] as Array<[string, string]>) {
    const result = applyPlanningTurn(createPlanningSession(at), message, at);
    assert.equal(result.session.facts.find((fact) => fact.key === "travel_dates")?.value, expected, message);
  }
  const selectedYear = applyPlanningTurn(createPlanningSession(at), "2027年", at);
  const laterDates = applyPlanningTurn(selectedYear.session, "10月6日至10月16日", at);
  assert.equal(laterDates.session.facts.find((fact) => fact.key === "travel_dates")?.value, "2027年10月6日至10月16日");
  const correctedYear = applyPlanningTurn(applyPlanningTurn(createPlanningSession(at), "10月6日至10月16日", at).session, "改成2027年", at);
  assert.equal(correctedYear.session.facts.find((fact) => fact.key === "travel_dates")?.value, "2027-10-06 to 2027-10-16");
});

test("an arrival date does not replace the stated trip duration", () => {
  const result = applyPlanningTurn(createPlanningSession(), "我想去葡萄牙旅行10天，主要看建筑；抵达里斯本机场，航班预计10月12日14:30到达");
  assert.equal(result.session.facts.find((fact) => fact.key === "timing")?.value, "10天");
});

test("proposal confirmation collects generation-critical facts while accommodation remains optional", () => {
  const proposed = applyPlanningTurn(createPlanningSession(), "我想去巴黎旅行7天，主要看艺术；住宿还没有预订");
  assert.equal(proposed.session.status, "proposal_ready");
  const proposalVersion = proposed.session.proposal?.version;
  assert.equal(typeof proposalVersion, "number");
  const confirmed = { ...proposed.session, status: "proposal_confirmed" as const, ...(proposalVersion === undefined ? {} : { confirmedProposalVersion: proposalVersion }) };
  const prepared = prepareConfirmedPlanningSession(confirmed);
  assert.match(prepared.reply, /use this year/i);

  const notBooked = applyPlanningTurn(prepared.session, "2026年10月6日至10月16日，我还没订机票");
  assert.equal(notBooked.session.status, "proposal_confirmed");
  assert.match(notBooked.reply, /time can stay unconfirmed until you book/i);

  const ready = applyPlanningTurn(notBooked.session, "3个人出行，交通倾向于打车；从上海出发，抵达戴高乐机场，预计14:30到达；返程从戴高乐机场预计18:20离开");
  assert.equal(ready.session.status, "proposal_confirmed");
  assert.equal(ready.session.unresolved.length, 0);
  assert.equal(ready.session.facts.find((fact) => fact.key === "accommodation")?.value, "住宿还没有预订");
  assert.equal(ready.session.facts.find((fact) => fact.key === "arrival_status"), undefined);
  assert.equal(ready.reply, "Got it. I have enough to start building the plan.");
});

test("generation-detail chat remembers a short year and asks only for the remaining dates", () => {
  const proposed = applyPlanningTurn(createPlanningSession(), "我想去巴黎旅行10天，主要看艺术和建筑");
  const confirmed = { ...proposed.session, status: "proposal_confirmed" as const, confirmedProposalVersion: proposed.session.proposal!.version };
  const year = applyPlanningTurn(confirmed, "26年");
  assert.equal(year.session.facts.find((item) => item.key === "travel_year")?.value, "2026");
  assert.match(year.reply, /Year: 2026/i);
  assert.match(year.reply, /exact departure and return dates/i);
  assert.doesNotMatch(year.reply, /还没有足够的已知信息|travel_year=/);

  const dates = applyPlanningTurn(year.session, "10月6日至10月16日");
  assert.equal(dates.session.facts.find((item) => item.key === "travel_dates")?.value, "2026年10月6日至10月16日");
  assert.match(dates.reply, /Travel dates: 2026年10月6日至10月16日/i);
});

test("confirmed display dates resolve to one strict internal date-only range", () => {
  assert.deepEqual(planningTravelDateRange("2026年10月6日至10月16日"), { startDate: "2026-10-06", endDate: "2026-10-16" });
  assert.deepEqual(planningTravelDateRange("October 3–12, 2026"), { startDate: "2026-10-03", endDate: "2026-10-12" });
  assert.deepEqual(planningTravelDateRange("2026-10-03 to 2026-10-12"), { startDate: "2026-10-03", endDate: "2026-10-12" });
});

test("ambiguous, impossible, and reversed dates remain unresolved before generation", () => {
  const base = [
    { key: "arrival", value: "DPS at 13:50", source: "user" as const, confirmed: true, updatedAt: now },
    { key: "departure", value: "DPS at 14:25", source: "user" as const, confirmed: true, updatedAt: now },
    { key: "party_size", value: "3 people", source: "user" as const, confirmed: true, updatedAt: now },
    { key: "transport_preference", value: "Landi推荐", source: "user" as const, confirmed: true, updatedAt: now }
  ];
  for (const value of ["10/3 to 10/12", "2026-02-30 to 2026-03-02", "2026-10-12 to 2026-10-03"]) {
    const unresolved = missingGenerationQuestions([...base, { key: "travel_dates", value, source: "user", confirmed: true, updatedAt: now }]);
    assert.equal(unresolved[0]?.key, "travel_dates", value);
  }
});

test("generation uses canonical date-only context without rewriting display dates or booking local times", () => {
  const completed = applyAgentPlanningTurn(createPlanningSession(), "Bali dates", {
    reply: "Dates noted.",
    facts: [
      { key: "destination", value: "Bali, Indonesia" },
      { key: "purpose", value: "Vacation" },
      { key: "travel_dates", value: "October 3–12, 2026" },
      { key: "arrival", value: "DPS on October 5, 2026 at 13:50 local time" },
      { key: "departure", value: "DPS on October 12, 2026 at 14:25 local time" },
      { key: "party_size", value: "3 people" },
      { key: "transport_preference", value: "Landi推荐" }
    ]
  }).session;
  const proposal = completed.proposal!;
  const confirmed = { ...completed, status: "proposal_confirmed" as const, confirmedProposalVersion: proposal.version };
  const booking: TravelBooking = {
    id: "flight-local-time", planningSessionId: confirmed.id, type: "flight", status: "confirmed", title: "Arrival flight", source: "user", sourceHash: "flight", sourceLabel: "User flight", importedAt: now, updatedAt: now, constraintStrength: "hard",
    segments: [{ id: "arrival", segmentType: "flight_leg", title: "Arrival", status: "confirmed", startAtLocal: "2026-10-04T18:15", endAtLocal: "2026-10-05T13:50", origin: "LAX", destination: "DPS", constraintStrength: "hard", fixedCommitment: true, needsReviewReasons: [] }]
  };
  const request = planningRequestForGenerationWithBookings(confirmed, [booking]);
  assert.match(request, /travel_dates: October 3–12, 2026/);
  assert.match(request, /authoritative for itinerary days\): 2026-10-03 to 2026-10-12/);
  assert.match(request, /start 2026-10-04T18:15; end 2026-10-05T13:50/);
  assert.equal(confirmed.facts.find((fact) => fact.key === "travel_dates")?.value, "October 3–12, 2026");
});

test("generation-detail chat retains partial arrival facts and asks only for the airport", () => {
  const proposed = applyPlanningTurn(createPlanningSession(), "我想去巴黎旅行10天，主要看艺术和建筑");
  const confirmed = { ...proposed.session, status: "proposal_confirmed" as const, confirmedProposalVersion: proposed.session.proposal!.version };
  const dates = applyPlanningTurn(confirmed, "2026年10月6日至10月16日");
  const partial = applyPlanningTurn(dates.session, "我从美国芝加哥出发，预计下午4点钟落地巴黎");
  assert.equal(partial.session.facts.find((item) => item.key === "arrival_origin")?.value, "美国芝加哥");
  assert.equal(partial.session.facts.find((item) => item.key === "arrival_time")?.value, "下午4点");
  assert.match(partial.reply, /Departure point: 美国芝加哥/i);
  assert.match(partial.reply, /Expected arrival: 下午4点/i);
  assert.match(partial.reply, /Which airport or station will you arrive at/i);
  assert.doesNotMatch(partial.reply, /还没有足够的已知信息|arrival_origin=/);

  const airport = applyPlanningTurn(partial.session, "戴高乐机场");
  assert.equal(airport.session.facts.find((item) => item.key === "arrival")?.value, "Depart from 美国芝加哥, arrive at 戴高乐机场 at about 下午4点");
  assert.match(airport.reply, /return trip/i);
});

test("Agent-led planning turns persist structured facts while showing the Agent's natural reply", () => {
  const first = applyAgentPlanningTurn(createPlanningSession(), "我想去巴黎", { reply: "巴黎很适合慢慢看。你大约准备去多久？", facts: [{ key: "destination", value: "巴黎" }, { key: "purpose", value: "旅行" }] });
  assert.equal(first.reply, "巴黎很适合慢慢看。你大约准备去多久？");
  assert.equal(first.session.facts.find((item) => item.key === "destination")?.value, "巴黎");
  assert.equal(first.session.unresolved[0]?.key, "timing");
  const ready = applyAgentPlanningTurn(first.session, "大约10天", { reply: "明白，我会按10天的节奏整理提案。", facts: [{ key: "timing", value: "10天" }] });
  assert.equal(ready.session.status, "proposal_ready");
  assert.match(ready.reply, /Before I can generate the plan: Share the departure and return month\/day/);
  assert.equal(ready.session.proposal?.objective.includes("10天"), true);
  assert.equal(ready.session.unresolved[0]?.key, "travel_dates");
  assert.equal(ready.session.confirmedProposalVersion, undefined);
});

test("an Agent follow-up does not duplicate the deterministic generation question", () => {
  const first = applyAgentPlanningTurn(createPlanningSession(), "我想去杭州玩三天", {
    reply: "杭州很适合慢慢逛。你打算几个人去？",
    facts: [{ key: "destination", value: "杭州" }, { key: "purpose", value: "游览西湖" }, { key: "timing", value: "三天" }]
  });
  assert.equal(first.reply, first.session.unresolved[0]?.question);
  assert.doesNotMatch(first.reply, /你打算几个人去/);
});

test("unbooked rail travel preserves the user's route without requiring invented station times", () => {
  const message = "我们两个人10月10日至12日从上海坐高铁去杭州玩，车票和酒店都没订，想看西湖和园林，12号返回上海。";
  const turn = applyAgentPlanningTurn(createPlanningSession(), message, {
    reply: "你到杭州东站的准确时间是几点？",
    facts: [
      { key: "destination", value: "杭州" }, { key: "purpose", value: "看西湖和园林" },
      { key: "transport_preference", value: "公共交通" },
      { key: "arrival", value: "Hangzhou East Station at 09:00" },
      { key: "departure", value: "Hangzhou East Station at 17:00" }
    ],
    clarification: { key: "arrival", question: "Which exact station and time?" }
  }, new Date("2026-10-04T00:00:00.000Z"));
  assert.equal(turn.session.facts.find((fact) => fact.key === "arrival_status")?.value, "not_booked");
  assert.equal(turn.session.facts.find((fact) => fact.key === "arrival_origin")?.value, "上海");
  assert.equal(turn.session.facts.find((fact) => fact.key === "departure_destination")?.value, "上海");
  assert.equal(turn.session.facts.find((fact) => fact.key === "party_size")?.value, "两人");
  assert.equal(turn.session.facts.some((fact) => fact.key === "arrival" || fact.key === "departure"), false);
  assert.deepEqual(missingGenerationQuestions(turn.session.facts, turn.session.messages).map((item) => item.key), []);
});

test("Agent-led planning grounds yearless dates in the user's message and current year", () => {
  const at = new Date("2026-09-28T10:00:00");
  const session = createPlanningSession(at);
  const inferred = applyAgentPlanningTurn(session, "October 6–16", {
    reply: "I noted your dates.",
    facts: [{ key: "travel_dates", value: "October 6–16, 2027" }, { key: "travel_year", value: "2027" }]
  }, at);
  assert.equal(inferred.session.facts.find((item) => item.key === "travel_dates")?.value, "October 6–16, 2026");
  assert.equal(inferred.session.facts.find((item) => item.key === "travel_year"), undefined);

  const explicit = applyAgentPlanningTurn(inferred.session, "明年10月6日至10月16日", {
    reply: "Updated.",
    facts: [{ key: "travel_dates", value: "October 6–16, 2026" }]
  }, at);
  assert.equal(explicit.session.facts.find((item) => item.key === "travel_dates")?.value, "2027年10月6日至10月16日");
  assert.equal(explicit.session.facts.find((item) => item.key === "travel_year")?.value, "2027");

  const omitted = applyAgentPlanningTurn(session, "10月6日至10月16日", { reply: "I noted your dates.", facts: [] }, at);
  assert.equal(omitted.session.facts.find((item) => item.key === "travel_dates")?.value, "2026年10月6日至10月16日");
  const correctedYear = applyAgentPlanningTurn(omitted.session, "改成2027年", { reply: "Updated.", facts: [{ key: "travel_year", value: "2027" }] }, at);
  assert.equal(correctedYear.session.facts.find((item) => item.key === "travel_dates")?.value, "2027-10-06 to 2027-10-16");
});

test("Agent-led planning asks for correction of impossible dates before generation", () => {
  const session = applyAgentPlanningTurn(createPlanningSession(), "Tokyo for museums in October", {
    reply: "I can help plan Tokyo.",
    facts: [{ key: "destination", value: "Tokyo" }, { key: "purpose", value: "Visit museums" }, { key: "timing", value: "October" }]
  }).session;
  const invalid = applyAgentPlanningTurn(session, "October 16 to October 6, 2026", {
    reply: "I noted the dates.", facts: [{ key: "travel_dates", value: "October 16 to October 6, 2026" }]
  });
  assert.match(invalid.reply, /could not reconcile those travel dates/i);
  assert.equal(invalid.session.facts.some((item) => item.key === "travel_dates"), false);
  assert.equal(invalid.session.unresolved[0]?.key, "travel_dates");
  const corrected = applyAgentPlanningTurn(invalid.session, "October 6 to October 16, 2026", {
    reply: "The corrected dates are clear.", facts: [{ key: "travel_dates", value: "October 6 to October 16, 2026" }]
  });
  assert.equal(corrected.session.facts.find((item) => item.key === "travel_dates")?.value, "October 6 to October 16, 2026");
  assert.equal(corrected.session.status, "proposal_ready");
});

test("an uncertain correction clears an earlier confirmed fact until the user resolves it", () => {
  const ready = applyAgentPlanningTurn(createPlanningSession(), "Tokyo museums, October 6–16, 2026, two travelers", {
    reply: "Review the trip details.",
    facts: [
      { key: "destination", value: "Tokyo" }, { key: "purpose", value: "Visit museums" },
      { key: "travel_dates", value: "2026-10-06 to 2026-10-16" },
      { key: "arrival", value: "Depart SFO, arrive HND at 14:30" },
      { key: "departure", value: "Depart HND at 18:00" },
      { key: "party_size", value: "2" }, { key: "transport_preference", value: "walking" }
    ]
  });
  assert.equal(ready.session.unresolved.length, 0);
  const uncertain = applyAgentPlanningTurn(ready.session, "The return airport may have changed; I am not sure", {
    reply: "Which airport will you depart from for the return trip?", facts: [],
    clarification: { key: "departure", question: "Which airport will you depart from for the return trip?" }
  });
  assert.equal(uncertain.session.facts.some((item) => item.key === "departure"), false);
  assert.equal(uncertain.session.unresolved[0]?.key, "departure");
  assert.match(uncertain.reply, /Which airport/);
  const corrected = applyAgentPlanningTurn(uncertain.session, "Depart NRT at 19:00", {
    reply: "The return airport is now clear.", facts: [{ key: "departure", value: "Depart NRT at 19:00" }]
  });
  assert.equal(corrected.session.unresolved.length, 0);
  assert.equal(corrected.session.facts.find((item) => item.key === "departure")?.value, "Depart NRT at 19:00");
});

test("clarifying a destination preserves the proposal version boundary", () => {
  const proposed = applyAgentPlanningTurn(createPlanningSession(), "Tokyo museums in October", {
    reply: "Tell me the exact dates.", facts: [{ key: "destination", value: "Tokyo" }, { key: "purpose", value: "Visit museums" }, { key: "timing", value: "October" }, { key: "arrival", value: "Arrive at HND at 14:30" }]
  });
  assert.equal(proposed.session.proposal?.version, 1);
  const uncertain = applyAgentPlanningTurn(proposed.session, "It may be Kyoto instead", {
    reply: "Should I plan Tokyo or Kyoto?", facts: [], clarification: { key: "destination", question: "Should I plan Tokyo or Kyoto?" }
  });
  assert.equal(uncertain.session.facts.some((item) => item.key === "destination" || item.key === "arrival"), false);
  assert.equal(uncertain.session.unresolved[0]?.key, "destination");
  const corrected = applyAgentPlanningTurn(uncertain.session, "Kyoto", { reply: "Kyoto it is.", facts: [{ key: "destination", value: "Kyoto" }] });
  assert.equal(corrected.session.proposal?.version, 2);
  assert.match(corrected.session.proposal?.title ?? "", /^Kyoto/);
});

test("complete travel dates satisfy the earlier broad timing question", () => {
  const result = applyAgentPlanningTurn(createPlanningSession(), "2026年10月6日至10月17日去巴黎求婚", {
    reply: "日期和目标已经记下。",
    facts: [
      { key: "destination", value: "巴黎" },
      { key: "purpose", value: "求婚" },
      { key: "travel_year", value: "2026" },
      { key: "travel_dates", value: "2026年10月6日至10月17日" }
    ]
  });
  assert.equal(result.session.status, "proposal_ready");
  assert.equal(result.session.unresolved.some((item) => item.key === "timing"), false);
  assert.match(result.session.proposal?.objective ?? "", /2026年10月6日至10月17日/);
});

test("destination changes only when the user explicitly supplies a new destination", () => {
  const first = applyPlanningTurn(createPlanningSession(), "我想去巴黎旅行7天，主要看建筑；抵达戴高乐机场，预计14:30到达");
  const purpose = first.session.facts.find((fact) => fact.key === "purpose")?.value;
  const revised = applyPlanningTurn(first.session, "目的地改成伦敦");
  assert.equal(revised.session.facts.find((fact) => fact.key === "destination")?.value, "伦敦");
  assert.equal(revised.session.facts.find((fact) => fact.key === "purpose")?.value, purpose);
  assert.equal(revised.session.facts.find((fact) => fact.key === "arrival"), undefined);
  assert.equal(revised.session.status, "proposal_ready");
  assert.match(revised.session.proposal?.title ?? "", /^伦敦 ·/);
});

test("an explicit goal correction stores the goal content rather than the correction instruction", () => {
  const first = applyPlanningTurn(createPlanningSession(), "我想去巴黎旅行7天，主要看建筑；抵达戴高乐机场，预计14:30到达");
  const revised = applyPlanningTurn(first.session, "目标是轻松体验巴黎的艺术和建筑");
  assert.equal(revised.session.facts.find((fact) => fact.key === "purpose")?.value, "轻松体验巴黎的艺术和建筑");
});

test("unseen Chinese travel scenarios produce bounded proposals from the three required facts", () => {
  const scenarios = [
    { request: "我想去日本旅行7天，主要体验温泉和当地饮食；抵达成田机场，预计14:30到达", destination: "日本", timing: "7天" },
    { request: "我计划去柏林旅行一周，主要参加马拉松并参观博物馆；抵达柏林机场，预计15:20到达", destination: "柏林", timing: "一周" },
    { request: "我想去清迈旅居一个月，主要远程工作和体验当地生活；抵达清迈机场，预计16:00到达", destination: "清迈", timing: "一个月" }
  ];
  for (const scenario of scenarios) {
    const result = applyPlanningTurn(createPlanningSession(), scenario.request);
    assert.equal(result.session.status, "proposal_ready", scenario.request);
    assert.equal(result.session.facts.find((fact) => fact.key === "destination")?.value, scenario.destination);
    assert.equal(result.session.facts.find((fact) => fact.key === "timing")?.value, scenario.timing);
    assert.equal(result.session.proposal?.segments.length, 3);
    assert.equal(result.session.proposal?.decisionPoints.length, 3);
  }
});

test("generation request is blocked until the proposal is confirmed", () => {
  const result = applyPlanningTurn(createPlanningSession(), "我想去葡萄牙旅行10天，主要看建筑");
  assert.equal(result.session.status, "proposal_ready");
  assert.equal(result.session.facts.find((fact) => fact.key === "destination")?.value, "葡萄牙");
  assert.match(result.session.proposal?.title ?? "", /^葡萄牙 ·/);
  assert.throws(() => planningRequestForGeneration(result.session), /confirmed planning proposal/i);

  const version = result.session.proposal?.version;
  assert.equal(typeof version, "number");
  const confirmed = { ...result.session, status: "proposal_confirmed" as const, ...(version === undefined ? {} : { confirmedProposalVersion: version }) };
  assert.throws(() => planningRequestForGeneration(confirmed), /generation-critical facts/i);
  const completed = applyPlanningTurn(confirmed, "2026年10月12日至10月21日，3个人出行，交通倾向于打车；从上海出发，抵达里斯本机场，预计14:30到达；返程从里斯本机场预计18:20离开");
  assert.equal(completed.session.unresolved.length, 0);
  assert.equal(planningArrivalLocalDateTime(completed.session), "2026-10-12T14:30");
  const request = planningRequestForGeneration(completed.session);
  assert.match(request, /user-approved planning proposal/);
  assert.match(request, /葡萄牙/);
  assert.equal(planningRequestForGeneration({ ...completed.session, status: "generating" }), request, "已确认同版本的恢复请求必须保持相同内容。");
  const { confirmedProposalVersion: _confirmed, ...unconfirmed } = completed.session;
  const { proposal: _proposal, ...withoutProposal } = completed.session;
  assert.throws(() => planningRequestForGeneration(unconfirmed), /confirmed planning proposal/i);
  assert.throws(() => planningRequestForGeneration(withoutProposal), /confirmed planning proposal/i);
  for (const invalidVersion of [0, -1, 1.5, completed.session.proposal!.version + 1]) {
    for (const status of ["proposal_confirmed", "generating"] as const) assert.throws(() => planningRequestForGeneration({
      ...completed.session, status, confirmedProposalVersion: invalidVersion
    }), /confirmed planning proposal/i);
  }
  for (const status of ["collecting", "proposal_ready", "draft_ready", "abandoned"] as const) {
    assert.throws(() => planningRequestForGeneration({ ...completed.session, status }), /confirmed planning proposal/i);
  }
});

test("arrival configuration uses the stated arrival date after an overnight outbound journey", () => {
  const session = createPlanningSession();
  session.facts = [
    { key: "travel_dates", value: "October 3–12, 2026", source: "user", confirmed: true, updatedAt: "2026-09-28T00:00:00.000Z" },
    { key: "arrival", value: "From LAX via Singapore, arriving at Bali Denpasar Airport (DPS) on October 5, 2026 at 10:35 local time", source: "user", confirmed: true, updatedAt: "2026-09-28T00:00:00.000Z" }
  ];
  assert.equal(planningArrivalLocalDateTime(session), "2026-10-05T10:35");
  session.facts[1] = {
    ...session.facts[1]!,
    value: "Depart Los Angeles on October 3, 2026 at 16:30 via Singapore, arriving at Bali Denpasar Airport (DPS) on October 5, 2026 at 10:35 local time"
  };
  assert.equal(planningArrivalLocalDateTime(session), "2026-10-05T10:35");
});

test("arrival configuration retains an explicit time before the arrival verb without reusing an outbound time", () => {
  const session = createPlanningSession();
  const fact = (key: string, value: string) => ({ key, value, source: "user" as const, confirmed: true, updatedAt: "2026-10-10T00:00:00.000Z" });
  session.facts = [fact("travel_dates", "2026-11-10 to 2026-11-19"), fact("arrival", "2026-11-10 09:00 抵达东京羽田机场，时间为日本当地时间")];
  assert.equal(planningArrivalLocalDateTime(session), "2026-11-10T09:00");
  session.facts[1] = fact("arrival", "Depart Los Angeles on 2026-11-10 at 16:30, arriving at Haneda Airport; arrival time not provided");
  assert.equal(planningArrivalLocalDateTime(session), undefined);
});

test("changing the destination after proposal confirmation requires a new proposal confirmation", () => {
  const proposed = applyPlanningTurn(createPlanningSession(), "我想去巴黎旅行7天，主要看建筑");
  const version = proposed.session.proposal?.version;
  const confirmed = { ...proposed.session, status: "proposal_confirmed" as const, ...(version === undefined ? {} : { confirmedProposalVersion: version }) };
  const revised = applyPlanningTurn(confirmed, "目的地改成伦敦");
  assert.equal(revised.session.status, "proposal_ready");
  assert.equal(revised.session.confirmedProposalVersion, undefined);
  assert.equal(revised.session.proposal?.version, 2);
  assert.match(revised.reply, /Confirm the direction again/i);
});

test("completed proposal generation is idempotent for the same output Plan", () => {
  const completed = { ...createPlanningSession(), status: "draft_ready" as const, outputPlanId: "plan-1" };
  assert.equal(planningGenerationReuse(completed, "plan-1"), "reuse");
  assert.equal(planningGenerationReuse(completed, "plan-2"), "conflict");
  assert.equal(planningGenerationReuse({ ...completed, status: "proposal_ready" }, "plan-1"), "continue");
});

test("research scopes preserve city-country names while splitting explicit multi-city trips", () => {
  const base = { facts: [] };
  assert.deepEqual(planningResearchScopes({ ...base, facts: [{ key: "destination", value: "Tokyo, Japan", source: "user", confirmed: true, updatedAt: "2026-08-26T00:00:00.000Z" }] }), ["Tokyo, Japan"]);
  assert.deepEqual(planningResearchScopes({ ...base, facts: [{ key: "destination", value: "Japan, mainly Tokyo, Mount Fuji, Kyoto, Nara, and Osaka", source: "user", confirmed: true, updatedAt: "2026-08-26T00:00:00.000Z" }] }), ["Tokyo", "Mount Fuji", "Kyoto", "Nara", "Osaka"]);
  assert.deepEqual(planningResearchScopes({ ...base, facts: [{ key: "destination", value: "东京、京都和大阪", source: "user", confirmed: true, updatedAt: "2026-08-26T00:00:00.000Z" }] }), ["东京", "京都", "大阪"]);
  assert.deepEqual(planningResearchScopes({ ...base, facts: [{ key: "destination", value: "Praca da Batalha, Porto, Portugal", source: "user", confirmed: true, updatedAt: now }] }), ["Praca da Batalha, Porto, Portugal"]);
  assert.deepEqual(planningResearchScopes({ ...base, facts: [{ key: "destination", value: "Lisbon + Porto", source: "user", confirmed: true, updatedAt: now }] }), ["Lisbon", "Porto"]);
  assert.deepEqual(planningResearchScopes({ ...base, facts: [{ key: "destination", value: "New Zealand, with Wellington as the entry and exit city", source: "user", confirmed: true, updatedAt: now }] }), [
    "New Zealand: signature travel regions and route options (entry/exit Wellington)",
    "New Zealand: representative regions beyond Wellington (candidate overnight bases)"
  ]);
  assert.deepEqual(planningResearchScopes({ ...base, facts: [
    { key: "destination", value: "New Zealand", source: "user", confirmed: true, updatedAt: now },
    { key: "arrival_node", value: "Auckland Airport (AKL)", source: "user", confirmed: true, updatedAt: now },
    { key: "departure", value: "Auckland Airport (AKL), 3:00 PM on November 17", source: "user", confirmed: true, updatedAt: now },
    { key: "travel_dates", value: "November 2–17, 2026", source: "user", confirmed: true, updatedAt: now }
  ] }), [
    "New Zealand: signature travel regions and route options (entry/exit Auckland)",
    "New Zealand: representative regions beyond Auckland (candidate overnight bases)"
  ]);
  assert.deepEqual(planningResearchScopes({ ...base, facts: [
    { key: "destination", value: "Tokyo", source: "user", confirmed: true, updatedAt: now },
    { key: "arrival_node", value: "Tokyo International Airport", source: "user", confirmed: true, updatedAt: now },
    { key: "departure", value: "Tokyo International Airport", source: "user", confirmed: true, updatedAt: now }
  ] }), ["Tokyo"]);
  assert.deepEqual(planningResearchScopes({ ...base, facts: [{ key: "destination", value: "新西兰，惠灵顿进出", source: "user", confirmed: true, updatedAt: now }] }), [
    "新西兰: signature travel regions and route options (entry/exit 惠灵顿)",
    "新西兰: representative regions beyond 惠灵顿 (candidate overnight bases)"
  ]);
  assert.deepEqual(planningResearchScopes({ ...base, facts: [
    { key: "destination", value: "New Zealand, with Wellington as the entry and exit city", source: "user", confirmed: true, updatedAt: now },
    { key: "constraints", value: "Only Wellington; no intercity travel", source: "user", confirmed: true, updatedAt: now }
  ] }), ["Wellington"]);
});

test("accommodation destination conflicts retain matching multi-base stays and flag genuine mismatches", () => {
  const session = {
    ...createPlanningSession(),
    facts: [{ key: "destination", value: "Lisbon + Porto", source: "user" as const, confirmed: true, updatedAt: now }]
  };
  const stay = (id: string, location: string): TravelBooking => ({
    id, type: "accommodation", status: "confirmed", title: id, source: "user", sourceHash: id, sourceLabel: "fixture", importedAt: now, updatedAt: now, constraintStrength: "hard",
    segments: [{ id: `${id}-segment`, segmentType: "hotel_stay", title: id, status: "confirmed", location, constraintStrength: "hard", fixedCommitment: true, needsReviewReasons: [] }]
  });
  assert.deepEqual(planningAccommodationDestinationConflicts(session, [stay("lisbon", "Rua Example, Lisbon, Portugal"), stay("porto", "Praca Example, Porto, Portugal")]), []);
  assert.deepEqual(planningAccommodationDestinationConflicts(session, [stay("madrid", "Calle Example, Madrid, Spain")]), ["Calle Example, Madrid, Spain"]);
});


test("unlimited budget does not treat dates and party size elsewhere as an amount", () => {
  const messages = [{ id: "m", role: "user" as const, text: "2026-10-20到22日，2个人去杭州。不设固定预算，优先舒适和性价比。", createdAt: now }];
  assert.equal(missingGenerationQuestions([], messages).some((item) => item.key === "budget_scope"), false);
  messages[0]!.text = "Two people in Hangzhou from 2026-10-20 to 22, no fixed budget.";
  assert.equal(missingGenerationQuestions([], messages).some((item) => item.key === "budget_scope"), false);
  messages[0]!.text = "2026-10-20 两个人去杭州，预算还没确定。";
  assert.equal(missingGenerationQuestions([], messages).some((item) => item.key === "budget_scope"), false);
  messages[0]!.text = "A budget for 2 adults has not been decided.";
  assert.equal(missingGenerationQuestions([], messages).some((item) => item.key === "budget_scope"), false);
  messages[0]!.text = "两个人10月20到22日去杭州，预算约1万元人民币。";
  assert.equal(missingGenerationQuestions([], messages).some((item) => item.key === "budget_scope"), true);
});


test('English traveller counts are accepted and passed into generation without another question', () => {
 for (const value of ['Two adults', '2 people', 'two travelers', '两人']) assert.equal(partySizeNumber(value), 2);
 for (const value of ['0 adults', '-2', '2026', 'two adults and one child', 'unknown']) assert.equal(partySizeNumber(value), undefined);
 const turn = applyAgentPlanningTurn(createPlanningSession(), 'Two adults will travel.', {reply:'Thanks.',facts:[{key:'party_size',value:'Two adults'}]}, new Date(now));
 assert.equal(turn.session.facts.find(f => f.key === 'party_size')?.value, '2');
 assert.equal(turn.session.unresolved.some(f => f.key === 'party_size'), false);
 assert.equal(planningPartySize(turn.session), 2);
 const legacy = {...turn.session, facts:[{key:'party_size',value:'2 people',confirmed:true,source:'user' as const,updatedAt:now}]};
 assert.equal(planningPartySize(legacy), 2);
});
