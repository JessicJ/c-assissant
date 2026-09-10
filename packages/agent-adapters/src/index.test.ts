import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import test from "node:test";

import { importSkillItinerary, importSkillResearchBatches } from "@c-assistant/core";
import { LANDI_BLUEPRINT_SKILL, LEGACY_BLUEPRINT_SKILL } from "./landi-blueprint-policy.js";
import { ClaudeCodeRuntimeAdapter, CodexRuntimeAdapter, RuntimeAdapterError, areLocationsCompatible, buildPlanDraftPrompt, buildPlanRepairPrompt, buildPlanResearchPrompt, buildSkillImageEnrichmentPrompt, buildSkillItineraryPrompt, buildSkillResearchBatchPrompt, codexStrictOutputSchema, parseClaudePrintResult, parsePlanDraft, parsePlanResearchBrief, parsePlanningConversationTurn, parseSkillImageEnrichmentArtifact, parseSkillItineraryArtifact, parseSkillResearchBatchArtifact, planDraftSchema, planResearchBriefToSkillBatch, planResearchSchema, skillImageEnrichmentSchema, skillItinerarySchema, skillResearchBatchSchema, type RuntimeProcess } from "./index.js";

const validDraft = JSON.stringify({
  title: "Attend an exhibition in Shanghai",
  location: "Shanghai, China",
  dates: "September 2026",
  knownInformation: ["Purpose: exhibition"],
  assumptions: ["Accommodation is unconfirmed."],
  nextAction: "Review the complete Plan.",
  presentation: { kind: "timeline", summary: "A non-spatial execution timeline.", days: [], places: [], routeSegments: [] },
  sources: [
    { title: "Official entry guidance", authority: "Government authority", url: "https://official.example/entry", retrievedAt: "2026-08-11" },
    { title: "Official destination guidance", authority: "Destination authority", url: "https://official.example/destination", retrievedAt: "2026-08-11" }
  ],
  stages: Array.from({ length: 6 }, (_, stageIndex) => ({ title: `Plan section ${stageIndex + 1}`, description: "A complete part of the journey.", presentationKind: stageIndex === 0 ? "overview" : stageIndex === 1 ? "itinerary" : "details", tasks: Array.from({ length: 3 }, (_, taskIndex) => ({ title: stageIndex === 0 && taskIndex === 0 ? "Check documents" : `Arrangement ${stageIndex + 1}.${taskIndex + 1}`, description: "A concrete arrangement with its dependency and expected result.", owner: stageIndex === 0 && taskIndex === 0 ? "user" : "assistant", dueLabel: stageIndex === 0 && taskIndex === 0 ? "Two hours before departure" : `Phase ${stageIndex + 1}`, preparationCategory: stageIndex === 0 && taskIndex === 0 ? "documents" : "not_applicable", ...(stageIndex === 0 && taskIndex === 0 ? { reminder: { scheduledAtLocal: "2026-09-01T05:00", timeZone: "Asia/Shanghai", purpose: "Check your passport, travel documents, phone, and charger before leaving.", refreshFacts: [] } } : {}) })) }))
});

test("Codex Adapter accepts a schema-compatible Plan draft", () => {
  assert.equal(parsePlanDraft(validDraft).title, "Attend an exhibition in Shanghai");
  assert.equal(parsePlanDraft(validDraft).stages[0]?.tasks[0]?.reminder?.scheduledAtLocal, "2026-09-01T05:00");
  assert.deepEqual(parsePlanDraft(validDraft).stages[0]?.tasks[0]?.reminder?.refreshFacts, []);
});

test("Codex Adapter rejects malformed Plan output", () => {
  assert.throws(() => parsePlanDraft("not json"), RuntimeAdapterError);
  assert.equal(parsePlanDraft(validDraft.replace("Asia/Shanghai", "Mars/Olympus")).stages[0]?.tasks[0]?.reminder, undefined);
  assert.equal(parsePlanDraft(validDraft.replace('"refreshFacts":[]', '"refreshFacts":["traffic"]')).stages[0]?.tasks[0]?.reminder, undefined);
});

test("Codex Adapter accepts only internally consistent structured itinerary places", () => {
  const input = JSON.parse(validDraft) as Record<string, unknown>;
  input.sources = [
    { title: "City Museum", authority: "City Museum", url: "https://official.example/museum", retrievedAt: "2026-08-11" },
    { title: "City Museum tickets", authority: "City Museum", url: "https://official.example/museum/tickets", retrievedAt: "2026-08-11" }
  ];
  input.presentation = {
    kind: "itinerary",
    summary: "Two named stops with a route that still needs verification.",
    language: "en",
    startDate: "2026-09-01",
    endDate: "2026-09-01",
    cities: ["Shanghai"],
    days: [{ id: "day-1", label: "Day 1", date: "2026-09-01", shortLabel: "Sep 1", city: "Shanghai", title: "Museum and neighborhood life", summary: "A restrained first day with one cultural anchor and a direct return to the hotel.", anchors: ["museum"], candidates: [], placeIds: ["museum", "hotel"], stops: [{ placeId: "museum", order: 1, time: "10:00" }, { placeId: "hotel", order: 2, time: "16:00" }], routeReview: { sequenceRationale: "Visit the museum during the strongest energy window, then return directly to the hotel without crossing the city again.", routingMethod: "Provisional transit plan pending live refresh." } }],
    places: [
      { id: "museum", name: "City Museum", locationLabel: "Central district", city: "Shanghai", area: "Central district", coordinates: [31.23, 121.47], category: "museum", priority: "must", contentTier: "deep", durationMinutes: 180, whyWorthIt: "Main interest.", plan: "Visit in the morning.", detailSections: [{ title: "What to see", items: ["Follow the permanent collection in chronological order", "Pause at the city model to understand the afternoon route"] }], officialUrl: "https://official.example/museum", bookingUrl: "https://official.example/museum/tickets", reservation: { requirement: "required", verification: "verified", note: "Timed admission is required.", checkedAt: "2026-08-11" }, sourceRefs: ["https://official.example/museum"] },
      { id: "hotel", name: "Confirmed hotel", locationLabel: "Hotel address", city: "Shanghai", coordinates: [31.22, 121.46], category: "accommodation", priority: "booked", whyWorthIt: "Confirmed base.", plan: "Return after the visit.", detailSections: [], sourceRefs: [] }
    ],
    routeSegments: [{ id: "route-1", dayId: "day-1", originPlaceId: "museum", destinationPlaceId: "hotel", label: "Transit back to the hotel", detail: "Allow a conservative 35-minute window and refresh the live route before departure.", mode: "transit", verification: "needs_verification", durationMinutes: 35, sourceRefs: [] }]
  };
  const parsed = parsePlanDraft(JSON.stringify(input));
  assert.equal(parsed.presentation?.places.length, 2);
  assert.deepEqual(parsed.presentation?.places[0]?.coordinates, [31.23, 121.47]);
  assert.equal(parsed.presentation?.days[0]?.title, "Museum and neighborhood life");
  assert.equal(parsed.presentation?.places[0]?.reservation?.requirement, "required");
  assert.equal(parsed.presentation?.routeSegments[0]?.verification, "needs_verification");

  const inconsistent = structuredClone(input) as typeof input & { presentation: { days: Array<{ placeIds: string[] }> } };
  inconsistent.presentation.days[0]!.placeIds = ["museum", "missing-place"];
  assert.deepEqual(parsePlanDraft(JSON.stringify(inconsistent)).presentation?.days[0]?.placeIds, ["museum"]);

  const duplicateCandidate = structuredClone(input) as any;
  duplicateCandidate.presentation.days[0].candidates = ["museum"];
  assert.deepEqual(parsePlanDraft(JSON.stringify(duplicateCandidate)).presentation?.days[0]?.candidates, []);

  const missingCoordinates = structuredClone(input) as any;
  delete missingCoordinates.presentation.places[0].coordinates;
  assert.throws(() => parsePlanDraft(JSON.stringify(missingCoordinates)), RuntimeAdapterError);

  const wrongCity = structuredClone(input) as any;
  wrongCity.presentation.places[0].city = "Paris";
  assert.throws(() => parsePlanDraft(JSON.stringify(wrongCity)), RuntimeAdapterError);

  const airportBoundary = structuredClone(input) as any;
  airportBoundary.presentation.days[0].city = "Tokyo";
  airportBoundary.presentation.places[0].city = "Narita";
  airportBoundary.presentation.places[0].category = "airport";
  assert.match(parsePlanDraft(JSON.stringify(airportBoundary)).presentation?.days[0]?.city ?? "", /Tokyo \/ Narita/);

  const missingTimelineTime = structuredClone(input) as any;
  delete missingTimelineTime.presentation.days[0].stops[1].time;
  assert.equal(parsePlanDraft(JSON.stringify(missingTimelineTime)).presentation?.days[0]?.stops?.[1]?.time, "13:35");

  const missingSequenceRationale = structuredClone(input) as any;
  delete missingSequenceRationale.presentation.days[0].routeReview;
  assert.match(parsePlanDraft(JSON.stringify(missingSequenceRationale)).presentation?.days[0]?.routeReview?.sequenceRationale ?? "", /limit backtracking/);

  const missingMovementDuration = structuredClone(input) as any;
  delete missingMovementDuration.presentation.routeSegments[0].durationMinutes;
  assert.equal(parsePlanDraft(JSON.stringify(missingMovementDuration)).presentation?.routeSegments[0]?.durationMinutes, 30);

  const missingPlaceEvidence = structuredClone(input) as any;
  missingPlaceEvidence.presentation.places[0].sourceRefs = [];
  assert.equal(parsePlanDraft(JSON.stringify(missingPlaceEvidence)).presentation?.places[0]?.sourceRefs.length, 0);

  const unsavedPlaceEvidence = structuredClone(input) as any;
  unsavedPlaceEvidence.presentation.places[0].sourceRefs = ["https://unsupported.example/museum"];
  assert.deepEqual(parsePlanDraft(JSON.stringify(unsavedPlaceEvidence)).presentation?.places[0]?.sourceRefs, []);

  const ungroundedReservation = structuredClone(input) as any;
  delete ungroundedReservation.presentation.places[0].bookingUrl;
  const downgradedReservation = parsePlanDraft(JSON.stringify(ungroundedReservation));
  assert.equal(downgradedReservation.presentation?.places[0]?.reservation?.verification, "needs_recheck");

  const ungroundedRoute = structuredClone(input) as any;
  ungroundedRoute.presentation.routeSegments[0].verification = "verified";
  ungroundedRoute.presentation.routeSegments[0].checkedAt = "2026-08-11";
  ungroundedRoute.presentation.routeSegments[0].sourceRefs = [];
  const downgradedRoute = parsePlanDraft(JSON.stringify(ungroundedRoute));
  assert.equal(downgradedRoute.presentation?.routeSegments[0]?.verification, "needs_verification");
  assert.equal(downgradedRoute.presentation?.routeSegments[0]?.checkedAt, undefined);
});

test("planning conversation output keeps natural copy separate from structured facts", () => {
  const turn = parsePlanningConversationTurn(JSON.stringify({ reply: "好的，我记下是2026年。具体哪一天出发？", facts: [{ key: "travel_year", value: "2026" }] }));
  assert.equal(turn.reply, "好的，我记下是2026年。具体哪一天出发？");
  assert.deepEqual(turn.facts, [{ key: "travel_year", value: "2026" }]);
  assert.throws(() => parsePlanningConversationTurn(JSON.stringify({ reply: "", facts: [] })), RuntimeAdapterError);
});

test("Codex Adapter removes structured-output nulls from optional Task fields", () => {
  const withNulls = JSON.stringify({
    title: "Attend an exhibition in Shanghai",
    location: "Shanghai, China",
    dates: "September 2026",
    knownInformation: ["Purpose: exhibition"],
    assumptions: ["Accommodation is unconfirmed."],
    nextAction: "Review the complete Plan.",
    presentation: { kind: "timeline", summary: "A non-spatial execution timeline.", days: [], places: [], routeSegments: [] },
    sources: [
      { title: "Official entry guidance", authority: "Government authority", url: "https://official.example/entry", retrievedAt: "2026-08-11" },
      { title: "Official destination guidance", authority: "Destination authority", url: "https://official.example/destination", retrievedAt: "2026-08-11" }
    ],
    stages: Array.from({ length: 6 }, (_, stageIndex) => ({ title: `Plan section ${stageIndex + 1}`, description: "A complete part of the journey.", presentationKind: stageIndex === 0 ? "overview" : stageIndex === 1 ? "itinerary" : "details", tasks: Array.from({ length: 3 }, (_, taskIndex) => ({ title: stageIndex === 0 && taskIndex === 0 ? "Choose accommodation" : `Arrangement ${stageIndex + 1}.${taskIndex + 1}`, description: "A concrete arrangement with its dependency and expected result.", owner: stageIndex === 0 && taskIndex === 0 ? "user" : "assistant", dueLabel: stageIndex === 0 && taskIndex === 0 ? "Before departure" : `Phase ${stageIndex + 1}`, preparationCategory: stageIndex === 0 && taskIndex === 0 ? "booking" : "not_applicable", activationTrigger: null, reminder: null })) }))
  });
  const draft = parsePlanDraft(withNulls);
  assert.equal(draft.stages[0]?.tasks[0]?.activationTrigger, undefined);
  assert.equal(draft.stages[0]?.tasks[0]?.reminder, undefined);
});

test("Codex output schema stays inside the supported structured-output subset", () => {
  assert.doesNotMatch(JSON.stringify(planDraftSchema), /uniqueItems/);
  assert.equal(planDraftSchema.properties.stages.minItems, 6);
  assert.equal(planDraftSchema.properties.stages.maxItems, 6);
  assert.equal(planDraftSchema.properties.stages.items.properties.tasks.minItems, 1);
  assert.equal(planDraftSchema.properties.stages.items.properties.tasks.items.required.includes("description"), true);
  assert.equal(planDraftSchema.properties.stages.items.properties.tasks.items.required.includes("preparationCategory"), true);
  assert.equal(planDraftSchema.properties.stages.items.required.includes("presentationKind"), true);
  assert.equal(planDraftSchema.required.includes("presentation"), true);
  assert.equal(planDraftSchema.properties.presentation.properties.routeSegments.items.properties.verification.enum.includes("needs_verification"), true);
});

test("Codex strict schema requires every property and makes semantic optionals nullable", () => {
  const strict = codexStrictOutputSchema(planDraftSchema) as any;
  const assertStrictObjects = (value: any): void => {
    if (Array.isArray(value)) { value.forEach(assertStrictObjects); return; }
    if (!value || typeof value !== "object") return;
    if (value.type === "object" && value.properties) assert.deepEqual([...value.required].sort(), Object.keys(value.properties).sort());
    Object.values(value).forEach(assertStrictObjects);
  };
  assertStrictObjects(strict);
  const stopsProperty = strict.properties.presentation.properties.days.items.properties.stops;
  const stop = stopsProperty.anyOf.find((item: any) => item.type === "array").items;
  assert.equal(stop.required.includes("time"), true);
  assert.equal(stop.properties.time.anyOf.some((item: any) => item.type === "null"), true);
});

test("Codex research brief preserves useful content when official evidence is unavailable", () => {
  const brief = parsePlanResearchBrief(JSON.stringify({
    resolvedDestination: "复旦大学邯郸校区，上海市杨浦区",
    destinationConfidence: "confirmed",
    applicabilityNotes: ["邯郸 is the campus name here, not Handan city in Hebei."],
    sources: [
      { title: "Handan Campus", authority: "Fudan University", url: "https://www.fudan.edu.cn/campus", retrievedAt: "2026-08-11" },
      { title: "Contact", authority: "Fudan University", url: "https://iso.fudan.edu.cn/contact", retrievedAt: "2026-08-11" }
    ],
    candidatePlaces: [{ name: "Fudan University Handan Campus", locationLabel: "Yangpu District, Shanghai", city: "Shanghai", area: "Yangpu District", category: "university", coordinates: [31.299, 121.503], whyCandidate: "This is the confirmed study destination and primary fixed anchor for the Plan.", officialUrl: "https://www.fudan.edu.cn/campus", bookingUrl: null, reservation: "not_required", sourceUrls: ["https://www.fudan.edu.cn/campus"] }],
    planningFacts: [{ subject: "Fudan University Handan Campus", kind: "access", claim: "The named Handan Campus is located in Yangpu District, Shanghai.", status: "verified", sourceUrl: "https://www.fudan.edu.cn/campus", checkedAt: "2026-08-11" }]
  }));
  assert.equal(brief.destinationConfidence, "confirmed");
  assert.equal(brief.candidatePlaces.length, 1);
  assert.equal(planResearchSchema.properties.sources.minItems, 0);
  assert.equal(parsePlanResearchBrief(JSON.stringify({ ...brief, sources: [], candidatePlaces: [{ ...brief.candidatePlaces[0], sourceUrls: [] }], planningFacts: [] })).candidatePlaces.length, 1);
  const canonicalMatch = parsePlanResearchBrief(JSON.stringify({ ...brief, candidatePlaces: [{ ...brief.candidatePlaces[0], sourceUrls: ["https://www.fudan.edu.cn/campus/?utm_source=test#visit"] }] }));
  assert.equal(canonicalMatch.candidatePlaces[0]?.reservation, "not_required");
  assert.equal(canonicalMatch.candidatePlaces[0]?.sourceUrls.length, 1);
  const cleaned = parsePlanResearchBrief(JSON.stringify({
    ...brief,
    candidatePlaces: [{ ...brief.candidatePlaces[0], bookingUrl: "https://unsupported.example/tickets", reservation: "required", sourceUrls: ["https://unsupported.example/place"] }],
    planningFacts: [...brief.planningFacts, { ...brief.planningFacts[0], subject: "Unsupported claim", sourceUrl: "https://unsupported.example/fact" }]
  }));
  assert.deepEqual(cleaned.candidatePlaces[0]?.sourceUrls, []);
  assert.equal(cleaned.candidatePlaces[0]?.reservation, "unknown");
  assert.equal(cleaned.candidatePlaces[0]?.bookingUrl, null);
  assert.equal(cleaned.planningFacts.length, 1);
  assert.match(cleaned.applicabilityNotes.at(-1) ?? "", /1 place record.*1 planning fact/i);
});

test("Plan research fallback emits Blueprint display intent for candidate places", () => {
  const brief = parsePlanResearchBrief(JSON.stringify({
    resolvedDestination: "Kyoto, Japan",
    destinationConfidence: "confirmed",
    applicabilityNotes: ["Use a balanced place mix."],
    sources: [{ title: "Kyoto shopping guide", authority: "Kyoto tourism", url: "https://example.com/kyoto", retrievedAt: "2026-08-11" }],
    candidatePlaces: [
      { name: "Teramachi Shopping Arcade", locationLabel: "Central Kyoto", city: "Kyoto", area: "Central Kyoto", category: "shopping arcade", coordinates: [35.005, 135.765], whyCandidate: "A covered browsing stop for local products and rainy-day flexibility.", officialUrl: null, bookingUrl: null, reservation: "unknown", sourceUrls: ["https://example.com/kyoto"] },
      { name: "Tea Ceremony Studio", locationLabel: "Gion", city: "Kyoto", area: "Gion", category: "tea ceremony class", coordinates: [35.003, 135.778], whyCandidate: "A structured cultural activity that needs a booked session.", officialUrl: null, bookingUrl: null, reservation: "unknown", sourceUrls: ["https://example.com/kyoto"] }
    ],
    planningFacts: []
  }));
  const batch = planResearchBriefToSkillBatch(brief, { id: "kyoto", scopeLabel: "Kyoto" }, "2026-08-11T00:00:00.000Z");
  assert.deepEqual(batch.places.map((place) => place.display), [
    { type: "shopping", markerKind: "shopping" },
    { type: "experience", markerKind: "experience" }
  ]);
  assert.deepEqual(batch.places.map((place) => place.schedulingEligibility?.decision), ["schedulable", "schedulable"]);
});

test("Codex research prompt disambiguates campus names before city-level planning", () => {
  const prompt = buildPlanResearchPrompt({
    request: "I am going to Fudan University's Handan Campus to study.",
    profile: { preferredLanguage: "English", nationality: "USA", gender: "man", immigrationStatus: "student_visa" }
  });
  assert.match(prompt, /Fudan University's Handan Campus/);
  assert.match(prompt, /campus name contains 邯郸\/Handan/i);
  assert.match(prompt, /Being official is not sufficient/i);
  assert.match(prompt, /Cross-check the resolved destination/i);
  assert.match(prompt, /Use \$interactive-trip-planner/i);
  assert.doesNotMatch(prompt, /Xiaohongshu|小红书|xhslink/i);
  assert.match(prompt, /12-18 unique mappable POIs/i);
  assert.match(prompt, /55-90 for 6 or more days/i);
  assert.match(prompt, /richness targets, not hard rejection thresholds/i);
  assert.match(prompt, /4-6 direct replacements/i);
  assert.match(prompt, /must exactly match a URL also returned in the top-level sources array/i);
  assert.doesNotMatch(prompt, /2-3 useful candidates|cap the complete pool near 28/i);
  assert.equal(planResearchSchema.properties.candidatePlaces.maxItems, 160);
});

test("Skill research batch prompt scopes work without quotas or Xiaohongshu import", () => {
  const prompt = buildSkillResearchBatchPrompt({
    request: "Plan Tokyo and Kyoto from 2026-09-01 to 2026-09-07.",
    batch: { id: "tokyo", scopeLabel: "Tokyo" },
    profile: { preferredLanguage: "English", nationality: "Canada", gender: "not_specified", immigrationStatus: "not_obtained" }
  });
  assert.match(prompt, /Landi Trip Blueprint generation policy 1\.0\.0/);
  assert.doesNotMatch(prompt, /Use \$interactive-trip-planner|Regional Source Pack/);
  assert.match(prompt, /Select sources by capability and actual availability/);
  assert.match(prompt, /Geographic scope: Tokyo/);
  assert.match(prompt, /Do not import from Xiaohongshu/i);
  assert.match(prompt, /never a validity quota/i);
  assert.match(prompt, /Do not flatten rich place content/i);
  assert.match(prompt, /include display\.type as one of attraction, dining, shopping, or experience/i);
  assert.match(prompt, /display\.markerKind/i);
  assert.match(prompt, /add images with url, alt, sourceUrl/i);
  assert.match(prompt, /omit images when that cannot be guaranteed/i);
  assert.match(prompt, /Use guideDisplay for Web workspace-specific display intent/i);
  assert.match(prompt, /Use localFoods, localProducts, and experienceThemes/i);
  assert.match(prompt, /Include destination-relevant travelTips/i);
  assert.match(prompt, /schedulingEligibility\.decision/i);
  assert.match(prompt, /schedulingEligibility\.evidence/i);
  assert.match(prompt, /Add relationships/i);
  assert.ok(skillResearchBatchSchema.properties.places.items.required.includes("display"));
  assert.ok(skillResearchBatchSchema.properties.places.items.required.includes("schedulingEligibility"));
  assert.ok("guideDisplay" in skillResearchBatchSchema.properties.places.items.properties);
  assert.ok("images" in skillResearchBatchSchema.properties.places.items.properties);
  assert.deepEqual(skillResearchBatchSchema.properties.places.items.properties.images.items.required, ["url", "alt", "sourceUrl"]);
  assert.ok("evidence" in skillResearchBatchSchema.properties.places.items.properties.schedulingEligibility.properties);
  assert.ok(skillResearchBatchSchema.required.includes("localFoods"));
  assert.ok(skillResearchBatchSchema.required.includes("localProducts"));
  assert.ok(skillResearchBatchSchema.required.includes("experienceThemes"));
  assert.ok(skillResearchBatchSchema.required.includes("travelTips"));
  assert.ok(skillResearchBatchSchema.required.includes("relationships"));
});

test("Skill image enrichment prompt and parser require source-bound direct images", () => {
  const batch = parseSkillResearchBatchArtifact(JSON.stringify({
    id: "ignored", scopeLabel: "ignored", completedAt: "ignored",
    sources: [],
    places: [
      { id: "palace", name: "Ubud Palace", locationLabel: "Ubud", city: "Ubud", area: "Central Ubud", category: "palace", priority: "must", coordinates: [-8.5069, 115.2625], display: { type: "attraction" }, schedulingEligibility: { decision: "schedulable", reason: "Central Ubud stop." }, contentTier: "deep", whyWorthIt: "A central Balinese architecture anchor.", plan: "Visit the palace courtyard.", sourceUrls: [] }
    ],
    events: [],
    relationships: [],
    localFoods: [],
    localProducts: [],
    experienceThemes: [],
    travelTips: [],
    actionRequirements: []
  }), { id: "bali", scopeLabel: "Ubud" }, "2026-09-08T00:00:00.000Z");
  const prompt = buildSkillImageEnrichmentPrompt({
    request: "Plan Bali.",
    batch: { id: "bali", scopeLabel: "Ubud" },
    completedAt: "2026-09-08T00:00:00.000Z",
    profile: { preferredLanguage: "English", nationality: "Canada", gender: "not_specified", immigrationStatus: "not_obtained" }
  }, batch);
  assert.match(prompt, /Find sourced place images/i);
  assert.match(prompt, /Wikimedia Commons/i);
  assert.match(prompt, /sourceUrl must be the HTTPS page/i);
  assert.match(prompt, /Do not use Xiaohongshu/i);
  assert.equal(skillImageEnrichmentSchema.required.includes("sources"), true);
  assert.equal(skillImageEnrichmentSchema.properties.images.items.required.includes("placeId"), true);

  const parsed = parseSkillImageEnrichmentArtifact(JSON.stringify({
    sources: [{ id: "commons-palace", title: "Ubud Palace image", authority: "Wikimedia Commons", url: "https://commons.wikimedia.org/wiki/File:Ubud_Palace.jpg#metadata", retrievedAt: "2026-09-08", status: "verified", official: false }],
    images: [
      { placeId: "bali-palace", url: "https://upload.wikimedia.org/wikipedia/commons/1/11/Ubud_Palace.jpg", alt: "Courtyard at Ubud Palace", caption: "Ubud Palace courtyard", sourceUrl: "https://commons.wikimedia.org/wiki/File:Ubud_Palace.jpg", usage: ["detail"], status: "verified" },
      { placeId: "bali-palace", url: "https://unsupported.example/palace.jpg", alt: "Unsupported palace", sourceUrl: "https://unsupported.example/palace", usage: ["detail"], status: "verified" },
      { placeId: "unknown", url: "https://upload.wikimedia.org/wikipedia/commons/2/22/Unknown.jpg", alt: "Unknown", sourceUrl: "https://commons.wikimedia.org/wiki/File:Ubud_Palace.jpg", usage: ["detail"], status: "verified" }
    ],
    omitted: [{ placeId: "unknown", reason: "Unknown place." }]
  }), new Set(["bali-palace"]));
  assert.equal(parsed.images.length, 1);
  assert.equal(parsed.images[0]?.sourceUrl, "https://commons.wikimedia.org/wiki/File:Ubud_Palace.jpg");
  assert.deepEqual(parsed.omitted, []);
});

test("Skill research image enrichment fills missing images before import", async () => {
  const prompts: string[] = [];
  const adapter = new CodexRuntimeAdapter({ run: async (_command, args) => {
    if (args.includes("--version")) return { code: 0, stdout: "codex test", stderr: "" };
    if (args[0] === "login") return { code: 0, stdout: "logged in", stderr: "" };
    prompts.push(args.at(-1)!);
    const outputPath = args[args.indexOf("--output-last-message") + 1]!;
    if (outputPath.endsWith("skill-image-enrichment.json")) {
      await writeFile(outputPath, JSON.stringify({
        sources: [{ id: "commons-palace", title: "Ubud Palace image", authority: "Wikimedia Commons", url: "https://commons.wikimedia.org/wiki/File:Ubud_Palace.jpg", retrievedAt: "2026-09-08", status: "verified", official: false }],
        images: [{ placeId: "bali-palace", url: "https://upload.wikimedia.org/wikipedia/commons/1/11/Ubud_Palace.jpg", alt: "Courtyard at Ubud Palace", caption: "Ubud Palace courtyard", sourceUrl: "https://commons.wikimedia.org/wiki/File:Ubud_Palace.jpg", usage: ["detail"], status: "verified" }],
        omitted: []
      }));
      return { code: 0, stdout: "", stderr: "" };
    }
    await writeFile(outputPath, JSON.stringify({
      id: "batch", scopeLabel: "Ubud", sources: [], events: [], relationships: [], localFoods: [], localProducts: [], experienceThemes: [], travelTips: [], actionRequirements: [],
      places: [{ id: "palace", name: "Ubud Palace", locationLabel: "Ubud", city: "Ubud", area: "Central Ubud", category: "palace", priority: "must", coordinates: [-8.5069, 115.2625], display: { type: "attraction" }, schedulingEligibility: { decision: "schedulable", reason: "Central Ubud stop." }, contentTier: "deep", whyWorthIt: "A central Balinese architecture anchor.", plan: "Visit the palace courtyard.", sourceUrls: [] }]
    }));
    return { code: 0, stdout: "", stderr: "" };
  } });
  const input = { request: "Plan Bali.", batch: { id: "bali", scopeLabel: "Ubud" }, completedAt: "2026-09-08T00:00:00.000Z", profile: { preferredLanguage: "English", nationality: "Canada", gender: "not_specified" as const, immigrationStatus: "not_obtained" as const } };
  const artifact = await adapter.generateSkillResearchBatch(input);
  assert.equal(prompts.length, 2);
  assert.match(prompts[1]!, /Find sourced place images/i);
  assert.deepEqual(artifact.imageDiagnostics, { requestedPlaceCount: 1, acceptedImageCount: 1, omitted: [] });
  assert.equal(artifact.places[0]?.images?.[0]?.url, "https://upload.wikimedia.org/wikipedia/commons/1/11/Ubud_Palace.jpg");
  const research = importSkillResearchBatches([artifact], { researchSetId: "r", generationKey: "g", proposalRef: { sessionId: "s", proposalVersion: 1 }, skillLineage: LANDI_BLUEPRINT_SKILL, createdAt: "2026-09-08T00:00:00Z", updatedAt: "2026-09-08T00:00:00Z" });
  assert.equal(research.places[0]?.images?.[0]?.sourceId, research.sources.find((source) => source.url === "https://commons.wikimedia.org/wiki/File:Ubud_Palace.jpg")?.id);
});

test("research invocations carry the selected policy and unsupported versions never invoke the runtime", async () => {
  const prompts: string[] = [];
  const adapter = new CodexRuntimeAdapter({ run: async (_command, args) => {
    if (args.includes("--version")) return { code: 0, stdout: "codex test", stderr: "" };
    if (args[0] === "login") return { code: 0, stdout: "logged in", stderr: "" };
    prompts.push(args.at(-1)!);
    const outputPath = args[args.indexOf("--output-last-message") + 1]!;
    await writeFile(outputPath, JSON.stringify(outputPath.endsWith("skill-itinerary.json") ? {
      title: "Lisbon", summary: "Arrival rest day", language: "en", destinations: ["Lisbon"], startDate: "2026-10-12", endDate: "2026-10-12",
      days: [{ id: "d1", date: "2026-10-12", kind: "rest", city: "Lisbon", title: "Rest", summary: "Keep arrival flexible", stops: [], candidatePlaceIds: [] }], movements: []
    } : {
      id: "batch", scopeLabel: "Lisbon", sources: [], events: [], actionRequirements: [],
      places: [{ id: "museum", name: "Museum", locationLabel: "Lisbon", category: "museum", whyWorthIt: "Local ceramic collection", plan: "Explore the collection", sourceUrls: [], images: [{ url: "https://example.com/museum.jpg", alt: "Museum gallery", sourceUrl: "https://example.com/museum", usage: ["detail"], status: "recheck" }] }]
    }));
    return { code: 0, stdout: "", stderr: "" };
  } });
  const input = { request: "Lisbon", batch: { id: "lisbon", scopeLabel: "Lisbon" }, profile: { preferredLanguage: "English", nationality: "Canada", gender: "not_specified" as const, immigrationStatus: "not_obtained" as const } };
  const artifact = await adapter.generateSkillResearchBatch(input);
  const research = importSkillResearchBatches([artifact], { researchSetId: "r", generationKey: "g", proposalRef: { sessionId: "s", proposalVersion: 1 }, skillLineage: LANDI_BLUEPRINT_SKILL, createdAt: "2026-09-08T00:00:00Z", updatedAt: "2026-09-08T00:00:00Z" });
  assert.equal(research.places.length, 1);
  assert.equal(research.places[0]?.whyWorthIt, "Local ceramic collection");
  assert.equal(research.places[0]?.evidence.some((ref) => ref.status === "verified"), false);
  assert.match(prompts[0]!, /Landi Trip Blueprint generation policy/);
  assert.doesNotMatch(prompts[0]!, /Use \$interactive-trip-planner/);
  await adapter.generateSkillResearchBatch({ ...input, skillLineage: LEGACY_BLUEPRINT_SKILL });
  assert.match(prompts[1]!, /Use \$interactive-trip-planner/);
  assert.match(prompts[1]!, /Regional Source Pack/);
  await assert.rejects(adapter.generateSkillResearchBatch({ ...input, skillLineage: { ...LANDI_BLUEPRINT_SKILL, skillVersion: "99.0.0" } }), /Unsupported Blueprint generation policy/);
  assert.equal(prompts.length, 2);
  const prompt = buildSkillItineraryPrompt({ ...input, research: { ...research, status: "completed" } });
  assert.match(prompt, /Landi Trip Blueprint generation policy/);
  assert.match(prompt, /Evidence source catalog/);
  assert.match(prompt, /omit unsupported duration and geometry/);
  assert.doesNotMatch(prompt, /Use \$interactive-trip-planner/);
  const itinerary = await adapter.generateSkillItinerary({ ...input, research: { ...research, status: "completed" } });
  assert.equal(itinerary.days[0]?.kind, "rest");
  assert.match(prompts[2]!, /Landi Trip Blueprint generation policy/);
  await adapter.generateSkillItinerary({ ...input, research: { ...research, status: "completed", skillLineage: LEGACY_BLUEPRINT_SKILL } });
  assert.match(prompts[3]!, /Use \$interactive-trip-planner/);
  assert.throws(() => buildSkillItineraryPrompt({ ...input, research: { ...research, status: "completed", skillLineage: { ...LANDI_BLUEPRINT_SKILL, skillVersion: "99.0.0" } } }), /Unsupported Blueprint generation policy/);
});

test("runtime checks are bounded so live validation cannot hang before generation", async () => {
  const codexOptions: Array<Parameters<RuntimeProcess>[2]> = [];
  const codex = new CodexRuntimeAdapter({ run: async (_command, args, options) => {
    codexOptions.push(options);
    if (args[0] === "--version") return { code: 0, stdout: "codex 1.0\n", stderr: "" };
    return { code: 0, stdout: "Logged in", stderr: "" };
  } });
  assert.equal((await codex.check()).authenticated, true);
  assert.deepEqual(codexOptions.map((options) => options?.timeoutMs), [30_000, 30_000]);

  const hungCodex = new CodexRuntimeAdapter({ run: async (_command, args) => args[0] === "--version"
    ? { code: 0, stdout: "codex 1.0\n", stderr: "" }
    : { code: 0, stdout: "", stderr: "", timedOut: true } });
  const hungStatus = await hungCodex.check();
  assert.equal(hungStatus.installed, true);
  assert.equal(hungStatus.authenticated, false);
  assert.match(hungStatus.message ?? "", /login status did not respond/i);
});

test("Skill research batch keeps rich place content and namespaces local identities", () => {
  const parsed = parseSkillResearchBatchArtifact(JSON.stringify({
    id: "ignored", scopeLabel: "ignored", completedAt: "ignored",
    sources: [{ id: "source-1", title: "Official place", authority: "City", url: "https://example.com/place", retrievedAt: "2026-08-26", status: "verified", official: true }],
    places: [
      { id: "place-1", name: "Place", localizedName: "地点", locationLabel: "Center", city: "Lisbon", area: "Baixa", category: "architecture", priority: "must", coordinates: null, display: { type: "attraction", markerKind: "attraction" }, guideDisplay: { showInGuide: true, cardSummary: "Blueprint card copy.", tags: ["120 min"], detailLeadTitle: "Why this fits", comparisonRows: [{ id: "row-alt", relatedPlaceId: "place-2", area: "Baixa", routeFit: "Same area", timing: "Morning", effort: "Easy swap", sourceState: "Verified source", sourceUrls: ["https://example.com/place"] }] }, schedulingEligibility: { decision: "schedulable", reason: "Fits central Lisbon days.", evidence: [{ sourceId: "source-1", status: "stale", supports: ["opening window"] }] }, fieldEvidence: [{ path: "whyWorthIt", status: "verified", evidence: [{ sourceId: "source-1", status: "verified" }] }], contentTier: "deep", visitRole: "anchor", durationMinutes: 120, whyWorthIt: "Specific architectural value.", plan: "Inspect the facade and interior sequence.", tip: "Reserve energy.", detailSections: [{ title: "Look for", body: "Stone and light.", items: ["Facade", "Courtyard"] }], sourceUrls: ["https://example.com/place"] },
      { id: "place-2", name: "Alternative Place", locationLabel: "Center", city: "Lisbon", area: "Baixa", category: "architecture", priority: "nearby", coordinates: null, display: { type: "attraction" }, schedulingEligibility: { decision: "schedulable", reason: "Fits central Lisbon days." }, whyWorthIt: "Nearby alternative.", plan: "Use if the anchor is crowded.", detailSections: [{ title: "Look for", body: "Quiet street.", items: ["Facade"] }], sourceUrls: ["https://example.com/place"] }
    ],
    events: [{ id: "event-1", title: "Event", placeId: "place-1", description: "Program", sourceUrls: ["https://example.com/place"] }],
    relationships: [{ id: "rel-1", kind: "supports_anchor", fromPlaceId: "place-1", toPlaceId: "place-2", rationale: "Alternative if the anchor is crowded." }],
    localFoods: [{ id: "food-1", title: "Custard tart", description: "A local pastry break.", context: "Cafe stops", diningPlaceIds: ["place-1"], sourceUrls: ["https://example.com/place"] }],
    localProducts: [{ id: "product-1", title: "Tile shops", description: "Small tile browsing.", context: "Baixa shops", purchasePlaceIds: ["place-2"], sourceUrls: ["https://example.com/place"] }],
    experienceThemes: [{ id: "experience-1", title: "Fado night", description: "Use a concrete venue.", context: "Evening options", offeringPlaceIds: ["place-1"], sourceUrls: ["https://example.com/place"] }],
    travelTips: [{ id: "tip-1", title: "Queue etiquette", body: "Queue quietly at busy viewpoints and follow posted local signs.", theme: "etiquette", context: "Baixa", placeId: "place-1", sourceUrls: ["https://example.com/place"] }],
    actionRequirements: [{ id: "requirement-1", kind: "reservation", title: "Reserve", description: "Choose a slot.", accountableParty: "traveler", completionCondition: "A slot is confirmed.", placeId: "place-1", sourceUrls: ["https://example.com/place"] }]
  }), { id: "lisbon", scopeLabel: "Lisbon" }, "2026-08-26T00:00:00.000Z");
  assert.equal(parsed.places[0]?.id, "lisbon-place-1");
  assert.equal(parsed.events[0]?.placeId, "lisbon-place-1");
  assert.equal(parsed.actionRequirements?.[0]?.placeId, "lisbon-place-1");
  assert.deepEqual(parsed.places[0]?.display, { type: "attraction", markerKind: "attraction" });
  assert.equal(parsed.places[0]?.guideDisplay?.cardSummary, "Blueprint card copy.");
  assert.equal(parsed.places[0]?.guideDisplay?.comparisonRows?.[0]?.relatedPlaceId, "lisbon-place-2");
  assert.deepEqual(parsed.places[0]?.guideDisplay?.comparisonRows?.[0]?.sourceUrls, ["https://example.com/place"]);
  assert.deepEqual(parsed.places[0]?.schedulingEligibility, { decision: "schedulable", reason: "Fits central Lisbon days.", evidence: [{ sourceId: "lisbon-source-1", status: "stale", supports: ["opening window"] }] });
  assert.equal(parsed.places[0]?.fieldEvidence?.[0]?.evidence[0]?.sourceId, "lisbon-source-1");
  assert.equal(parsed.relationships?.[0]?.fromPlaceId, "lisbon-place-1");
  assert.equal(parsed.localFoods?.[0]?.id, "lisbon-food-1");
  assert.deepEqual(parsed.localFoods?.[0]?.diningPlaceIds, ["lisbon-place-1"]);
  assert.deepEqual(parsed.localProducts?.[0]?.purchasePlaceIds, ["lisbon-place-2"]);
  assert.deepEqual(parsed.experienceThemes?.[0]?.offeringPlaceIds, ["lisbon-place-1"]);
  assert.equal(parsed.travelTips?.[0]?.id, "lisbon-tip-1");
  assert.equal(parsed.travelTips?.[0]?.placeId, "lisbon-place-1");
  assert.equal(parsed.places[0]?.detailSections?.[0]?.items?.length, 2);
  assert.equal(skillResearchBatchSchema.properties.places.maxItems, 240);
});

test("Skill research batch keeps already-scoped evidence source ids valid", () => {
  const parsed = parseSkillResearchBatchArtifact(JSON.stringify({
    id: "ignored",
    scopeLabel: "ignored",
    completedAt: "ignored",
    sources: [{ id: "scope-1-src-tirta-empul", title: "Tirta Empul official guide", authority: "Official tourism", url: "https://example.com/tirta-empul", retrievedAt: "2026-09-09", status: "verified", official: true }],
    places: [{
      id: "scope-1-pl-tirta-empul",
      name: "Tirta Empul",
      locationLabel: "Tampaksiring, Bali",
      city: "Bali",
      area: "Tampaksiring",
      category: "temple",
      priority: "must",
      coordinates: [-8.4156, 115.3156],
      display: { type: "attraction", markerKind: "attraction" },
      schedulingEligibility: { decision: "schedulable", reason: "Fits the cultural landscape day.", evidence: [{ sourceId: "scope-1-src-tirta-empul", status: "verified", supports: ["official overview"] }] },
      fieldEvidence: [{ path: "whyWorthIt", status: "verified", evidence: [{ sourceId: "scope-1-src-tirta-empul", status: "verified", supports: ["official overview"] }] }],
      contentTier: "deep",
      visitRole: "water temple anchor",
      durationMinutes: 90,
      whyWorthIt: "A water temple that anchors the cultural landscape day.",
      plan: "Visit respectfully before the rice terrace stop.",
      detailSections: [{ title: "At the temple", body: "Use this as a cultural anchor.", items: ["Follow posted etiquette"] }],
      sourceUrls: ["https://example.com/tirta-empul"]
    }],
    events: [],
    relationships: [],
    localFoods: [],
    localProducts: [],
    experienceThemes: [],
    travelTips: [],
    actionRequirements: []
  }), { id: "scope-1", scopeLabel: "Bali" }, "2026-09-09T00:00:00.000Z");

  const research = importSkillResearchBatches([parsed], {
    researchSetId: "research-bali",
    generationKey: "generation-bali",
    proposalRef: { sessionId: "session-bali", proposalVersion: 1 },
    skillLineage: LANDI_BLUEPRINT_SKILL,
    createdAt: "2026-09-09T00:00:00.000Z",
    updatedAt: "2026-09-09T00:00:00.000Z"
  });

  assert.equal(parsed.sources[0]?.id, "scope-1-src-tirta-empul");
  assert.equal(parsed.places[0]?.id, "scope-1-pl-tirta-empul");
  assert.equal(parsed.places[0]?.fieldEvidence?.[0]?.evidence[0]?.sourceId, "scope-1-src-tirta-empul");
  const importedSourceIds = new Set(research.sources.map((source) => source.id));
  const fieldSourceId = research.places[0]?.fieldEvidence?.[0]?.evidence[0]?.sourceId;
  const schedulingSourceId = research.places[0]?.schedulingEligibility?.evidence?.[0]?.sourceId;
  assert.ok(fieldSourceId && importedSourceIds.has(fieldSourceId));
  assert.ok(schedulingSourceId && importedSourceIds.has(schedulingSourceId));
});

test("Skill research batch output imports into a complete Trip Blueprint slice", () => {
  const parsed = parseSkillResearchBatchArtifact(JSON.stringify({
    id: "ignored",
    scopeLabel: "ignored",
    completedAt: "ignored",
    sources: [{ id: "official", title: "Kyoto official guide", authority: "Kyoto tourism", url: "https://example.com/kyoto", retrievedAt: "2026-08-26", status: "verified", official: true }],
    places: [
      {
        id: "garden",
        name: "Kiyosumi Gardens",
        locationLabel: "Kiyosumi, Tokyo",
        city: "Tokyo",
        area: "Kiyosumi",
        category: "garden",
        priority: "must",
        coordinates: [35.681, 139.799],
        display: { type: "attraction", markerKind: "attraction" },
        guideDisplay: { showInGuide: true, state: "unscheduled", cardSummary: "Quiet garden anchor for a low-intensity morning.", tags: ["Garden", "Morning"], comparisonRows: [{ id: "row-cafe", relatedPlaceId: "cafe", area: "Kiyosumi", routeFit: "Same neighborhood", timing: "After the garden", effort: "Low effort", sourceState: "Needs route refresh", sourceUrls: ["https://example.com/kyoto"] }] },
        schedulingEligibility: { decision: "schedulable", reason: "Fits the Tokyo neighborhood day.", suitableDayIds: ["tokyo-day", "stale-day"], evidence: [{ sourceId: "official", status: "stale", supports: ["opening pattern"] }] },
        fieldEvidence: [{ path: "whyWorthIt", status: "verified", evidence: [{ sourceId: "official", status: "verified", supports: ["official overview"] }] }],
        contentTier: "deep",
        visitRole: "morning anchor",
        durationMinutes: 90,
        whyWorthIt: "A calm landscape anchor that sets up the nearby coffee stop without crossing the city.",
        plan: "Visit in the morning, then keep the next stop in the same neighborhood.",
        tip: "Check garden notices close to the travel date.",
        detailSections: [{ title: "At the garden", body: "Keep this as the quiet anchor.", items: ["Walk the pond loop", "Leave enough time for the cafe"] }],
        sourceUrls: ["https://example.com/kyoto"]
      },
      {
        id: "cafe",
        name: "ARiSE Coffee Roasters",
        locationLabel: "Kiyosumi, Tokyo",
        city: "Tokyo",
        area: "Kiyosumi",
        category: "coffee",
        priority: "preferred",
        coordinates: [35.68, 139.8],
        display: { type: "dining", markerKind: "dining" },
        schedulingEligibility: { decision: "schedulable", reason: "Works as a short same-area break." },
        contentTier: "standard",
        visitRole: "coffee rest",
        durationMinutes: 45,
        whyWorthIt: "A compact coffee break that supports the garden route.",
        plan: "Use after the garden if the day needs a pause.",
        sourceUrls: ["https://example.com/kyoto"]
      }
    ],
    events: [],
    relationships: [{ id: "rel-cafe", kind: "meal_support", fromPlaceId: "cafe", toPlaceId: "garden", rationale: "The cafe supports the garden morning without a large route change.", sourceUrls: ["https://example.com/kyoto"] }],
    localFoods: [{ id: "coffee", title: "Kiyosumi coffee break", description: "Use coffee as a real rest stop rather than an extra attraction.", context: "Kiyosumi morning", diningPlaceIds: ["cafe"], sourceUrls: ["https://example.com/kyoto"] }],
    localProducts: [{ id: "garden-goods", title: "Small garden goods", description: "Keep purchases light because this day is walking based.", context: "Garden shops", purchasePlaceIds: ["garden"], sourceUrls: ["https://example.com/kyoto"] }],
    experienceThemes: [{ id: "slow-morning", title: "Slow Tokyo morning", description: "The theme is represented by concrete garden and cafe stops.", context: "Kiyosumi", offeringPlaceIds: ["garden"], sourceUrls: ["https://example.com/kyoto"] }],
    travelTips: [{ id: "cash", title: "Carry a little cash", body: "Small cafes and garden kiosks may move faster with cash during busy periods.", theme: "payment", context: "Tokyo neighborhood stops", placeId: "cafe", sourceUrls: ["https://example.com/kyoto"] }],
    actionRequirements: [{ id: "check-garden", kind: "time_sensitive_recheck", title: "Recheck garden notices", description: "Check official notices close to the visit date.", accountableParty: "assistant", completionCondition: "Garden notices are fresh before the route is finalized.", placeId: "garden", sourceUrls: ["https://example.com/kyoto"] }]
  }), { id: "tokyo", scopeLabel: "Tokyo" }, "2026-08-26T00:00:00.000Z");
  const research = importSkillResearchBatches([parsed], {
    researchSetId: "research-tokyo",
    generationKey: "generation-tokyo",
    proposalRef: { sessionId: "session-tokyo", proposalVersion: 1 },
    skillLineage: { skillId: "interactive-trip-planner", skillVersion: "0.2.0" },
    createdAt: "2026-08-26T00:00:00.000Z",
    updatedAt: "2026-08-26T00:00:00.000Z"
  });
  const garden = research.places.find((place) => place.name === "Kiyosumi Gardens");
  const cafe = research.places.find((place) => place.name === "ARiSE Coffee Roasters");
  assert.ok(garden);
  assert.ok(cafe);
  assert.equal(garden.guideDisplay?.comparisonRows?.[0]?.relatedPlaceId, cafe.id);
  assert.equal(garden.schedulingEligibility?.evidence?.[0]?.status, "stale");
  assert.equal(garden.fieldEvidence?.[0]?.evidence[0]?.status, "verified");
  const blueprint = importSkillItinerary(research, {
    title: "Tokyo",
    summary: "A slow Kiyosumi morning.",
    language: "en",
    destinations: ["Tokyo"],
    startDate: "2026-10-04",
    endDate: "2026-10-04",
    guideTheme: { title: "Slow Tokyo morning", narrative: "Keep the first day calm and neighborhood based.", visitorMode: "balanced-visitor" },
    days: [{
      id: "tokyo-day",
      date: "2026-10-04",
      kind: "scheduled",
      city: "Tokyo",
      title: "Kiyosumi morning",
      summary: "Garden first, cafe after.",
      stops: [{ placeId: garden.id, order: 1, time: "09:00" }],
      blocks: [
        { id: "block-garden", kind: "stop", order: 1, placeId: garden.id, startTime: "09:00", title: "Start with Kiyosumi Gardens", summary: "Use the garden as the quiet anchor.", evidence: [] },
        { id: "block-cafe", kind: "meal", order: 2, placeId: cafe.id, startTime: "10:45", title: "Coffee break nearby", summary: "Keep the break in the same neighborhood.", evidence: [] },
        { id: "block-flex", kind: "flexible", order: 3, title: "Leave the late morning flexible", summary: "Use this window for pace, weather, or a short nearby extension.", durationMinutes: 45, evidence: [] }
      ],
      candidatePlaceIds: [cafe.id]
    }],
    movements: []
  }, { blueprintId: "blueprint-tokyo", blueprintVersion: 1, createdAt: "2026-08-26T01:00:00.000Z" });
  assert.deepEqual(blueprint.days[0]?.blocks?.map((block) => [block.kind, block.placeId, block.title]), [
    ["stop", garden.id, "Start with Kiyosumi Gardens"],
    ["meal", cafe.id, "Coffee break nearby"],
    ["flexible", undefined, "Leave the late morning flexible"]
  ]);
  assert.deepEqual(blueprint.places.find((place) => place.id === garden.id)?.schedulingEligibility?.suitableDayIds, ["tokyo-day"]);
  assert.equal(blueprint.localFoods?.[0]?.diningPlaceIds[0], cafe.id);
  assert.equal(blueprint.localProducts?.[0]?.purchasePlaceIds[0], garden.id);
  assert.equal(blueprint.experienceThemes?.[0]?.offeringPlaceIds[0], garden.id);
  assert.equal(blueprint.travelTips?.[0]?.placeId, cafe.id);
  assert.equal(blueprint.guideRelationshipGraph?.relationships[0]?.kind, "meal_support");
});

test("Skill research batch rejects invalid place display intent", () => {
  assert.throws(() => parseSkillResearchBatchArtifact(JSON.stringify({
    id: "ignored", scopeLabel: "ignored", completedAt: "ignored",
    sources: [],
    places: [{ id: "place-1", name: "Place", locationLabel: "Center", category: "architecture", display: { type: "landmark" }, whyWorthIt: "Specific architectural value.", plan: "Inspect the facade." }],
    events: [],
    actionRequirements: []
  }), { id: "lisbon", scopeLabel: "Lisbon" }, "2026-08-26T00:00:00.000Z"), RuntimeAdapterError);
});

test("Skill research classifies a Codex usage limit without immediate transient retry semantics", async () => {
  const adapter = new CodexRuntimeAdapter({ run: async (_command, args) => args.includes("--version")
    ? { code: 0, stdout: "codex 1.0", stderr: "" }
    : args[0] === "login" ? { code: 0, stdout: "logged in", stderr: "" }
      : { code: 1, stdout: "", stderr: "ERROR: You've hit your usage limit. Try again later." } });
  await assert.rejects(() => adapter.generateSkillResearchBatch({
    request: "Lisbon on 2026-10-12", batch: { id: "lisbon", scopeLabel: "Lisbon" },
    profile: { preferredLanguage: "English", nationality: "Singapore", gender: "prefer_not_to_say", immigrationStatus: "not_obtained" }
  }), (error: unknown) => error instanceof RuntimeAdapterError && error.code === "rate_limited");
});

test("Skill itinerary artifact contains only known place identities and allows rest days", () => {
  const value = {
    title: "Tokyo", summary: "A balanced trip", language: "en", destinations: ["Tokyo"], startDate: "2026-09-01", endDate: "2026-09-02",
    days: [
      { id: "d1", date: "2026-09-01", kind: "scheduled", city: "Tokyo", title: "Day", summary: "Flow", stops: [{ placeId: "a", order: 1, time: null, role: null }], candidatePlaceIds: ["b"] },
      { id: "d2", date: "2026-09-02", kind: "rest", city: "Tokyo", title: "Rest", summary: "No fixed stops", stops: [], candidatePlaceIds: ["b"] }
    ], movements: []
  };
  const parsed = parseSkillItineraryArtifact(JSON.stringify(value), new Set(["a", "b"]));
  assert.equal(parsed.days[1]?.kind, "rest");
  assert.throws(() => parseSkillItineraryArtifact(JSON.stringify({ ...value, days: [{ ...value.days[0], stops: "missing" }] }), new Set(["a", "b"])), /usable itinerary days/i);
  assert.deepEqual(Object.keys(skillItinerarySchema.properties).sort(), ["days", "destinations", "endDate", "guideTheme", "language", "movements", "startDate", "summary", "title"]);
  assert.ok(skillItinerarySchema.required.includes("guideTheme"));
  assert.ok(skillItinerarySchema.properties.days.items.properties.blocks);
});

test("Skill itinerary parser keeps typed day blocks and filters invalid references", () => {
  const value = {
    title: "Tokyo",
    summary: "A balanced trip",
    language: "en",
    destinations: ["Tokyo"],
    startDate: "2026-09-01",
    endDate: "2026-09-01",
    guideTheme: { title: "Balanced Tokyo", narrative: "Keep the day readable." },
    days: [{
      id: "d1",
      date: "2026-09-01",
      kind: "scheduled",
      city: "Tokyo",
      title: "Garden and coffee",
      summary: "A compact day with explicit rest and flexible time.",
      stops: [{ placeId: "a", order: 1 }, { placeId: "b", order: 2 }],
      blocks: [
        { id: "block-stop", kind: "stop", order: 2, placeId: "a", startTime: "09:00", title: "Garden anchor", summary: "Start with the main visit.", durationMinutes: 90, role: "anchor", evidence: [{ sourceId: "source-1", status: "verified", supports: ["opening window"] }, { sourceId: "missing-source", status: "verified" }] },
        { id: "block-meal", kind: "meal", order: 3, placeId: "b", startTime: "10:45", title: "Coffee break", summary: "Use a real pause, not a hidden note.", durationMinutes: 45, evidence: [] },
        { id: "block-rest", kind: "rest", order: 4, title: "Hotel pause", summary: "Keep time open before the afternoon.", durationMinutes: 30, evidence: [] },
        { id: "block-lodging", kind: "lodging", order: 5, placeId: "hotel", title: "Return to the hotel area", summary: "Regroup before dinner.", evidence: [] },
        { id: "block-flex", kind: "flexible", order: 6, placeId: "c", title: "Same-direction backup", summary: "Use only if pace allows.", evidence: [] },
        { id: "block-transfer", kind: "transfer", order: 7, title: "Move across the neighborhood", summary: "Refresh live routing before leaving.", evidence: [] },
        { id: "block-event", kind: "event", order: 8, eventId: "event-1", title: "Evening program", summary: "Only if the event remains confirmed.", evidence: [] },
        { id: "block-filler-rest", kind: "rest", order: 9, title: "Slow morning", summary: "Take it easy.", evidence: [] },
        { id: "block-filler-flex", kind: "flexible", order: 10, title: "Flexible afternoon", summary: "Free time.", evidence: [] },
        { id: "block-placeholder", kind: "meal", order: 11, title: "Dinner", summary: "Restaurant TBD", evidence: [] },
        { id: "block-unscheduled-stop", kind: "stop", order: 9, placeId: "c", title: "Should drop", evidence: [] },
        { id: "block-missing-place", kind: "meal", order: 10, placeId: "missing", title: "Should drop", evidence: [] },
        { id: "block-missing-event", kind: "event", order: 11, eventId: "missing-event", title: "Should drop", evidence: [] },
        { id: "block-event-no-id", kind: "event", order: 12, title: "Should drop", evidence: [] }
      ],
      candidatePlaceIds: ["c"]
    }],
    movements: []
  };
  const parsed = parseSkillItineraryArtifact(JSON.stringify(value), new Set(["a", "b", "c", "hotel"]), new Set(["source-1"]), new Set(["event-1"]));
  assert.deepEqual(parsed.days[0]?.blocks?.map((block) => [block.kind, block.placeId, block.eventId, block.order]), [
    ["stop", "a", undefined, 1],
    ["meal", "b", undefined, 2],
    ["rest", undefined, undefined, 3],
    ["lodging", "hotel", undefined, 4],
    ["flexible", "c", undefined, 5],
    ["transfer", undefined, undefined, 6],
    ["event", undefined, "event-1", 7],
    ["meal", undefined, undefined, 8]
  ]);
  assert.equal(parsed.days[0]?.blocks?.[0]?.title, "Garden anchor");
  assert.equal(parsed.days[0]?.blocks?.[0]?.summary, "Start with the main visit.");
  assert.equal(parsed.days[0]?.blocks?.[0]?.durationMinutes, 90);
  assert.deepEqual(parsed.days[0]?.blocks?.[0]?.evidence, [{ sourceId: "source-1", status: "verified", supports: ["opening window"] }]);
  assert.equal(parsed.days[0]?.blocks?.[7]?.title, "Dinner");
  assert.equal(parsed.days[0]?.blocks?.[7]?.summary, undefined);
});

test("Skill itinerary parser degrades invalid place candidates and movements instead of rejecting the whole itinerary", () => {
  const value = {
    title: "Tokyo",
    summary: "A balanced trip",
    language: "en",
    destinations: ["Tokyo"],
    startDate: "2026-09-01",
    endDate: "2026-09-01",
    days: [{
      id: "d1",
      date: "2026-09-01",
      kind: "scheduled",
      city: "Tokyo",
      title: "Day",
      summary: "Flow",
      stops: [{ placeId: "b", order: 2 }, { placeId: "missing", order: 3 }, { placeId: "a", order: 1 }],
      candidatePlaceIds: ["b", "missing-candidate", "c"]
    }],
    movements: [
      { id: "bad-missing-place", dayId: "d1", originPlaceId: "a", destinationPlaceId: "missing", mode: "walking", status: "verified", evidence: [] },
      { id: "bad-non-adjacent", dayId: "d1", originPlaceId: "b", destinationPlaceId: "a", mode: "walking", status: "verified", evidence: [{ sourceId: "unknown-source", status: "verified" }] }
    ]
  };
  const parsed = parseSkillItineraryArtifact(JSON.stringify(value), new Set(["a", "b", "c"]), new Set(["source-1"]));
  assert.deepEqual(parsed.days[0]?.stops.map((stop) => [stop.placeId, stop.order]), [["a", 1], ["b", 2]]);
  assert.deepEqual(parsed.days[0]?.candidatePlaceIds, ["c"]);
  assert.equal(parsed.movements.length, 1);
  assert.equal(parsed.movements[0]?.originPlaceId, "a");
  assert.equal(parsed.movements[0]?.destinationPlaceId, "b");
  assert.equal(parsed.movements[0]?.mode, "unknown");
  assert.equal(parsed.movements[0]?.status, "recheck");
});

test("Skill itinerary parser recovers an empty scheduled day from valid candidates", () => {
  const value = {
    title: "Tokyo",
    summary: "A balanced trip",
    language: "en",
    destinations: ["Tokyo"],
    startDate: "2026-09-01",
    endDate: "2026-09-01",
    days: [{
      id: "d1",
      date: "2026-09-01",
      kind: "scheduled",
      city: "Tokyo",
      title: "Day",
      summary: "Flow",
      stops: [{ placeId: "missing", order: 1 }],
      candidatePlaceIds: ["a", "b"]
    }],
    movements: []
  };
  const parsed = parseSkillItineraryArtifact(JSON.stringify(value), new Set(["a", "b"]));
  assert.equal(parsed.days[0]?.kind, "scheduled");
  assert.deepEqual(parsed.days[0]?.stops, [{ placeId: "a", order: 1, role: "recovered_stop" }]);
  assert.deepEqual(parsed.days[0]?.candidatePlaceIds, ["b"]);
});

test("Skill itinerary prompt uses a compact Research Set and forbids Plan execution fields", () => {
  const prompt = buildSkillItineraryPrompt({
    request: "Tokyo on 2026-09-01.",
    profile: { preferredLanguage: "English", nationality: "Canada", gender: "not_specified", immigrationStatus: "not_obtained" },
    research: {
      schemaVersion: 1, id: "research-1", generationKey: "generation-1", proposalRef: { sessionId: "session-1", proposalVersion: 1 }, skillLineage: { skillId: "interactive-trip-planner", skillVersion: "0.2.0" }, status: "completed", batches: [],
      places: [{ id: "a", name: "A", locationLabel: "Tokyo", category: "sight", display: { type: "attraction", markerKind: "attraction" }, priority: "preferred", whyWorthIt: "Worth it", plan: "Visit", evidence: [] }], events: [], sources: [], actionRequirements: [], createdAt: "2026-08-26T00:00:00.000Z", updatedAt: "2026-08-26T00:00:00.000Z", completedAt: "2026-08-26T00:00:00.000Z"
    }
  });
  assert.match(prompt, /Use only the supplied stable place IDs/i);
  assert.match(prompt, /Include guideTheme/i);
  assert.match(prompt, /Every day must include typed day\.blocks/i);
  assert.match(prompt, /Do not create filler blocks merely to fill blank time/i);
  assert.match(prompt, /If deleting the block would not reduce the traveler's ability to understand or execute the day, omit it/i);
  assert.match(prompt, /Do not output Time TBD, Duration TBD, Distance TBD/i);
  assert.match(prompt, /make each covered morning depart from the accommodation occupied the previous night/i);
  assert.match(prompt, /skip this rule without asking for hotel details/i);
  assert.match(prompt, /stop block with placeId must correspond to a same-day stop/i);
  assert.match(prompt, /"display":\{"type":"attraction","markerKind":"attraction"\}/i);
  assert.match(prompt, /Do not return place records, sources, Plan Stages, Tasks, Reminders/i);
  assert.ok(skillItinerarySchema.properties.days.items.required.includes("blocks"));
});

test("Plan drafting preserves the researched map pool instead of collapsing it into the formal route", () => {
  const research = parsePlanResearchBrief(JSON.stringify({
    resolvedDestination: "Paris, France", destinationConfidence: "confirmed", applicabilityNotes: ["Use the Paris venue, not a same-named place."],
    sources: [
      { title: "Venue", authority: "Venue", url: "https://official.example/venue", retrievedAt: "2026-08-18" },
      { title: "Tourism", authority: "Paris tourism", url: "https://official.example/paris", retrievedAt: "2026-08-18" }
    ],
    candidatePlaces: [{ name: "Official Venue", locationLabel: "Paris", city: "Paris", area: "Central Paris", category: "museum", coordinates: [48.86, 2.34], whyCandidate: "A researched cultural anchor that directly supports the approved trip theme.", officialUrl: "https://official.example/venue", bookingUrl: null, reservation: "unknown", sourceUrls: ["https://official.example/venue"] }],
    planningFacts: []
  }));
  const prompt = buildPlanDraftPrompt({ request: "Plan Paris", profile: { preferredLanguage: "English", nationality: "Canada", gender: "not_specified", immigrationStatus: "tourist_visa" } }, research);
  assert.match(prompt, /Preserve every researched candidate with valid coordinates/i);
  assert.match(prompt, /map is a richer exploration surface than the formal route/i);
  assert.match(prompt, /Use \$interactive-trip-planner/i);
  assert.match(prompt, /Execute Stage 3 now/i);
  assert.match(prompt, /4-6 direct replacements and 4-6 extended choices/i);
  assert.match(prompt, /12-18 unique mappable POIs/i);
});

test("Codex preserves travel-plan richness through an unverified fallback when isolated Skill research times out", async () => {
  const calls: string[][] = [];
  const timeouts: number[] = [];
  let generationRuns = 0;
  const fallbackDraft = JSON.stringify({
    ...JSON.parse(validDraft),
    location: "Paris, France",
    sources: [],
    presentation: {
      kind: "itinerary", summary: "A mapped itinerary whose current facts remain explicitly unverified.", language: "en", startDate: "2026-09-01", endDate: "2026-09-01", cities: ["Paris"],
      days: [{ id: "day-1", label: "Day 1", date: "2026-09-01", city: "Paris", title: "Arrival in Paris", summary: "A light arrival day with one real mapped destination.", anchors: ["hotel"], candidates: [], placeIds: ["hotel"], stops: [{ placeId: "hotel", order: 1, time: "16:00" }] }],
      places: [{ id: "hotel", name: "Provisional central Paris hotel area", locationLabel: "Central Paris", coordinates: [48.8566, 2.3522], city: "Paris", area: "Central Paris", category: "accommodation", priority: "pending", whyWorthIt: "A provisional central base for route planning.", plan: "Replace this area marker after accommodation is booked.", detailSections: [], sourceRefs: [] }],
      routeSegments: []
    }
  });
  const run: RuntimeProcess = async (_command, args, options) => {
    calls.push(args);
    if (options?.timeoutMs) timeouts.push(options.timeoutMs);
    if (args[0] === "--version") return { code: 0, stdout: "codex 1.0\n", stderr: "" };
    if (args[0] === "login") return { code: 0, stdout: "Logged in", stderr: "" };
    if (args[0] === "--search" && /Research and resolve the factual scope/i.test(args.at(-1) ?? "")) return { code: 0, stdout: "", stderr: "", timedOut: true };
    generationRuns += 1;
    return { code: 0, stdout: fallbackDraft, stderr: "" };
  };

  const draft = await new CodexRuntimeAdapter({ run }).generatePlanDraft({
    request: "I want to visit Paris for seven days.",
    profile: { preferredLanguage: "English", nationality: "Canada", gender: "not_specified", immigrationStatus: "tourist_visa" }
  });

  assert.equal(draft.location, "Paris, France");
  assert.equal(generationRuns, 1);
  assert.equal(calls.length, 4);
  assert.deepEqual(timeouts, [30_000, 30_000, 1_080_000, 1_800_000]);
  assert.match(calls.at(-1)?.at(-1) ?? "", /do not repeat web research/i);
  assert.match(calls.at(-1)?.at(-1) ?? "", /Do not return a non-spatial timeline or an empty places array/i);
});

test("Codex classifies a graceful zero exit after the draft timeout as timed out", async () => {
  const run: RuntimeProcess = async (_command, args) => {
    if (args[0] === "--version") return { code: 0, stdout: "codex 1.0\n", stderr: "" };
    if (args[0] === "login") return { code: 0, stdout: "Logged in", stderr: "" };
    if (args[0] === "--search" && /Research and resolve the factual scope/i.test(args.at(-1) ?? "")) return { code: 0, stdout: "", stderr: "", timedOut: true };
    return { code: 0, stdout: "", stderr: "progress", timedOut: true };
  };

  await assert.rejects(
    new CodexRuntimeAdapter({ run }).generatePlanDraft({
      request: "Create a complete Shanghai Plan.",
      profile: { preferredLanguage: "English", nationality: "Canada", gender: "not_specified", immigrationStatus: "tourist_visa" }
    }),
    (error: unknown) => error instanceof RuntimeAdapterError && error.code === "timed_out" && /assembling the complete Plan/i.test(error.message)
  );
});

test("Codex keeps a zero exit with no output and no timeout classified as invalid output", async () => {
  const run: RuntimeProcess = async (_command, args) => {
    if (args[0] === "--version") return { code: 0, stdout: "codex 1.0\n", stderr: "" };
    if (args[0] === "login") return { code: 0, stdout: "Logged in", stderr: "" };
    if (args[0] === "--search" && /Research and resolve the factual scope/i.test(args.at(-1) ?? "")) return { code: 0, stdout: "", stderr: "", timedOut: true };
    return { code: 0, stdout: "", stderr: "completed without a final message" };
  };

  await assert.rejects(
    new CodexRuntimeAdapter({ run }).generatePlanDraft({
      request: "Create a complete Shanghai Plan.",
      profile: { preferredLanguage: "English", nationality: "Canada", gender: "not_specified", immigrationStatus: "tourist_visa" }
    }),
    (error: unknown) => error instanceof RuntimeAdapterError && error.code === "invalid_output" && /without returning structured output/i.test(error.message)
  );
});

test("Codex accepts structured stdout when the final-message file was not created", async () => {
  const run: RuntimeProcess = async (_command, args) => {
    if (args[0] === "--version") return { code: 0, stdout: "codex 1.0\n", stderr: "" };
    if (args[0] === "login") return { code: 0, stdout: "Logged in", stderr: "" };
    if (args[0] === "--search" && /Research and resolve the factual scope/i.test(args.at(-1) ?? "")) return { code: 1, stdout: "", stderr: "", timedOut: true };
    return { code: 0, stdout: validDraft, stderr: "" };
  };

  const draft = await new CodexRuntimeAdapter({ run }).generatePlanDraft({
    request: "Create a complete Shanghai Plan.",
    profile: { preferredLanguage: "English", nationality: "Canada", gender: "not_specified", immigrationStatus: "tourist_visa" }
  });

  assert.equal(draft.title, "Attend an exhibition in Shanghai");
});

test("Codex repairs one structurally rejected Plan instead of ending generation", async () => {
  const calls: string[][] = [];
  let generationRuns = 0;
  const run: RuntimeProcess = async (_command, args) => {
    calls.push(args);
    if (args[0] === "--version") return { code: 0, stdout: "codex 1.0\n", stderr: "" };
    if (args[0] === "login") return { code: 0, stdout: "Logged in", stderr: "" };
    if (args[0] === "--search" && /Research and resolve the factual scope/i.test(args.at(-1) ?? "")) return { code: 1, stdout: "", stderr: "", timedOut: true };
    generationRuns += 1;
    const outputIndex = args.indexOf("--output-last-message");
    const malformedDraft = JSON.parse(validDraft) as { stages: unknown[] };
    malformedDraft.stages.pop();
    const output = generationRuns === 1 ? JSON.stringify(malformedDraft) : validDraft;
    await writeFile(args[outputIndex + 1]!, output, "utf8");
    return { code: 0, stdout: "", stderr: "" };
  };

  const draft = await new CodexRuntimeAdapter({ run }).generatePlanDraft({
    request: "Create a complete Shanghai Plan.",
    profile: { preferredLanguage: "English", nationality: "Canada", gender: "not_specified", immigrationStatus: "tourist_visa" }
  });

  assert.equal(draft.title, "Attend an exhibition in Shanghai");
  assert.equal(generationRuns, 2);
  assert.equal(calls.length, 5);
  assert.match(calls.at(-1)?.at(-1) ?? "", /Repair one rejected Landi Plan draft/i);
  assert.match(calls.at(-1)?.at(-1) ?? "", /only repair attempt/i);
});

test("Codex stops the active generation process when its request is cancelled", async () => {
  const controller = new AbortController();
  const stages: string[] = [];
  const run: RuntimeProcess = async (_command, args, options) => {
    if (args[0] === "--version") return { code: 0, stdout: "codex 1.0\n", stderr: "" };
    if (args[0] === "login") return { code: 0, stdout: "Logged in", stderr: "" };
    assert.equal(options?.signal, controller.signal);
    controller.abort();
    return { code: 0, stdout: "", stderr: "", aborted: true };
  };

  await assert.rejects(
    new CodexRuntimeAdapter({ run }).generatePlanDraft({
      request: "Create a complete Shanghai Plan.",
      signal: controller.signal,
      onStage: (stage) => stages.push(stage),
      profile: { preferredLanguage: "English", nationality: "Canada", gender: "not_specified", immigrationStatus: "tourist_visa" }
    }),
    (error: unknown) => error instanceof RuntimeAdapterError && error.code === "cancelled"
  );
  assert.deepEqual(stages, ["researching"]);
});

test("repair prompt names missing itinerary execution details", () => {
  const rejected = JSON.stringify({ presentation: { kind: "itinerary", summary: "Incomplete", days: [{ id: "d1", label: "Day 1", placeIds: [] }], places: [], routeSegments: [] } });
  const prompt = buildPlanRepairPrompt({ request: "Plan Paris", profile: { preferredLanguage: "English", nationality: "Canada", gender: "not_specified", immigrationStatus: "tourist_visa" } }, rejected, new RuntimeAdapterError("invalid_output", "Invalid Plan"));
  assert.match(prompt, /day d1 must have a machine-readable date/i);
  assert.match(prompt, /ordered stops with local HH:mm times/i);
  assert.match(prompt, /Use \$interactive-trip-planner/i);
  assert.match(prompt, /at least 12 unique choices/i);
});

test("location validation accepts harmless aliases but rejects a same-named different place", () => {
  assert.equal(areLocationsCompatible("Honolulu, Oahu, Hawaii", "Honolulu, Island of Oahu, Hawaii, United States"), true);
  assert.equal(areLocationsCompatible("Handan, Hebei, China", "Fudan University Handan Campus, Yangpu District, Shanghai, China"), false);
});

test("Claude Code Adapter extracts the Print-mode result before validating the Plan", () => {
  assert.equal(parseClaudePrintResult(JSON.stringify({ result: validDraft })), validDraft);
  assert.throws(() => parseClaudePrintResult(JSON.stringify({ result: 42 })), RuntimeAdapterError);
});

test("Claude Code Adapter runs one isolated web-research Print-mode Plan draft without Connector secrets", async () => {
  const calls: Array<{ command: string; args: string[]; options?: Parameters<RuntimeProcess>[2] }> = [];
  const run: RuntimeProcess = async (command, args, options) => {
    calls.push({ command, args, options });
    if (args[0] === "--version") return { code: 0, stdout: "2.1.0\n", stderr: "" };
    if (args[0] === "auth") return { code: 0, stdout: "{\"loggedIn\":true}", stderr: "" };
    return { code: 0, stdout: JSON.stringify({ result: validDraft }), stderr: "" };
  };
  const adapter = new ClaudeCodeRuntimeAdapter({
    run,
    environment: { PATH: process.env.PATH, AMAP_API_KEY: "not-for-claude", TELEGRAM_BOT_TOKEN: "not-for-claude", WHATSAPP_ACCESS_TOKEN: "not-for-claude", WHATSAPP_APP_SECRET: "not-for-claude", ANTHROPIC_API_KEY: "not-for-claude" }
  });

  const draft = await adapter.generatePlanDraft({
    request: "I will attend an exhibition in Shanghai.",
    profile: { preferredLanguage: "English", nationality: "Canada", gender: "woman", immigrationStatus: "tourist_visa" }
  });

  assert.equal(draft.title, "Attend an exhibition in Shanghai");
  const generation = calls.at(-1)!;
  assert.equal(generation.command, "claude");
  assert.deepEqual(generation.args.slice(0, 8), ["-p", "--output-format", "json", "--max-turns", "8", "--tools", "WebSearch,WebFetch", "--json-schema"]);
  assert.equal(generation.args.includes("--strict-mcp-config"), true);
  assert.equal(generation.args.includes("--no-session-persistence"), true);
  assert.match(generation.args.at(-1) ?? "", /User request: I will attend an exhibition/i);
  assert.equal(generation.options?.env?.AMAP_API_KEY, undefined);
  assert.equal(generation.options?.env?.TELEGRAM_BOT_TOKEN, undefined);
  assert.equal(generation.options?.env?.WHATSAPP_ACCESS_TOKEN, undefined);
  assert.equal(generation.options?.env?.WHATSAPP_APP_SECRET, undefined);
  assert.equal(generation.options?.env?.ANTHROPIC_API_KEY, undefined);
  assert.equal(generation.options?.timeoutMs, 240_000);
  assert.equal(existsSync(generation.options?.cwd ?? ""), false);
});

test("Claude Code classifies a graceful zero exit after timeout as timed out", async () => {
  const run: RuntimeProcess = async (_command, args) => {
    if (args[0] === "--version") return { code: 0, stdout: "2.1.0\n", stderr: "" };
    if (args[0] === "auth") return { code: 0, stdout: JSON.stringify({ loggedIn: true }), stderr: "" };
    return { code: 0, stdout: "", stderr: "progress", timedOut: true };
  };

  await assert.rejects(
    new ClaudeCodeRuntimeAdapter({ run }).generatePlanDraft({
      request: "Create a complete Shanghai Plan.",
      profile: { preferredLanguage: "English", nationality: "Canada", gender: "not_specified", immigrationStatus: "tourist_visa" }
    }),
    (error: unknown) => error instanceof RuntimeAdapterError && error.code === "timed_out"
  );
});

test("Claude Code Adapter does not treat a logged-out JSON status as authenticated", async () => {
  const run: RuntimeProcess = async (_command, args) => {
    if (args[0] === "--version") return { code: 0, stdout: "2.1.85\n", stderr: "" };
    return { code: 0, stdout: JSON.stringify({ loggedIn: false, authMethod: "none" }), stderr: "" };
  };

  const status = await new ClaudeCodeRuntimeAdapter({ run }).check();
  assert.equal(status.installed, true);
  assert.equal(status.authenticated, false);
  assert.match(status.message ?? "", /needs login/i);
});

test("Claude Code Adapter classifies an expired OAuth token as needing login", async () => {
  const run: RuntimeProcess = async (_command, args) => {
    if (args[0] === "--version") return { code: 0, stdout: "2.1.85\n", stderr: "" };
    if (args[0] === "auth") return { code: 0, stdout: JSON.stringify({ loggedIn: true }), stderr: "" };
    return { code: 1, stdout: JSON.stringify({ is_error: true, result: "Failed to authenticate. OAuth access token has expired." }), stderr: "" };
  };

  await assert.rejects(
    new ClaudeCodeRuntimeAdapter({ run }).generatePlanDraft({
      request: "I will attend an exhibition in Shanghai.",
      profile: { preferredLanguage: "English", nationality: "Canada", gender: "not_specified", immigrationStatus: "tourist_visa" }
    }),
    (error: unknown) => error instanceof RuntimeAdapterError && error.code === "not_authenticated" && /expired/i.test(error.message)
  );
});

test("Codex Plan context includes confirmed Profile identity without claiming policy eligibility", () => {
  const prompt = buildPlanDraftPrompt({
    request: "I will attend an exhibition in Shanghai.",
    profile: { preferredLanguage: "English", nationality: "Canada", gender: "woman", immigrationStatus: "tourist_visa" }
  });
  assert.match(prompt, /nationality: Canada/);
  assert.match(prompt, /gender: woman/);
  assert.match(prompt, /Destination entry or residence status: tourist_visa/);
  assert.match(prompt, /not as proof of a policy entitlement/i);
  assert.match(prompt, /Never invent a date, time, or departure time zone/i);
  assert.match(prompt, /Use \["weather"\] only when current destination weather/i);
  assert.match(prompt, /exactly six stages/i);
  assert.match(prompt, /Trip Overview/);
  assert.match(prompt, /Daily Itinerary/);
  assert.match(prompt, /Reservations/);
  assert.match(prompt, /Budget/);
  assert.match(prompt, /Transport/);
  assert.match(prompt, /Emergency Information/);
  assert.match(prompt, /10-20% contingency/i);
  assert.match(prompt, /plan backward/i);
  assert.match(prompt, /1-2 must-do items per day/i);
  assert.match(prompt, /only time-bound travel nodes/i);
  assert.match(prompt, /Only packing or carry items and concrete work that must be completed before departure/i);
  assert.match(prompt, /one tangible object that goes into luggage/i);
  assert.match(prompt, /A booking, payment, application, appointment, document procedure, account setup, or decision is never a physical item/i);
  assert.match(prompt, /actual destination and travel dates or season/i);
  assert.match(prompt, /Keep passports, visas, admission letters/i);
  assert.match(prompt, /Do not present itinerary nodes, on-trip activities, general information, budgets, transport guidance, or post-arrival actions as checklist work/i);
  assert.match(prompt, /host collects user-confirmed basics before invoking you/i);
  assert.match(prompt, /ask for at most one optional highest-value missing fact/i);
  assert.match(prompt, /Do not turn missing profile fields, dates, venues, budgets, preferences, or other information requests into user-owned Tasks/i);
  assert.match(prompt, /Missing information blocks only the Task or decision that requires it/i);
  assert.match(prompt, /Never invent an app download URL/i);
  assert.match(prompt, /Turn every confirmed fact into a visible planning consequence/i);
  assert.match(prompt, /make the arrival day genuinely usable/i);
  assert.match(prompt, /A taxi preference should produce door-to-door routing/i);
  assert.match(prompt, /food restriction should affect meal suggestions/i);
  assert.match(prompt, /When no brief is supplied, do not claim that current facts were verified/i);
  assert.match(prompt, /Keep sources empty/i);
  assert.match(prompt, /never fabricate citations or verified facts/i);
});

test("Codex treats no visa yet as a research trigger without deciding eligibility", () => {
  const input = {
    request: "I plan to study in Shanghai.",
    profile: { preferredLanguage: "English", nationality: "Canada", gender: "not_specified" as const, immigrationStatus: "no_visa" as const }
  };
  const researchPrompt = buildPlanResearchPrompt(input);
  const draftPrompt = buildPlanDraftPrompt(input);
  assert.match(researchPrompt, /has not obtained a destination visa or residence permit yet/i);
  assert.match(researchPrompt, /official application requirements and preparation steps/i);
  assert.match(draftPrompt, /No visa or residence permit has been obtained yet/i);
  assert.match(draftPrompt, /Do not decide eligibility, promise approval, or invent a visa category/i);
});

test("Plan revision context is complete but excludes Core and Connector state", () => {
  const currentPlan = JSON.parse(validDraft);
  const prompt = buildPlanDraftPrompt({
    request: "Move the arrival date to September 2.",
    currentPlan,
    completedTasks: [{ stageTitle: "Preparation", title: "Pack passport", dueLabel: "Before departure" }],
    profile: { preferredLanguage: "English", nationality: "Canada", gender: "woman", immigrationStatus: "tourist_visa" }
  });

  assert.match(prompt, /Current draft to revise/);
  assert.match(prompt, /Move the arrival date to September 2/);
  assert.match(prompt, /Attend an exhibition in Shanghai/);
  assert.match(prompt, /Preserve every unaffected known fact/);
  assert.match(prompt, /User-confirmed completed Tasks/);
  assert.match(prompt, /Pack passport/);
  assert.match(prompt, /do not remind the user about it/i);
  assert.doesNotMatch(prompt, /sourceSnapshots|AMAP_API_KEY|TELEGRAM_BOT_TOKEN|plan-[0-9a-f-]{36}/);
});
