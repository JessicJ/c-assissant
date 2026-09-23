import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { buildSemanticTravelPlanPrompt, CodexRuntimeAdapter, semanticTravelPlanStaticPrompt, type SemanticTravelPlan } from "../packages/agent-adapters/src/index.ts";
import type { ImmigrationStatus, PlanningFact, PlanningMessage, PlanningProposal, ProfileGender, ResearchSet } from "../packages/core/src/index.ts";

interface PlanningSessionRow {
  id: string;
  status: string;
  messages_json: string;
  facts_json: string;
  proposal_json: string | null;
  confirmed_proposal_version: number | null;
}

interface ProfileRow {
  preferred_language: string;
  nationality: string;
  gender: ProfileGender;
  immigration_status: ImmigrationStatus;
}

const databasePath = resolve(process.env.C_ASSISTANT_DATA_PATH ?? "data/c-assistant.sqlite");
const outputBase = resolve(process.env.SEMANTIC_PLAN_OUTPUT ?? "output/semantic-plan");

const db = new DatabaseSync(databasePath, { readOnly: true });
try {
  const profile = db.prepare("SELECT preferred_language, nationality, gender, immigration_status FROM profiles WHERE id = 1").get() as ProfileRow | undefined;
  if (!profile) throw new Error("Profile row not found.");
  const session = db.prepare(`
    SELECT id, status, messages_json, facts_json, proposal_json, confirmed_proposal_version
    FROM planning_sessions
    WHERE objective_type = 'travel'
      AND confirmed_proposal_version IS NOT NULL
      AND lower(facts_json) LIKE '%bali%'
    ORDER BY updated_at DESC, rowid DESC
    LIMIT 1
  `).get() as PlanningSessionRow | undefined;
  if (!session?.confirmed_proposal_version) throw new Error("No confirmed Bali planning session found.");
  const generationKey = `${session.id}:${session.confirmed_proposal_version}:landi-trip-blueprint@1.0.0`;
  const researchRow = db.prepare("SELECT content_json FROM research_sets WHERE generation_key = ?").get(generationKey) as { content_json: string } | undefined;
  if (!researchRow) throw new Error(`No completed Landi ResearchSet found for ${generationKey}.`);
  const research = JSON.parse(researchRow.content_json) as ResearchSet;
  if (research.status !== "completed") throw new Error(`ResearchSet is ${research.status}, not completed.`);

  const messages = JSON.parse(session.messages_json) as PlanningMessage[];
  const facts = JSON.parse(session.facts_json) as PlanningFact[];
  const proposal = session.proposal_json ? JSON.parse(session.proposal_json) as PlanningProposal : undefined;
  const request = [
    "Create Planner V2.4 semantic travel plan only, using clean production-like context and plan-driven targeted research for meaningful day richness. Do not create TripBlueprint, blocks, stops, movements, IDs, Web timeline, Telegram reminders, or execution tasks.",
    "Do not use or infer from any prior Planner V2 output, accepted day sequence, gold itinerary, benchmark itinerary, or expected Bali solution. Use only the confirmed facts, conversation context, profile, ResearchSet, and bounded plan-serving targeted research.",
    "",
    "Confirmed facts:",
    ...facts.filter((fact) => fact.confirmed).map((fact) => `- ${fact.key}: ${fact.value}`),
    "",
    proposal ? `Confirmed proposal: ${proposal.title}\nObjective: ${proposal.objective}\nTheme: ${proposal.theme}\nSegments: ${proposal.segments.join("; ")}\nTrade-offs: ${proposal.tradeoffs.join("; ")}\nAssumptions: ${proposal.assumptions.join("; ")}` : "",
    "",
    "Conversation context:",
    ...messages.map((message) => `- ${message.role}: ${message.text}`)
  ].filter(Boolean).join("\n");

  const adapter = new CodexRuntimeAdapter();
  const profileContext = {
    preferredLanguage: profile.preferred_language,
    nationality: profile.nationality,
    gender: profile.gender,
    immigrationStatus: profile.immigration_status
  };
  const semanticInput = { request, research, fixedCommitments: [], profile: profileContext };
  const fullPlannerPrompt = buildSemanticTravelPlanPrompt(semanticInput);
  const result = await adapter.generateSemanticTravelPlan(semanticInput);

  await mkdir(dirname(outputBase), { recursive: true });
  await writeFile(`${outputBase}.raw.json`, result.rawJson.endsWith("\n") ? result.rawJson : `${result.rawJson}\n`, "utf8");
  await writeFile(`${outputBase}.json`, `${JSON.stringify(result.plan, null, 2)}\n`, "utf8");
  await writeFile(`${outputBase}.md`, result.plan.markdown.endsWith("\n") ? result.plan.markdown : `${result.plan.markdown}\n`, "utf8");
  await writeFile(`${outputBase}.diagnostics.json`, `${JSON.stringify({
    databasePath,
    sessionId: session.id,
    sessionStatus: session.status,
    generationKey,
    researchSetId: research.id,
    promptAudit: {
      systemPlannerPrompt: semanticTravelPlanStaticPrompt(),
      dynamicContextCategories: [
        "confirmed user facts",
        "confirmed proposal metadata",
        "conversation messages",
        "profile context",
        "ResearchSet compact places/events/foods/products/themes/tips/actionRequirements/sources",
        "bounded targeted web research inside Planner V2.4"
      ],
      finalPromptCharacterCount: fullPlannerPrompt.length,
      goldPlanLeakage: {
        priorSemanticPlan: false,
        acceptedDayHeadings: false,
        acceptedBaliSequence: false,
        benchmarkItinerary: false,
        expectedOutputExamplesContainingBaliSolution: false
      }
    },
    inputCounts: {
      messages: messages.length,
      facts: facts.length,
      places: research.places.length,
      events: research.events.length,
      sources: research.sources.length,
      actionRequirements: research.actionRequirements.length
    },
    researchSetSize: {
      places: research.places.length,
      events: research.events.length,
      localFoods: research.localFoods?.length ?? 0,
      localProducts: research.localProducts?.length ?? 0,
      experienceThemes: research.experienceThemes?.length ?? 0,
      travelTips: research.travelTips?.length ?? 0,
      sources: research.sources.length,
      actionRequirements: research.actionRequirements.length
    },
    targetedResearchPerformed: result.plan.targetedResearch,
    researchBehaviorReport: semanticResearchBehaviorReport(result.plan),
    unresolvedExperiencesProposed: result.plan.unresolvedExperiences,
    qualityReview: semanticPlanQualityReview(result.plan),
    omittedProductionFields: ["TripBlueprint", "SkillItineraryArtifact", "days.blocks", "days.stops", "movements", "movement IDs", "block IDs", "candidatePlaceIds", "Timeline UI", "Telegram reminder schema", "compiler tasks", "execution configuration", "database persistence"]
  }, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ok: true, outputBase, sessionId: session.id, generationKey, researchSetId: research.id }, null, 2));
} finally {
  db.close();
}

function semanticPlanQualityReview(plan: SemanticTravelPlan): Record<string, string> {
  const markdown = plan.markdown.toLowerCase();
  const baseChangeDay = plan.dailyItinerary.find((day) => day.startContext.label !== day.endContext.label && day.startContext.status.includes("property") && day.endContext.status.includes("property"));
  const missingAnchors = plan.dailyItinerary.filter((day) => !day.startContext.label || !day.endContext.label).length;
  return {
    accommodationBaseStrategy: /base|lodging|accommodation|hotel/.test(markdown) ? "present" : "needs review",
    regionalFlow: /region|geograph|backtrack|cross-island|base/.test(markdown) ? "present" : "needs review",
    dailyStartEnd: missingAnchors === 0 ? "present on every day" : `${missingAnchors} day(s) missing anchors`,
    baseChange: baseChangeDay ? `present on ${baseChangeDay.date}` : "not detected",
    meaningfulDailyDensity: /relaxed|open|rest|spa|beach|museum|class|temple|walk|experience/.test(markdown) ? "present" : "needs review",
    transportGuidance: /private car|driver|transfer|taxi|ride|walking|transport/.test(markdown) ? "present" : "needs review",
    fixedEventComposition: /flight|class|performance|sunset|reservation|ticket/.test(markdown) ? "present" : "needs review",
    arrivalDepartureSafety: /arrival|departure|airport|buffer|check-in|dps|lax/.test(markdown) ? "present" : "needs review",
    preparationUsefulness: plan.preparation.length >= 5 ? "present" : "thin",
    practicalTipsUsefulness: plan.tips.length >= 5 ? "present" : "thin"
  };
}

function semanticResearchBehaviorReport(plan: SemanticTravelPlan): Record<string, unknown> {
  const outcomes = plan.targetedResearch.map((item) => item.outcome).join("\n");
  const selected = extractOutcomeLines(outcomes, ["selected", "used", "scheduled", "kept"]);
  const rejected = extractOutcomeLines(outcomes, ["rejected", "not used", "omitted", "left out", "discarded"]);
  return {
    researchGapsIdentified: plan.targetedResearch.map((item) => item.question),
    targetedResearchQueries: plan.targetedResearch.map((item) => item.question),
    additionalPlacesOrInformationDiscovered: plan.targetedResearch.map((item) => item.outcome),
    researchedCandidatesSelected: selected.length ? selected : ["Review targetedResearch outcomes; no explicit selected candidate line was returned."],
    researchedCandidatesRejected: rejected.length ? rejected : ["Review targetedResearch outcomes; no explicit rejected candidate line was returned."],
    unresolvedExperiences: plan.unresolvedExperiences
  };
}

function extractOutcomeLines(text: string, needles: string[]): string[] {
  return text
    .split(/\n|;|\.\s+/)
    .map((line) => line.trim())
    .filter((line) => line && needles.some((needle) => line.toLowerCase().includes(needle)));
}
