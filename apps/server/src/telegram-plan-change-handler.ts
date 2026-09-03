import { RuntimeAdapterError, type ClaudeCodeRuntimeAdapter, type CodexRuntimeAdapter } from "@c-assistant/agent-adapters";
import type { TelegramConnector } from "@c-assistant/connectors";
import type { AgentRuntimeKind, Plan } from "@c-assistant/core";
import type { SqliteWorkspaceStore } from "@c-assistant/storage";
import type { MessagingCommandReply } from "./messaging-replies.js";
import type { PlanningGenerationService } from "./planning-generation-service.js";
import {
  completedTasksForRevision,
  parseTelegramPlanChangeAction,
  planDraftForRevision
} from "./telegram-plan.js";

type RuntimeAdapter = CodexRuntimeAdapter | ClaudeCodeRuntimeAdapter;
export type TelegramPlanChangeCallbackAction = Exclude<ReturnType<typeof parseTelegramPlanChangeAction>, { action: "not_change" }>;

export function createTelegramPlanChangeCallbackHandler(dependencies: {
  store: SqliteWorkspaceStore;
  getTelegram: () => TelegramConnector;
  getGeneratingPlan: () => boolean;
  setGeneratingPlan: (running: boolean) => void;
  selectedRuntimeAdapter: (kind: AgentRuntimeKind) => RuntimeAdapter;
  planningGeneration: PlanningGenerationService;
  sendCommandReplies: (chatId: string, replies: MessagingCommandReply[]) => Promise<void>;
  planReplies: (plan: Plan, intro?: string) => MessagingCommandReply[];
  withExecutionContinuity: (workspace: ReturnType<SqliteWorkspaceStore["getWorkspace"]>, intro: string) => string;
}) {
  const {
    store,
    getTelegram,
    getGeneratingPlan,
    setGeneratingPlan,
    selectedRuntimeAdapter,
    planningGeneration,
    sendCommandReplies,
    planReplies,
    withExecutionContinuity
  } = dependencies;

  return async function handleTelegramPlanChangeCallback(
    chatId: string,
    callbackId: string,
    planChangeAction: TelegramPlanChangeCallbackAction
  ): Promise<void> {
    const telegram = getTelegram();
    const proposal = store.getTelegramPlanChangeProposal(planChangeAction.proposalId);
    if (!proposal || proposal.status !== "pending") {
      await telegram.answerCallbackQuery({ callbackId, text: "That Plan change proposal is no longer pending." });
      return;
    }
    if (planChangeAction.action === "cancel") {
      store.resolveTelegramPlanChangeProposal(proposal.id, "cancelled");
      await telegram.answerCallbackQuery({ callbackId, text: "Current Plan kept unchanged." });
      await telegram.sendMessage({ chatId, text: "The proposed change was cancelled. Your current Plan and its active reminders are unchanged." });
      return;
    }
    const workspace = store.getWorkspace();
    if (workspace.activePlan.id !== proposal.planId || workspace.activePlan.version !== proposal.baseVersion || workspace.activePlan.status !== "active") {
      store.resolveTelegramPlanChangeProposal(proposal.id, "stale");
      await telegram.answerCallbackQuery({ callbackId, text: "That proposal is out of date." });
      await telegram.sendMessage({ chatId, text: "The Plan changed after this suggestion was created, so the older suggestion was not applied. Send the request again and Landi will reassess it against the latest Plan." });
      return;
    }
    if (workspace.activeBlueprint) {
      store.resolveTelegramPlanChangeProposal(proposal.id, "cancelled");
      await telegram.answerCallbackQuery({ callbackId, text: "Blueprint replanning is not enabled yet." });
      await telegram.sendMessage({ chatId, text: "This Plan is backed by a Trip Blueprint. Landi kept it unchanged because Assisted Replanning is not enabled yet. Use the Web workbench to start a new planning conversation." });
      return;
    }
    if (getGeneratingPlan()) {
      await telegram.answerCallbackQuery({ callbackId, text: "Another Plan draft is already being prepared." });
      return;
    }
    await telegram.answerCallbackQuery({ callbackId, text: "Preparing a replacement draft…" });
    setGeneratingPlan(true);
    let runId: string | undefined;
    try {
      const runtime = selectedRuntimeAdapter(workspace.runtime.selectedKind);
      runId = store.startPlanGenerationRun({ runtimeKind: workspace.runtime.selectedKind, trigger: "telegram" }).id;
      const draft = await runtime.generatePlanDraft({
        request: proposal.request,
        currentPlan: planDraftForRevision(workspace.activePlan),
        completedTasks: completedTasksForRevision(workspace.activePlan),
        profile: {
          preferredLanguage: workspace.profile.preferredLanguage,
          nationality: workspace.profile.nationality,
          gender: workspace.profile.gender,
          immigrationStatus: workspace.profile.immigrationStatus
        }
      });
      const revised = store.reviseGeneratedPlan({ draft, runtime: workspace.runtime.selectedKind, expectedPlanId: proposal.planId, expectedVersion: proposal.baseVersion, changeImpact: proposal.impact });
      store.resolveTelegramPlanChangeProposal(proposal.id, "applied");
      store.finishPlanGenerationRun({ runId, status: "succeeded", outputPlanId: revised.activePlan.id });
      await sendCommandReplies(chatId, planReplies(revised.activePlan, withExecutionContinuity(revised, "Landi prepared a complete replacement draft from your request. The existing Plan remains active until you confirm this draft.")));
    } catch (error) {
      if (runId) store.finishPlanGenerationRun({ runId, status: "failed", failureCode: planGenerationFailureCode(error, planningGeneration) });
      await telegram.sendMessage({ chatId, text: "Landi could not prepare the replacement draft, so the current Plan remains unchanged. You can use the same proposal button to retry while its Plan version is still current." });
    } finally {
      setGeneratingPlan(false);
    }
  };
}

function planGenerationFailureCode(error: unknown, planningGeneration: PlanningGenerationService): string {
  return error instanceof RuntimeAdapterError ? error.code : planningGeneration.planGenerationFailureCode(error);
}
