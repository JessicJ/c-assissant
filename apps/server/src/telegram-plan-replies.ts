import type { SqliteWorkspaceStore } from "@c-assistant/storage";
import type { MessagingCommandReply } from "./messaging-replies.js";
import {
  formatTelegramPlanPages,
  telegramExecutionContinuityNotice,
  telegramPlanConfirmationMarkup
} from "./telegram-plan.js";

export function telegramPlanReplies(plan: ReturnType<SqliteWorkspaceStore["getWorkspace"]>["activePlan"], intro?: string): MessagingCommandReply[] {
  const replyMarkup = telegramPlanConfirmationMarkup(plan);
  const pages = formatTelegramPlanPages(plan);
  return pages.map((page, index) => ({
    text: index === 0 && intro ? `${intro}\n\n${page}` : page,
    ...(index === pages.length - 1 && replyMarkup ? { replyMarkup } : {})
  }));
}

export function withTelegramExecutionContinuity(workspace: ReturnType<SqliteWorkspaceStore["getWorkspace"]>, intro: string): string {
  const continuity = telegramExecutionContinuityNotice(workspace);
  return continuity ? `${intro}\n\n${continuity}` : intro;
}
