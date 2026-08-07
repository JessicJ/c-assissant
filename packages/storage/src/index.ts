import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  confirmPlan,
  createInitialWorkspace,
  createPlanFromDraft,
  createPlanFromRequest,
  createDefaultPlanConfiguration,
  type CreatePlanInput,
  type AgentRuntimeKind,
  type AgentRun,
  type GeneratedPlanDraft,
  type InboxItem,
  type ImmigrationStatus,
  type Plan,
  type PlanAccommodationInput,
  type PlanArrivalInput,
  type PlanConfiguration,
  type PlanTravelContextInput,
  type PlanTransportPreferenceInput,
  type ProfileGender,
  type ProfileUpdate,
  type RuntimeSelectionUpdate,
  type RunStatus,
  type RunTrigger,
  type SourceReference,
  type SourceSnapshot,
  type SourceSnapshotInput,
  type SourceSnapshotWriteResult,
  type Stage,
  type Task,
  type TaskReminder,
  type TaskReminderRun,
  type TaskReminderRunStatus,
  type TelegramBinding,
  type TelegramPairingStatus,
  type WorkspaceSnapshot
} from "@c-assistant/core";

interface ProfileRow {
  display_name: string;
  preferred_language: string;
  nationality: string;
  gender: ProfileGender;
  immigration_status: ImmigrationStatus;
  status: "incomplete" | "ready";
}

interface RuntimeSettingsRow {
  selected_runtime: AgentRuntimeKind;
}

interface PlanRow {
  id: string;
  version: number;
  title: string;
  location: string;
  dates: string;
  status: Plan["status"];
  known_information_json: string;
  assumptions_json: string;
  next_action: string;
  configuration_json: string;
  sources_json: string;
  created_at: string;
}

interface StageRow {
  id: string;
  title: string;
  description: string;
}

interface TaskRow {
  id: string;
  title: string;
  owner: Task["owner"];
  status: Task["status"];
  due_label: string;
  activation_trigger: "arrival" | null;
  reminder_json: string | null;
}

interface InboxRow {
  id: string;
  tone: InboxItem["tone"];
  title: string;
  body: string;
  timestamp: string;
}

interface SourceSnapshotRow {
  id: string;
  source_id: string;
  authority: string;
  title_original: string;
  url: string;
  retrieved_at: string;
  content_hash: string;
  excerpt: string;
}

interface AgentRunRow {
  id: string;
  kind: "plan_generation";
  runtime_kind: AgentRuntimeKind;
  trigger: RunTrigger;
  status: RunStatus;
  started_at: string;
  finished_at: string | null;
  output_plan_id: string | null;
  failure_code: string | null;
}

interface TaskReminderRunRow {
  id: string;
  plan_id: string;
  task_id: string;
  reminder_key: string;
  due_at: string;
  status: TaskReminderRunStatus;
  attempt_count: number;
  weather_status: TaskReminderRun["weatherStatus"];
  weather_stage: "amap" | "qweather" | "pipeline" | null;
  weather_failure_code: string | null;
  telegram_failure_code: string | null;
  started_at: string;
  finished_at: string | null;
  updated_at: string;
}

interface TelegramBindingRow {
  chat_id: string;
  user_id: string;
  first_name: string;
  username: string | null;
  paired_at: string;
}

interface TelegramPairingRequestRow {
  code: string;
  expires_at: string;
}

interface TelegramArrivalCheckinRow {
  check_in_sent_at: string;
  location_requested_at: string | null;
  location_received_at: string | null;
}

export type TelegramProfileTextField = "displayName" | "preferredLanguage" | "nationality";

interface TelegramProfileEditRow {
  field: TelegramProfileTextField;
  started_at: string;
}

interface TelegramTaskReminderDeliveryRow {
  task_id: string;
  due_at: string;
  status: "attempting" | "retry_wait" | "delivered" | "failed";
  attempt_count: number;
  next_attempt_at: string | null;
}

export interface TelegramTaskReminderAttempt {
  claimed: boolean;
  attemptNumber?: number;
}

export interface TelegramTaskReminderFailureResult {
  status: "retry_scheduled" | "failed" | "cancelled";
  nextAttemptAt?: string;
}

const TASK_REMINDER_CATCH_UP_MS = 30 * 60_000;
const TASK_REMINDER_ATTEMPT_LEASE_MS = 60_000;
const TASK_REMINDER_RETRY_DELAYS_MS = [60_000, 5 * 60_000] as const;

/** Contains delivery state only. Coordinates are never stored here. */
export interface TelegramArrivalCheckinState {
  checkInSentAt: string;
  locationRequestedAt?: string;
  locationReceivedAt?: string;
}

export class SqliteWorkspaceStore {
  private readonly database: DatabaseSync;

  constructor(databasePath: string) {
    if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new DatabaseSync(databasePath);
    this.database.exec("PRAGMA foreign_keys = ON;");
    this.migrate();
    this.seedIfEmpty();
  }

  close(): void {
    this.database.close();
  }

  getWorkspace(): WorkspaceSnapshot {
    const profile = this.database.prepare("SELECT display_name, preferred_language, nationality, gender, immigration_status, status FROM profiles WHERE id = 1").get() as ProfileRow | undefined;
    const runtime = this.database.prepare("SELECT selected_runtime FROM runtime_settings WHERE id = 1").get() as RuntimeSettingsRow | undefined;
    const activePlan = this.getCurrentPlan();
    if (!profile || !runtime || !activePlan) throw new Error("The local workspace is not initialized.");

    return {
      profile: {
        displayName: profile.display_name,
        preferredLanguage: profile.preferred_language,
        nationality: profile.nationality,
        gender: profile.gender,
        immigrationStatus: profile.immigration_status,
        status: profile.status
      },
      runtime: { selectedKind: runtime.selected_runtime },
      activePlan,
      inbox: (this.database.prepare("SELECT id, tone, title, body, timestamp FROM inbox_items ORDER BY created_at DESC, rowid DESC").all() as unknown as InboxRow[]).map((row) => ({
        id: row.id,
        tone: row.tone,
        title: row.title,
        body: row.body,
        timestamp: row.timestamp
      })),
      sourceSnapshots: this.listSourceSnapshots(),
      system: {
        core: "ready",
        storage: "local",
        runtime: "configured",
        telegram: "not_configured",
        amap: "not_configured"
      }
    };
  }

  getTelegramPairingStatus(): TelegramPairingStatus {
    const binding = this.database.prepare("SELECT chat_id, user_id, first_name, username, paired_at FROM telegram_binding WHERE id = 1").get() as TelegramBindingRow | undefined;
    if (binding) return {
      state: "paired",
      binding: {
        chatId: binding.chat_id,
        userId: binding.user_id,
        firstName: binding.first_name,
        ...(binding.username ? { username: binding.username } : {}),
        pairedAt: binding.paired_at
      }
    };
    const request = this.database.prepare("SELECT code, expires_at FROM telegram_pairing_requests WHERE consumed_at IS NULL ORDER BY created_at DESC LIMIT 1").get() as TelegramPairingRequestRow | undefined;
    if (request && Date.parse(request.expires_at) > Date.now()) return { state: "waiting_for_start", expiresAt: request.expires_at };
    return { state: "not_paired" };
  }

  createTelegramPairingRequest(input: { code: string; expiresAt: string }): TelegramPairingStatus {
    const code = input.code.trim();
    if (!/^[A-Za-z0-9_-]{12,96}$/.test(code)) throw new Error("The Telegram pairing code is invalid.");
    if (!Number.isFinite(Date.parse(input.expiresAt)) || Date.parse(input.expiresAt) <= Date.now()) throw new Error("The Telegram pairing code must expire in the future.");
    if (this.getTelegramPairingStatus().state === "paired") return this.getTelegramPairingStatus();
    const now = new Date().toISOString();
    this.database.prepare("UPDATE telegram_pairing_requests SET consumed_at = ? WHERE consumed_at IS NULL").run(now);
    this.database.prepare("INSERT INTO telegram_pairing_requests (code, expires_at, created_at, consumed_at) VALUES (?, ?, ?, NULL)").run(code, input.expiresAt, now);
    return { state: "waiting_for_start", expiresAt: input.expiresAt };
  }

  claimTelegramPairing(input: { code: string; chatId: string; userId: string; firstName: string; username?: string }): TelegramPairingStatus {
    const code = input.code.trim();
    const chatId = input.chatId.trim();
    const userId = input.userId.trim();
    const firstName = input.firstName.trim();
    if (!code || !chatId || !userId || !firstName) throw new Error("Telegram pairing needs a valid private-chat identity.");
    const existing = this.getTelegramPairingStatus();
    if (existing.state === "paired") {
      if (existing.binding?.chatId !== chatId) throw new Error("This instance is already paired to a different Telegram account.");
      return existing;
    }
    const request = this.database.prepare("SELECT code, expires_at FROM telegram_pairing_requests WHERE code = ? AND consumed_at IS NULL").get(code) as TelegramPairingRequestRow | undefined;
    if (!request || Date.parse(request.expires_at) <= Date.now()) throw new Error("This Telegram pairing instruction has expired. Start a new pairing from the Web workspace.");
    const pairedAt = new Date().toISOString();
    this.database.prepare("INSERT INTO telegram_binding (id, chat_id, user_id, first_name, username, paired_at) VALUES (1, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET chat_id = excluded.chat_id, user_id = excluded.user_id, first_name = excluded.first_name, username = excluded.username, paired_at = excluded.paired_at").run(chatId, userId, firstName, input.username?.trim() || null, pairedAt);
    this.database.prepare("UPDATE telegram_pairing_requests SET consumed_at = ? WHERE code = ?").run(pairedAt, code);
    this.addInbox({
      id: `telegram-paired-${pairedAt}`,
      tone: "ready",
      title: "Telegram paired",
      body: `Telegram is paired with ${input.username?.trim() ? `@${input.username.trim()}` : input.firstName}. Future Telegram actions still require their own explicit implementation and confirmation.`,
      timestamp: "Just now"
    });
    return this.getTelegramPairingStatus();
  }

  /** Removes only the bound chat identity; Plans, Profile, update cursor, and local Bot token stay untouched. */
  unpairTelegram(): TelegramPairingStatus {
    const existing = this.getTelegramPairingStatus();
    if (existing.state !== "paired") return existing;
    const unpairedAt = new Date().toISOString();
    this.database.exec("BEGIN");
    try {
      this.database.prepare("DELETE FROM telegram_binding WHERE id = 1").run();
      this.database.prepare("DELETE FROM telegram_profile_edit_state WHERE id = 1").run();
      this.database.prepare("UPDATE telegram_pairing_requests SET consumed_at = ? WHERE consumed_at IS NULL").run(unpairedAt);
      this.addInbox({
        id: `telegram-unpaired-${unpairedAt}`,
        tone: "notice",
        title: "Telegram disconnected",
        body: "This Telegram chat is no longer bound to this instance. Your Plans, Profile, local Bot token, and existing records were not deleted.",
        timestamp: "Just now"
      });
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return this.getTelegramPairingStatus();
  }

  getTelegramUpdateOffset(): number | undefined {
    const row = this.database.prepare("SELECT next_update_id FROM telegram_update_cursor WHERE id = 1").get() as { next_update_id: number } | undefined;
    return row?.next_update_id;
  }

  advanceTelegramUpdateOffset(nextUpdateId: number): void {
    if (!Number.isInteger(nextUpdateId) || nextUpdateId < 1) throw new Error("Telegram update offset must be a positive whole number.");
    this.database.prepare("INSERT INTO telegram_update_cursor (id, next_update_id) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET next_update_id = MAX(telegram_update_cursor.next_update_id, excluded.next_update_id)").run(nextUpdateId);
  }

  claimTelegramUpdate(updateId: number): boolean {
    if (!Number.isInteger(updateId) || updateId < 1) throw new Error("Telegram update id must be a positive whole number.");
    const existing = this.database.prepare("SELECT update_id FROM telegram_processed_updates WHERE update_id = ?").get(updateId);
    if (existing) return false;
    this.database.prepare("INSERT INTO telegram_processed_updates (update_id, processed_at) VALUES (?, ?)").run(updateId, new Date().toISOString());
    return true;
  }

  claimTelegramReminder(input: { planId: string; reminderKey: string; dueAt: string }): boolean {
    const planId = input.planId.trim();
    const reminderKey = input.reminderKey.trim();
    if (!planId || !reminderKey || !Number.isFinite(Date.parse(input.dueAt))) throw new Error("Telegram reminder needs a Plan, key, and due time.");
    const existing = this.database.prepare("SELECT plan_id FROM telegram_reminder_deliveries WHERE plan_id = ? AND reminder_key = ?").get(planId, reminderKey);
    if (existing) return false;
    this.database.prepare("INSERT INTO telegram_reminder_deliveries (plan_id, reminder_key, due_at, claimed_at) VALUES (?, ?, ?, ?)").run(planId, reminderKey, input.dueAt, new Date().toISOString());
    return true;
  }

  claimTelegramTaskReminderAttempt(input: { planId: string; reminderKey: string; taskId: string; dueAt: string; reminder: TaskReminder; now?: string }): TelegramTaskReminderAttempt {
    const planId = input.planId.trim();
    const reminderKey = input.reminderKey.trim();
    const taskId = input.taskId.trim();
    const now = input.now ?? new Date().toISOString();
    const dueAtMs = Date.parse(input.dueAt);
    const nowMs = Date.parse(now);
    if (!planId || !reminderKey || !taskId || !Number.isFinite(dueAtMs) || !Number.isFinite(nowMs)) throw new Error("A Task reminder attempt needs a Plan, key, Task, due time, and current time.");
    if (nowMs < dueAtMs || nowMs > dueAtMs + TASK_REMINDER_CATCH_UP_MS) return { claimed: false };
    const workspace = this.getWorkspace();
    if (workspace.activePlan.id !== planId || workspace.activePlan.status !== "active") return { claimed: false };
    const currentReminder = workspace.activePlan.stages.flatMap((stage) => stage.tasks).find((task) => task.id === taskId)?.reminder;
    if (!currentReminder || !taskRemindersEqual(currentReminder, input.reminder)) return { claimed: false };
    const existing = this.database.prepare(`SELECT task_id, due_at, status, attempt_count, next_attempt_at
      FROM telegram_task_reminder_deliveries WHERE plan_id = ? AND reminder_key = ?`).get(planId, reminderKey) as TelegramTaskReminderDeliveryRow | undefined;
    const leaseUntil = new Date(nowMs + TASK_REMINDER_ATTEMPT_LEASE_MS).toISOString();
    if (!existing) {
      this.database.prepare(`INSERT INTO telegram_task_reminder_deliveries
        (plan_id, reminder_key, task_id, due_at, status, attempt_count, next_attempt_at, last_failure_code, delivered_at, updated_at)
        VALUES (?, ?, ?, ?, 'attempting', 1, ?, NULL, NULL, ?)`).run(planId, reminderKey, taskId, input.dueAt, leaseUntil, now);
      return { claimed: true, attemptNumber: 1 };
    }
    if (existing.task_id !== taskId || existing.due_at !== input.dueAt || existing.status === "delivered" || existing.status === "failed" || existing.attempt_count >= 3) return { claimed: false };
    if (existing.next_attempt_at && Date.parse(existing.next_attempt_at) > nowMs) return { claimed: false };
    const nextAttemptNumber = existing.attempt_count + 1;
    const updated = this.database.prepare(`UPDATE telegram_task_reminder_deliveries
      SET status = 'attempting', attempt_count = ?, next_attempt_at = ?, updated_at = ?
      WHERE plan_id = ? AND reminder_key = ? AND status IN ('attempting', 'retry_wait') AND attempt_count = ?`).run(nextAttemptNumber, leaseUntil, now, planId, reminderKey, existing.attempt_count);
    return updated.changes === 1 ? { claimed: true, attemptNumber: nextAttemptNumber } : { claimed: false };
  }

  recordTelegramTaskReminderDelivered(input: { planId: string; reminderKey: string; taskId: string; taskTitle: string; reminder: TaskReminder; deliveredAt?: string }): void {
    const workspace = this.getWorkspace();
    const taskTitle = input.taskTitle.trim();
    if (!taskTitle || !input.reminder.purpose.trim()) throw new Error("A delivered Task reminder needs its delivery-time Task context.");
    const currentTask = workspace.activePlan.stages.flatMap((stage) => stage.tasks).find((candidate) => candidate.id === input.taskId);
    const currentReminder = currentTask?.reminder;
    const currentMatch = workspace.activePlan.id === input.planId && workspace.activePlan.status === "active" && Boolean(currentReminder && taskRemindersEqual(currentReminder, input.reminder));
    const deliveredAt = input.deliveredAt ?? new Date().toISOString();
    if (!Number.isFinite(Date.parse(deliveredAt))) throw new Error("A delivered Task reminder needs a valid delivery time.");
    this.database.exec("BEGIN");
    try {
      const updated = this.database.prepare(`UPDATE telegram_task_reminder_deliveries
        SET status = 'delivered', next_attempt_at = NULL, delivered_at = ?, updated_at = ?
        WHERE plan_id = ? AND reminder_key = ? AND task_id = ? AND status = 'attempting'`).run(deliveredAt, deliveredAt, input.planId, input.reminderKey, input.taskId);
      if (updated.changes !== 1) throw new Error("The Task reminder delivery attempt is not active.");
      this.addInbox({
        id: `task-reminder-delivered-${input.planId}-${input.taskId}-${input.reminder.scheduledAtLocal}`,
        tone: currentMatch ? "ready" : "attention",
        title: currentMatch ? `Reminder sent: ${taskTitle}` : `Reminder sent before Plan change took effect: ${taskTitle}`,
        body: currentMatch ? input.reminder.purpose : `${input.reminder.purpose} Telegram accepted this message before cancellation or Plan replacement could stop the in-flight request.`,
        timestamp: "Just now"
      });
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  recordTelegramTaskReminderFailure(input: { planId: string; reminderKey: string; taskId: string; reminder: TaskReminder; failureCode: string; retryable: boolean; failedAt?: string }): TelegramTaskReminderFailureResult {
    const failedAt = input.failedAt ?? new Date().toISOString();
    const failedAtMs = Date.parse(failedAt);
    const failureCode = input.failureCode.trim().slice(0, 80) || "unknown_failure";
    if (!Number.isFinite(failedAtMs)) throw new Error("A failed Task reminder needs a valid failure time.");
    const row = this.database.prepare(`SELECT task_id, due_at, status, attempt_count, next_attempt_at
      FROM telegram_task_reminder_deliveries WHERE plan_id = ? AND reminder_key = ?`).get(input.planId, input.reminderKey) as TelegramTaskReminderDeliveryRow | undefined;
    if (!row || row.task_id !== input.taskId || row.status !== "attempting") throw new Error("The Task reminder delivery attempt is not active.");
    const workspace = this.getWorkspace();
    const currentReminder = workspace.activePlan.id === input.planId ? workspace.activePlan.stages.flatMap((stage) => stage.tasks).find((task) => task.id === input.taskId)?.reminder : undefined;
    const currentMatch = workspace.activePlan.status === "active" && Boolean(currentReminder && taskRemindersEqual(currentReminder, input.reminder));
    if (!currentMatch) {
      this.database.prepare(`UPDATE telegram_task_reminder_deliveries
        SET status = 'failed', next_attempt_at = NULL, last_failure_code = 'reminder_cancelled', updated_at = ?
        WHERE plan_id = ? AND reminder_key = ? AND status = 'attempting'`).run(failedAt, input.planId, input.reminderKey);
      return { status: "cancelled" };
    }
    const retryDelay = TASK_REMINDER_RETRY_DELAYS_MS[row.attempt_count - 1];
    const nextAttemptAt = retryDelay === undefined ? undefined : new Date(failedAtMs + retryDelay).toISOString();
    const retryWithinWindow = nextAttemptAt !== undefined && Date.parse(nextAttemptAt) <= Date.parse(row.due_at) + TASK_REMINDER_CATCH_UP_MS;
    if (input.retryable && row.attempt_count < 3 && retryWithinWindow) {
      this.database.prepare(`UPDATE telegram_task_reminder_deliveries
        SET status = 'retry_wait', next_attempt_at = ?, last_failure_code = ?, updated_at = ?
        WHERE plan_id = ? AND reminder_key = ? AND status = 'attempting'`).run(nextAttemptAt, failureCode, failedAt, input.planId, input.reminderKey);
      return { status: "retry_scheduled", nextAttemptAt };
    }
    this.database.exec("BEGIN");
    try {
      this.database.prepare(`UPDATE telegram_task_reminder_deliveries
        SET status = 'failed', next_attempt_at = NULL, last_failure_code = ?, updated_at = ?
        WHERE plan_id = ? AND reminder_key = ? AND status = 'attempting'`).run(failureCode, failedAt, input.planId, input.reminderKey);
      const task = this.getWorkspace().activePlan.stages.flatMap((stage) => stage.tasks).find((candidate) => candidate.id === input.taskId);
      this.addInbox({
        id: `task-reminder-failed-${input.planId}-${input.reminderKey}`,
        tone: "attention",
        title: `Reminder could not be sent${task ? `: ${task.title}` : ""}`,
        body: `C-assistant stopped after ${row.attempt_count} delivery attempt${row.attempt_count === 1 ? "" : "s"}. Review the current Plan; no external action was performed.`,
        timestamp: "Just now"
      });
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return { status: "failed" };
  }

  cancelTaskReminder(planId: string, taskId: string): WorkspaceSnapshot {
    const workspace = this.getWorkspace();
    if (workspace.activePlan.id !== planId) throw new Error(`Plan ${planId} was not found.`);
    const task = workspace.activePlan.stages.flatMap((stage) => stage.tasks).find((candidate) => candidate.id === taskId);
    if (!task) throw new Error("The Task was not found in the current Plan.");
    if (!task.reminder) return workspace;
    this.database.exec("BEGIN");
    try {
      this.database.prepare("UPDATE tasks SET reminder_json = NULL WHERE id = ?").run(taskId);
      this.database.prepare("UPDATE plans SET version = version + 1 WHERE id = ?").run(planId);
      const cancelledAt = new Date().toISOString();
      this.database.prepare(`UPDATE task_reminder_runs SET status = 'cancelled', finished_at = ?, updated_at = ?
        WHERE plan_id = ? AND task_id = ? AND status IN ('running', 'retry_wait')`).run(cancelledAt, cancelledAt, planId, taskId);
      this.addInbox({
        id: `task-reminder-cancelled-${planId}-${taskId}-${Date.now()}`,
        tone: "notice",
        title: `Reminder cancelled: ${task.title}`,
        body: "This reminder was removed from the current Plan. A message already accepted by Telegram cannot be recalled.",
        timestamp: "Just now"
      });
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return this.getWorkspace();
  }

  recordTelegramArrivalCheckin(input: { planId: string; checkInSentAt: string }): void {
    const planId = input.planId.trim();
    if (!planId || !Number.isFinite(Date.parse(input.checkInSentAt))) throw new Error("Telegram arrival check-in needs a Plan and valid delivery time.");
    this.database.prepare("INSERT INTO telegram_arrival_checkins (plan_id, check_in_sent_at, location_requested_at, location_received_at) VALUES (?, ?, NULL, NULL) ON CONFLICT(plan_id) DO NOTHING").run(planId, input.checkInSentAt);
  }

  getTelegramArrivalCheckin(planId: string): TelegramArrivalCheckinState | undefined {
    const row = this.database.prepare("SELECT check_in_sent_at, location_requested_at, location_received_at FROM telegram_arrival_checkins WHERE plan_id = ?").get(planId.trim()) as TelegramArrivalCheckinRow | undefined;
    if (!row) return undefined;
    return {
      checkInSentAt: row.check_in_sent_at,
      ...(row.location_requested_at ? { locationRequestedAt: row.location_requested_at } : {}),
      ...(row.location_received_at ? { locationReceivedAt: row.location_received_at } : {})
    };
  }

  markTelegramArrivalLocationRequested(planId: string, requestedAt: string): boolean {
    if (!planId.trim() || !Number.isFinite(Date.parse(requestedAt))) throw new Error("Telegram arrival location request needs a Plan and valid time.");
    const result = this.database.prepare("UPDATE telegram_arrival_checkins SET location_requested_at = ? WHERE plan_id = ? AND location_requested_at IS NULL AND location_received_at IS NULL").run(requestedAt, planId.trim());
    return result.changes === 1;
  }

  markTelegramArrivalLocationReceived(planId: string, receivedAt: string): void {
    if (!planId.trim() || !Number.isFinite(Date.parse(receivedAt))) throw new Error("Telegram arrival location receipt needs a Plan and valid time.");
    this.database.prepare("UPDATE telegram_arrival_checkins SET location_received_at = ? WHERE plan_id = ?").run(receivedAt, planId.trim());
  }

  /** Marks only an explicitly arrival-triggered task as ready; completion stays user-owned. */
  activateArrivalTask(planId: string): Task | undefined {
    const workspace = this.getWorkspace();
    if (workspace.activePlan.id !== planId) throw new Error(`Plan ${planId} was not found.`);
    const selected = this.database.prepare(`SELECT t.id, t.title, t.owner, t.status, t.due_label, t.activation_trigger
      FROM tasks t JOIN stages s ON s.id = t.stage_id
      WHERE s.plan_id = ? AND t.activation_trigger = 'arrival' AND t.status = 'scheduled'
      ORDER BY s.sort_order, t.sort_order LIMIT 1`).get(planId) as TaskRow | undefined;
    if (!selected) return undefined;
    this.database.exec("BEGIN");
    try {
      this.database.prepare("UPDATE tasks SET status = 'ready' WHERE id = ?").run(selected.id);
      this.database.prepare("UPDATE plans SET version = version + 1, next_action = ? WHERE id = ?").run(`Current arrival step: ${selected.title}`, planId);
      this.addInbox({
        id: `arrival-task-ready-${selected.id}`,
        tone: "ready",
        title: "Arrival task is ready",
        body: `${selected.title} is ready to begin. It has not been completed automatically.`,
        timestamp: "Just now"
      });
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return { id: selected.id, title: selected.title, owner: selected.owner, status: "ready", dueLabel: selected.due_label, activationTrigger: "arrival" };
  }

  /** Completion requires an explicit user action and only accepts a ready task in the current Plan. */
  completeReadyTask(planId: string, taskId: string): Task | undefined {
    const workspace = this.getWorkspace();
    if (workspace.activePlan.id !== planId) throw new Error(`Plan ${planId} was not found.`);
    const selected = this.database.prepare(`SELECT t.id, t.title, t.owner, t.status, t.due_label, t.activation_trigger
      FROM tasks t JOIN stages s ON s.id = t.stage_id
      WHERE s.plan_id = ? AND t.id = ? AND t.status = 'ready'`).get(planId, taskId.trim()) as TaskRow | undefined;
    if (!selected) return undefined;
    this.database.exec("BEGIN");
    try {
      this.database.prepare("UPDATE tasks SET status = 'completed' WHERE id = ?").run(selected.id);
      const next = this.database.prepare(`SELECT t.title FROM tasks t JOIN stages s ON s.id = t.stage_id
        WHERE s.plan_id = ? AND t.status NOT IN ('completed', 'skipped', 'cancelled')
        ORDER BY s.sort_order, t.sort_order LIMIT 1`).get(planId) as { title: string } | undefined;
      this.database.prepare("UPDATE plans SET version = version + 1, next_action = ? WHERE id = ?").run(next ? `Next unfinished Plan step: ${next.title}` : "All current Plan tasks are complete.", planId);
      this.addInbox({
        id: `task-completed-${selected.id}`,
        tone: "ready",
        title: "Task completed by you",
        body: `${selected.title} is marked complete based on your confirmation.`,
        timestamp: "Just now"
      });
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return { id: selected.id, title: selected.title, owner: selected.owner, status: "completed", dueLabel: selected.due_label, ...(selected.activation_trigger === "arrival" ? { activationTrigger: "arrival" as const } : {}) };
  }

  createPlan(input: CreatePlanInput): WorkspaceSnapshot {
    const plan = createPlanFromRequest(input);
    this.savePlan(plan);
    this.addInbox({
      id: `plan-created-${plan.id}`,
      tone: "notice",
      title: "New Plan saved locally",
      body: "Review its assumptions, then confirm it when the details are correct.",
      timestamp: "Just now"
    });
    return this.getWorkspace();
  }

  createGeneratedPlan(draft: GeneratedPlanDraft, runtime: AgentRuntimeKind = "codex"): WorkspaceSnapshot {
    const plan = createPlanFromDraft(draft);
    this.savePlan(plan);
    this.addInbox({
      id: `plan-generated-${plan.id}`,
      tone: "notice",
      title: `${runtimeDisplayName(runtime)} Plan draft saved locally`,
      body: "Review the generated assumptions and the complete Plan before activation.",
      timestamp: "Just now"
    });
    return this.getWorkspace();
  }

  reviseGeneratedPlan(input: { draft: GeneratedPlanDraft; runtime?: AgentRuntimeKind; expectedPlanId: string; expectedVersion: number }): WorkspaceSnapshot {
    const workspace = this.getWorkspace();
    if (workspace.activePlan.status !== "draft" || workspace.activePlan.id !== input.expectedPlanId || workspace.activePlan.version !== input.expectedVersion) {
      throw new Error("The Plan changed while its revision was being prepared.");
    }
    const plan = createPlanFromDraft(input.draft);
    plan.configuration = structuredClone(workspace.activePlan.configuration);
    this.savePlan(plan);
    this.addInbox({
      id: `plan-revised-${plan.id}`,
      tone: "notice",
      title: `${runtimeDisplayName(input.runtime ?? "codex")} revised Plan draft saved locally`,
      body: "The previous draft remains in local history. Review this complete replacement draft before activation.",
      timestamp: "Just now"
    });
    return this.getWorkspace();
  }

  confirmPlan(planId: string): WorkspaceSnapshot {
    const workspace = this.getWorkspace();
    const confirmed = confirmPlan(workspace, planId);
    this.database.prepare("UPDATE plans SET status = ?, next_action = ? WHERE id = ?").run(
      confirmed.activePlan.status,
      confirmed.activePlan.nextAction,
      planId
    );
    this.addInbox(confirmed.inbox[0]!);
    return this.getWorkspace();
  }

  updateProfile(input: ProfileUpdate): WorkspaceSnapshot {
    const displayName = input.displayName.trim();
    const preferredLanguage = input.preferredLanguage.trim();
    const nationality = input.nationality.trim();
    if (!displayName || !preferredLanguage || !nationality) throw new Error("Name, preferred language, and nationality are required.");
    if (displayName.length > 80 || preferredLanguage.length > 80 || nationality.length > 100) throw new Error("Keep each Profile text field concise.");
    if (!["not_specified", "woman", "man", "nonbinary", "prefer_not_to_say"].includes(input.gender)) throw new Error("Choose a supported gender setting.");
    if (!["unknown", "short_term_visitor", "tourist_visa", "student_visa", "work_visa", "residence_permit", "other"].includes(input.immigrationStatus)) throw new Error("Choose a supported immigration status setting.");

    const status = nationality.toLocaleLowerCase() !== "to be confirmed" && input.immigrationStatus !== "unknown" ? "ready" : "incomplete";
    this.database.prepare("UPDATE profiles SET display_name = ?, preferred_language = ?, nationality = ?, gender = ?, immigration_status = ?, status = ?, updated_at = ? WHERE id = 1").run(
      displayName,
      preferredLanguage,
      nationality,
      input.gender,
      input.immigrationStatus,
      status,
      new Date().toISOString()
    );
    this.addInbox({
      id: `profile-updated-${Date.now()}`,
      tone: status === "ready" ? "ready" : "notice",
      title: "Profile saved locally",
      body: "Only confirmed long-term information is stored in the Profile.",
      timestamp: "Just now"
    });
    return this.getWorkspace();
  }

  startTelegramProfileTextEdit(field: TelegramProfileTextField, startedAt = new Date().toISOString()): void {
    if (!["displayName", "preferredLanguage", "nationality"].includes(field)) throw new Error("Choose a supported Telegram Profile field.");
    if (!Number.isFinite(Date.parse(startedAt))) throw new Error("Telegram Profile editing needs a valid start time.");
    this.database.prepare("INSERT INTO telegram_profile_edit_state (id, field, started_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET field = excluded.field, started_at = excluded.started_at").run(field, startedAt);
  }

  getTelegramProfileTextEdit(now = new Date().toISOString()): TelegramProfileTextField | undefined {
    const nowMs = Date.parse(now);
    if (!Number.isFinite(nowMs)) throw new Error("Telegram Profile editing needs a valid current time.");
    const row = this.database.prepare("SELECT field, started_at FROM telegram_profile_edit_state WHERE id = 1").get() as TelegramProfileEditRow | undefined;
    if (!row) return undefined;
    if (nowMs - Date.parse(row.started_at) <= 15 * 60_000) return row.field;
    this.clearTelegramProfileTextEdit();
    return undefined;
  }

  clearTelegramProfileTextEdit(): void {
    this.database.prepare("DELETE FROM telegram_profile_edit_state WHERE id = 1").run();
  }

  updateRuntimeSelection(input: RuntimeSelectionUpdate): WorkspaceSnapshot {
    if (!isAgentRuntimeKind(input.kind)) throw new Error("Choose Codex or Claude Code as the Plan runtime.");
    const current = this.getWorkspace().runtime.selectedKind;
    if (current === input.kind) return this.getWorkspace();
    this.database.prepare("UPDATE runtime_settings SET selected_runtime = ?, updated_at = ? WHERE id = 1").run(input.kind, new Date().toISOString());
    this.addInbox({
      id: `runtime-selected-${input.kind}-${Date.now()}`,
      tone: "notice",
      title: "Plan runtime selected",
      body: `${runtimeDisplayName(input.kind)} is selected for future Plan drafts. Its login remains in the local CLI and is never stored by C-assistant.`,
      timestamp: "Just now"
    });
    return this.getWorkspace();
  }

  startPlanGenerationRun(input: { runtimeKind: AgentRuntimeKind; trigger: RunTrigger }): AgentRun {
    if (!isAgentRuntimeKind(input.runtimeKind)) throw new Error("Choose Codex or Claude Code for the recorded Plan run.");
    if (!isRunTrigger(input.trigger)) throw new Error("Choose Web or Telegram as the Plan run trigger.");
    const run: AgentRun = {
      id: `run-${randomUUID()}`,
      kind: "plan_generation",
      runtimeKind: input.runtimeKind,
      trigger: input.trigger,
      status: "running",
      startedAt: new Date().toISOString()
    };
    this.database.prepare(`INSERT INTO agent_runs (id, kind, runtime_kind, trigger, status, started_at, finished_at, output_plan_id, failure_code)
      VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL)`).run(run.id, run.kind, run.runtimeKind, run.trigger, run.status, run.startedAt);
    return run;
  }

  finishPlanGenerationRun(input: { runId: string; status: Exclude<RunStatus, "running">; outputPlanId?: string; failureCode?: string }): AgentRun {
    const runId = input.runId.trim();
    if (!runId) throw new Error("A Plan run id is required.");
    if (!isFinishedRunStatus(input.status)) throw new Error("A Plan run must finish as succeeded, failed, or fallback.");
    if (input.status === "succeeded" && !input.outputPlanId?.trim()) throw new Error("A successful Plan run needs its saved Plan id.");
    if (input.status !== "succeeded" && input.outputPlanId) throw new Error("Only a successful Plan run can reference an Agent-generated Plan.");
    const failureCode = input.failureCode?.trim();
    if (failureCode && !/^[a-z0-9_:-]{1,80}$/i.test(failureCode)) throw new Error("A Plan run failure code must be a short safe classification.");
    const finishedAt = new Date().toISOString();
    const result = this.database.prepare(`UPDATE agent_runs
      SET status = ?, finished_at = ?, output_plan_id = ?, failure_code = ?
      WHERE id = ? AND status = 'running'`).run(input.status, finishedAt, input.outputPlanId?.trim() ?? null, failureCode ?? null, runId);
    if (result.changes !== 1) throw new Error("The Plan run was not found or has already finished.");
    const saved = this.database.prepare(`SELECT id, kind, runtime_kind, trigger, status, started_at, finished_at, output_plan_id, failure_code
      FROM agent_runs WHERE id = ?`).get(runId) as unknown as AgentRunRow;
    return agentRunFromRow(saved);
  }

  listRecentAgentRuns(limit = 12): AgentRun[] {
    const safeLimit = Number.isInteger(limit) && limit > 0 && limit <= 50 ? limit : 12;
    return (this.database.prepare(`SELECT id, kind, runtime_kind, trigger, status, started_at, finished_at, output_plan_id, failure_code
      FROM agent_runs ORDER BY started_at DESC, rowid DESC LIMIT ?`).all(safeLimit) as unknown as AgentRunRow[]).map(agentRunFromRow);
  }

  startTaskReminderRun(input: { planId: string; taskId: string; reminderKey: string; dueAt: string; attemptNumber: number; startedAt?: string }): TaskReminderRun {
    const planId = input.planId.trim();
    const taskId = input.taskId.trim();
    const reminderKey = input.reminderKey.trim();
    const startedAt = input.startedAt ?? new Date().toISOString();
    if (!planId || !taskId || !reminderKey || !Number.isFinite(Date.parse(input.dueAt)) || !Number.isFinite(Date.parse(startedAt))) throw new Error("A Task Reminder Run needs valid Plan, Task, Reminder, due, and start values.");
    if (!Number.isInteger(input.attemptNumber) || input.attemptNumber < 1 || input.attemptNumber > 3) throw new Error("A Task Reminder Run attempt must be from 1 to 3.");
    const id = `run-${randomUUID()}`;
    this.database.prepare(`INSERT OR IGNORE INTO task_reminder_runs
      (id, plan_id, task_id, reminder_key, due_at, status, attempt_count, weather_status, weather_stage, weather_failure_code, telegram_failure_code, started_at, finished_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'running', ?, 'not_attempted', NULL, NULL, NULL, ?, NULL, ?)`).run(id, planId, taskId, reminderKey, input.dueAt, input.attemptNumber, startedAt, startedAt);
    this.database.prepare(`UPDATE task_reminder_runs SET status = 'running', attempt_count = MAX(attempt_count, ?), finished_at = NULL, updated_at = ?
      WHERE plan_id = ? AND reminder_key = ? AND status IN ('running', 'retry_wait')`).run(input.attemptNumber, startedAt, planId, reminderKey);
    const row = this.database.prepare(`SELECT id, plan_id, task_id, reminder_key, due_at, status, attempt_count, weather_status, weather_stage, weather_failure_code, telegram_failure_code, started_at, finished_at, updated_at
      FROM task_reminder_runs WHERE plan_id = ? AND reminder_key = ?`).get(planId, reminderKey) as TaskReminderRunRow | undefined;
    if (!row) throw new Error("The Task Reminder Run could not be started.");
    if (row.task_id !== taskId || row.due_at !== input.dueAt) throw new Error("The Task Reminder Run key conflicts with different Task or due-time facts.");
    return taskReminderRunFromRow(row);
  }

  recordTaskReminderRunWeather(input: { runId: string; status: "available" | "unavailable"; stage?: "amap" | "qweather" | "pipeline"; failureCode?: string; recordedAt?: string }): TaskReminderRun {
    const recordedAt = input.recordedAt ?? new Date().toISOString();
    if (!Number.isFinite(Date.parse(recordedAt))) throw new Error("A Task Reminder weather audit needs a valid time.");
    if (input.status === "available" && (input.stage || input.failureCode)) throw new Error("Available weather cannot contain a failure classification.");
    if (input.status === "unavailable" && !input.stage) throw new Error("Unavailable weather needs its failed stage.");
    const failureCode = sanitizeRunFailureCode(input.failureCode);
    const updated = this.database.prepare(`UPDATE task_reminder_runs
      SET weather_status = ?, weather_stage = ?, weather_failure_code = ?, updated_at = ?
      WHERE id = ? AND status = 'running'`).run(input.status, input.stage ?? null, failureCode ?? null, recordedAt, input.runId.trim());
    if (updated.changes !== 1) throw new Error("The running Task Reminder Run was not found.");
    return this.getTaskReminderRun(input.runId);
  }

  recordTaskReminderRunDelivery(input: { runId: string; status: "retry_wait" | "succeeded" | "failed" | "cancelled"; failureCode?: string; recordedAt?: string }): TaskReminderRun {
    const recordedAt = input.recordedAt ?? new Date().toISOString();
    if (!Number.isFinite(Date.parse(recordedAt))) throw new Error("A Task Reminder delivery audit needs a valid time.");
    const failureCode = sanitizeRunFailureCode(input.failureCode);
    if (input.status === "succeeded" && failureCode) throw new Error("A successful Task Reminder Run cannot contain a Telegram failure.");
    const finishedAt = input.status === "retry_wait" ? null : recordedAt;
    const allowedCurrent = input.status === "succeeded" || input.status === "cancelled" ? "('running', 'cancelled')" : "('running')";
    const updated = this.database.prepare(`UPDATE task_reminder_runs
      SET status = ?, telegram_failure_code = ?, finished_at = ?, updated_at = ?
      WHERE id = ? AND status IN ${allowedCurrent}`).run(input.status, failureCode ?? null, finishedAt, recordedAt, input.runId.trim());
    if (updated.changes !== 1) throw new Error("The active Task Reminder Run was not found.");
    return this.getTaskReminderRun(input.runId);
  }

  listRecentTaskReminderRuns(limit = 20): TaskReminderRun[] {
    const safeLimit = Number.isInteger(limit) && limit > 0 && limit <= 100 ? limit : 20;
    return (this.database.prepare(`SELECT id, plan_id, task_id, reminder_key, due_at, status, attempt_count, weather_status, weather_stage, weather_failure_code, telegram_failure_code, started_at, finished_at, updated_at
      FROM task_reminder_runs ORDER BY started_at DESC, rowid DESC LIMIT ?`).all(safeLimit) as unknown as TaskReminderRunRow[]).map(taskReminderRunFromRow);
  }

  private getTaskReminderRun(runId: string): TaskReminderRun {
    const row = this.database.prepare(`SELECT id, plan_id, task_id, reminder_key, due_at, status, attempt_count, weather_status, weather_stage, weather_failure_code, telegram_failure_code, started_at, finished_at, updated_at
      FROM task_reminder_runs WHERE id = ?`).get(runId.trim()) as TaskReminderRunRow | undefined;
    if (!row) throw new Error("The Task Reminder Run was not found.");
    return taskReminderRunFromRow(row);
  }

  /** Stores immutable official-source evidence and reports only byte-level content change. */
  saveSourceSnapshot(input: SourceSnapshotInput): SourceSnapshotWriteResult {
    const normalized = normalizeSourceSnapshotInput(input);
    const existing = this.database.prepare(`SELECT id, source_id, authority, title_original, url, retrieved_at, content_hash, excerpt
      FROM source_snapshots WHERE source_id = ? AND url = ? AND content_hash = ?`).get(normalized.sourceId, normalized.url, normalized.contentHash) as SourceSnapshotRow | undefined;
    if (existing) return { snapshot: sourceSnapshotFromRow(existing), duplicate: true, contentChanged: false };

    const previous = this.database.prepare(`SELECT id, source_id, authority, title_original, url, retrieved_at, content_hash, excerpt
      FROM source_snapshots WHERE source_id = ? AND url = ?
      ORDER BY retrieved_at DESC, rowid DESC LIMIT 1`).get(normalized.sourceId, normalized.url) as SourceSnapshotRow | undefined;
    const snapshot: SourceSnapshot = { id: `source-${randomUUID()}`, ...normalized };
    this.database.prepare(`INSERT INTO source_snapshots (id, source_id, authority, title_original, url, retrieved_at, content_hash, excerpt, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      snapshot.id,
      snapshot.sourceId,
      snapshot.authority,
      snapshot.titleOriginal,
      snapshot.url,
      snapshot.retrievedAt,
      snapshot.contentHash,
      snapshot.excerpt,
      new Date().toISOString()
    );
    const previousSnapshot = previous ? sourceSnapshotFromRow(previous) : undefined;
    return { snapshot, ...(previousSnapshot ? { previousSnapshot } : {}), duplicate: false, contentChanged: Boolean(previousSnapshot && previousSnapshot.contentHash !== snapshot.contentHash) };
  }

  /** Adds a saved immutable official snapshot to the current Plan only after an explicit user action. */
  linkSourceSnapshotToPlan(planId: string, sourceSnapshotId: string): WorkspaceSnapshot {
    const workspace = this.getWorkspace();
    if (workspace.activePlan.id !== planId) throw new Error(`Plan ${planId} was not found.`);
    const snapshot = this.database.prepare(`SELECT id, source_id, authority, title_original, url, retrieved_at, content_hash, excerpt
      FROM source_snapshots WHERE id = ?`).get(sourceSnapshotId.trim()) as SourceSnapshotRow | undefined;
    if (!snapshot) throw new Error("The saved official evidence was not found.");

    const source = sourceSnapshotFromRow(snapshot);
    const alreadyLinked = workspace.activePlan.sources.some((candidate) => candidate.url === source.url && candidate.authority === source.authority && candidate.retrievedAt === source.retrievedAt);
    if (alreadyLinked) return workspace;

    const sources: SourceReference[] = [...workspace.activePlan.sources, {
      title: source.titleOriginal,
      authority: source.authority,
      url: source.url,
      retrievedAt: source.retrievedAt,
      sourceSnapshotId: source.id,
      contentHash: source.contentHash
    }];
    this.database.prepare("UPDATE plans SET sources_json = ?, version = version + 1 WHERE id = ?").run(JSON.stringify(sources), planId);
    this.addInbox({
      id: `source-linked-${planId}-${source.id}`,
      tone: "notice",
      title: "Official evidence linked to this Plan",
      body: `${source.titleOriginal} is retained as a source reference for this Plan. Linking evidence does not determine whether a policy applies to you.`,
      timestamp: "Just now"
    });
    return this.getWorkspace();
  }

  updatePlanAccommodation(planId: string, input: PlanAccommodationInput): WorkspaceSnapshot {
    const workspace = this.getWorkspace();
    if (workspace.activePlan.id !== planId) throw new Error(`Plan ${planId} was not found.`);
    const name = input.name.trim();
    const address = input.address.trim();
    const location = input.location.trim();
    if (!name || !address || !location) throw new Error("A saved accommodation candidate needs a name, address, and location.");

    const configuration: PlanConfiguration = {
      ...workspace.activePlan.configuration,
      accommodation: {
        status: input.status,
        ...(input.id?.trim() ? { id: input.id.trim() } : {}),
        name,
        address,
        location,
        source: input.source,
        updatedAt: new Date().toISOString()
      }
    };
    this.database.prepare("UPDATE plans SET configuration_json = ?, version = version + 1 WHERE id = ?").run(JSON.stringify(configuration), planId);
    this.addInbox({
      id: `accommodation-candidate-${planId}-${Date.now()}`,
      tone: "notice",
      title: input.status === "confirmed" ? "Accommodation confirmed in this Plan" : "Accommodation candidate saved in this Plan",
      body: input.status === "confirmed" ? `${name} is marked as booked after your confirmation.` : `${name} is saved as a candidate. It is not marked as booked.`,
      timestamp: "Just now"
    });
    return this.getWorkspace();
  }

  updatePlanTransportPreference(planId: string, input: PlanTransportPreferenceInput): WorkspaceSnapshot {
    const workspace = this.getWorkspace();
    if (workspace.activePlan.id !== planId) throw new Error(`Plan ${planId} was not found.`);
    if (!["plan_recommended", "taxi", "public_transit", "walking"].includes(input.preference)) throw new Error("Choose a supported transport preference.");
    const configuration: PlanConfiguration = {
      ...workspace.activePlan.configuration,
      transport: { preference: input.preference }
    };
    this.database.prepare("UPDATE plans SET configuration_json = ?, version = version + 1 WHERE id = ?").run(JSON.stringify(configuration), planId);
    this.addInbox({
      id: `transport-preference-${planId}-${Date.now()}`,
      tone: "notice",
      title: "Transport preference saved in this Plan",
      body: input.preference === "plan_recommended" ? "C-assistant will choose a transport approach from the Plan context when that capability is connected." : `This Plan now prefers ${input.preference.replaceAll("_", " ")}.`,
      timestamp: "Just now"
    });
    return this.getWorkspace();
  }

  updatePlanTravelContext(planId: string, input: PlanTravelContextInput): WorkspaceSnapshot {
    const workspace = this.getWorkspace();
    if (workspace.activePlan.id !== planId) throw new Error(`Plan ${planId} was not found.`);
    const partySize = input.partySize;
    if (partySize !== undefined && (!Number.isInteger(partySize) || partySize < 1 || partySize > 20)) throw new Error("Party size must be a whole number from 1 to 20.");
    if (!["unknown", "light", "standard", "heavy"].includes(input.luggage)) throw new Error("Choose a supported luggage level.");
    const configuration: PlanConfiguration = {
      ...workspace.activePlan.configuration,
      travelContext: {
        ...(partySize === undefined ? {} : { partySize }),
        luggage: input.luggage
      }
    };
    this.database.prepare("UPDATE plans SET configuration_json = ?, version = version + 1 WHERE id = ?").run(JSON.stringify(configuration), planId);
    this.addInbox({
      id: `travel-context-${planId}-${Date.now()}`,
      tone: "notice",
      title: "Travel context saved in this Plan",
      body: "Companions and luggage will guide later transport decisions.",
      timestamp: "Just now"
    });
    return this.getWorkspace();
  }

  updatePlanArrival(planId: string, input: PlanArrivalInput): WorkspaceSnapshot {
    const workspace = this.getWorkspace();
    if (workspace.activePlan.id !== planId) throw new Error(`Plan ${planId} was not found.`);
    const expectedAtLocal = input.expectedAtLocal?.trim();
    const timeZone = input.timeZone?.trim();
    if (expectedAtLocal && !isLocalDateTime(expectedAtLocal)) throw new Error("Expected arrival must be a valid local date and time.");
    if (timeZone && !isTimeZoneName(timeZone)) throw new Error("Use a valid IANA time-zone name for the expected arrival.");

    const configuration: PlanConfiguration = {
      ...workspace.activePlan.configuration,
      arrival: {
        ...(expectedAtLocal ? { expectedAtLocal } : {}),
        ...(timeZone ? { timeZone } : {})
      }
    };
    this.database.prepare("UPDATE plans SET configuration_json = ?, version = version + 1 WHERE id = ?").run(JSON.stringify(configuration), planId);
    this.addInbox({
      id: `arrival-timing-${planId}-${Date.now()}`,
      tone: "notice",
      title: expectedAtLocal ? "Expected arrival saved in this Plan" : "Expected arrival cleared from this Plan",
      body: expectedAtLocal ? `Arrival is saved for ${expectedAtLocal}${timeZone ? ` (${timeZone})` : ""}. No reminder has been scheduled yet.` : "No reminder has been scheduled or sent.",
      timestamp: "Just now"
    });
    return this.getWorkspace();
  }

  private migrate(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS profiles (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        display_name TEXT NOT NULL,
        preferred_language TEXT NOT NULL,
        nationality TEXT NOT NULL,
        gender TEXT NOT NULL DEFAULT 'not_specified',
        immigration_status TEXT NOT NULL DEFAULT 'unknown',
        status TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS runtime_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        selected_runtime TEXT NOT NULL CHECK (selected_runtime IN ('codex', 'claude-code')),
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS plans (
        id TEXT PRIMARY KEY,
        version INTEGER NOT NULL,
        title TEXT NOT NULL,
        location TEXT NOT NULL,
        dates TEXT NOT NULL,
        status TEXT NOT NULL,
        known_information_json TEXT NOT NULL,
        assumptions_json TEXT NOT NULL,
        next_action TEXT NOT NULL,
        configuration_json TEXT NOT NULL,
        sources_json TEXT NOT NULL,
        is_current INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS stages (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        sort_order INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        stage_id TEXT NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        owner TEXT NOT NULL,
        status TEXT NOT NULL,
        due_label TEXT NOT NULL,
        activation_trigger TEXT,
        reminder_json TEXT,
        sort_order INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS inbox_items (
        id TEXT PRIMARY KEY,
        tone TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS source_snapshots (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        authority TEXT NOT NULL,
        title_original TEXT NOT NULL,
        url TEXT NOT NULL,
        retrieved_at TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        excerpt TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (source_id, url, content_hash)
      );
      CREATE TABLE IF NOT EXISTS agent_runs (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind = 'plan_generation'),
        runtime_kind TEXT NOT NULL CHECK (runtime_kind IN ('codex', 'claude-code')),
        trigger TEXT NOT NULL CHECK (trigger IN ('web', 'telegram')),
        status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'fallback')),
        started_at TEXT NOT NULL,
        finished_at TEXT,
        output_plan_id TEXT,
        failure_code TEXT
      );
      CREATE TABLE IF NOT EXISTS task_reminder_runs (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        reminder_key TEXT NOT NULL,
        due_at TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('running', 'retry_wait', 'succeeded', 'failed', 'cancelled')),
        attempt_count INTEGER NOT NULL CHECK (attempt_count BETWEEN 1 AND 3),
        weather_status TEXT NOT NULL CHECK (weather_status IN ('not_attempted', 'available', 'unavailable')),
        weather_stage TEXT CHECK (weather_stage IN ('amap', 'qweather', 'pipeline')),
        weather_failure_code TEXT,
        telegram_failure_code TEXT,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        updated_at TEXT NOT NULL,
        UNIQUE (plan_id, reminder_key)
      );
      CREATE TABLE IF NOT EXISTS telegram_binding (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        chat_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        first_name TEXT NOT NULL,
        username TEXT,
        paired_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS telegram_pairing_requests (
        code TEXT PRIMARY KEY,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        consumed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS telegram_update_cursor (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        next_update_id INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS telegram_profile_edit_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        field TEXT NOT NULL CHECK (field IN ('displayName', 'preferredLanguage', 'nationality')),
        started_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS telegram_processed_updates (
        update_id INTEGER PRIMARY KEY,
        processed_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS telegram_reminder_deliveries (
        plan_id TEXT NOT NULL,
        reminder_key TEXT NOT NULL,
        due_at TEXT NOT NULL,
        claimed_at TEXT NOT NULL,
        PRIMARY KEY (plan_id, reminder_key)
      );
      CREATE TABLE IF NOT EXISTS telegram_task_reminder_deliveries (
        plan_id TEXT NOT NULL,
        reminder_key TEXT NOT NULL,
        task_id TEXT NOT NULL,
        due_at TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('attempting', 'retry_wait', 'delivered', 'failed')),
        attempt_count INTEGER NOT NULL,
        next_attempt_at TEXT,
        last_failure_code TEXT,
        delivered_at TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (plan_id, reminder_key)
      );
      CREATE TABLE IF NOT EXISTS telegram_arrival_checkins (
        plan_id TEXT PRIMARY KEY REFERENCES plans(id) ON DELETE CASCADE,
        check_in_sent_at TEXT NOT NULL,
        location_requested_at TEXT,
        location_received_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_plans_current ON plans(is_current, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_stages_plan_order ON stages(plan_id, sort_order);
      CREATE INDEX IF NOT EXISTS idx_tasks_stage_order ON tasks(stage_id, sort_order);
      CREATE INDEX IF NOT EXISTS idx_inbox_created_at ON inbox_items(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_source_snapshots_latest ON source_snapshots(source_id, url, retrieved_at DESC);
      CREATE INDEX IF NOT EXISTS idx_agent_runs_recent ON agent_runs(started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_task_reminder_runs_recent ON task_reminder_runs(started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_telegram_pairing_requests_active ON telegram_pairing_requests(consumed_at, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_telegram_task_reminders_due ON telegram_task_reminder_deliveries(status, next_attempt_at);
      CREATE INDEX IF NOT EXISTS idx_telegram_arrival_checkins_follow_up ON telegram_arrival_checkins(location_requested_at, location_received_at, check_in_sent_at);
      PRAGMA optimize;
    `);
    const planColumns = this.database.prepare("PRAGMA table_info(plans)").all() as unknown as Array<{ name: string }>;
    if (!planColumns.some((column) => column.name === "configuration_json")) {
      this.database.exec("ALTER TABLE plans ADD COLUMN configuration_json TEXT NOT NULL DEFAULT '{\"accommodation\":{\"status\":\"not_set\"}}'");
    }
    const taskColumns = this.database.prepare("PRAGMA table_info(tasks)").all() as unknown as Array<{ name: string }>;
    if (!taskColumns.some((column) => column.name === "activation_trigger")) this.database.exec("ALTER TABLE tasks ADD COLUMN activation_trigger TEXT");
    if (!taskColumns.some((column) => column.name === "reminder_json")) this.database.exec("ALTER TABLE tasks ADD COLUMN reminder_json TEXT");
    this.database.exec("CREATE INDEX IF NOT EXISTS idx_tasks_arrival_trigger ON tasks(activation_trigger, status) WHERE activation_trigger = 'arrival' AND status = 'scheduled'; PRAGMA optimize;");
    const profileColumns = this.database.prepare("PRAGMA table_info(profiles)").all() as unknown as Array<{ name: string }>;
    if (!profileColumns.some((column) => column.name === "gender")) this.database.exec("ALTER TABLE profiles ADD COLUMN gender TEXT NOT NULL DEFAULT 'not_specified'");
    if (!profileColumns.some((column) => column.name === "immigration_status")) this.database.exec("ALTER TABLE profiles ADD COLUMN immigration_status TEXT NOT NULL DEFAULT 'unknown'");
    this.database.prepare("INSERT OR IGNORE INTO runtime_settings (id, selected_runtime, updated_at) VALUES (1, 'codex', ?)").run(new Date().toISOString());
  }

  private seedIfEmpty(): void {
    const profile = this.database.prepare("SELECT id FROM profiles WHERE id = 1").get();
    if (profile) return;

    const workspace = createInitialWorkspace();
    this.database.prepare("INSERT INTO profiles (id, display_name, preferred_language, nationality, gender, immigration_status, status, updated_at) VALUES (1, ?, ?, ?, ?, ?, ?, ?)").run(
      workspace.profile.displayName,
      workspace.profile.preferredLanguage,
      workspace.profile.nationality,
      workspace.profile.gender,
      workspace.profile.immigrationStatus,
      workspace.profile.status,
      new Date().toISOString()
    );
    this.database.prepare("INSERT OR IGNORE INTO runtime_settings (id, selected_runtime, updated_at) VALUES (1, ?, ?)").run(workspace.runtime.selectedKind, new Date().toISOString());
    this.savePlan(workspace.activePlan);
    workspace.inbox.forEach((item) => this.addInbox(item));
  }

  private savePlan(plan: Plan): void {
    this.database.exec("BEGIN");
    try {
      const supersededAt = new Date().toISOString();
      this.database.prepare(`UPDATE task_reminder_runs SET status = 'cancelled', finished_at = ?, updated_at = ?
        WHERE plan_id IN (SELECT id FROM plans WHERE is_current = 1) AND status IN ('running', 'retry_wait')`).run(supersededAt, supersededAt);
      this.database.prepare("UPDATE plans SET is_current = 0 WHERE is_current = 1").run();
      this.database.prepare(`INSERT INTO plans (id, version, title, location, dates, status, known_information_json, assumptions_json, next_action, configuration_json, sources_json, is_current, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`).run(
        plan.id,
        plan.version,
        plan.title,
        plan.location,
        plan.dates,
        plan.status,
        JSON.stringify(plan.knownInformation),
        JSON.stringify(plan.assumptions),
        plan.nextAction,
        JSON.stringify(plan.configuration),
        JSON.stringify(plan.sources),
        plan.createdAt
      );
      plan.stages.forEach((stage, stageIndex) => {
        this.database.prepare("INSERT INTO stages (id, plan_id, title, description, sort_order) VALUES (?, ?, ?, ?, ?)").run(
          stage.id,
          plan.id,
          stage.title,
          stage.description,
          stageIndex
        );
        stage.tasks.forEach((task, taskIndex) => {
          this.database.prepare("INSERT INTO tasks (id, stage_id, title, owner, status, due_label, activation_trigger, reminder_json, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
            task.id,
            stage.id,
            task.title,
            task.owner,
            task.status,
            task.dueLabel,
            task.activationTrigger ?? null,
            task.reminder ? JSON.stringify(task.reminder) : null,
            taskIndex
          );
        });
      });
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  private getCurrentPlan(): Plan | undefined {
    const plan = this.database.prepare(`SELECT id, version, title, location, dates, status, known_information_json, assumptions_json, next_action, configuration_json, sources_json, created_at
      FROM plans WHERE is_current = 1 ORDER BY created_at DESC LIMIT 1`).get() as PlanRow | undefined;
    if (!plan) return undefined;

    const stageRows = this.database.prepare("SELECT id, title, description FROM stages WHERE plan_id = ? ORDER BY sort_order").all(plan.id) as unknown as StageRow[];
    const stages: Stage[] = stageRows.map((stage) => ({
      id: stage.id,
      title: stage.title,
      description: stage.description,
      tasks: (this.database.prepare("SELECT id, title, owner, status, due_label, activation_trigger, reminder_json FROM tasks WHERE stage_id = ? ORDER BY sort_order").all(stage.id) as unknown as TaskRow[]).map((task) => {
        const reminder = parseTaskReminder(task.reminder_json);
        return {
          id: task.id,
          title: task.title,
          owner: task.owner,
          status: task.status,
          dueLabel: task.due_label,
          ...(task.activation_trigger === "arrival" ? { activationTrigger: "arrival" as const } : {}),
          ...(reminder ? { reminder } : {})
        };
      })
    }));

    return {
      id: plan.id,
      version: plan.version,
      title: plan.title,
      location: plan.location,
      dates: plan.dates,
      status: plan.status,
      knownInformation: JSON.parse(plan.known_information_json) as string[],
      assumptions: JSON.parse(plan.assumptions_json) as string[],
      nextAction: plan.next_action,
      configuration: parsePlanConfiguration(plan.configuration_json),
      stages,
      sources: JSON.parse(plan.sources_json) as SourceReference[],
      createdAt: plan.created_at
    };
  }

  private listSourceSnapshots(limit = 30): SourceSnapshot[] {
    return (this.database.prepare(`SELECT id, source_id, authority, title_original, url, retrieved_at, content_hash, excerpt
      FROM source_snapshots ORDER BY retrieved_at DESC, rowid DESC LIMIT ?`).all(limit) as unknown as SourceSnapshotRow[]).map(sourceSnapshotFromRow);
  }

  private addInbox(item: InboxItem): void {
    this.database.prepare("INSERT OR IGNORE INTO inbox_items (id, tone, title, body, timestamp, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
      item.id,
      item.tone,
      item.title,
      item.body,
      item.timestamp,
      new Date().toISOString()
    );
  }
}

function parsePlanConfiguration(value: string): PlanConfiguration {
  const defaults = createDefaultPlanConfiguration();
  try {
    const parsed = JSON.parse(value) as Partial<PlanConfiguration>;
    const accommodation = parsed.accommodation && ["not_set", "candidate", "confirmed"].includes(parsed.accommodation.status) ? parsed.accommodation : defaults.accommodation;
    const preference = parsed.transport && ["plan_recommended", "taxi", "public_transit", "walking"].includes(parsed.transport.preference) ? parsed.transport.preference : defaults.transport.preference;
    const travelContext = parsed.travelContext && ["unknown", "light", "standard", "heavy"].includes(parsed.travelContext.luggage) ? { ...(Number.isInteger(parsed.travelContext.partySize) && parsed.travelContext.partySize! >= 1 && parsed.travelContext.partySize! <= 20 ? { partySize: parsed.travelContext.partySize } : {}), luggage: parsed.travelContext.luggage } : defaults.travelContext;
    const arrival = parsed.arrival && typeof parsed.arrival === "object" ? { ...(typeof parsed.arrival.expectedAtLocal === "string" && isLocalDateTime(parsed.arrival.expectedAtLocal) ? { expectedAtLocal: parsed.arrival.expectedAtLocal } : {}), ...(typeof parsed.arrival.timeZone === "string" && isTimeZoneName(parsed.arrival.timeZone) ? { timeZone: parsed.arrival.timeZone } : {}) } : defaults.arrival;
    return { accommodation, arrival, transport: { preference }, travelContext };
  } catch {
    // Old local data can safely fall back to an empty Plan configuration.
  }
  return defaults;
}

function parseTaskReminder(value: string | null): TaskReminder | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as Partial<TaskReminder>;
    if (typeof parsed.scheduledAtLocal !== "string" || !isLocalDateTime(parsed.scheduledAtLocal)) return undefined;
    if (typeof parsed.timeZone !== "string" || !isTimeZoneName(parsed.timeZone)) return undefined;
    if (typeof parsed.purpose !== "string" || !parsed.purpose.trim() || parsed.purpose.length > 500) return undefined;
    if (parsed.refreshFacts !== undefined && (!Array.isArray(parsed.refreshFacts) || parsed.refreshFacts.length > 1 || parsed.refreshFacts.some((fact) => fact !== "weather"))) return undefined;
    const refreshFacts = parsed.refreshFacts?.includes("weather") ? ["weather" as const] : undefined;
    return { scheduledAtLocal: parsed.scheduledAtLocal, timeZone: parsed.timeZone, purpose: parsed.purpose.trim(), ...(refreshFacts ? { refreshFacts } : {}) };
  } catch {
    return undefined;
  }
}

function taskRemindersEqual(left: TaskReminder, right: TaskReminder): boolean {
  return left.scheduledAtLocal === right.scheduledAtLocal
    && left.timeZone === right.timeZone
    && left.purpose === right.purpose
    && JSON.stringify(left.refreshFacts ?? []) === JSON.stringify(right.refreshFacts ?? []);
}

function isLocalDateTime(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}:00Z`));
}

function isTimeZoneName(value: string): boolean {
  if (!/^[A-Za-z_]+(?:\/[A-Za-z_+-]+)+$/.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function normalizeSourceSnapshotInput(input: SourceSnapshotInput): Omit<SourceSnapshot, "id"> {
  const sourceId = input.sourceId.trim();
  const authority = input.authority.trim();
  const titleOriginal = input.titleOriginal.trim();
  const url = input.url.trim();
  const retrievedAt = input.retrievedAt.trim();
  const contentHash = input.contentHash.trim().toLowerCase();
  const excerpt = input.excerpt.trim();
  if (!/^[a-z0-9][a-z0-9_-]{0,119}$/i.test(sourceId)) throw new Error("A source snapshot needs a stable source id.");
  if (!authority || authority.length > 300 || !titleOriginal || titleOriginal.length > 500) throw new Error("A source snapshot needs a bounded authority and original title.");
  try {
    if (new URL(url).protocol !== "https:") throw new Error();
  } catch {
    throw new Error("A source snapshot needs an HTTPS canonical URL.");
  }
  if (!Number.isFinite(Date.parse(retrievedAt))) throw new Error("A source snapshot needs a valid retrieval time.");
  if (!/^[a-f0-9]{64}$/.test(contentHash)) throw new Error("A source snapshot needs a SHA-256 content hash.");
  if (!excerpt || excerpt.length > 12_000) throw new Error("A source snapshot needs a bounded readable excerpt.");
  return { sourceId, authority, titleOriginal, url, retrievedAt, contentHash, excerpt };
}

function sourceSnapshotFromRow(row: SourceSnapshotRow): SourceSnapshot {
  return { id: row.id, sourceId: row.source_id, authority: row.authority, titleOriginal: row.title_original, url: row.url, retrievedAt: row.retrieved_at, contentHash: row.content_hash, excerpt: row.excerpt };
}

function agentRunFromRow(row: AgentRunRow): AgentRun {
  return {
    id: row.id,
    kind: row.kind,
    runtimeKind: row.runtime_kind,
    trigger: row.trigger,
    status: row.status,
    startedAt: row.started_at,
    ...(row.finished_at ? { finishedAt: row.finished_at } : {}),
    ...(row.output_plan_id ? { outputPlanId: row.output_plan_id } : {}),
    ...(row.failure_code ? { failureCode: row.failure_code } : {})
  };
}

function taskReminderRunFromRow(row: TaskReminderRunRow): TaskReminderRun {
  return {
    id: row.id,
    kind: "task_reminder",
    planId: row.plan_id,
    taskId: row.task_id,
    reminderKey: row.reminder_key,
    dueAt: row.due_at,
    status: row.status,
    attemptCount: row.attempt_count,
    weatherStatus: row.weather_status,
    ...(row.weather_stage ? { weatherStage: row.weather_stage } : {}),
    ...(row.weather_failure_code ? { weatherFailureCode: row.weather_failure_code } : {}),
    ...(row.telegram_failure_code ? { telegramFailureCode: row.telegram_failure_code } : {}),
    startedAt: row.started_at,
    ...(row.finished_at ? { finishedAt: row.finished_at } : {}),
    updatedAt: row.updated_at
  };
}

function sanitizeRunFailureCode(value: string | undefined): string | undefined {
  const code = value?.trim();
  if (!code) return undefined;
  if (!/^[a-z0-9_:-]{1,80}$/i.test(code)) throw new Error("A Run failure code must be a short safe classification.");
  return code;
}

function isAgentRuntimeKind(value: unknown): value is AgentRuntimeKind {
  return value === "codex" || value === "claude-code";
}

function isRunTrigger(value: unknown): value is RunTrigger {
  return value === "web" || value === "telegram";
}

function isFinishedRunStatus(value: unknown): value is Exclude<RunStatus, "running"> {
  return value === "succeeded" || value === "failed" || value === "fallback";
}

function runtimeDisplayName(kind: AgentRuntimeKind): string {
  return kind === "claude-code" ? "Claude Code" : "Codex";
}
