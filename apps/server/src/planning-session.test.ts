import assert from "node:assert/strict";
import test from "node:test";
import type { TravelBooking } from "@c-assistant/core";
import { applyAgentPlanningTurn, applyExternalPlanningFacts, applyPlanningTurn, createPlanningSession, planningArrivalLocalDateTime, planningGenerationReuse, planningPartySize, planningRequestForGeneration, planningRequestForGenerationWithBookings, planningResearchScopes, planningTransportPreference, prepareConfirmedPlanningSession } from "./planning-session.js";

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
  const result = applyPlanningTurn(createPlanningSession(), "我想去巴黎旅行，10月6日至10月16日，主要看艺术和建筑");
  assert.equal(result.session.facts.find((fact) => fact.key === "timing")?.value, "10月6日至10月16日");
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
  assert.match(prepared.reply, /including the year/i);

  const notBooked = applyPlanningTurn(prepared.session, "2026年10月6日至10月16日，我还没订机票");
  assert.equal(notBooked.session.status, "proposal_confirmed");
  assert.match(notBooked.reply, /After booking/i);

  const ready = applyPlanningTurn(notBooked.session, "3个人出行，交通倾向于打车；从上海出发，抵达戴高乐机场，预计14:30到达；返程从戴高乐机场预计18:20离开");
  assert.equal(ready.session.status, "proposal_confirmed");
  assert.equal(ready.session.unresolved.length, 0);
  assert.equal(ready.session.facts.find((fact) => fact.key === "accommodation")?.value, "住宿还没有预订");
  assert.equal(ready.session.facts.find((fact) => fact.key === "arrival_status"), undefined);
  assert.match(ready.reply, /Create Complete Plan/i);
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
  assert.equal(ready.reply, "明白，我会按10天的节奏整理提案。");
  assert.equal(ready.session.proposal?.objective.includes("10天"), true);
  assert.equal(ready.session.unresolved.length, 0);
  assert.equal(ready.session.confirmedProposalVersion, undefined);
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
});
