import assert from "node:assert/strict";
import test from "node:test";

import { importSkillItinerary, type ResearchSet } from "../packages/core/src/index.ts";
import type { SemanticTravelPlan } from "../packages/agent-adapters/src/index.ts";
import { hardenSemanticPlanContract, structureSemanticTravelPlan } from "./semantic-plan-structurer.ts";

const research: ResearchSet = {
  schemaVersion: 1,
  id: "research-test",
  generationKey: "generation-test",
  proposalRef: { sessionId: "session-test", proposalVersion: 1 },
  skillLineage: { skillId: "landi-trip-blueprint", skillVersion: "1.0.0" },
  status: "completed",
  batches: [],
  places: [
    { id: "tegallalang", name: "Tegallalang Rice Terrace", locationLabel: "Ubud", city: "Bali", area: "Ubud", category: "rice terrace", priority: "preferred", whyWorthIt: "Rice terrace.", plan: "Visit.", evidence: [] },
    { id: "tirta", name: "Tirta Empul Temple", locationLabel: "Tampaksiring", city: "Bali", area: "Ubud", category: "temple", priority: "preferred", whyWorthIt: "Temple.", plan: "Visit.", evidence: [] },
    { id: "jatiluwih", name: "Jatiluwih Rice Terraces", locationLabel: "Jatiluwih", city: "Bali", area: "Tabanan", category: "rice terraces", priority: "must", whyWorthIt: "Subak landscape.", plan: "Visit.", evidence: [] },
    { id: "waterbom", name: "Waterbom Bali", locationLabel: "Kuta", city: "Bali", area: "South Bali", category: "water park", priority: "preferred", whyWorthIt: "Recreation day.", plan: "Visit.", evidence: [] },
    { id: "uluwatu", name: "Uluwatu Temple", locationLabel: "Uluwatu", city: "Bali", area: "South Bali", category: "temple", priority: "must", whyWorthIt: "Cliff temple.", plan: "Visit.", evidence: [] },
    { id: "kecak", name: "Uluwatu Kecak Dance", locationLabel: "Uluwatu", city: "Bali", area: "South Bali", category: "performance", priority: "must", whyWorthIt: "Performance.", plan: "Attend.", evidence: [] }
  ],
  events: [],
  sources: [],
  actionRequirements: [],
  createdAt: "2026-09-14T00:00:00.000Z",
  updatedAt: "2026-09-14T00:00:00.000Z",
  completedAt: "2026-09-14T00:00:00.000Z"
};

const semanticPlan: SemanticTravelPlan = {
  title: "Bali S1.2 fixture",
  language: "en",
  tripStrategy: "Use Ubud first, then South Bali. Preserve lodging uncertainty.",
  targetedResearch: [],
  dailyItinerary: [
    {
      date: "2026-10-08",
      area: "North and northeast of Ubud",
      startContext: { label: "Ubud accommodation - exact property pending", status: "planned_base_pending_property" },
      endContext: { label: "Ubud accommodation - exact property pending", status: "planned_base_pending_property" },
      plan: "Visit Tegallalang Rice Terrace, then continue to Tirta Empul Temple. Do not assume admission permits purification.",
      experiences: [
        { title: "Tegallalang Rice Terrace", placeName: "Tegallalang Rice Terrace", planRole: "planned", summary: "Weather-aware terrace walk.", operationalConditions: [{ kind: "weather", note: "Adjust walk if rain or mud makes paths uncomfortable." }] },
        { title: "Tirta Empul Temple", placeName: "Tirta Empul Temple", planRole: "planned", summary: "Ordinary temple visit.", operationalConditions: [{ kind: "access", note: "Do not assume purification access." }] }
      ]
    },
    {
      date: "2026-10-09",
      area: "Ubud to Jatiluwih, Mengwi, and Jimbaran",
      startContext: { label: "Ubud accommodation - exact property pending", status: "planned_base_pending_property" },
      endContext: { label: "Jimbaran accommodation - exact property pending", status: "planned_base_pending_property" },
      plan: "Jatiluwih is the principal transfer-day experience. Taman Ayun is optional if route and energy allow.",
      experiences: [
        { title: "Jatiluwih Rice Terraces", placeName: "Jatiluwih Rice Terraces", planRole: "planned", primaryExperience: true, summary: "Principal rice-landscape experience.", operationalConditions: [{ kind: "weather", note: "Use a weather-appropriate route." }] },
        { title: "Taman Ayun", planRole: "optional", summary: "Energy-dependent transfer stop.", operationalConditions: [{ kind: "route", note: "Depends on selected hotels." }, { kind: "traveler_choice", note: "Use only if the group has energy." }] }
      ]
    },
    {
      date: "2026-10-10",
      area: "Kuta and Jimbaran",
      startContext: { label: "Jimbaran accommodation - exact property pending", status: "planned_base_pending_property" },
      endContext: { label: "Jimbaran accommodation - exact property pending", status: "planned_base_pending_property" },
      plan: "Waterbom is the core day plan. Jimbaran Beach replaces it if travelers do not want a water park.",
      experiences: [
        { title: "Waterbom Bali", placeName: "Waterbom Bali", planRole: "planned", primaryExperience: true, summary: "Core recreational plan.", startTime: "09:30", operationalConditions: [{ kind: "reservation", note: "Consider advance tickets." }] },
        { title: "Jimbaran Beach", planRole: "replacement", replacementFor: "Waterbom Bali", summary: "Slow beach replacement if travelers reject the water park.", operationalConditions: [{ kind: "traveler_choice", note: "Traveler preference decides this replacement." }] }
      ]
    },
    {
      date: "2026-10-11",
      area: "Jimbaran and Uluwatu",
      startContext: { label: "Jimbaran accommodation - exact property pending", status: "planned_base_pending_property" },
      endContext: { label: "Jimbaran accommodation - exact property pending", status: "planned_base_pending_property" },
      plan: "Light Jimbaran Beach morning, then planned Uluwatu Temple and Kecak finale with session confirmation.",
      experiences: [
        { title: "Jimbaran Beach", planRole: "planned", summary: "Light morning beach experience.", startTime: "09:30" },
        { title: "Uluwatu Temple", placeName: "Uluwatu Temple", planRole: "planned", summary: "Planned cliff temple.", startTime: "15:00" },
        { title: "Uluwatu Kecak Dance", placeName: "Uluwatu Kecak Dance", planRole: "planned", summary: "Planned performance.", operationalConditions: [{ kind: "session", note: "Confirm session." }, { kind: "reservation", note: "Confirm tickets." }] }
      ]
    }
  ],
  unresolvedExperiences: ["Taman Ayun remains route- and energy-dependent."],
  preparation: ["Confirm and buy three Uluwatu Kecak tickets after the October 11 performance time is published.", "Carry light rain shells and shoes suitable for wet paths."],
  tips: ["Do not use straight-line map distances to judge Bali journeys.", "At temples, cover shoulders and knees."],
  researchGrounding: ["Fixture research grounding."],
  followUpChecks: ["Confirm Kecak ticket inventory."],
  markdown: "x".repeat(1200)
};

test("S1.2 preserves plan role separately from operational conditions", () => {
  const { artifact } = structureSemanticTravelPlan(semanticPlan, research, { hardenContract: false });
  const oct8 = artifact.days.find((day) => day.date === "2026-10-08")!;
  const tirta = oct8.blocks?.find((block) => block.title === "Tirta Empul Temple");
  assert.equal(tirta?.planRole, "planned");
  assert.deepEqual(tirta?.operationalConditions?.map((item) => item.kind), ["access"]);
});

test("S1.2 preserves Jatiluwih as planned primary and Taman Ayun as optional", () => {
  const { artifact } = structureSemanticTravelPlan(semanticPlan, research, { hardenContract: false });
  const oct9 = artifact.days.find((day) => day.date === "2026-10-09")!;
  const jatiluwih = oct9.blocks?.find((block) => block.title === "Jatiluwih Rice Terraces");
  const tamanAyun = oct9.blocks?.find((block) => block.title === "Taman Ayun");
  assert.equal(jatiluwih?.planRole, "planned");
  assert.equal(jatiluwih?.primaryExperience, true);
  assert.equal(tamanAyun?.planRole, "optional");
});

test("S1.2 preserves Waterbom replacement relationship", () => {
  const { artifact } = structureSemanticTravelPlan(semanticPlan, research, { hardenContract: false });
  const oct10 = artifact.days.find((day) => day.date === "2026-10-10")!;
  const waterbom = oct10.blocks?.find((block) => block.title === "Waterbom Bali");
  const beach = oct10.blocks?.find((block) => block.title === "Jimbaran Beach");
  assert.equal(waterbom?.planRole, "planned");
  assert.equal(waterbom?.primaryExperience, true);
  assert.equal(beach?.planRole, "replacement");
  assert.equal(beach?.replacementFor, "Waterbom Bali");
  assert.equal(beach?.replacementForBlockId, waterbom?.id);
});

test("S1.2 preserves Kecak as planned with session and reservation conditions", () => {
  const { artifact } = structureSemanticTravelPlan(semanticPlan, research, { hardenContract: false });
  const kecak = artifact.days.find((day) => day.date === "2026-10-11")?.blocks?.find((block) => block.title === "Uluwatu Kecak Dance");
  assert.equal(kecak?.planRole, "planned");
  assert.deepEqual(kecak?.operationalConditions?.map((item) => item.kind).sort(), ["reservation", "session"]);
});

test("S1.2 carries start and end context into artifact and TripBlueprint", () => {
  const { artifact } = structureSemanticTravelPlan(semanticPlan, research, { hardenContract: false });
  const blueprint = importSkillItinerary(research, artifact, { blueprintId: "blueprint-test", blueprintVersion: 1, createdAt: "2026-09-14T00:00:00.000Z" });
  assert.equal(artifact.days[1]?.startContext?.label, "Ubud accommodation - exact property pending");
  assert.equal(blueprint.days[1]?.endContext?.label, "Jimbaran accommodation - exact property pending");
});

test("S1.2 maps preparation and tips to native structures", () => {
  const { artifact, importedBlueprint } = structureSemanticTravelPlan(semanticPlan, research, { hardenContract: false, importBlueprint: true, createdAt: "2026-09-14T00:00:00.000Z" });
  assert.equal(artifact.preparationChecklist?.length, 2);
  assert.equal(artifact.travelTips?.length, 2);
  assert.equal(importedBlueprint?.preparationChecklist?.length, 2);
  assert.equal(importedBlueprint?.travelTips?.length, 2);
});

test("S1.2 fidelity reports no changed or dropped decisions", () => {
  const { fidelity } = structureSemanticTravelPlan(semanticPlan, research, { hardenContract: false, importBlueprint: true, createdAt: "2026-09-14T00:00:00.000Z" });
  assert.equal(fidelity.some((item) => item.classification === "CHANGED" || item.classification === "DROPPED"), false);
});

test("contract hardening supplies accepted Bali metadata when old V2.4 plan lacks experiences", () => {
  const oldPlan: SemanticTravelPlan = { ...semanticPlan, dailyItinerary: semanticPlan.dailyItinerary.map(({ experiences: _experiences, ...day }) => day) };
  const hardened = hardenSemanticPlanContract(oldPlan);
  assert.equal(hardened.dailyItinerary.find((day) => day.date === "2026-10-10")?.experiences?.find((item) => item.title === "Jimbaran Beach")?.planRole, "replacement");
});
