import assert from "node:assert/strict";
import test from "node:test";
import type { CodexRuntimeAdapter } from "@c-assistant/agent-adapters";
import type { TelegramConnector } from "@c-assistant/connectors";
import { SqliteWorkspaceStore } from "@c-assistant/storage";
import type { PlanningGenerationService } from "./planning-generation-service.js";
import { createTelegramPlanChangeCallbackHandler } from "./telegram-plan-change-handler.js";

test("Telegram Plan change confirmation creates a replacement draft without interrupting execution", async () => {
  const store = new SqliteWorkspaceStore(":memory:");
  store.updateProfile({ displayName: "Alex", preferredLanguage: "English", nationality: "Canada", gender: "not_specified", immigrationStatus: "unknown" });
  const draft = store.createGeneratedPlan({
    title: "Paris trip",
    location: "Paris, France",
    dates: "October 12-18, 2026",
    knownInformation: ["Two travellers."],
    assumptions: [],
    nextAction: "Review the Plan.",
    stages: [{ title: "Daily itinerary", description: "A compact itinerary.", tasks: [{ title: "Explore Paris", owner: "assistant", dueLabel: "Day 1" }] }]
  });
  const active = store.confirmPlan(draft.activePlan.id).activePlan;
  const impact = {
    planId: active.id,
    baseVersion: active.version,
    impact: "low" as const,
    summary: "A meal preference changes itinerary choices.",
    reasons: [],
    affectedAreas: ["itinerary" as const],
    requiresConfirmation: false,
    createsReplacementDraft: true
  };
  const proposal = store.createTelegramPlanChangeProposal({ planId: active.id, baseVersion: active.version, request: "Add one Italian dinner.", impact });
  const answeredCallbacks: Array<{ callbackId: string; text?: string }> = [];
  const sentMessages: Array<{ chatId: string; text: string }> = [];
  const sentReplies: string[] = [];
  let generatedRequest: string | undefined;
  const telegram = {
    answerCallbackQuery: async (input: { callbackId: string; text?: string }) => { answeredCallbacks.push(input); },
    sendMessage: async (input: { chatId: string; text: string }) => { sentMessages.push(input); }
  } as unknown as TelegramConnector;
  const runtime = {
    generatePlanDraft: async (input: { request: string }) => {
      generatedRequest = input.request;
      return {
        title: "Paris trip with Italian dinner",
        location: active.location,
        dates: active.dates,
        knownInformation: ["Italian dinner preference."],
        assumptions: [],
        nextAction: "Review the replacement draft.",
        stages: [{ title: "Adjusted itinerary", description: "Review the new dinner fit.", tasks: [{ title: "Choose Italian dinner", owner: "user" as const, dueLabel: "Day 2" }] }]
      };
    }
  } as unknown as CodexRuntimeAdapter;
  const planningGeneration = {
    planGenerationFailureCode: () => "generation_failed"
  } as unknown as PlanningGenerationService;
  const handler = createTelegramPlanChangeCallbackHandler({
    store,
    getTelegram: () => telegram,
    getGeneratingPlan: () => false,
    setGeneratingPlan: () => {},
    selectedRuntimeAdapter: () => runtime,
    planningGeneration,
    sendCommandReplies: async (_chatId, replies) => { sentReplies.push(...replies.map((reply) => reply.text)); },
    planReplies: (_plan, intro) => [{ text: intro ?? "Plan ready." }],
    withExecutionContinuity: (_workspace, intro) => intro
  });

  await handler("chat-1", "callback-1", { action: "confirm", proposalId: proposal.id });

  assert.equal(generatedRequest, "Add one Italian dinner.");
  assert.deepEqual(answeredCallbacks, [{ callbackId: "callback-1", text: "Preparing a replacement draft…" }]);
  assert.equal(sentMessages.length, 0);
  assert.match(sentReplies[0] ?? "", /replacement draft/i);
  assert.equal(store.getTelegramPlanChangeProposal(proposal.id)?.status, "applied");
  assert.equal(store.getWorkspace().activePlan.status, "draft");
  assert.equal(store.getWorkspace().activePlan.title, "Paris trip with Italian dinner");
  assert.equal(store.getExecutionPlan()?.id, active.id);
  store.close();
});
