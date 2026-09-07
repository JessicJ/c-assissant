import { chmodSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  confirmPlan,
  applyDirectBlueprintRevisionBatchWithMetadata,
  assertPlanPresentationIntegrity,
  assertResearchSetIntegrity,
  assertTripBlueprintIntegrity,
  blueprintPresentation,
  createInitialWorkspace,
  createPlanFromDraft,
  createPlanFromRequest,
  createDefaultPlanConfiguration,
  compileTripBlueprint,
  isPreDepartureChecklistTask,
  type CreatePlanInput,
  type CountryPackSkillRun,
  type DestinationArrivalEvent,
  type DirectBlueprintRevision,
  type DirectBlueprintRevisionBatchMetadata,
  type AgentRuntimeKind,
  type AgentRun,
  type BlueprintGeneration,
  type BlueprintGenerationEvent,
  type BlueprintItineraryBlock,
  type BlueprintMovement,
  type BlueprintPlanCompilation,
  type BlueprintSource,
  type BlueprintStop,
  type GeneratedPlanDraft,
  type InboxItem,
  type ItineraryDay,
  type ImmigrationStatus,
  type Plan,
  type PlanAccommodationInput,
  type PlanArrivalInput,
  type PlanCompilationAudit,
  type PlanCompilationOrigin,
  type PlanCompilationRun,
  type PlanChangeSet,
  type PlanChangeImpactPreview,
  type PlanConfiguration,
  type PlanReplacementAudit,
  type PlanRevalidationScope,
  type PlanPresentation,
  type PlanPlacePriority,
  type PlanRouteSegment,
  type PlanTravelContextInput,
  type PlanningSession,
  type PlanBlueprintLineage,
  type PlanTransportPreferenceInput,
  type ProfileGender,
  type ProfileUpdate,
  type RuntimeSelectionUpdate,
  type RunStatus,
  type RunTrigger,
  type SourceReference,
  type StagePresentationKind,
  type SourceEvidenceRef,
  type SourceSnapshot,
  type SourceSnapshotInput,
  type SourceSnapshotWriteResult,
  type TravelBooking,
  type ResearchSet,
  type Stage,
  type Task,
  type TaskReminder,
  type TaskReminderRun,
  type TaskReminderRunStatus,
  type TripBlueprint,
  type TelegramBinding,
  type TelegramPairingStatus,
  type TransportPreference,
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
  presentation_json: string | null;
  created_at: string;
}

interface PlanChangeSetRow {
  id: string;
  plan_id: string;
  base_version: number;
  applied_version: number;
  kind: PlanChangeSet["kind"];
  impact: PlanChangeSet["impact"];
  status: PlanChangeSet["status"];
  stage_id: string;
  task_id: string;
  from_index: number;
  to_index: number;
  affected_task_ids_json: string;
  created_at: string;
  undone_at: string | null;
}

interface PlanReplacementAuditRow {
  id: string;
  source_plan_id: string;
  source_plan_version: number;
  replacement_plan_id: string;
  replacement_plan_version: number;
  impact: PlanReplacementAudit["impact"];
  affected_areas_json: string;
  revalidation_scopes_json: string;
  preserved_completed_tasks_json: string;
  created_at: string;
}

interface BlueprintGenerationRow {
  generation_key: string;
  session_id: string;
  proposal_version: number;
  skill_id: string;
  skill_version: string;
  status: BlueprintGeneration["status"];
  stage: BlueprintGeneration["stage"];
  research_set_id: string | null;
  blueprint_id: string | null;
  blueprint_version: number | null;
  failure_json: string | null;
  created_at: string;
  updated_at: string;
}

interface ResearchSetRow {
  id: string;
  generation_key: string;
  content_json: string;
}

interface TripBlueprintRow {
  id: string;
  version: number;
  generation_key: string;
  research_set_id: string;
  content_json: string;
}

interface PlanBlueprintLineageRow {
  plan_id: string;
  plan_version: number;
  blueprint_id: string;
  blueprint_version: number;
  compiler_version: string;
  compilation_key: string;
  created_at: string;
}

interface BlueprintGenerationEventRow {
  id: string;
  generation_key: string;
  sequence: number;
  stage: BlueprintGenerationEvent["stage"];
  status: BlueprintGenerationEvent["status"];
  scope_label: string | null;
  saved_place_count: number | null;
  detail: string;
  next_action: string | null;
  created_at: string;
}

export interface TelegramPlanChangeProposal {
  id: string;
  planId: string;
  baseVersion: number;
  request: string;
  impact: PlanChangeImpactPreview;
  status: "pending" | "applied" | "cancelled" | "stale";
  createdAt: string;
  resolvedAt?: string;
}

export interface DirectBlueprintRevisionSaveResult {
  workspace: WorkspaceSnapshot;
  revision: DirectBlueprintRevisionBatchMetadata;
}

interface TelegramPlanChangeProposalRow {
  id: string;
  plan_id: string;
  base_version: number;
  request: string;
  impact_json: string;
  status: TelegramPlanChangeProposal["status"];
  created_at: string;
  resolved_at: string | null;
}

interface StageRow {
  id: string;
  title: string;
  description: string;
  presentation_kind: StagePresentationKind | null;
  origin_json?: string | null;
}

interface TaskRow {
  id: string;
  title: string;
  description?: string | null;
  owner: Task["owner"];
  status: Task["status"];
  due_label: string;
  preparation_category: Task["preparationCategory"] | null;
  activation_trigger: "arrival" | null;
  reminder_json: string | null;
  requirement_id?: string | null;
  origin_json?: string | null;
}

interface PlanCompilationRunRow {
  id: string;
  plan_id: string;
  country_pack_id: string;
  country_pack_version: string;
  composition_skill_id: string;
  composition_skill_version: string;
  source_plan_version: number;
  compiled_plan_version: number;
  task_count: number;
  reminder_count: number;
  compiled_at: string;
}

interface CountryPackSkillRunRow {
  id: string;
  compilation_run_id: string;
  plan_id: string;
  source_plan_version: number;
  skill_id: string;
  skill_version: string;
  status: CountryPackSkillRun["status"];
  finished_at: string;
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

interface PlanningSessionRow {
  id: string;
  status: PlanningSession["status"];
  objective_type: PlanningSession["objectiveType"];
  messages_json: string;
  facts_json: string;
  unresolved_json: string;
  deferred_json: string;
  proposal_json: string | null;
  confirmed_proposal_version: number | null;
  output_plan_id: string | null;
  created_at: string;
  updated_at: string;
}

interface TravelBookingRow {
  id: string;
  planning_session_id: string | null;
  plan_id: string | null;
  source_hash: string;
  status: TravelBooking["status"];
  type: TravelBooking["type"];
  content_json: string;
  created_at: string;
  updated_at: string;
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

interface PlanDestinationArrivalRow {
  city: string;
  arrived_at: string;
  confirmed: number;
}

interface TelegramRouteHandoffRow {
  plan_id: string;
  offered_at: string;
  opened_at: string | null;
  route_duration_seconds: number;
  wait_buffer_seconds: number;
  safety_margin_seconds: number;
  expected_arrival_at: string;
  guidance_sent_at: string | null;
  delay_count: number;
  last_delayed_at: string | null;
}

export type TelegramProfileTextField = "displayName" | "preferredLanguage" | "nationality";

interface TelegramProfileEditRow {
  field: TelegramProfileTextField;
  started_at: string;
}

export type TelegramLocationIntentPurpose = "arrival_route" | "nearby_food" | "uber_test" | "movement_go";

interface TelegramLocationIntentRow {
  purpose: TelegramLocationIntentPurpose;
  plan_id: string;
  started_at: string;
  transport_override: Exclude<TransportPreference, "plan_recommended"> | null;
}

interface TelegramTaskReminderDeliveryRow {
  task_id: string;
  due_at: string;
  status: "attempting" | "retry_wait" | "delivered" | "failed";
  attempt_count: number;
  next_attempt_at: string | null;
}

interface TelegramItineraryReminderDeliveryRow {
  day_id: string;
  place_id: string;
  scheduled_time: string;
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

export type TelegramItineraryReminderAttempt = TelegramTaskReminderAttempt;
export type TelegramItineraryReminderFailureResult = TelegramTaskReminderFailureResult;

const TASK_REMINDER_CATCH_UP_MS = 30 * 60_000;
const TASK_REMINDER_ATTEMPT_LEASE_MS = 60_000;
const TASK_REMINDER_RETRY_DELAYS_MS = [60_000, 5 * 60_000] as const;
const ITINERARY_REMINDER_CATCH_UP_MS = 20 * 60_000;
const ITINERARY_REMINDER_ATTEMPT_LEASE_MS = 60_000;
const ITINERARY_REMINDER_RETRY_DELAYS_MS = [60_000, 5 * 60_000] as const;
const CURRENT_SCHEMA_VERSION = 19;

export interface DatabaseMaintenanceStatus {
  schemaVersion: number;
  latestSchemaVersion: number;
  integrity: "ok" | "failed";
  migrations: Array<{ version: number; name: string; appliedAt: string }>;
}

export interface DatabaseBackupResult {
  path: string;
  fileName: string;
  createdAt: string;
  schemaVersion: number;
  integrity: "ok";
}

/** Contains delivery state only. Coordinates are never stored here. */
export interface TelegramArrivalCheckinState {
  checkInSentAt: string;
  locationRequestedAt?: string;
  locationReceivedAt?: string;
}

/** Confirmed handoff delivery facts and timing inputs only; journey state is derived elsewhere. */
export interface TelegramRouteHandoffState {
  planId: string;
  offeredAt: string;
  openedAt?: string;
  routeDurationSeconds: number;
  waitBufferSeconds: number;
  safetyMarginSeconds: number;
  expectedArrivalAt: string;
  guidanceSentAt?: string;
  delayCount: number;
  lastDelayedAt?: string;
}

export class SqliteWorkspaceStore {
  private readonly database: DatabaseSync;
  private readonly databasePath: string;

  constructor(databasePath: string) {
    if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true });
    this.databasePath = databasePath;
    this.database = new DatabaseSync(databasePath);
    try {
      this.database.exec("PRAGMA foreign_keys = ON;");
      this.migrate();
      this.seedIfEmpty();
    } catch (error) {
      this.database.close();
      throw error;
    }
  }

  close(): void {
    this.database.close();
  }

  getDatabaseMaintenanceStatus(): DatabaseMaintenanceStatus {
    const migrations = this.database.prepare("SELECT version, name, applied_at FROM schema_migrations ORDER BY version").all() as unknown as Array<{ version: number; name: string; applied_at: string }>;
    const integrity = this.database.prepare("PRAGMA integrity_check").get() as Record<string, unknown> | undefined;
    return {
      schemaVersion: migrations.at(-1)?.version ?? 0,
      latestSchemaVersion: CURRENT_SCHEMA_VERSION,
      integrity: Object.values(integrity ?? {})[0] === "ok" ? "ok" : "failed",
      migrations: migrations.map((migration) => ({ version: migration.version, name: migration.name, appliedAt: migration.applied_at }))
    };
  }

  /** Creates a consistent SQLite snapshot without exposing it to Agent or Connector code. */
  createBackup(now = new Date()): DatabaseBackupResult {
    if (this.databasePath === ":memory:") throw new Error("An in-memory workspace cannot be backed up.");
    if (!Number.isFinite(now.getTime())) throw new Error("A backup needs a valid creation time.");
    const current = this.getDatabaseMaintenanceStatus();
    if (current.integrity !== "ok" || current.schemaVersion !== CURRENT_SCHEMA_VERSION) throw new Error("The workspace must pass integrity and schema checks before backup.");
    const createdAt = now.toISOString();
    const fileName = `c-assistant-${createdAt.replaceAll(/[:.]/g, "-")}.sqlite`;
    const backupDirectory = join(dirname(this.databasePath), "backups");
    const path = join(backupDirectory, fileName);
    mkdirSync(backupDirectory, { recursive: true });
    if (existsSync(path)) throw new Error("A backup with this timestamp already exists.");
    this.database.exec(`VACUUM INTO '${path.replaceAll("'", "''")}'`);
    chmodSync(path, 0o600);

    const backup = new DatabaseSync(path, { readOnly: true });
    try {
      const integrity = backup.prepare("PRAGMA integrity_check").get() as Record<string, unknown> | undefined;
      const version = backup.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number | null } | undefined;
      if (Object.values(integrity ?? {})[0] !== "ok" || version?.version !== CURRENT_SCHEMA_VERSION) throw new Error("The created backup did not pass verification.");
    } catch (error) {
      backup.close();
      unlinkSync(path);
      throw error;
    } finally {
      if (backup.isOpen) backup.close();
    }
    return { path, fileName, createdAt, schemaVersion: CURRENT_SCHEMA_VERSION, integrity: "ok" };
  }

  getWorkspace(): WorkspaceSnapshot {
    const profile = this.database.prepare("SELECT display_name, preferred_language, nationality, gender, immigration_status, status FROM profiles WHERE id = 1").get() as ProfileRow | undefined;
    const runtime = this.database.prepare("SELECT selected_runtime FROM runtime_settings WHERE id = 1").get() as RuntimeSettingsRow | undefined;
    const activePlan = this.getCurrentPlan();
    if (!profile || !runtime || !activePlan) throw new Error("The local workspace is not initialized.");
    const executionPlan = this.getExecutionPlan();
    const planningSession = this.getPlanningSession();
    const latestPlanChange = this.getLatestAppliedPlanChange(activePlan.id);
    const latestPlanReplacement = this.getLatestPlanReplacementAudit(activePlan.id);
    const activeLineage = this.getPlanBlueprintLineage(activePlan.id);
    const activeBlueprint = activeLineage ? this.getTripBlueprint(activeLineage.blueprintId, activeLineage.blueprintVersion) : undefined;
    const presentedActivePlan = activeBlueprint ? { ...activePlan, presentation: blueprintPresentation(activeBlueprint) } : activePlan;

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
      activePlan: presentedActivePlan,
      ...(activeBlueprint ? { activeBlueprint } : {}),
      ...(planningSession ? { planningSession } : {}),
      ...(latestPlanChange ? { latestPlanChange } : {}),
      ...(latestPlanReplacement ? { latestPlanReplacement } : {}),
      ...(executionPlan && executionPlan.id !== activePlan.id ? { executionPlan } : {}),
      destinationArrivals: this.listPlanDestinationArrivals(activePlan.id),
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

  /** Adds one deduplicated attention item for a material current-weather condition on the executing Plan. */
  recordPlanWeatherAttention(input: { planId: string; destination: string; kind: "storm" | "snow_or_ice" | "heavy_rain" | "extreme_heat" | "extreme_cold" | "low_visibility"; observedAt: string; title: string; body: string }): boolean {
    const plan = this.getExecutionPlan();
    if (!plan || plan.id !== input.planId || plan.status !== "active") return false;
    const destination = input.destination.trim();
    const title = input.title.trim();
    const body = input.body.trim();
    if (!destination || !title || !body || !Number.isFinite(Date.parse(input.observedAt))) throw new Error("A Plan weather attention item needs a destination, observation time, title, and body.");
    const observedDay = input.observedAt.slice(0, 10);
    const destinationKey = encodeURIComponent(destination.toLocaleLowerCase()).slice(0, 120);
    const result = this.database.prepare("INSERT OR IGNORE INTO inbox_items (id, tone, title, body, timestamp, created_at) VALUES (?, 'attention', ?, ?, 'Just now', ?)").run(
      `plan-weather:${plan.id}:${destinationKey}:${observedDay}:${input.kind}`,
      title,
      body,
      new Date().toISOString()
    );
    return result.changes === 1;
  }

  /** Adds one deduplicated closure attention item for a monitored venue on the executing Plan. */
  recordPlanVenueAttention(input: { planId: string; placeId: string; status: "temporarily_closed" | "permanently_closed"; observedAt: string; title: string; body: string }): boolean {
    const plan = this.getExecutionPlan();
    if (!plan || plan.id !== input.planId || plan.status !== "active") return false;
    const placeId = input.placeId.trim();
    const title = input.title.trim();
    const body = input.body.trim();
    if (!placeId || !title || !body || !Number.isFinite(Date.parse(input.observedAt))) throw new Error("A Plan venue attention item needs a place, observation time, title, and body.");
    const observedDay = input.observedAt.slice(0, 10);
    const result = this.database.prepare("INSERT OR IGNORE INTO inbox_items (id, tone, title, body, timestamp, created_at) VALUES (?, 'attention', ?, ?, 'Just now', ?)").run(
      `plan-venue:${plan.id}:${encodeURIComponent(placeId).slice(0, 120)}:${observedDay}:${input.status}`,
      title,
      body,
      new Date().toISOString()
    );
    return result.changes === 1;
  }

  getPlanningSession(): PlanningSession | undefined {
    const row = this.database.prepare(`SELECT id, status, objective_type, messages_json, facts_json, unresolved_json, deferred_json, proposal_json, confirmed_proposal_version, output_plan_id, created_at, updated_at
      FROM planning_sessions WHERE status IN ('collecting', 'proposal_ready', 'proposal_confirmed', 'generating') ORDER BY updated_at DESC, rowid DESC LIMIT 1`).get() as PlanningSessionRow | undefined;
    return row ? planningSessionFromRow(row) : undefined;
  }

  createPlanningSession(objectiveType: PlanningSession["objectiveType"] = "travel", now = new Date()): PlanningSession {
    const createdAt = now.toISOString();
    this.database.prepare("UPDATE planning_sessions SET status = 'abandoned', updated_at = ? WHERE status IN ('collecting', 'proposal_ready', 'proposal_confirmed', 'generating')").run(createdAt);
    const session: PlanningSession = {
      id: randomUUID(),
      status: "collecting",
      objectiveType,
      messages: [],
      facts: [],
      unresolved: [],
      deferred: [],
      createdAt,
      updatedAt: createdAt
    };
    this.savePlanningSession(session);
    return session;
  }

  savePlanningSession(session: PlanningSession): PlanningSession {
    this.database.prepare(`INSERT INTO planning_sessions (id, status, objective_type, messages_json, facts_json, unresolved_json, deferred_json, proposal_json, confirmed_proposal_version, output_plan_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET status = excluded.status, objective_type = excluded.objective_type, messages_json = excluded.messages_json, facts_json = excluded.facts_json, unresolved_json = excluded.unresolved_json, deferred_json = excluded.deferred_json, proposal_json = excluded.proposal_json, confirmed_proposal_version = excluded.confirmed_proposal_version, output_plan_id = excluded.output_plan_id, updated_at = excluded.updated_at`).run(
      session.id,
      session.status,
      session.objectiveType,
      JSON.stringify(session.messages),
      JSON.stringify(session.facts),
      JSON.stringify(session.unresolved),
      JSON.stringify(session.deferred),
      session.proposal ? JSON.stringify(session.proposal) : null,
      session.confirmedProposalVersion ?? null,
      session.outputPlanId ?? null,
      session.createdAt,
      session.updatedAt
    );
    return session;
  }

  confirmPlanningSession(sessionId: string, proposalVersion: number): PlanningSession {
    const session = this.getPlanningSessionById(sessionId);
    if (!session) throw new Error("The planning session was not found.");
    if (session.status === "proposal_confirmed" && session.proposal?.version === proposalVersion && session.confirmedProposalVersion === proposalVersion) return session;
    if (session.status !== "proposal_ready" || !session.proposal || session.proposal.version !== proposalVersion) throw new Error("Confirm the latest planning proposal before generating a Plan.");
    const confirmed: PlanningSession = { ...session, status: "proposal_confirmed", confirmedProposalVersion: proposalVersion, updatedAt: new Date().toISOString() };
    return this.savePlanningSession(confirmed);
  }

  updatePlanningSessionStatus(sessionId: string, status: PlanningSession["status"], outputPlanId?: string): PlanningSession {
    const session = this.getPlanningSessionById(sessionId);
    if (!session) throw new Error("The planning session was not found.");
    const updated: PlanningSession = { ...session, status, updatedAt: new Date().toISOString(), ...(outputPlanId ? { outputPlanId } : {}) };
    return this.savePlanningSession(updated);
  }

  abandonPlanningSession(sessionId: string): PlanningSession {
    const session = this.getPlanningSessionById(sessionId);
    if (!session) throw new Error("The planning session was not found.");
    if (session.status === "draft_ready") throw new Error("A completed planning session cannot be abandoned.");
    return this.savePlanningSession({ ...session, status: "abandoned", updatedAt: new Date().toISOString() });
  }

  getPlanningSessionById(sessionId: string): PlanningSession | undefined {
    const row = this.database.prepare(`SELECT id, status, objective_type, messages_json, facts_json, unresolved_json, deferred_json, proposal_json, confirmed_proposal_version, output_plan_id, created_at, updated_at
      FROM planning_sessions WHERE id = ?`).get(sessionId) as PlanningSessionRow | undefined;
    return row ? planningSessionFromRow(row) : undefined;
  }

  listTravelBookingsForPlanningSession(sessionId: string): TravelBooking[] {
    return (this.database.prepare(`SELECT id, planning_session_id, plan_id, source_hash, status, type, content_json, created_at, updated_at
      FROM travel_bookings WHERE planning_session_id = ? ORDER BY created_at DESC, rowid DESC`).all(sessionId) as unknown as TravelBookingRow[]).map(travelBookingFromRow);
  }

  listTravelBookingsForPlan(planId: string): TravelBooking[] {
    return (this.database.prepare(`SELECT id, planning_session_id, plan_id, source_hash, status, type, content_json, created_at, updated_at
      FROM travel_bookings WHERE plan_id = ? ORDER BY created_at DESC, rowid DESC`).all(planId) as unknown as TravelBookingRow[]).map(travelBookingFromRow);
  }

  hasTravelBookingSourceHash(scope: { planningSessionId?: string; planId?: string }, sourceHash: string): boolean {
    const hash = sourceHash.trim();
    if (!hash) return false;
    if (scope.planningSessionId) {
      const row = this.database.prepare("SELECT id FROM travel_bookings WHERE planning_session_id = ? AND source_hash = ? LIMIT 1").get(scope.planningSessionId, hash);
      if (row) return true;
    }
    if (scope.planId) {
      const row = this.database.prepare("SELECT id FROM travel_bookings WHERE plan_id = ? AND source_hash = ? LIMIT 1").get(scope.planId, hash);
      if (row) return true;
    }
    return false;
  }

  saveTravelBooking(booking: TravelBooking): TravelBooking {
    if (!booking.planningSessionId && !booking.planId) throw new Error("A booking must belong to a Planning Session or Plan.");
    if (booking.planningSessionId && !this.getPlanningSessionById(booking.planningSessionId)) throw new Error("The planning session was not found.");
    if (booking.planId && !this.database.prepare("SELECT id FROM plans WHERE id = ?").get(booking.planId)) throw new Error("The Plan was not found.");
    this.database.prepare(`INSERT INTO travel_bookings (id, planning_session_id, plan_id, source_hash, status, type, content_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET planning_session_id = excluded.planning_session_id, plan_id = excluded.plan_id, source_hash = excluded.source_hash,
        status = excluded.status, type = excluded.type, content_json = excluded.content_json, updated_at = excluded.updated_at`).run(
      booking.id,
      booking.planningSessionId ?? null,
      booking.planId ?? null,
      booking.sourceHash,
      booking.status,
      booking.type,
      JSON.stringify(booking),
      booking.importedAt,
      booking.updatedAt
    );
    return booking;
  }

  saveProtectedBookingAttachment(input: { bookingId: string; sourceHash: string; sourceLabel: string; contentText: string; createdAt?: string }): void {
    const contentText = input.contentText.trim();
    if (!contentText) return;
    if (!this.database.prepare("SELECT id FROM travel_bookings WHERE id = ?").get(input.bookingId)) throw new Error("Protected Booking Attachment references a missing booking.");
    const createdAt = input.createdAt ?? new Date().toISOString();
    this.database.prepare(`INSERT INTO protected_booking_attachments (id, booking_id, source_hash, source_label, content_text, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(booking_id, source_hash) DO UPDATE SET source_label = excluded.source_label, content_text = excluded.content_text`).run(
      `protected-booking-${input.bookingId}-${input.sourceHash.slice(0, 16)}`,
      input.bookingId,
      input.sourceHash,
      input.sourceLabel.trim().slice(0, 160) || "Imported booking confirmation",
      contentText.slice(0, 80_000),
      createdAt
    );
  }

  countProtectedBookingAttachments(bookingId: string): number {
    const row = this.database.prepare("SELECT COUNT(*) AS count FROM protected_booking_attachments WHERE booking_id = ?").get(bookingId) as { count: number } | undefined;
    return row?.count ?? 0;
  }

  applyTravelBookingToCurrentPlan(booking: TravelBooking, expectedVersion?: number): WorkspaceSnapshot {
    if (!booking.planId) throw new Error("A Plan-linked booking is required.");
    const workspace = this.getWorkspace();
    const plan = workspace.activePlan.id === booking.planId ? workspace.activePlan : workspace.executionPlan?.id === booking.planId ? workspace.executionPlan : undefined;
    if (!plan) throw new Error("The Plan was not found.");
    if (expectedVersion !== undefined && plan.version !== expectedVersion) throw new Error("The Plan changed while the booking was being reviewed.");
    const knownInformation = uniqueStrings([...plan.knownInformation, ...travelBookingKnownInformation(booking)]);
    const assumptions = uniqueStrings([...plan.assumptions, ...travelBookingAssumptions(booking)]);
    const configuration = configurationWithTravelBooking(plan.configuration, booking);
    const nextAction = booking.segments.some((segment) => segment.constraintStrength === "hard")
      ? "Review the imported booking details. Structural hard constraints may need a replacement draft before they change the itinerary."
      : plan.nextAction;
    const updated = this.database.prepare(`UPDATE plans SET known_information_json = ?, assumptions_json = ?, configuration_json = ?, next_action = ?, version = version + 1
      WHERE id = ? AND version = ? AND is_current = 1`).run(
      JSON.stringify(knownInformation),
      JSON.stringify(assumptions),
      JSON.stringify(configuration),
      nextAction,
      plan.id,
      plan.version
    ) as { changes: number | bigint };
    if (Number(updated.changes) !== 1) throw new Error("The Plan changed while the booking was being saved.");
    this.addInbox({
      id: `booking-imported-${booking.id}`,
      tone: "notice",
      title: "Booking details added",
      body: `${booking.title} is linked to this Plan. Landi has not booked, paid, checked in, or changed anything externally.`,
      timestamp: "Just now"
    });
    return this.getWorkspace();
  }

  getBlueprintGeneration(generationKey: string): BlueprintGeneration | undefined {
    const row = this.database.prepare(`SELECT generation_key, session_id, proposal_version, skill_id, skill_version, status, stage,
      research_set_id, blueprint_id, blueprint_version, failure_json, created_at, updated_at
      FROM blueprint_generations WHERE generation_key = ?`).get(generationKey) as BlueprintGenerationRow | undefined;
    return row ? blueprintGenerationFromRow(row) : undefined;
  }

  saveBlueprintGeneration(generation: BlueprintGeneration): BlueprintGeneration {
    if (!generation.generationKey.trim() || !generation.proposalRef.sessionId.trim() || !Number.isInteger(generation.proposalRef.proposalVersion) || generation.proposalRef.proposalVersion < 1) throw new Error("Blueprint Generation needs a valid key and Proposal reference.");
    if (!generation.skillLineage.skillId.trim() || !generation.skillLineage.skillVersion.trim()) throw new Error("Blueprint Generation needs Skill lineage.");
    this.database.prepare(`INSERT INTO blueprint_generations (generation_key, session_id, proposal_version, skill_id, skill_version, status, stage,
      research_set_id, blueprint_id, blueprint_version, failure_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(generation_key) DO UPDATE SET status = excluded.status, stage = excluded.stage,
        research_set_id = COALESCE(excluded.research_set_id, blueprint_generations.research_set_id),
        blueprint_id = COALESCE(excluded.blueprint_id, blueprint_generations.blueprint_id),
        blueprint_version = COALESCE(excluded.blueprint_version, blueprint_generations.blueprint_version),
        failure_json = excluded.failure_json, updated_at = excluded.updated_at`).run(
      generation.generationKey,
      generation.proposalRef.sessionId,
      generation.proposalRef.proposalVersion,
      generation.skillLineage.skillId,
      generation.skillLineage.skillVersion,
      generation.status,
      generation.stage,
      generation.researchSetId ?? null,
      generation.blueprintId ?? null,
      generation.blueprintVersion ?? null,
      generation.failure ? JSON.stringify(generation.failure) : null,
      generation.createdAt,
      generation.updatedAt
    );
    return this.getBlueprintGeneration(generation.generationKey)!;
  }

  saveResearchSet(research: ResearchSet): ResearchSet {
    assertResearchSetIntegrity(research);
    const generation = this.getBlueprintGeneration(research.generationKey);
    if (!generation) throw new Error("Save Blueprint Generation before its Research Set.");
    if (generation.proposalRef.sessionId !== research.proposalRef.sessionId || generation.proposalRef.proposalVersion !== research.proposalRef.proposalVersion) throw new Error("Research Set does not match its confirmed Proposal.");
    if (generation.skillLineage.skillId !== research.skillLineage.skillId || generation.skillLineage.skillVersion !== research.skillLineage.skillVersion) throw new Error("Research Set does not match its Skill lineage.");
    this.database.exec("BEGIN");
    try {
      this.database.prepare(`INSERT INTO research_sets (id, generation_key, schema_version, status, content_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET status = excluded.status, content_json = excluded.content_json, updated_at = excluded.updated_at`).run(
        research.id, research.generationKey, research.schemaVersion, research.status, JSON.stringify(research), research.createdAt, research.updatedAt
      );
      this.database.prepare("UPDATE blueprint_generations SET research_set_id = ?, updated_at = ? WHERE generation_key = ?").run(research.id, research.updatedAt, research.generationKey);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return this.getResearchSet(research.id)!;
  }

  getResearchSet(id: string): ResearchSet | undefined {
    const row = this.database.prepare("SELECT id, generation_key, content_json FROM research_sets WHERE id = ?").get(id) as ResearchSetRow | undefined;
    return row ? JSON.parse(row.content_json) as ResearchSet : undefined;
  }

  getResearchSetByGenerationKey(generationKey: string): ResearchSet | undefined {
    const row = this.database.prepare("SELECT id, generation_key, content_json FROM research_sets WHERE generation_key = ?").get(generationKey) as ResearchSetRow | undefined;
    return row ? JSON.parse(row.content_json) as ResearchSet : undefined;
  }

  saveTripBlueprint(blueprint: TripBlueprint): TripBlueprint {
    const research = this.getResearchSet(blueprint.researchSetId);
    if (!research) throw new Error("Publish a Trip Blueprint only after its Research Set is saved.");
    if (research.generationKey !== blueprint.generationKey) throw new Error("Trip Blueprint does not belong to its Research Set Generation.");
    assertTripBlueprintIntegrity(blueprint, { expectedResearchPlaceIds: research.places.map((place) => place.id) });
    this.database.exec("BEGIN");
    try {
      this.database.prepare(`INSERT INTO trip_blueprints (id, version, generation_key, research_set_id, schema_version, content_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id, version) DO UPDATE SET content_json = excluded.content_json`).run(
        blueprint.id, blueprint.version, blueprint.generationKey, blueprint.researchSetId, blueprint.schemaVersion, JSON.stringify(blueprint), blueprint.createdAt
      );
      this.database.prepare("UPDATE blueprint_generations SET blueprint_id = ?, blueprint_version = ?, stage = 'compile', updated_at = ? WHERE generation_key = ?").run(blueprint.id, blueprint.version, blueprint.createdAt, blueprint.generationKey);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return this.getTripBlueprint(blueprint.id, blueprint.version)!;
  }

  getTripBlueprint(id: string, version: number): TripBlueprint | undefined {
    const row = this.database.prepare("SELECT id, version, generation_key, research_set_id, content_json FROM trip_blueprints WHERE id = ? AND version = ?").get(id, version) as TripBlueprintRow | undefined;
    return row ? JSON.parse(row.content_json) as TripBlueprint : undefined;
  }

  getTripBlueprintByGenerationKey(generationKey: string): TripBlueprint | undefined {
    const row = this.database.prepare("SELECT id, version, generation_key, research_set_id, content_json FROM trip_blueprints WHERE generation_key = ? ORDER BY version DESC LIMIT 1").get(generationKey) as TripBlueprintRow | undefined;
    return row ? JSON.parse(row.content_json) as TripBlueprint : undefined;
  }

  savePlanBlueprintLineage(lineage: PlanBlueprintLineage): PlanBlueprintLineage {
    const existing = this.getPlanBlueprintLineageByCompilationKey(lineage.compilationKey);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(lineage)) throw new Error("Compilation Key already belongs to a different Plan lineage.");
      return existing;
    }
    const blueprint = this.getTripBlueprint(lineage.blueprintId, lineage.blueprintVersion);
    if (!blueprint) throw new Error("Plan lineage references a missing Trip Blueprint.");
    const plan = this.database.prepare("SELECT id, version FROM plans WHERE id = ?").get(lineage.planId) as { id: string; version: number } | undefined;
    if (!plan || plan.version !== lineage.planVersion) throw new Error("Plan lineage must reference the persisted Plan version.");
    this.database.prepare(`INSERT INTO plan_blueprint_lineage (plan_id, plan_version, blueprint_id, blueprint_version, compiler_version, compilation_key, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(lineage.planId, lineage.planVersion, lineage.blueprintId, lineage.blueprintVersion, lineage.compilerVersion, lineage.compilationKey, lineage.createdAt);
    return this.getPlanBlueprintLineage(lineage.planId)!;
  }

  getPlanBlueprintLineage(planId: string): PlanBlueprintLineage | undefined {
    const row = this.database.prepare(`SELECT plan_id, plan_version, blueprint_id, blueprint_version, compiler_version, compilation_key, created_at
      FROM plan_blueprint_lineage WHERE plan_id = ?`).get(planId) as PlanBlueprintLineageRow | undefined;
    return row ? planBlueprintLineageFromRow(row) : undefined;
  }

  getPlanBlueprintLineageByCompilationKey(compilationKey: string): PlanBlueprintLineage | undefined {
    const row = this.database.prepare(`SELECT plan_id, plan_version, blueprint_id, blueprint_version, compiler_version, compilation_key, created_at
      FROM plan_blueprint_lineage WHERE compilation_key = ?`).get(compilationKey) as PlanBlueprintLineageRow | undefined;
    return row ? planBlueprintLineageFromRow(row) : undefined;
  }

  appendBlueprintGenerationEvent(input: Omit<BlueprintGenerationEvent, "id" | "sequence"> & { id?: string }): BlueprintGenerationEvent {
    if (!this.getBlueprintGeneration(input.generationKey)) throw new Error("Generation Event references a missing Blueprint Generation.");
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const sequence = ((this.database.prepare("SELECT MAX(sequence) AS sequence FROM blueprint_generation_events WHERE generation_key = ?").get(input.generationKey) as { sequence: number | null } | undefined)?.sequence ?? 0) + 1;
      const event: BlueprintGenerationEvent = { ...input, id: input.id ?? randomUUID(), sequence };
      this.database.prepare(`INSERT INTO blueprint_generation_events (id, generation_key, sequence, stage, status, scope_label, saved_place_count, detail, next_action, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(event.id, event.generationKey, event.sequence, event.stage, event.status, event.scopeLabel ?? null, event.savedPlaceCount ?? null, event.detail, event.nextAction ?? null, event.createdAt);
      this.database.exec("COMMIT");
      return event;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  getBlueprintGenerationEvents(generationKey: string, afterSequence = 0): BlueprintGenerationEvent[] {
    const rows = this.database.prepare(`SELECT id, generation_key, sequence, stage, status, scope_label, saved_place_count, detail, next_action, created_at
      FROM blueprint_generation_events WHERE generation_key = ? AND sequence > ? ORDER BY sequence`).all(generationKey, afterSequence) as unknown as BlueprintGenerationEventRow[];
    return rows.map(blueprintGenerationEventFromRow);
  }

  saveDiagnosticArtifact(input: { id?: string; generationKey: string; rawResponse: string; createdAt: string; expiresAt: string }): string {
    if (!this.getBlueprintGeneration(input.generationKey)) throw new Error("Diagnostic Artifact references a missing Blueprint Generation.");
    if (!Number.isFinite(Date.parse(input.createdAt)) || !Number.isFinite(Date.parse(input.expiresAt)) || Date.parse(input.expiresAt) <= Date.parse(input.createdAt)) throw new Error("Diagnostic Artifact needs a valid expiry.");
    const id = input.id ?? randomUUID();
    this.database.prepare("INSERT INTO blueprint_diagnostic_artifacts (id, generation_key, raw_response, created_at, expires_at) VALUES (?, ?, ?, ?, ?)").run(id, input.generationKey, input.rawResponse, input.createdAt, input.expiresAt);
    return id;
  }

  deleteExpiredDiagnosticArtifacts(now = new Date()): number {
    if (!Number.isFinite(now.getTime())) throw new Error("Diagnostic cleanup needs a valid time.");
    return Number(this.database.prepare("DELETE FROM blueprint_diagnostic_artifacts WHERE expires_at <= ?").run(now.toISOString()).changes);
  }

  getLatestAppliedPlanChange(planId: string): PlanChangeSet | undefined {
    const row = this.database.prepare(`SELECT id, plan_id, base_version, applied_version, kind, impact, status, stage_id, task_id, from_index, to_index, affected_task_ids_json, created_at, undone_at
      FROM plan_change_sets WHERE plan_id = ? AND status = 'applied' ORDER BY created_at DESC, rowid DESC LIMIT 1`).get(planId) as PlanChangeSetRow | undefined;
    return row ? planChangeSetFromRow(row) : undefined;
  }

  getLatestPlanReplacementAudit(replacementPlanId: string): PlanReplacementAudit | undefined {
    const row = this.database.prepare(`SELECT id, source_plan_id, source_plan_version, replacement_plan_id, replacement_plan_version, impact,
      affected_areas_json, revalidation_scopes_json, preserved_completed_tasks_json, created_at
      FROM plan_replacement_audits WHERE replacement_plan_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`).get(replacementPlanId) as PlanReplacementAuditRow | undefined;
    return row ? planReplacementAuditFromRow(row) : undefined;
  }

  reorderPlanTask(input: { planId: string; taskId: string; direction: "up" | "down"; expectedVersion: number }): { workspace: WorkspaceSnapshot; change: PlanChangeSet } {
    const plan = this.getCurrentPlan();
    if (!plan || plan.id !== input.planId) throw new Error("The current Plan was not found.");
    if (plan.status !== "draft") throw new Error("Reorder a draft Plan before confirming it for execution.");
    if (plan.version !== input.expectedVersion) throw new Error("The Plan changed before this reorder was applied.");
    const selected = this.database.prepare(`SELECT tasks.stage_id, tasks.sort_order FROM tasks JOIN stages ON stages.id = tasks.stage_id
      WHERE tasks.id = ? AND stages.plan_id = ?`).get(input.taskId, input.planId) as { stage_id: string; sort_order: number } | undefined;
    if (!selected) throw new Error("The Plan task was not found.");
    const comparison = input.direction === "up" ? "<" : ">";
    const ordering = input.direction === "up" ? "DESC" : "ASC";
    const adjacent = this.database.prepare(`SELECT id, sort_order FROM tasks WHERE stage_id = ? AND sort_order ${comparison} ? ORDER BY sort_order ${ordering} LIMIT 1`).get(selected.stage_id, selected.sort_order) as { id: string; sort_order: number } | undefined;
    if (!adjacent) throw new Error(`The task is already at the ${input.direction === "up" ? "start" : "end"} of this section.`);
    const createdAt = new Date().toISOString();
    const change: PlanChangeSet = {
      id: randomUUID(),
      planId: input.planId,
      baseVersion: plan.version,
      appliedVersion: plan.version + 1,
      kind: "reorder_task",
      impact: "low",
      status: "applied",
      stageId: selected.stage_id,
      taskId: input.taskId,
      fromIndex: selected.sort_order,
      toIndex: adjacent.sort_order,
      affectedTaskIds: [input.taskId, adjacent.id],
      createdAt
    };
    this.database.exec("BEGIN");
    try {
      this.database.prepare("UPDATE tasks SET sort_order = ? WHERE id = ?").run(adjacent.sort_order, input.taskId);
      this.database.prepare("UPDATE tasks SET sort_order = ? WHERE id = ?").run(selected.sort_order, adjacent.id);
      this.database.prepare("UPDATE plans SET version = ? WHERE id = ?").run(change.appliedVersion, input.planId);
      this.database.prepare(`INSERT INTO plan_change_sets (id, plan_id, base_version, applied_version, kind, impact, status, stage_id, task_id, from_index, to_index, affected_task_ids_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(change.id, change.planId, change.baseVersion, change.appliedVersion, change.kind, change.impact, change.status, change.stageId, change.taskId, change.fromIndex, change.toIndex, JSON.stringify(change.affectedTaskIds), change.createdAt);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return { workspace: this.getWorkspace(), change };
  }

  undoPlanChange(input: { planId: string; changeId: string; expectedVersion: number }): WorkspaceSnapshot {
    const plan = this.getCurrentPlan();
    if (!plan || plan.id !== input.planId) throw new Error("The current Plan was not found.");
    if (plan.status !== "draft") throw new Error("Only draft Plan changes can be undone here.");
    if (plan.version !== input.expectedVersion) throw new Error("The Plan changed before this undo was applied.");
    const latest = this.getLatestAppliedPlanChange(input.planId);
    if (!latest || latest.id !== input.changeId) throw new Error("Only the latest Plan change can be undone.");
    const adjacentTaskId = latest.affectedTaskIds.find((taskId) => taskId !== latest.taskId);
    if (!adjacentTaskId) throw new Error("The Plan change cannot be reversed safely.");
    const undoneAt = new Date().toISOString();
    this.database.exec("BEGIN");
    try {
      this.database.prepare("UPDATE tasks SET sort_order = ? WHERE id = ? AND stage_id = ?").run(latest.fromIndex, latest.taskId, latest.stageId);
      this.database.prepare("UPDATE tasks SET sort_order = ? WHERE id = ? AND stage_id = ?").run(latest.toIndex, adjacentTaskId, latest.stageId);
      this.database.prepare("UPDATE plans SET version = version + 1 WHERE id = ?").run(input.planId);
      this.database.prepare("UPDATE plan_change_sets SET status = 'undone', undone_at = ? WHERE id = ?").run(undoneAt, latest.id);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return this.getWorkspace();
  }

  /** Saves one Connector-observed route fact without regenerating unrelated Plan content. */
  savePlanRouteRefresh(input: { planId: string; segmentId: string; expectedVersion: number; expectedBlueprintVersion?: number; observedAt: string; distanceMeters: number; durationSeconds?: number; originCoordinates: [number, number]; destinationCoordinates: [number, number]; provider: "google_maps" }): WorkspaceSnapshot {
    const workspace = this.getWorkspace();
    const plan = workspace.activePlan;
    if (plan.id !== input.planId || plan.version !== input.expectedVersion) throw new Error("The Plan changed before this route refresh was saved.");
    if (workspace.activeBlueprint && input.expectedBlueprintVersion !== undefined && workspace.activeBlueprint.version !== input.expectedBlueprintVersion) throw new Error("The Trip Blueprint changed before this route refresh was saved.");
    const sourcePresentation = routeRefreshPresentationForWorkspace(workspace);
    if (!Number.isFinite(Date.parse(input.observedAt)) || !Number.isInteger(input.distanceMeters) || input.distanceMeters <= 0 || (input.durationSeconds !== undefined && (!Number.isInteger(input.durationSeconds) || input.durationSeconds <= 0))) throw new Error("A refreshed route needs valid observed distance and duration facts.");
    if (![input.originCoordinates, input.destinationCoordinates].every(([longitude, latitude]) => Number.isFinite(longitude) && longitude >= -180 && longitude <= 180 && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90)) throw new Error("A refreshed route needs valid place coordinates.");
    const presentation = structuredClone(sourcePresentation);
    const segment = presentation.routeSegments.find((candidate) => candidate.id === input.segmentId);
    if (!segment) throw new Error("The Plan route segment was not found.");
    const origin = presentation.places.find((place) => place.id === segment.originPlaceId);
    const destination = presentation.places.find((place) => place.id === segment.destinationPlaceId);
    if (!origin || !destination) throw new Error("The Plan route segment references a missing place.");
    origin.coordinates = providerCoordinatesToPlanCoordinates(input.originCoordinates);
    destination.coordinates = providerCoordinatesToPlanCoordinates(input.destinationCoordinates);
    const { distanceMeters: _oldDistance, checkedAt: _oldCheckedAt, sourceRefs: _oldSourceRefs, ...stableSegment } = segment;
    const refreshed: PlanRouteSegment = {
      ...stableSegment,
      verification: "verified",
      distanceMeters: input.distanceMeters,
      ...(input.durationSeconds !== undefined
        ? { durationMinutes: Math.max(1, Math.round(input.durationSeconds / 60)) }
        : segment.durationMinutes !== undefined ? { durationMinutes: segment.durationMinutes } : {}),
      checkedAt: input.observedAt,
      sourceRefs: [input.provider]
    };
    presentation.routeSegments = presentation.routeSegments.map((candidate) => candidate.id === input.segmentId ? refreshed : candidate);
    if (workspace.activeBlueprint) {
      return this.saveBlueprintRouteRefresh({
        workspace,
        presentation,
        routes: [{
          segmentId: input.segmentId,
          observedAt: input.observedAt,
          distanceMeters: input.distanceMeters,
          ...(input.durationSeconds !== undefined ? { durationSeconds: input.durationSeconds } : {}),
          originCoordinates: input.originCoordinates,
          destinationCoordinates: input.destinationCoordinates
        }],
        provider: input.provider,
        observedAt: input.observedAt
      });
    }
    const updated = this.database.prepare("UPDATE plans SET presentation_json = ?, version = version + 1 WHERE id = ? AND version = ? AND is_current = 1").run(JSON.stringify(presentation), input.planId, input.expectedVersion);
    if (updated.changes !== 1) throw new Error("The Plan changed before this route refresh was saved.");
    this.addInbox({ id: `route-refreshed-${input.planId}-${input.segmentId}-${Date.now()}`, tone: "notice", title: "Route facts refreshed", body: "One Plan route segment was refreshed from Google Maps facts. No navigation, booking, or transport action was started.", timestamp: "Just now" });
    return this.getWorkspace();
  }

  /** Saves a best-effort batch of Connector-observed route facts after generation. */
  saveGeneratedPlanRouteRefresh(input: { planId: string; expectedVersion: number; expectedBlueprintVersion?: number; provider: "google_maps"; routes: Array<{ segmentId: string; observedAt: string; distanceMeters: number; durationSeconds?: number; originCoordinates: [number, number]; destinationCoordinates: [number, number]; geometry?: Array<[number, number]> }> }): { workspace: WorkspaceSnapshot; scheduleConflictDayIds: string[] } {
    if (!input.routes.length) return { workspace: this.getWorkspace(), scheduleConflictDayIds: [] };
    const workspace = this.getWorkspace();
    const plan = workspace.activePlan;
    if (plan.id !== input.planId || plan.version !== input.expectedVersion) throw new Error("The Plan changed before generated routes were saved.");
    if (workspace.activeBlueprint && input.expectedBlueprintVersion !== undefined && workspace.activeBlueprint.version !== input.expectedBlueprintVersion) throw new Error("The Trip Blueprint changed before generated routes were saved.");
    const presentation = structuredClone(routeRefreshPresentationForWorkspace(workspace));
    const routeById = new Map(input.routes.map((route) => [route.segmentId, route]));
    const validCoordinate = ([longitude, latitude]: [number, number]) => Number.isFinite(longitude) && longitude >= -180 && longitude <= 180 && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90;
    for (const route of input.routes) {
      if (!Number.isFinite(Date.parse(route.observedAt)) || !Number.isInteger(route.distanceMeters) || route.distanceMeters <= 0 || (route.durationSeconds !== undefined && (!Number.isInteger(route.durationSeconds) || route.durationSeconds <= 0))) throw new Error("Generated routes need valid observed distance and duration facts.");
      if (!validCoordinate(route.originCoordinates) || !validCoordinate(route.destinationCoordinates) || route.geometry?.some((point) => !validCoordinate(point))) throw new Error("Generated routes need valid map coordinates.");
    }
    const refreshedSegments = new Map(presentation.routeSegments.map((segment) => {
      const route = routeById.get(segment.id);
      if (!route) return [segment.id, segment] as const;
      const origin = presentation.places.find((place) => place.id === segment.originPlaceId);
      const destination = presentation.places.find((place) => place.id === segment.destinationPlaceId);
      if (!origin || !destination) throw new Error("A generated route references a missing place.");
      origin.coordinates = providerCoordinatesToPlanCoordinates(route.originCoordinates);
      destination.coordinates = providerCoordinatesToPlanCoordinates(route.destinationCoordinates);
      return [segment.id, {
        ...segment,
        verification: "verified",
        distanceMeters: route.distanceMeters,
        ...(route.durationSeconds !== undefined ? { durationMinutes: Math.max(1, Math.round(route.durationSeconds / 60)) } : {}),
        checkedAt: route.observedAt,
        sourceRefs: [input.provider],
        detail: route.durationSeconds !== undefined
          ? `Google Maps checked this ${segment.mode} segment at ${Math.max(1, Math.round(route.durationSeconds / 60))} minutes over ${(route.distanceMeters / 1000).toFixed(1)} km.`
          : `Google Maps checked this ${segment.mode} segment over ${(route.distanceMeters / 1000).toFixed(1)} km.`
      } satisfies PlanRouteSegment] as const;
    }));
    const scheduleConflictDayIds = new Set<string>();
    const shiftedStopsByDay = new Map<string, NonNullable<ItineraryDay["stops"]>>();
    for (const day of presentation.days) {
      const stops = (day.stops ?? []).map((stop) => ({ ...stop }));
      if (stops.length < 2 || stops.some((stop) => itineraryMinute(stop.time) === undefined)) continue;
      const originalStops = stops.map((stop) => ({ ...stop }));
      let conflict = false;
      for (let index = 0; index < stops.length - 1; index += 1) {
        const current = stops[index]!;
        const next = stops[index + 1]!;
        const origin = presentation.places.find((place) => place.id === current.placeId);
        const destination = presentation.places.find((place) => place.id === next.placeId);
        const segment = presentation.routeSegments.find((candidate) => candidate.dayId === day.id && candidate.originPlaceId === current.placeId && candidate.destinationPlaceId === next.placeId);
        const refreshed = segment ? refreshedSegments.get(segment.id) : undefined;
        if (!origin || !destination || !refreshed?.durationMinutes) continue;
        const earliest = itineraryMinute(current.time)! + (origin.durationMinutes ?? 0) + refreshed.durationMinutes;
        const nextMinute = itineraryMinute(next.time)!;
        if (earliest <= nextMinute) continue;
        if (fixedItineraryStop(next.role, destination.priority) || earliest >= 24 * 60) {
          conflict = true;
          break;
        }
        next.time = itineraryTime(earliest);
      }
      if (conflict) {
        scheduleConflictDayIds.add(day.id);
        shiftedStopsByDay.set(day.id, originalStops);
      } else {
        shiftedStopsByDay.set(day.id, stops);
      }
    }
    presentation.routeSegments = presentation.routeSegments.map((segment) => {
      const refreshed = refreshedSegments.get(segment.id) ?? segment;
      if (!scheduleConflictDayIds.has(segment.dayId ?? "") || !routeById.has(segment.id)) return refreshed;
      const route = routeById.get(segment.id)!;
      const observedMinutes = route.durationSeconds !== undefined ? Math.max(1, Math.round(route.durationSeconds / 60)) : undefined;
      return {
        ...refreshed,
        verification: "stale",
        ...(segment.durationMinutes ? { durationMinutes: segment.durationMinutes } : {}),
        detail: `Google Maps observed${observedMinutes ? ` about ${observedMinutes} minutes` : " a changed route"}, but applying it would conflict with a fixed itinerary time. Replan this day before execution.`
      };
    });
    presentation.days = presentation.days.map((day) => {
      const daySegments = presentation.routeSegments.filter((segment) => segment.dayId === day.id);
      const geometries = daySegments.map((segment) => routeById.get(segment.id)?.geometry).filter((geometry): geometry is Array<[number, number]> => Boolean(geometry?.length));
      const scheduleConflict = scheduleConflictDayIds.has(day.id);
      const stops = shiftedStopsByDay.get(day.id) ?? day.stops;
      const conflictConstraint = "Google Maps found a travel-time conflict with a fixed itinerary time; this day must be replanned before execution.";
      if (!daySegments.length || geometries.length !== daySegments.length) return {
        ...day,
        ...(stops ? { stops } : {}),
        ...(scheduleConflict ? { routeReview: { ...day.routeReview, fixedConstraints: [...new Set([...(day.routeReview?.fixedConstraints ?? []), conflictConstraint])] } } : {})
      };
      const routeGeometry = geometries.flatMap((geometry, index) => index === 0 ? geometry : geometry.slice(1));
      if (routeGeometry.length < 2) return day;
      const modes = new Set(daySegments.map((segment) => segment.mode));
      const reviewedAt = daySegments.map((segment) => segment.checkedAt).filter((value): value is string => Boolean(value)).sort().at(-1);
      return {
        ...day,
        ...(stops ? { stops } : {}),
        routeGeometry,
        routeGeometryMode: modes.size === 1 ? daySegments[0]!.mode : "mixed",
        ...(reviewedAt ? { routeGeometryReviewedAt: reviewedAt } : {}),
        routeReview: {
          ...day.routeReview,
          routingMethod: "Google Maps Routes",
          ...(scheduleConflict ? { fixedConstraints: [...new Set([...(day.routeReview?.fixedConstraints ?? []), conflictConstraint])] } : {})
        }
      };
    });
    if (workspace.activeBlueprint) {
      return {
        workspace: this.saveBlueprintRouteRefresh({
          workspace,
          presentation,
          routes: input.routes,
          provider: input.provider,
          observedAt: latestRouteObservedAt(input.routes)
        }),
        scheduleConflictDayIds: [...scheduleConflictDayIds]
      };
    }
    const updated = this.database.prepare("UPDATE plans SET presentation_json = ?, version = version + 1 WHERE id = ? AND version = ? AND is_current = 1").run(JSON.stringify(presentation), input.planId, input.expectedVersion);
    if (updated.changes !== 1) throw new Error("The Plan changed before generated routes were saved.");
    return { workspace: this.getWorkspace(), scheduleConflictDayIds: [...scheduleConflictDayIds] };
  }

  private saveBlueprintRouteRefresh(input: { workspace: WorkspaceSnapshot; presentation: PlanPresentation; routes: Array<{ segmentId: string; observedAt: string; distanceMeters: number; durationSeconds?: number; originCoordinates: [number, number]; destinationCoordinates: [number, number]; geometry?: Array<[number, number]> }>; provider: "google_maps"; observedAt: string }): WorkspaceSnapshot {
    const { workspace, presentation } = input;
    const plan = workspace.activePlan;
    const blueprint = workspace.activeBlueprint;
    const lineage = this.getPlanBlueprintLineage(plan.id);
    if (!blueprint || !lineage) throw new Error("Route refresh needs the current Trip Blueprint lineage.");
    const routeById = new Map(input.routes.map((route) => [route.segmentId, route]));
    const segmentById = new Map(presentation.routeSegments.map((segment) => [segment.id, segment]));
    const providerSource = routeRefreshProviderSource(input.provider, input.observedAt);
    const hasProviderSource = blueprint.sources.some((source) => source.id === providerSource.id);
    const nextBlueprint: TripBlueprint = {
      ...structuredClone(blueprint),
      version: blueprint.version + 1,
      createdAt: input.observedAt,
      sources: hasProviderSource
        ? blueprint.sources.map((source) => source.id === providerSource.id ? { ...source, retrievedAt: input.observedAt, status: "verified" } : source)
        : [...blueprint.sources, providerSource],
      places: blueprint.places.map((place) => {
        const originRoute = input.routes.find((route) => segmentById.get(route.segmentId)?.originPlaceId === place.id);
        const destinationRoute = input.routes.find((route) => segmentById.get(route.segmentId)?.destinationPlaceId === place.id);
        const coordinates = originRoute ? providerCoordinatesToPlanCoordinates(originRoute.originCoordinates) : destinationRoute ? providerCoordinatesToPlanCoordinates(destinationRoute.destinationCoordinates) : undefined;
        return coordinates ? { ...place, coordinates } : place;
      }),
      movements: blueprint.movements.map((movement) => {
        const route = routeById.get(movement.id);
        const segment = segmentById.get(movement.id);
        if (!route || !segment) return movement;
        const verification = segment.verification === "stale" ? "stale" : "verified";
        const durationMinutes = segment.durationMinutes ?? (route.durationSeconds !== undefined ? Math.max(1, Math.round(route.durationSeconds / 60)) : undefined);
        return {
          ...movement,
          status: verification,
          distanceMeters: route.distanceMeters,
          ...(durationMinutes ? { durationMinutes } : {}),
          ...(segment.label ?? movement.label ? { label: segment.label ?? movement.label } : {}),
          ...(segment.detail ?? movement.detail ? { detail: segment.detail ?? movement.detail } : {}),
          display: refreshedBlueprintMovementDisplay(movement, segment),
          evidence: [{
            sourceId: providerSource.id,
            status: "verified" as const,
            checkedAt: route.observedAt,
            supports: route.durationSeconds !== undefined ? ["route duration", "route distance"] : ["route distance"]
          }]
        } satisfies BlueprintMovement;
      }),
      days: blueprint.days.map((day) => {
        const displayDay = presentation.days.find((candidate) => candidate.id === day.id);
        if (!displayDay?.stops) return day;
        return {
          ...day,
          stops: displayDay.stops.map((stop) => ({ placeId: stop.placeId, order: stop.order, ...(stop.time ? { time: stop.time } : {}), ...(stop.role ? { role: stop.role } : {}) })),
          ...(day.blocks ? { blocks: updateBlueprintBlocksFromStops(day, displayDay.stops) } : {})
        };
      })
    };
    const saved = this.saveTripBlueprint(nextBlueprint);
    const nextPresentation = blueprintPresentation(saved);
    const nextPlanVersion = plan.version + 1;
    this.database.exec("BEGIN");
    try {
      const updated = this.database.prepare("UPDATE plans SET version = ?, known_information_json = ?, assumptions_json = ?, sources_json = ?, presentation_json = ? WHERE id = ? AND version = ? AND is_current = 1").run(
        nextPlanVersion,
        JSON.stringify(routeRefreshKnownInformation(plan.knownInformation, saved)),
        JSON.stringify(routeRefreshAssumptions(plan.assumptions, saved)),
        JSON.stringify(saved.sources.map((source) => ({ title: source.title, authority: source.authority, url: source.url, retrievedAt: source.retrievedAt }))),
        JSON.stringify(nextPresentation),
        plan.id,
        plan.version
      );
      if (updated.changes !== 1) throw new Error("The Plan changed before generated routes were saved.");
      const nextCompilationKey = `route-refresh:${lineage.compilerVersion.replaceAll(".", "-")}:${plan.id}:plan-v${nextPlanVersion}:blueprint-${saved.id}-v${saved.version}`;
      const lineageUpdated = this.database.prepare("UPDATE plan_blueprint_lineage SET plan_version = ?, blueprint_version = ?, compilation_key = ?, created_at = ? WHERE plan_id = ?").run(nextPlanVersion, saved.version, nextCompilationKey, input.observedAt, plan.id);
      if (lineageUpdated.changes !== 1) throw new Error("The Plan Blueprint lineage changed before generated routes were saved.");
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return this.getWorkspace();
  }

  /** Saves user-authored itinerary organization without pretending that routes were reverified. */
  savePlanPresentationEdits(input: { planId: string; expectedVersion: number; assignments: Record<string, string>; priorities: Record<string, string>; orders: Record<string, string[]> }): WorkspaceSnapshot {
    const workspace = this.getWorkspace();
    const plan = workspace.activePlan;
    if (plan.id !== input.planId || plan.version !== input.expectedVersion) throw new Error("The Plan changed before these itinerary edits were saved.");
    if (plan.status !== "draft" && plan.status !== "active") throw new Error("Only the current draft or active Plan can receive itinerary map edits.");
    if (!plan.presentation || plan.presentation.kind !== "itinerary") throw new Error("This Plan does not contain a structured itinerary presentation.");
    const presentation = structuredClone(plan.presentation);
    const placeIds = new Set(presentation.places.map((place) => place.id));
    const dayIds = new Set(presentation.days.map((day) => day.id));
    if (Object.keys(input.assignments).some((placeId) => !placeIds.has(placeId) || (input.assignments[placeId] && !dayIds.has(input.assignments[placeId]!)))) throw new Error("The itinerary assignment contains an unknown place or day.");
    if (Object.keys(input.priorities).some((placeId) => !placeIds.has(placeId) || !["must", "preferred", "nearby", "archive", "pending", "recheck", "booked"].includes(input.priorities[placeId]!))) throw new Error("The itinerary priority contains an unsupported value.");
    if (Object.entries(input.orders).some(([dayId, ids]) => !dayIds.has(dayId) || !Array.isArray(ids) || ids.some((placeId, index) => !placeIds.has(placeId) || ids.indexOf(placeId) !== index))) throw new Error("The itinerary order contains an unknown or duplicate place.");

    const originalDayByPlace = new Map(presentation.days.flatMap((day) => day.placeIds.map((placeId) => [placeId, day.id] as const)));
    const originalStopByPlace = new Map(presentation.days.flatMap((day) => (day.stops ?? []).map((stop) => [stop.placeId, stop] as const)));
    presentation.places = presentation.places.map((place) => input.priorities[place.id] ? { ...place, priority: input.priorities[place.id] as typeof place.priority } : place);
    const changedDayIds = new Set<string>();
    presentation.days = presentation.days.map((day) => {
      const requested = (input.orders[day.id] ?? []).filter((placeId) => input.assignments[placeId] === day.id);
      const unordered = presentation.places.map((place) => place.id).filter((placeId) => input.assignments[placeId] === day.id && !requested.includes(placeId));
      const nextPlaceIds = [...requested, ...unordered];
      const previousStops = new Map((day.stops ?? []).map((stop) => [stop.placeId, stop]));
      const availableTimes = nextPlaceIds.map((placeId) => originalStopByPlace.get(placeId)?.time).filter((time): time is string => Boolean(time)).sort();
      const usedTimes = new Set(nextPlaceIds.flatMap((placeId) => {
        const previous = originalStopByPlace.get(placeId);
        const place = presentation.places.find((candidate) => candidate.id === placeId);
        return previous?.time && place && fixedItineraryStop(previous.role, place.priority) ? [previous.time] : [];
      }));
      const changed = nextPlaceIds.join("\0") !== day.placeIds.join("\0");
      if (day.capacity !== undefined && nextPlaceIds.length > day.capacity) throw new Error(`The itinerary edit exceeds the capacity of ${day.label}.`);
      const wrongCity = nextPlaceIds.map((placeId) => presentation.places.find((place) => place.id === placeId)).find((place) => place?.city && day.city && !day.city.trim().toLocaleLowerCase().includes(place.city.trim().toLocaleLowerCase()));
      if (wrongCity) throw new Error(`The itinerary edit would move ${wrongCity.name} into a day for a different city.`);
      if (changed) changedDayIds.add(day.id);
      const { routeGeometry: _routeGeometry, routeGeometryMode: _routeGeometryMode, routeGeometryReviewedAt: _routeGeometryReviewedAt, routeReview: _routeReview, ...stableDay } = day;
      return {
        ...(changed ? stableDay : day),
        placeIds: nextPlaceIds,
        stops: nextPlaceIds.map((placeId, order) => {
          const previous = originalStopByPlace.get(placeId) ?? previousStops.get(placeId);
          const place = presentation.places.find((candidate) => candidate.id === placeId);
          const fixed = place ? fixedItineraryStop(previous?.role, place.priority) : false;
          const time = fixed && previous?.time
            ? previous.time
            : availableTimes.find((candidate) => !usedTimes.has(candidate));
          if (time) usedTimes.add(time);
          return { placeId, order: order + 1, ...(time ? { time } : {}), ...(previous?.role ? { role: previous.role } : {}) };
        }),
        anchors: (day.anchors ?? []).filter((placeId) => nextPlaceIds.includes(placeId)),
        candidates: (day.candidates ?? []).filter((placeId) => !nextPlaceIds.includes(placeId))
      };
    });
    for (const [placeId, previousDayId] of originalDayByPlace) {
      const nextDayId = input.assignments[placeId] || "";
      if (previousDayId !== nextDayId) {
        changedDayIds.add(previousDayId);
        if (nextDayId) changedDayIds.add(nextDayId);
      }
    }
    const existingRoutes = new Map(presentation.routeSegments.map((segment) => [`${segment.dayId ?? ""}\0${segment.originPlaceId}\0${segment.destinationPlaceId}`, segment] as const));
    presentation.routeSegments = presentation.days.flatMap((day) => day.placeIds.slice(0, -1).map((originPlaceId, index) => {
      const destinationPlaceId = day.placeIds[index + 1]!;
      const existing = existingRoutes.get(`${day.id}\0${originPlaceId}\0${destinationPlaceId}`);
      if (existing && !changedDayIds.has(day.id)) return existing;
      const reverse = existingRoutes.get(`${day.id}\0${destinationPlaceId}\0${originPlaceId}`);
      const mode = existing?.mode ?? reverse?.mode ?? editedItineraryRouteMode(plan.configuration.transport.preference);
      const durationMinutes = existing?.durationMinutes ?? reverse?.durationMinutes;
      return {
        id: existing?.id ?? `${day.id}-route-${index + 1}`,
        dayId: day.id,
        originPlaceId,
        destinationPlaceId,
        mode,
        verification: "needs_verification" as const,
        ...(durationMinutes ? { durationMinutes } : {}),
        sourceRefs: [],
        label: "The itinerary order changed, so this journey needs to be checked again.",
        detail: "Landi will recalculate this journey with the map service. The current duration is not treated as live routing until verification is complete."
      };
    }));
    presentation.days = presentation.days.map((day) => {
      if (!changedDayIds.has(day.id) || !day.stops?.length) return day;
      const stops = day.stops.map((stop) => ({ ...stop }));
      for (let index = 0; index < stops.length - 1; index += 1) {
        const current = stops[index]!;
        const next = stops[index + 1]!;
        const currentStart = itineraryMinute(current.time);
        if (currentStart === undefined) continue;
        const origin = presentation.places.find((place) => place.id === current.placeId);
        const destination = presentation.places.find((place) => place.id === next.placeId);
        const route = presentation.routeSegments.find((segment) => segment.dayId === day.id && segment.originPlaceId === current.placeId && segment.destinationPlaceId === next.placeId);
        const earliest = currentStart + (origin?.durationMinutes ?? 0) + (route?.durationMinutes ?? 30);
        const nextStart = itineraryMinute(next.time);
        if (nextStart !== undefined && nextStart >= earliest) continue;
        if (destination && fixedItineraryStop(next.role, destination.priority)) throw new Error(`The itinerary order conflicts with the fixed time for ${destination.name}. Revise the time before moving this stop.`);
        if (earliest >= 24 * 60) throw new Error(`The itinerary edit would push ${destination?.name ?? next.placeId} beyond the end of the day.`);
        next.time = itineraryTime(earliest);
      }
      return { ...day, stops };
    });
    assertPlanPresentationIntegrity(presentation, { executionReady: false });
    const updated = this.database.prepare("UPDATE plans SET presentation_json = ?, version = version + 1 WHERE id = ? AND version = ? AND is_current = 1 AND status IN ('draft', 'active')").run(JSON.stringify(presentation), input.planId, input.expectedVersion);
    if (updated.changes !== 1) throw new Error("The Plan changed before these itinerary edits were saved.");
    this.addInbox({ id: `itinerary-edited-${input.planId}-${Date.now()}`, tone: "notice", title: "Travel Plan updated", body: "The map change was saved directly to the current Plan. Only affected itinerary days and routes were marked for refresh.", timestamp: "Just now" });
    return this.getWorkspace();
  }

  /** Returns archived Plan versions for read-only user review. */
  listHistoricalPlans(limit = 20): Plan[] {
    const safeLimit = Number.isInteger(limit) && limit > 0 && limit <= 100 ? limit : 20;
    const rows = this.database.prepare(`SELECT id, version, title, location, dates, status, known_information_json, assumptions_json, next_action, configuration_json, sources_json, presentation_json, created_at
      FROM plans WHERE is_current = 0 AND is_execution = 0 ORDER BY created_at DESC, rowid DESC LIMIT ?`).all(safeLimit) as unknown as PlanRow[];
    return rows.map((row) => this.planFromRow(row));
  }

  /** Permanently removes one archived Plan. Current or executing Plans are protected. */
  deleteHistoricalPlan(planId: string): boolean {
    const row = this.database.prepare("SELECT is_current, is_execution FROM plans WHERE id = ?").get(planId) as { is_current: number; is_execution: number } | undefined;
    if (!row) return false;
    if (row.is_current || row.is_execution) throw new Error("The current or executing Plan cannot be deleted from history.");
    return this.database.prepare("DELETE FROM plans WHERE id = ?").run(planId).changes > 0;
  }

  /** Permanently removes every archived Plan while protecting current and executing Plans. */
  clearHistoricalPlans(): number {
    return Number(this.database.prepare("DELETE FROM plans WHERE is_current = 0 AND is_execution = 0").run().changes);
  }

  /** Clears every user Plan and returns the workspace to its stable empty-Plan state. */
  resetPlansToEmptyState(): WorkspaceSnapshot {
    const placeholderPlan = createInitialWorkspace().activePlan;
    this.database.exec("BEGIN");
    try {
      this.database.prepare("DELETE FROM task_reminder_runs").run();
      this.database.prepare("DELETE FROM telegram_reminder_deliveries").run();
      this.database.prepare("DELETE FROM telegram_task_reminder_deliveries").run();
      this.database.prepare("DELETE FROM telegram_itinerary_reminder_deliveries").run();
      this.database.prepare("DELETE FROM telegram_location_intent").run();
      this.database.prepare("UPDATE agent_runs SET output_plan_id = NULL").run();
      this.database.prepare("DELETE FROM plans").run();
      this.insertCurrentPlan(placeholderPlan);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return this.getWorkspace();
  }

  /** Discards the current unconfirmed draft, preserving an executing Plan or returning to an empty workspace. */
  discardCurrentDraft(planId: string): WorkspaceSnapshot {
    const current = this.database.prepare("SELECT id, status, is_current, is_execution FROM plans WHERE id = ?").get(planId) as { id: string; status: Plan["status"]; is_current: number; is_execution: number } | undefined;
    if (!current || !current.is_current) throw new Error("The current draft Plan was not found.");
    if (current.status !== "draft" || current.is_execution) throw new Error("Only an unconfirmed draft Plan can be discarded.");
    const fallback = this.database.prepare(`SELECT id FROM plans
      WHERE id <> ? AND is_execution = 1
      ORDER BY rowid DESC LIMIT 1`).get(planId) as { id: string } | undefined;
    this.database.exec("BEGIN");
    try {
      this.database.prepare("UPDATE planning_sessions SET status = 'abandoned', output_plan_id = NULL, updated_at = ? WHERE output_plan_id = ?").run(new Date().toISOString(), planId);
      this.database.prepare("UPDATE agent_runs SET output_plan_id = NULL WHERE output_plan_id = ?").run(planId);
      this.database.prepare("DELETE FROM plans WHERE id = ?").run(planId);
      this.database.prepare("DELETE FROM inbox_items WHERE id LIKE ?").run(`%${planId}%`);
      if (fallback) this.database.prepare("UPDATE plans SET is_current = 1 WHERE id = ?").run(fallback.id);
      else this.insertCurrentPlan(createInitialWorkspace().activePlan);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return this.getWorkspace();
  }

  /** Abandons the current active Plan and returns to an empty workspace while preserving historical Plans. */
  abandonActivePlan(planId: string): WorkspaceSnapshot {
    const current = this.database.prepare("SELECT id, status, is_current, is_execution FROM plans WHERE id = ?").get(planId) as { id: string; status: Plan["status"]; is_current: number; is_execution: number } | undefined;
    if (!current || !current.is_current || !current.is_execution) throw new Error("The active Plan was not found.");
    if (current.status !== "active") throw new Error("Only the active Plan can be abandoned.");
    const abandonedAt = new Date().toISOString();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare(`UPDATE task_reminder_runs SET status = 'cancelled', finished_at = ?, updated_at = ?
        WHERE plan_id = ? AND status IN ('running', 'retry_wait')`).run(abandonedAt, abandonedAt, planId);
      this.database.prepare("UPDATE telegram_plan_change_proposals SET status = 'cancelled', resolved_at = ? WHERE plan_id = ? AND status = 'pending'").run(abandonedAt, planId);
      this.database.prepare("UPDATE planning_sessions SET status = 'abandoned', output_plan_id = NULL, updated_at = ? WHERE output_plan_id = ?").run(abandonedAt, planId);
      this.database.prepare("UPDATE agent_runs SET output_plan_id = NULL WHERE output_plan_id = ?").run(planId);
      this.database.prepare("UPDATE plans SET status = 'cancelled', next_action = ?, is_current = 0, is_execution = 0 WHERE id = ? AND is_current = 1 AND is_execution = 1").run("This Plan was abandoned by the user.", planId);
      this.insertCurrentPlan(createInitialWorkspace().activePlan);
      this.addInbox({
        id: `plan-abandoned-${planId}-${Date.now()}`,
        tone: "notice",
        title: "Plan abandoned",
        body: "The active Plan was stopped. Reminders and execution guidance for it no longer run; the Plan remains in history for review.",
        timestamp: "Just now"
      });
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return this.getWorkspace();
  }

  /** Persists a user-owned preparation checklist item from the Web workspace. */
  setPlanTaskChecked(planId: string, taskId: string, checked: boolean): WorkspaceSnapshot {
    const task = this.database.prepare(`SELECT tasks.owner, tasks.status, tasks.title, tasks.description, tasks.due_label, tasks.preparation_category, stages.title AS stage_title
      FROM tasks JOIN stages ON stages.id = tasks.stage_id JOIN plans ON plans.id = stages.plan_id
      WHERE tasks.id = ? AND plans.id = ? AND plans.is_current = 1`).get(taskId, planId) as { owner: Task["owner"]; status: Task["status"]; title: string; description: string | null; due_label: string; preparation_category: Task["preparationCategory"] | null; stage_title: string } | undefined;
    if (!task) throw new Error("The current Plan task was not found.");
    if (!isPreDepartureChecklistTask({ owner: task.owner, title: task.title, ...(task.description ? { description: task.description } : {}), dueLabel: task.due_label, ...(task.preparation_category ? { preparationCategory: task.preparation_category } : {}) }, task.stage_title)) {
      throw new Error("Only packing items and pre-departure tasks can be checked here.");
    }
    const nextStatus: Task["status"] = checked ? "completed" : "waiting_user";
    if (task.status !== nextStatus) {
      this.database.prepare("UPDATE tasks SET status = ? WHERE id = ?").run(nextStatus, taskId);
      this.database.prepare("UPDATE plans SET version = version + 1 WHERE id = ?").run(planId);
    }
    return this.getWorkspace();
  }

  /** Returns the Plan whose reminders and timeline are currently allowed to execute. */
  getExecutionPlan(): Plan | undefined {
    const plan = this.database.prepare(`SELECT id, version, title, location, dates, status, known_information_json, assumptions_json, next_action, configuration_json, sources_json, presentation_json, created_at
      FROM plans WHERE is_execution = 1 ORDER BY created_at DESC LIMIT 1`).get() as PlanRow | undefined;
    return plan ? this.planFromRow(plan) : undefined;
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
      this.database.prepare("DELETE FROM telegram_location_intent WHERE id = 1").run();
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

  claimWhatsAppMessage(messageId: string): boolean {
    const normalized = messageId.trim();
    if (!/^wamid\.[A-Za-z0-9._~:-]{1,240}$/.test(normalized)) throw new Error("WhatsApp message id is invalid.");
    const existing = this.database.prepare("SELECT message_id FROM whatsapp_processed_messages WHERE message_id = ?").get(normalized);
    if (existing) return false;
    this.database.prepare("INSERT INTO whatsapp_processed_messages (message_id, processed_at) VALUES (?, ?)").run(normalized, new Date().toISOString());
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

  claimTelegramItineraryReminderAttempt(input: { planId: string; reminderKey: string; dayId: string; placeId: string; scheduledTime: string; dueAt: string; now?: string }): TelegramItineraryReminderAttempt {
    const now = input.now ?? new Date().toISOString();
    const nowMs = Date.parse(now);
    const dueAtMs = Date.parse(input.dueAt);
    if (![input.planId, input.reminderKey, input.dayId, input.placeId].every((value) => value.trim()) || !/^\d{2}:\d{2}$/.test(input.scheduledTime) || !Number.isFinite(nowMs) || !Number.isFinite(dueAtMs)) throw new Error("An itinerary reminder attempt needs a Plan, stop, local time, and due time.");
    if (nowMs < dueAtMs || nowMs > dueAtMs + ITINERARY_REMINDER_CATCH_UP_MS) return { claimed: false };
    if (!this.itineraryReminderStillCurrent(input)) return { claimed: false };
    const existing = this.database.prepare(`SELECT day_id, place_id, scheduled_time, due_at, status, attempt_count, next_attempt_at
      FROM telegram_itinerary_reminder_deliveries WHERE plan_id = ? AND reminder_key = ?`).get(input.planId, input.reminderKey) as TelegramItineraryReminderDeliveryRow | undefined;
    const leaseUntil = new Date(nowMs + ITINERARY_REMINDER_ATTEMPT_LEASE_MS).toISOString();
    if (!existing) {
      this.database.prepare(`INSERT INTO telegram_itinerary_reminder_deliveries
        (plan_id, reminder_key, day_id, place_id, scheduled_time, due_at, status, attempt_count, next_attempt_at, last_failure_code, delivered_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'attempting', 1, ?, NULL, NULL, ?)`).run(input.planId, input.reminderKey, input.dayId, input.placeId, input.scheduledTime, input.dueAt, leaseUntil, now);
      return { claimed: true, attemptNumber: 1 };
    }
    if (existing.day_id !== input.dayId || existing.place_id !== input.placeId || existing.scheduled_time !== input.scheduledTime || existing.due_at !== input.dueAt || existing.status === "delivered" || existing.status === "failed" || existing.attempt_count >= 3) return { claimed: false };
    if (existing.next_attempt_at && Date.parse(existing.next_attempt_at) > nowMs) return { claimed: false };
    const attemptNumber = existing.attempt_count + 1;
    const updated = this.database.prepare(`UPDATE telegram_itinerary_reminder_deliveries SET status = 'attempting', attempt_count = ?, next_attempt_at = ?, updated_at = ?
      WHERE plan_id = ? AND reminder_key = ? AND status IN ('attempting', 'retry_wait') AND attempt_count = ?`).run(attemptNumber, leaseUntil, now, input.planId, input.reminderKey, existing.attempt_count);
    return updated.changes === 1 ? { claimed: true, attemptNumber } : { claimed: false };
  }

  recordTelegramItineraryReminderDelivered(input: { planId: string; reminderKey: string; dayId: string; placeId: string; scheduledTime: string; deliveredAt?: string }): void {
    const deliveredAt = input.deliveredAt ?? new Date().toISOString();
    if (!Number.isFinite(Date.parse(deliveredAt))) throw new Error("A delivered itinerary reminder needs a valid delivery time.");
    const updated = this.database.prepare(`UPDATE telegram_itinerary_reminder_deliveries SET status = 'delivered', next_attempt_at = NULL, delivered_at = ?, updated_at = ?
      WHERE plan_id = ? AND reminder_key = ? AND day_id = ? AND place_id = ? AND scheduled_time = ? AND status = 'attempting'`).run(deliveredAt, deliveredAt, input.planId, input.reminderKey, input.dayId, input.placeId, input.scheduledTime);
    if (updated.changes !== 1) throw new Error("The itinerary reminder delivery attempt is not active.");
  }

  recordTelegramItineraryReminderFailure(input: { planId: string; reminderKey: string; dayId: string; placeId: string; scheduledTime: string; failureCode: string; retryable: boolean; failedAt?: string }): TelegramItineraryReminderFailureResult {
    const failedAt = input.failedAt ?? new Date().toISOString();
    const failedAtMs = Date.parse(failedAt);
    if (!Number.isFinite(failedAtMs)) throw new Error("A failed itinerary reminder needs a valid failure time.");
    const row = this.database.prepare(`SELECT day_id, place_id, scheduled_time, due_at, status, attempt_count, next_attempt_at
      FROM telegram_itinerary_reminder_deliveries WHERE plan_id = ? AND reminder_key = ?`).get(input.planId, input.reminderKey) as TelegramItineraryReminderDeliveryRow | undefined;
    if (!row || row.day_id !== input.dayId || row.place_id !== input.placeId || row.scheduled_time !== input.scheduledTime || row.status !== "attempting") throw new Error("The itinerary reminder delivery attempt is not active.");
    const current = this.itineraryReminderStillCurrent(input);
    const failureCode = input.failureCode.trim().slice(0, 80) || "unknown_failure";
    const retryDelay = ITINERARY_REMINDER_RETRY_DELAYS_MS[row.attempt_count - 1];
    const nextAttemptAt = retryDelay === undefined ? undefined : new Date(failedAtMs + retryDelay).toISOString();
    const retryWithinWindow = nextAttemptAt !== undefined && Date.parse(nextAttemptAt) <= Date.parse(row.due_at) + ITINERARY_REMINDER_CATCH_UP_MS;
    if (current && input.retryable && row.attempt_count < 3 && retryWithinWindow) {
      this.database.prepare(`UPDATE telegram_itinerary_reminder_deliveries SET status = 'retry_wait', next_attempt_at = ?, last_failure_code = ?, updated_at = ?
        WHERE plan_id = ? AND reminder_key = ? AND status = 'attempting'`).run(nextAttemptAt, failureCode, failedAt, input.planId, input.reminderKey);
      return { status: "retry_scheduled", nextAttemptAt };
    }
    this.database.prepare(`UPDATE telegram_itinerary_reminder_deliveries SET status = 'failed', next_attempt_at = NULL, last_failure_code = ?, updated_at = ?
      WHERE plan_id = ? AND reminder_key = ? AND status = 'attempting'`).run(current ? failureCode : "reminder_cancelled", failedAt, input.planId, input.reminderKey);
    return { status: current ? "failed" : "cancelled" };
  }

  private itineraryReminderStillCurrent(input: { planId: string; dayId: string; placeId: string; scheduledTime: string }): boolean {
    const plan = this.getExecutionPlan();
    if (plan?.id !== input.planId || plan.status !== "active" || plan.presentation?.kind !== "itinerary") return false;
    const day = plan.presentation.days.find((candidate) => candidate.id === input.dayId);
    return Boolean(day?.stops?.some((stop) => stop.placeId === input.placeId && stop.time === input.scheduledTime));
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
    const executionPlan = this.getExecutionPlan();
    if (executionPlan?.id !== planId || executionPlan.status !== "active") return { claimed: false };
    const currentReminder = executionPlan.stages.flatMap((stage) => stage.tasks).find((task) => task.id === taskId)?.reminder;
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
    const executionPlan = this.getExecutionPlan();
    const taskTitle = input.taskTitle.trim();
    if (!taskTitle || !input.reminder.purpose.trim()) throw new Error("A delivered Task reminder needs its delivery-time Task context.");
    const currentTask = executionPlan?.stages.flatMap((stage) => stage.tasks).find((candidate) => candidate.id === input.taskId);
    const currentReminder = currentTask?.reminder;
    const currentMatch = executionPlan?.id === input.planId && executionPlan.status === "active" && Boolean(currentReminder && taskRemindersEqual(currentReminder, input.reminder));
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
    const executionPlan = this.getExecutionPlan();
    const currentReminder = executionPlan?.id === input.planId ? executionPlan.stages.flatMap((stage) => stage.tasks).find((task) => task.id === input.taskId)?.reminder : undefined;
    const currentMatch = executionPlan?.status === "active" && Boolean(currentReminder && taskRemindersEqual(currentReminder, input.reminder));
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
      const task = this.getExecutionPlan()?.stages.flatMap((stage) => stage.tasks).find((candidate) => candidate.id === input.taskId);
      this.addInbox({
        id: `task-reminder-failed-${input.planId}-${input.reminderKey}`,
        tone: "attention",
        title: `Reminder could not be sent${task ? `: ${task.title}` : ""}`,
        body: `Landi stopped after ${row.attempt_count} delivery attempt${row.attempt_count === 1 ? "" : "s"}. Review the current Plan; no external action was performed.`,
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

  recordPlanDestinationArrival(input: { planId: string; city: string; arrivedAt?: string }): DestinationArrivalEvent {
    const plan = this.getExecutionPlan();
    if (!plan || plan.id !== input.planId || plan.status !== "active") throw new Error("An arrival can be confirmed only for the active Plan.");
    if (!plan.presentation || plan.presentation.kind !== "itinerary") throw new Error("The active Plan has no itinerary destinations to confirm.");
    const requestedCity = input.city.trim();
    const canonicalCity = plan.presentation.days.flatMap((day) => day.city?.trim() ? [day.city.trim()] : []).find((city) => samePlanCity(city, requestedCity));
    if (!canonicalCity) throw new Error(`“${requestedCity}” is not a destination in the active Plan.`);
    const arrivedAt = input.arrivedAt ?? new Date().toISOString();
    if (!Number.isFinite(Date.parse(arrivedAt))) throw new Error("A destination arrival needs a valid confirmation time.");
    this.database.prepare(`INSERT INTO plan_destination_arrivals (plan_id, city, arrived_at, confirmed)
      VALUES (?, ?, ?, 1) ON CONFLICT(plan_id, city) DO UPDATE SET arrived_at = excluded.arrived_at, confirmed = 1`).run(plan.id, canonicalCity, arrivedAt);
    this.addInbox({
      id: `destination-arrival-${plan.id}-${encodeURIComponent(canonicalCity.toLocaleLowerCase())}`,
      tone: "ready",
      title: `Arrival confirmed: ${canonicalCity}`,
      body: `Current-destination weather and travel assistance now follow ${canonicalCity}. No continuous location tracking was enabled.`,
      timestamp: "Just now"
    });
    return { city: canonicalCity, arrivedAt, confirmed: true };
  }

  listPlanDestinationArrivals(planId: string): DestinationArrivalEvent[] {
    return (this.database.prepare(`SELECT city, arrived_at, confirmed FROM plan_destination_arrivals
      WHERE plan_id = ? ORDER BY arrived_at ASC`).all(planId.trim()) as unknown as PlanDestinationArrivalRow[]).map((row) => ({ city: row.city, arrivedAt: row.arrived_at, confirmed: row.confirmed === 1 }));
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

  recordTelegramRouteHandoffOffered(input: { planId: string; offeredAt: string; routeDurationSeconds: number; waitBufferSeconds: number; safetyMarginSeconds: number; expectedArrivalAt: string }): TelegramRouteHandoffState {
    const values = [input.routeDurationSeconds, input.waitBufferSeconds, input.safetyMarginSeconds];
    if (!input.planId.trim() || !Number.isFinite(Date.parse(input.offeredAt)) || !Number.isFinite(Date.parse(input.expectedArrivalAt)) || !values.every((value) => Number.isInteger(value) && value >= 0)) {
      throw new Error("A Telegram route handoff needs valid Plan and timing facts.");
    }
    this.database.prepare(`INSERT INTO telegram_route_handoffs
      (plan_id, offered_at, opened_at, route_duration_seconds, wait_buffer_seconds, safety_margin_seconds, expected_arrival_at, guidance_sent_at, delay_count, last_delayed_at)
      VALUES (?, ?, NULL, ?, ?, ?, ?, NULL, 0, NULL)
      ON CONFLICT(plan_id) DO UPDATE SET offered_at = excluded.offered_at, opened_at = NULL, route_duration_seconds = excluded.route_duration_seconds,
        wait_buffer_seconds = excluded.wait_buffer_seconds, safety_margin_seconds = excluded.safety_margin_seconds,
        expected_arrival_at = excluded.expected_arrival_at, guidance_sent_at = NULL, delay_count = 0, last_delayed_at = NULL`).run(
      input.planId.trim(), input.offeredAt, input.routeDurationSeconds, input.waitBufferSeconds, input.safetyMarginSeconds, input.expectedArrivalAt
    );
    return this.getTelegramRouteHandoff(input.planId)!;
  }

  getTelegramRouteHandoff(planId: string): TelegramRouteHandoffState | undefined {
    const row = this.database.prepare(`SELECT plan_id, offered_at, opened_at, route_duration_seconds, wait_buffer_seconds, safety_margin_seconds,
      expected_arrival_at, guidance_sent_at, delay_count, last_delayed_at FROM telegram_route_handoffs WHERE plan_id = ?`).get(planId.trim()) as TelegramRouteHandoffRow | undefined;
    return row ? telegramRouteHandoffFromRow(row) : undefined;
  }

  claimTelegramRouteArrivalGuidance(planId: string, now = new Date().toISOString()): TelegramRouteHandoffState | undefined {
    if (!planId.trim() || !Number.isFinite(Date.parse(now))) throw new Error("Route arrival guidance needs a Plan and valid time.");
    const result = this.database.prepare(`UPDATE telegram_route_handoffs SET guidance_sent_at = ?
      WHERE plan_id = ? AND guidance_sent_at IS NULL AND expected_arrival_at <= ?`).run(now, planId.trim(), now);
    return result.changes === 1 ? this.getTelegramRouteHandoff(planId) : undefined;
  }

  releaseTelegramRouteArrivalGuidance(planId: string, guidanceSentAt: string): boolean {
    if (!planId.trim() || !Number.isFinite(Date.parse(guidanceSentAt))) throw new Error("Route arrival guidance release needs a Plan and valid claim time.");
    const result = this.database.prepare("UPDATE telegram_route_handoffs SET guidance_sent_at = NULL WHERE plan_id = ? AND guidance_sent_at = ?").run(planId.trim(), guidanceSentAt);
    return result.changes === 1;
  }

  delayTelegramRouteArrivalGuidance(planId: string, delayedAt = new Date().toISOString(), delaySeconds = 15 * 60): TelegramRouteHandoffState | undefined {
    if (!planId.trim() || !Number.isFinite(Date.parse(delayedAt)) || !Number.isInteger(delaySeconds) || delaySeconds <= 0) throw new Error("A route delay needs valid Plan and timing values.");
    const expectedArrivalAt = new Date(Date.parse(delayedAt) + delaySeconds * 1_000).toISOString();
    const result = this.database.prepare(`UPDATE telegram_route_handoffs SET expected_arrival_at = ?, guidance_sent_at = NULL,
      delay_count = delay_count + 1, last_delayed_at = ? WHERE plan_id = ? AND guidance_sent_at IS NOT NULL`).run(expectedArrivalAt, delayedAt, planId.trim());
    return result.changes === 1 ? this.getTelegramRouteHandoff(planId) : undefined;
  }

  /** Marks only an explicitly arrival-triggered task as ready; completion stays user-owned. */
  activateArrivalTask(planId: string): Task | undefined {
    if (this.getExecutionPlan()?.id !== planId) throw new Error(`Plan ${planId} was not found.`);
    const selected = this.database.prepare(`SELECT t.id, t.title, t.owner, t.status, t.due_label, t.activation_trigger
      FROM tasks t JOIN stages s ON s.id = t.stage_id
      WHERE s.plan_id = ? AND t.activation_trigger = 'arrival' AND t.status IN ('scheduled', 'waiting_user')
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
    if (this.getExecutionPlan()?.id !== planId) throw new Error(`Plan ${planId} was not found.`);
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

  createGeneratedPlan(draft: GeneratedPlanDraft, runtime: AgentRuntimeKind = "codex", context?: { partySize?: number; transportPreference?: TransportPreference; expectedArrivalAtLocal?: string }): WorkspaceSnapshot {
    if (draft.presentation) assertPlanPresentationIntegrity(draft.presentation, { executionReady: false });
    const plan = createPlanFromDraft(draft);
    if (context?.partySize !== undefined) {
      if (!Number.isInteger(context.partySize) || context.partySize < 1 || context.partySize > 20) throw new Error("Party size must be a whole number from 1 to 20.");
      plan.configuration.travelContext.partySize = context.partySize;
    }
    if (context?.transportPreference !== undefined) {
      if (!["plan_recommended", "taxi", "public_transit", "walking"].includes(context.transportPreference)) throw new Error("Choose a supported transport preference.");
      plan.configuration.transport.preference = context.transportPreference;
    }
    if (context?.expectedArrivalAtLocal !== undefined) {
      if (!isLocalDateTime(context.expectedArrivalAtLocal)) throw new Error("Expected arrival must be a valid local date and time.");
      plan.configuration.arrival.expectedAtLocal = context.expectedArrivalAtLocal;
    }
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

  createCompiledBlueprintPlan(compilation: BlueprintPlanCompilation, runtime: AgentRuntimeKind = "codex"): WorkspaceSnapshot {
    const { plan, lineage } = compilation;
    if (lineage.planId !== plan.id || lineage.planVersion !== plan.version) throw new Error("Compilation Lineage does not match its Draft Plan.");
    const existing = this.getPlanBlueprintLineageByCompilationKey(lineage.compilationKey);
    if (existing) {
      if (existing.planId !== plan.id || existing.blueprintId !== lineage.blueprintId || existing.blueprintVersion !== lineage.blueprintVersion || existing.compilerVersion !== lineage.compilerVersion) throw new Error("Compilation Key already belongs to a different Draft Plan.");
      return this.getWorkspace();
    }
    const blueprint = this.getTripBlueprint(lineage.blueprintId, lineage.blueprintVersion);
    if (!blueprint) throw new Error("Compile a Draft Plan only from a published Trip Blueprint.");
    const presentablePlan = { ...plan, presentation: blueprintPresentation(blueprint) };
    this.database.exec("BEGIN");
    try {
      this.insertCurrentPlan(presentablePlan);
      this.database.prepare(`INSERT INTO plan_blueprint_lineage (plan_id, plan_version, blueprint_id, blueprint_version, compiler_version, compilation_key, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(lineage.planId, lineage.planVersion, lineage.blueprintId, lineage.blueprintVersion, lineage.compilerVersion, lineage.compilationKey, lineage.createdAt);
      this.database.prepare("UPDATE blueprint_generations SET status = 'completed', stage = 'ready', updated_at = ? WHERE blueprint_id = ? AND blueprint_version = ?").run(lineage.createdAt, lineage.blueprintId, lineage.blueprintVersion);
      this.addInbox({ id: `blueprint-plan-compiled-${plan.id}`, tone: "notice", title: `${runtimeDisplayName(runtime)} trip draft ready for review`, body: "The complete Trip Blueprint and its execution work are saved locally. Nothing will run before you confirm the Draft Plan.", timestamp: "Just now" });
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return this.getWorkspace();
  }

  applyDirectBlueprintRevision(input: { expectedPlanId: string; expectedVersion: number; expectedBlueprintVersion?: number; revision: DirectBlueprintRevision; runtime?: AgentRuntimeKind }): WorkspaceSnapshot {
    const batchInput: { expectedPlanId: string; expectedVersion: number; expectedBlueprintVersion?: number; revisions: DirectBlueprintRevision[]; runtime?: AgentRuntimeKind } = {
      expectedPlanId: input.expectedPlanId,
      expectedVersion: input.expectedVersion,
      revisions: [input.revision]
    };
    if (input.expectedBlueprintVersion !== undefined) batchInput.expectedBlueprintVersion = input.expectedBlueprintVersion;
    if (input.runtime) batchInput.runtime = input.runtime;
    return this.applyDirectBlueprintRevisionBatch(batchInput).workspace;
  }

  applyDirectBlueprintRevisionBatch(input: { expectedPlanId: string; expectedVersion: number; expectedBlueprintVersion?: number; revisions: DirectBlueprintRevision[]; runtime?: AgentRuntimeKind }): DirectBlueprintRevisionSaveResult {
    const workspace = this.getWorkspace();
    if (workspace.activePlan.id !== input.expectedPlanId || workspace.activePlan.version !== input.expectedVersion) throw new Error("The Plan changed before this Blueprint Revision was applied.");
    if (!workspace.activeBlueprint) throw new Error("Direct Blueprint Revision requires a current Trip Blueprint.");
    if (input.expectedBlueprintVersion !== undefined && workspace.activeBlueprint.version !== input.expectedBlueprintVersion) throw new Error("The Trip Blueprint changed before this Blueprint Revision was applied.");
    const result = applyDirectBlueprintRevisionBatchWithMetadata(workspace.activeBlueprint, input.revisions);
    const saved = this.saveTripBlueprint(result.blueprint);
    const compilation = compileTripBlueprint(saved, { createdAt: result.metadata.createdAt, completedRequirementIds: completedRequirementIdsForWorkspace(workspace) });
    return {
      workspace: this.createCompiledBlueprintPlan(compilation, input.runtime),
      revision: result.metadata
    };
  }

  saveGeneratedPlanArrivalTimeZone(input: { planId: string; expectedVersion: number; timeZone: string }): WorkspaceSnapshot {
    const workspace = this.getWorkspace();
    const plan = workspace.activePlan;
    if (plan.id !== input.planId || plan.version !== input.expectedVersion) throw new Error("The Plan changed before its arrival timezone was saved.");
    if (!plan.configuration.arrival.expectedAtLocal || !isTimeZoneName(input.timeZone)) throw new Error("A generated arrival timezone needs a valid local arrival time and IANA timezone.");
    const configuration = structuredClone(plan.configuration);
    configuration.arrival.timeZone = input.timeZone;
    const updated = this.database.prepare("UPDATE plans SET configuration_json = ?, version = version + 1 WHERE id = ? AND version = ? AND is_current = 1").run(JSON.stringify(configuration), input.planId, input.expectedVersion);
    if (updated.changes !== 1) throw new Error("The Plan changed before its arrival timezone was saved.");
    return this.getWorkspace();
  }

  reviseGeneratedPlan(input: { draft: GeneratedPlanDraft; runtime?: AgentRuntimeKind; expectedPlanId: string; expectedVersion: number; changeImpact?: PlanChangeImpactPreview }): WorkspaceSnapshot {
    if (input.draft.presentation) assertPlanPresentationIntegrity(input.draft.presentation, { executionReady: false });
    const workspace = this.getWorkspace();
    if (workspace.activePlan.id !== input.expectedPlanId || workspace.activePlan.version !== input.expectedVersion) {
      throw new Error("The Plan changed while its revision was being prepared.");
    }
    const plan = createPlanFromDraft(input.draft);
    plan.configuration = structuredClone(workspace.activePlan.configuration);
    plan.sources = structuredClone(workspace.activePlan.sources);
    const sourceArrivals = this.listPlanDestinationArrivals(workspace.activePlan.id);
    const preservedCompletedTasks = carryForwardCompletedTasks(workspace.activePlan, plan);
    const impact = input.changeImpact ?? defaultPlanChangeImpact(workspace.activePlan);
    if (impact.planId !== workspace.activePlan.id || impact.baseVersion !== workspace.activePlan.version) throw new Error("The Plan change impact no longer matches the current Plan version.");
    const audit: PlanReplacementAudit = {
      id: `replacement-${randomUUID()}`,
      sourcePlanId: workspace.activePlan.id,
      sourcePlanVersion: workspace.activePlan.version,
      replacementPlanId: plan.id,
      replacementPlanVersion: plan.version,
      impact: impact.impact,
      affectedAreas: structuredClone(impact.affectedAreas),
      revalidationScopes: revalidationScopesForAreas(impact.affectedAreas),
      preservedCompletedTasks,
      createdAt: new Date().toISOString()
    };
    this.database.exec("BEGIN");
    try {
      this.insertCurrentPlan(plan);
      const replacementCities = plan.presentation?.days.flatMap((day) => day.city?.trim() ? [day.city.trim()] : []) ?? [];
      for (const arrival of sourceArrivals) {
        const city = replacementCities.find((candidate) => samePlanCity(candidate, arrival.city));
        if (city) this.database.prepare(`INSERT INTO plan_destination_arrivals (plan_id, city, arrived_at, confirmed) VALUES (?, ?, ?, ?)`)
          .run(plan.id, city, arrival.arrivedAt, arrival.confirmed ? 1 : 0);
      }
      this.database.prepare(`INSERT INTO plan_replacement_audits
        (id, source_plan_id, source_plan_version, replacement_plan_id, replacement_plan_version, impact, affected_areas_json, revalidation_scopes_json, preserved_completed_tasks_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        audit.id, audit.sourcePlanId, audit.sourcePlanVersion, audit.replacementPlanId, audit.replacementPlanVersion, audit.impact,
        JSON.stringify(audit.affectedAreas), JSON.stringify(audit.revalidationScopes), JSON.stringify(audit.preservedCompletedTasks), audit.createdAt
      );
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    this.addInbox({
      id: `plan-revised-${plan.id}`,
      tone: "notice",
      title: `${runtimeDisplayName(input.runtime ?? "codex")} revised Plan draft saved locally`,
      body: "The previous draft remains in local history. Review this complete replacement draft before activation.",
      timestamp: "Just now"
    });
    return this.getWorkspace();
  }

  /** Atomically applies an already authorized Core compilation to the exact current draft version. */
  saveCompiledPlan(input: { plan: Plan; expectedPlanId: string; expectedVersion: number; audit: PlanCompilationAudit; skillRuns?: Array<Pick<CountryPackSkillRun, "skillId" | "skillVersion" | "status"> & { sourceEvidence?: SourceEvidenceRef[] }>; compiledAt?: string }): WorkspaceSnapshot {
    const compiledAt = input.compiledAt ?? new Date().toISOString();
    validateCompiledPlanWrite(input, compiledAt);
    const run: PlanCompilationRun = {
      id: `run-${randomUUID()}`,
      kind: "plan_compilation",
      planId: input.plan.id,
      countryPackId: input.audit.countryPackId,
      countryPackVersion: input.audit.countryPackVersion,
      compositionSkillId: input.audit.compositionSkillId,
      compositionSkillVersion: input.audit.compositionSkillVersion,
      sourcePlanVersion: input.audit.sourcePlanVersion,
      compiledPlanVersion: input.audit.compiledPlanVersion,
      taskCount: input.audit.taskCount,
      reminderCount: input.audit.reminderCount,
      compiledAt,
      sourceEvidence: structuredClone(input.audit.sourceEvidence)
    };
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const updated = this.database.prepare(`UPDATE plans SET version = ?, title = ?, location = ?, dates = ?, status = ?, known_information_json = ?, assumptions_json = ?, next_action = ?, configuration_json = ?, sources_json = ?
        WHERE id = ? AND version = ? AND status = 'draft' AND is_current = 1`).run(
        input.plan.version,
        input.plan.title,
        input.plan.location,
        input.plan.dates,
        input.plan.status,
        JSON.stringify(input.plan.knownInformation),
        JSON.stringify(input.plan.assumptions),
        input.plan.nextAction,
        JSON.stringify(input.plan.configuration),
        JSON.stringify(input.plan.sources),
        input.expectedPlanId,
        input.expectedVersion
      ) as { changes: number | bigint };
      if (Number(updated.changes) !== 1) throw new Error("The Plan changed before its compiled proposal could be saved.");
      this.database.prepare("DELETE FROM stages WHERE plan_id = ?").run(input.plan.id);
      this.insertPlanStages(input.plan);
      this.database.prepare(`INSERT INTO plan_compilation_runs
        (id, plan_id, country_pack_id, country_pack_version, composition_skill_id, composition_skill_version, source_plan_version, compiled_plan_version, task_count, reminder_count, compiled_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        run.id,
        run.planId,
        run.countryPackId,
        run.countryPackVersion,
        run.compositionSkillId,
        run.compositionSkillVersion,
        run.sourcePlanVersion,
        run.compiledPlanVersion,
        run.taskCount,
        run.reminderCount,
        run.compiledAt
      );
      this.insertCompilationRunEvidence(run.id, run.sourceEvidence);
      const insertSkillRun = this.database.prepare(`INSERT INTO country_pack_skill_runs
        (id, compilation_run_id, plan_id, source_plan_version, skill_id, skill_version, status, finished_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const skillRun of input.skillRuns ?? []) {
        const skillRunId = `run-${randomUUID()}`;
        insertSkillRun.run(skillRunId, run.id, run.planId, run.sourcePlanVersion, skillRun.skillId, skillRun.skillVersion, skillRun.status, compiledAt);
        this.insertSkillRunEvidence(skillRunId, skillRun.sourceEvidence ?? []);
      }
      this.addInbox({
        id: `plan-compiled-${input.plan.id}-${input.plan.version}`,
        tone: "notice",
        title: "Country Pack proposal compiled",
        body: "A new draft Plan version is ready for complete review. No Task, Reminder, or external action was activated.",
        timestamp: "Just now"
      });
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return this.getWorkspace();
  }

  listRecentPlanCompilationRuns(limit = 20): PlanCompilationRun[] {
    const safeLimit = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 100) : 20;
    return (this.database.prepare(`SELECT id, plan_id, country_pack_id, country_pack_version, composition_skill_id, composition_skill_version,
      source_plan_version, compiled_plan_version, task_count, reminder_count, compiled_at
      FROM plan_compilation_runs ORDER BY compiled_at DESC, rowid DESC LIMIT ?`).all(safeLimit) as unknown as PlanCompilationRunRow[]).map((row) => ({ ...planCompilationRunFromRow(row), sourceEvidence: this.listCompilationRunEvidence(row.id) }));
  }

  listRecentCountryPackSkillRuns(limit = 100): CountryPackSkillRun[] {
    const safeLimit = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 500) : 100;
    return (this.database.prepare(`SELECT id, compilation_run_id, plan_id, source_plan_version, skill_id, skill_version, status, finished_at
      FROM country_pack_skill_runs ORDER BY finished_at DESC, rowid DESC LIMIT ?`).all(safeLimit) as unknown as CountryPackSkillRunRow[]).map((row) => ({
      id: row.id,
      kind: "country_pack_skill",
      compilationRunId: row.compilation_run_id,
      planId: row.plan_id,
      sourcePlanVersion: row.source_plan_version,
      skillId: row.skill_id,
      skillVersion: row.skill_version,
      status: row.status,
      finishedAt: row.finished_at,
      sourceEvidence: this.listSkillRunEvidence(row.id)
    }));
  }

  private insertCompilationRunEvidence(runId: string, evidence: SourceEvidenceRef[]): void {
    const insert = this.database.prepare(`INSERT INTO plan_compilation_run_sources (compilation_run_id, source_snapshot_id, content_hash) VALUES (?, ?, ?)`);
    for (const source of evidence) {
      this.requireStoredEvidence(source);
      insert.run(runId, source.sourceSnapshotId, source.contentHash);
    }
  }

  private insertSkillRunEvidence(runId: string, evidence: SourceEvidenceRef[]): void {
    const insert = this.database.prepare(`INSERT INTO country_pack_skill_run_sources (skill_run_id, source_snapshot_id, content_hash) VALUES (?, ?, ?)`);
    for (const source of evidence) {
      this.requireStoredEvidence(source);
      insert.run(runId, source.sourceSnapshotId, source.contentHash);
    }
  }

  private requireStoredEvidence(evidence: SourceEvidenceRef): void {
    const found = this.database.prepare("SELECT 1 FROM source_snapshots WHERE id = ? AND content_hash = ?").get(evidence.sourceSnapshotId, evidence.contentHash);
    if (!found) throw new Error("Compilation evidence does not match a stored immutable source snapshot.");
  }

  private listCompilationRunEvidence(runId: string): SourceEvidenceRef[] {
    return this.database.prepare(`SELECT source_snapshot_id, content_hash FROM plan_compilation_run_sources WHERE compilation_run_id = ? ORDER BY rowid`).all(runId).map(evidenceFromRow);
  }

  private listSkillRunEvidence(runId: string): SourceEvidenceRef[] {
    return this.database.prepare(`SELECT source_snapshot_id, content_hash FROM country_pack_skill_run_sources WHERE skill_run_id = ? ORDER BY rowid`).all(runId).map(evidenceFromRow);
  }

  confirmPlan(planId: string): WorkspaceSnapshot {
    const workspace = this.getWorkspace();
    const confirmed = confirmPlan(workspace, planId);
    const previousExecution = this.getExecutionPlan();
    this.database.exec("BEGIN");
    try {
      if (previousExecution && previousExecution.id !== planId) {
        const switchedAt = new Date().toISOString();
        this.database.prepare(`UPDATE task_reminder_runs SET status = 'cancelled', finished_at = ?, updated_at = ?
          WHERE plan_id = ? AND status IN ('running', 'retry_wait')`).run(switchedAt, switchedAt, previousExecution.id);
      }
      this.database.prepare("UPDATE plans SET is_execution = 0 WHERE is_execution = 1").run();
      this.database.prepare("UPDATE plans SET status = ?, next_action = ?, is_execution = 1 WHERE id = ? AND is_current = 1").run(
        confirmed.activePlan.status,
        confirmed.activePlan.nextAction,
        planId
      );
      this.addInbox(confirmed.inbox[0]!);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return this.getWorkspace();
  }

  undoLatestPlanReplacement(input: { expectedPlanId: string; expectedVersion: number }): WorkspaceSnapshot {
    const workspace = this.getWorkspace();
    if (workspace.activePlan.id !== input.expectedPlanId || workspace.activePlan.version !== input.expectedVersion || workspace.activePlan.status !== "active") {
      throw new Error("The active Plan changed before this replacement could be undone.");
    }
    const audit = this.getLatestPlanReplacementAudit(workspace.activePlan.id);
    if (!audit || audit.replacementPlanVersion !== workspace.activePlan.version) throw new Error("There is no latest replacement activation to undo.");
    const source = this.database.prepare("SELECT id, status FROM plans WHERE id = ? AND is_current = 0 AND is_execution = 0").get(audit.sourcePlanId) as { id: string; status: Plan["status"] } | undefined;
    if (!source) throw new Error("The previous Plan is no longer available to restore.");
    const restoredAt = new Date().toISOString();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare(`UPDATE task_reminder_runs SET status = 'cancelled', finished_at = ?, updated_at = ?
        WHERE plan_id = ? AND status IN ('running', 'retry_wait')`).run(restoredAt, restoredAt, workspace.activePlan.id);
      this.database.prepare("UPDATE telegram_plan_change_proposals SET status = 'cancelled', resolved_at = ? WHERE plan_id = ? AND status = 'pending'").run(restoredAt, workspace.activePlan.id);
      this.database.prepare("UPDATE plans SET is_current = 0, is_execution = 0 WHERE id = ? AND is_current = 1 AND is_execution = 1").run(workspace.activePlan.id);
      const restored = this.database.prepare("UPDATE plans SET is_current = 1, is_execution = 1, status = 'active' WHERE id = ? AND is_current = 0 AND is_execution = 0").run(source.id);
      if (restored.changes !== 1) throw new Error("The previous Plan could not be restored atomically.");
      this.addInbox({
        id: `plan-replacement-undone-${audit.id}`,
        tone: "ready",
        title: "Latest Plan replacement undone",
        body: "The previous Plan is active again. Future assistance follows the restored Plan; no external action was performed.",
        timestamp: "Just now"
      });
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return this.getWorkspace();
  }

  updateProfile(input: ProfileUpdate): WorkspaceSnapshot {
    const displayName = input.displayName.trim();
    const preferredLanguage = input.preferredLanguage.trim();
    const nationality = input.nationality.trim();
    if (!displayName || !preferredLanguage || !nationality) throw new Error("Name, preferred language, and nationality are required.");
    if (displayName.length > 80 || preferredLanguage.length > 80 || nationality.length > 100) throw new Error("Keep each Profile text field concise.");
    if (!["not_specified", "woman", "man", "nonbinary", "prefer_not_to_say"].includes(input.gender)) throw new Error("Choose a supported gender setting.");
    if (!["unknown", "no_visa", "short_term_visitor", "tourist_visa", "student_visa", "work_visa", "residence_permit", "other"].includes(input.immigrationStatus)) throw new Error("Choose a supported immigration status setting.");

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

  startTelegramLocationIntent(input: { purpose: TelegramLocationIntentPurpose; planId: string; transportOverride?: Exclude<TransportPreference, "plan_recommended">; startedAt?: string }): void {
    if (!["arrival_route", "nearby_food", "uber_test", "movement_go"].includes(input.purpose)) throw new Error("Choose a supported Telegram location purpose.");
    const startedAt = input.startedAt ?? new Date().toISOString();
    if (!Number.isFinite(Date.parse(startedAt))) throw new Error("Telegram location use needs a valid start time.");
    const workspace = this.getWorkspace();
    if (workspace.activePlan.id !== input.planId && workspace.executionPlan?.id !== input.planId) throw new Error(`Plan ${input.planId} was not found.`);
    if (input.transportOverride && !["taxi", "public_transit", "walking"].includes(input.transportOverride)) throw new Error("Choose a supported temporary transport override.");
    if (input.transportOverride && input.purpose !== "arrival_route") throw new Error("A temporary transport override is only valid for an arrival route.");
    this.database.prepare("INSERT INTO telegram_location_intent (id, purpose, plan_id, started_at, transport_override) VALUES (1, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET purpose = excluded.purpose, plan_id = excluded.plan_id, started_at = excluded.started_at, transport_override = excluded.transport_override").run(input.purpose, input.planId, startedAt, input.transportOverride ?? null);
  }

  getTelegramLocationIntent(now = new Date().toISOString()): { purpose: TelegramLocationIntentPurpose; planId: string; transportOverride?: Exclude<TransportPreference, "plan_recommended"> } | undefined {
    const nowMs = Date.parse(now);
    if (!Number.isFinite(nowMs)) throw new Error("Telegram location use needs a valid current time.");
    const row = this.database.prepare("SELECT purpose, plan_id, started_at, transport_override FROM telegram_location_intent WHERE id = 1").get() as TelegramLocationIntentRow | undefined;
    if (!row) return undefined;
    if (nowMs - Date.parse(row.started_at) <= 15 * 60_000) return { purpose: row.purpose, planId: row.plan_id, ...(row.transport_override ? { transportOverride: row.transport_override } : {}) };
    this.clearTelegramLocationIntent();
    return undefined;
  }

  clearTelegramLocationIntent(): void {
    this.database.prepare("DELETE FROM telegram_location_intent WHERE id = 1").run();
  }

  createTelegramPlanChangeProposal(input: { planId: string; baseVersion: number; request: string; impact: PlanChangeImpactPreview; createdAt?: string }): TelegramPlanChangeProposal {
    const workspace = this.getWorkspace();
    if (workspace.activePlan.id !== input.planId || workspace.activePlan.version !== input.baseVersion || workspace.activePlan.status !== "active") {
      throw new Error("The active Plan changed before this Telegram proposal could be saved.");
    }
    const request = input.request.trim();
    if (!request || request.length > 1_500) throw new Error("A Telegram Plan change needs a request between 1 and 1500 characters.");
    if (input.impact.planId !== input.planId || input.impact.baseVersion !== input.baseVersion) throw new Error("The Telegram proposal impact does not match the active Plan version.");
    const createdAt = input.createdAt ?? new Date().toISOString();
    if (!Number.isFinite(Date.parse(createdAt))) throw new Error("A Telegram Plan change proposal needs a valid creation time.");
    const proposal: TelegramPlanChangeProposal = {
      id: `tg-change-${randomUUID()}`,
      planId: input.planId,
      baseVersion: input.baseVersion,
      request,
      impact: structuredClone(input.impact),
      status: "pending",
      createdAt
    };
    this.database.exec("BEGIN");
    try {
      this.database.prepare("UPDATE telegram_plan_change_proposals SET status = 'cancelled', resolved_at = ? WHERE status = 'pending'").run(createdAt);
      this.database.prepare(`INSERT INTO telegram_plan_change_proposals
        (id, plan_id, base_version, request, impact_json, status, created_at, resolved_at)
        VALUES (?, ?, ?, ?, ?, 'pending', ?, NULL)`).run(proposal.id, proposal.planId, proposal.baseVersion, proposal.request, JSON.stringify(proposal.impact), proposal.createdAt);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return proposal;
  }

  getTelegramPlanChangeProposal(id: string): TelegramPlanChangeProposal | undefined {
    const row = this.database.prepare(`SELECT id, plan_id, base_version, request, impact_json, status, created_at, resolved_at
      FROM telegram_plan_change_proposals WHERE id = ?`).get(id.trim()) as TelegramPlanChangeProposalRow | undefined;
    return row ? telegramPlanChangeProposalFromRow(row) : undefined;
  }

  resolveTelegramPlanChangeProposal(id: string, status: Exclude<TelegramPlanChangeProposal["status"], "pending">, resolvedAt = new Date().toISOString()): TelegramPlanChangeProposal {
    if (!Number.isFinite(Date.parse(resolvedAt))) throw new Error("A Telegram Plan change resolution needs a valid time.");
    const result = this.database.prepare(`UPDATE telegram_plan_change_proposals SET status = ?, resolved_at = ?
      WHERE id = ? AND status = 'pending'`).run(status, resolvedAt, id.trim());
    if (result.changes !== 1) throw new Error("The Telegram Plan change proposal is missing or already resolved.");
    return this.getTelegramPlanChangeProposal(id)!;
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
      body: `${runtimeDisplayName(input.kind)} is selected for future Plan drafts. Its login remains in the local CLI and is never stored by Landi.`,
      timestamp: "Just now"
    });
    return this.getWorkspace();
  }

  startPlanGenerationRun(input: { runtimeKind: AgentRuntimeKind; trigger: RunTrigger }): AgentRun {
    if (!isAgentRuntimeKind(input.runtimeKind)) throw new Error("Choose Codex or Claude Code for the recorded Plan run.");
    if (!isRunTrigger(input.trigger)) throw new Error("Choose Web, Telegram, or WhatsApp as the Plan run trigger.");
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

  recoverInterruptedPlanGenerations(finishedAt = new Date().toISOString()): { runs: number; sessions: number } {
    if (!Number.isFinite(Date.parse(finishedAt))) throw new Error("Interrupted Plan recovery needs a valid time.");
    this.database.exec("BEGIN");
    try {
      const runs = Number(this.database.prepare(`UPDATE agent_runs
        SET status = 'failed', finished_at = ?, failure_code = 'service_interrupted'
        WHERE status = 'running'`).run(finishedAt).changes);
      const sessions = Number(this.database.prepare(`UPDATE planning_sessions
        SET status = 'proposal_ready', updated_at = ?
        WHERE status IN ('generating', 'proposal_confirmed') AND proposal_json IS NOT NULL`).run(finishedAt).changes);
      this.database.exec("COMMIT");
      return { runs, sessions };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
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

  /** Adds a saved immutable official snapshot to the exact current draft version. */
  linkSourceSnapshotToPlan(planId: string, sourceSnapshotId: string): WorkspaceSnapshot {
    const workspace = this.getWorkspace();
    if (workspace.activePlan.id !== planId) throw new Error(`Plan ${planId} was not found.`);
    if (workspace.activePlan.status !== "draft") throw new Error("Official evidence can be linked only while the current Plan is a draft.");
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
    const updated = this.database.prepare("UPDATE plans SET sources_json = ?, version = version + 1 WHERE id = ? AND version = ? AND status = 'draft' AND is_current = 1").run(JSON.stringify(sources), planId, workspace.activePlan.version) as { changes: number | bigint };
    if (Number(updated.changes) !== 1) throw new Error("The Plan changed before official evidence could be linked.");
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

  /** Atomically saves a draft accommodation and its effect on each daily departure. */
  saveDraftAccommodationLinkage(input: { planId: string; expectedVersion: number; accommodation: PlanAccommodationInput; departures: Array<{ dayId: string; departure: NonNullable<import("@c-assistant/core").ItineraryDay["accommodationDeparture"]> }> }): WorkspaceSnapshot {
    const workspace = this.getWorkspace();
    const plan = workspace.activePlan;
    if (plan.id !== input.planId || plan.version !== input.expectedVersion) throw new Error("The Plan changed before this accommodation update was saved.");
    if (plan.status !== "draft") throw new Error("An active Plan must use a replacement draft before changing accommodation.");
    if (!plan.presentation || plan.presentation.kind !== "itinerary") throw new Error("This Plan does not contain a structured itinerary presentation.");
    const name = input.accommodation.name.trim();
    const address = input.accommodation.address.trim();
    const location = input.accommodation.location.trim();
    if (!name || !address || !location) throw new Error("Accommodation linkage needs a resolved name, address, and location.");
    const dayById = new Map(plan.presentation.days.map((day) => [day.id, day]));
    const placeIds = new Set(plan.presentation.places.map((place) => place.id));
    if (input.departures.some(({ dayId, departure }) => !dayById.has(dayId) || !placeIds.has(departure.destinationPlaceId) || departure.accommodationName !== name || departure.accommodationAddress !== address)) throw new Error("Accommodation departure facts do not match this Plan.");
    const departureByDay = new Map(input.departures.map((item) => [item.dayId, item.departure]));
    const presentation: PlanPresentation = {
      ...structuredClone(plan.presentation),
      days: plan.presentation.days.map((day) => {
        const { accommodationDeparture: _previous, ...stable } = day;
        const departure = departureByDay.get(day.id);
        return departure ? { ...stable, accommodationDeparture: departure } : stable;
      })
    };
    const configuration: PlanConfiguration = {
      ...plan.configuration,
      accommodation: {
        status: input.accommodation.status,
        ...(input.accommodation.id?.trim() ? { id: input.accommodation.id.trim() } : {}),
        name,
        address,
        location,
        source: input.accommodation.source,
        updatedAt: new Date().toISOString()
      }
    };
    const updated = this.database.prepare("UPDATE plans SET configuration_json = ?, presentation_json = ?, version = version + 1 WHERE id = ? AND version = ? AND is_current = 1 AND status = 'draft'").run(JSON.stringify(configuration), JSON.stringify(presentation), input.planId, input.expectedVersion);
    if (updated.changes !== 1) throw new Error("The Plan changed before this accommodation update was saved.");
    const verified = input.departures.filter((item) => item.departure.verification === "verified").length;
    this.addInbox({ id: `accommodation-linked-${input.planId}-${Date.now()}`, tone: verified === input.departures.length ? "ready" : "attention", title: "Accommodation linked to the Travel Plan", body: `${name} was saved. Departure routes were updated for ${verified} travel days, while ${input.departures.length - verified} still need verification.`, timestamp: "Just now" });
    return this.getWorkspace();
  }

  updatePlanTransportPreference(planId: string, input: PlanTransportPreferenceInput): WorkspaceSnapshot {
    const workspace = this.getWorkspace();
    const plan = workspace.activePlan.id === planId ? workspace.activePlan : workspace.executionPlan?.id === planId ? workspace.executionPlan : undefined;
    if (!plan) throw new Error(`Plan ${planId} was not found.`);
    if (!["plan_recommended", "taxi", "public_transit", "walking"].includes(input.preference)) throw new Error("Choose a supported transport preference.");
    const configuration: PlanConfiguration = {
      ...plan.configuration,
      transport: { preference: input.preference }
    };
    this.database.prepare("UPDATE plans SET configuration_json = ?, version = version + 1 WHERE id = ?").run(JSON.stringify(configuration), planId);
    this.addInbox({
      id: `transport-preference-${planId}-${Date.now()}`,
      tone: "notice",
      title: "Transport preference saved in this Plan",
      body: input.preference === "plan_recommended" ? "Landi will choose a transport approach from the Plan context when that capability is connected." : `This Plan now prefers ${input.preference.replaceAll("_", " ")}.`,
      timestamp: "Just now"
    });
    return this.getWorkspace();
  }

  updatePlanTravelContext(planId: string, input: PlanTravelContextInput): WorkspaceSnapshot {
    const workspace = this.getWorkspace();
    const plan = workspace.activePlan.id === planId ? workspace.activePlan : workspace.executionPlan?.id === planId ? workspace.executionPlan : undefined;
    if (!plan) throw new Error(`Plan ${planId} was not found.`);
    const partySize = input.partySize;
    if (partySize !== undefined && (!Number.isInteger(partySize) || partySize < 1 || partySize > 20)) throw new Error("Party size must be a whole number from 1 to 20.");
    if (!["unknown", "light", "standard", "heavy"].includes(input.luggage)) throw new Error("Choose a supported luggage level.");
    const configuration: PlanConfiguration = {
      ...plan.configuration,
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
    this.database.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    );`);
    const existingVersion = (this.database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number | null } | undefined)?.version ?? 0;
    if (existingVersion > CURRENT_SCHEMA_VERSION) throw new Error(`This Landi build supports schema ${CURRENT_SCHEMA_VERSION}, but the workspace uses schema ${existingVersion}.`);
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
        presentation_json TEXT,
        is_current INTEGER NOT NULL DEFAULT 0,
        is_execution INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS stages (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        presentation_kind TEXT NOT NULL DEFAULT 'details' CHECK (presentation_kind IN ('overview', 'itinerary', 'reservations', 'budget', 'transport', 'details')),
        origin_json TEXT,
        sort_order INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        stage_id TEXT NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT,
        owner TEXT NOT NULL,
        status TEXT NOT NULL,
        due_label TEXT NOT NULL,
        preparation_category TEXT,
        activation_trigger TEXT,
        reminder_json TEXT,
        requirement_id TEXT,
        origin_json TEXT,
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
        trigger TEXT NOT NULL CHECK (trigger IN ('web', 'telegram', 'whatsapp')),
        status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'fallback')),
        started_at TEXT NOT NULL,
        finished_at TEXT,
        output_plan_id TEXT,
        failure_code TEXT
      );
      CREATE TABLE IF NOT EXISTS planning_sessions (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL CHECK (status IN ('collecting', 'proposal_ready', 'proposal_confirmed', 'generating', 'draft_ready', 'failed', 'abandoned')),
        objective_type TEXT NOT NULL CHECK (objective_type IN ('travel', 'relocation', 'event', 'other')),
        messages_json TEXT NOT NULL,
        facts_json TEXT NOT NULL,
        unresolved_json TEXT NOT NULL,
        deferred_json TEXT NOT NULL,
        proposal_json TEXT,
        confirmed_proposal_version INTEGER,
        output_plan_id TEXT REFERENCES plans(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS travel_bookings (
        id TEXT PRIMARY KEY,
        planning_session_id TEXT REFERENCES planning_sessions(id) ON DELETE CASCADE,
        plan_id TEXT REFERENCES plans(id) ON DELETE CASCADE,
        source_hash TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'cancelled', 'needs_review')),
        type TEXT NOT NULL CHECK (type IN ('accommodation', 'flight', 'train', 'rental_car', 'event', 'tour', 'ticket', 'restaurant', 'other')),
        content_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (planning_session_id IS NOT NULL OR plan_id IS NOT NULL)
      );
      CREATE TABLE IF NOT EXISTS protected_booking_attachments (
        id TEXT PRIMARY KEY,
        booking_id TEXT NOT NULL REFERENCES travel_bookings(id) ON DELETE CASCADE,
        source_hash TEXT NOT NULL,
        source_label TEXT NOT NULL,
        content_text TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (booking_id, source_hash)
      );
      CREATE TABLE IF NOT EXISTS blueprint_generations (
        generation_key TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES planning_sessions(id) ON DELETE CASCADE,
        proposal_version INTEGER NOT NULL CHECK (proposal_version > 0),
        skill_id TEXT NOT NULL,
        skill_version TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled', 'superseded')),
        stage TEXT NOT NULL CHECK (stage IN ('queued', 'research', 'itinerary', 'import', 'compile', 'ready')),
        research_set_id TEXT,
        blueprint_id TEXT,
        blueprint_version INTEGER,
        failure_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS research_sets (
        id TEXT PRIMARY KEY,
        generation_key TEXT NOT NULL UNIQUE REFERENCES blueprint_generations(generation_key) ON DELETE CASCADE,
        schema_version INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('researching', 'completed', 'failed', 'cancelled', 'superseded')),
        content_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS trip_blueprints (
        id TEXT NOT NULL,
        version INTEGER NOT NULL CHECK (version > 0),
        generation_key TEXT NOT NULL REFERENCES blueprint_generations(generation_key) ON DELETE RESTRICT,
        research_set_id TEXT NOT NULL REFERENCES research_sets(id) ON DELETE RESTRICT,
        schema_version INTEGER NOT NULL,
        content_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (id, version)
      );
      CREATE TABLE IF NOT EXISTS plan_blueprint_lineage (
        plan_id TEXT PRIMARY KEY REFERENCES plans(id) ON DELETE CASCADE,
        plan_version INTEGER NOT NULL CHECK (plan_version > 0),
        blueprint_id TEXT NOT NULL,
        blueprint_version INTEGER NOT NULL,
        compiler_version TEXT NOT NULL,
        compilation_key TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        FOREIGN KEY (blueprint_id, blueprint_version) REFERENCES trip_blueprints(id, version) ON DELETE RESTRICT
      );
      CREATE TABLE IF NOT EXISTS blueprint_generation_events (
        id TEXT PRIMARY KEY,
        generation_key TEXT NOT NULL REFERENCES blueprint_generations(generation_key) ON DELETE CASCADE,
        sequence INTEGER NOT NULL CHECK (sequence > 0),
        stage TEXT NOT NULL CHECK (stage IN ('queued', 'research', 'itinerary', 'import', 'compile', 'ready')),
        status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled', 'superseded')),
        scope_label TEXT,
        saved_place_count INTEGER CHECK (saved_place_count IS NULL OR saved_place_count >= 0),
        detail TEXT NOT NULL,
        next_action TEXT,
        created_at TEXT NOT NULL,
        UNIQUE (generation_key, sequence)
      );
      CREATE TABLE IF NOT EXISTS blueprint_diagnostic_artifacts (
        id TEXT PRIMARY KEY,
        generation_key TEXT NOT NULL REFERENCES blueprint_generations(generation_key) ON DELETE CASCADE,
        raw_response TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS plan_change_sets (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
        base_version INTEGER NOT NULL,
        applied_version INTEGER NOT NULL,
        kind TEXT NOT NULL CHECK (kind = 'reorder_task'),
        impact TEXT NOT NULL CHECK (impact = 'low'),
        status TEXT NOT NULL CHECK (status IN ('applied', 'undone')),
        stage_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        from_index INTEGER NOT NULL,
        to_index INTEGER NOT NULL,
        affected_task_ids_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        undone_at TEXT
      );
      CREATE TABLE IF NOT EXISTS plan_replacement_audits (
        id TEXT PRIMARY KEY,
        source_plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
        source_plan_version INTEGER NOT NULL,
        replacement_plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
        replacement_plan_version INTEGER NOT NULL,
        impact TEXT NOT NULL CHECK (impact IN ('low', 'high')),
        affected_areas_json TEXT NOT NULL,
        revalidation_scopes_json TEXT NOT NULL,
        preserved_completed_tasks_json TEXT NOT NULL,
        created_at TEXT NOT NULL
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
      CREATE TABLE IF NOT EXISTS plan_compilation_runs (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
        country_pack_id TEXT NOT NULL,
        country_pack_version TEXT NOT NULL,
        composition_skill_id TEXT NOT NULL,
        composition_skill_version TEXT NOT NULL,
        source_plan_version INTEGER NOT NULL,
        compiled_plan_version INTEGER NOT NULL,
        task_count INTEGER NOT NULL,
        reminder_count INTEGER NOT NULL,
        compiled_at TEXT NOT NULL,
        UNIQUE (plan_id, compiled_plan_version)
      );
      CREATE TABLE IF NOT EXISTS country_pack_skill_runs (
        id TEXT PRIMARY KEY,
        compilation_run_id TEXT NOT NULL REFERENCES plan_compilation_runs(id) ON DELETE CASCADE,
        plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
        source_plan_version INTEGER NOT NULL,
        skill_id TEXT NOT NULL,
        skill_version TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('success', 'degraded', 'needs_input', 'blocked', 'failed', 'not_supported')),
        finished_at TEXT NOT NULL,
        UNIQUE (compilation_run_id, skill_id)
      );
      CREATE TABLE IF NOT EXISTS plan_compilation_run_sources (
        compilation_run_id TEXT NOT NULL REFERENCES plan_compilation_runs(id) ON DELETE CASCADE,
        source_snapshot_id TEXT NOT NULL REFERENCES source_snapshots(id) ON DELETE RESTRICT,
        content_hash TEXT NOT NULL,
        PRIMARY KEY (compilation_run_id, source_snapshot_id, content_hash)
      );
      CREATE TABLE IF NOT EXISTS country_pack_skill_run_sources (
        skill_run_id TEXT NOT NULL REFERENCES country_pack_skill_runs(id) ON DELETE CASCADE,
        source_snapshot_id TEXT NOT NULL REFERENCES source_snapshots(id) ON DELETE RESTRICT,
        content_hash TEXT NOT NULL,
        PRIMARY KEY (skill_run_id, source_snapshot_id, content_hash)
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
      CREATE TABLE IF NOT EXISTS telegram_location_intent (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        purpose TEXT NOT NULL CHECK (purpose IN ('arrival_route', 'nearby_food', 'uber_test', 'movement_go')),
        plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
        started_at TEXT NOT NULL,
        transport_override TEXT CHECK (transport_override IN ('taxi', 'public_transit', 'walking'))
      );
      CREATE TABLE IF NOT EXISTS telegram_processed_updates (
        update_id INTEGER PRIMARY KEY,
        processed_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS whatsapp_processed_messages (
        message_id TEXT PRIMARY KEY,
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
      CREATE TABLE IF NOT EXISTS telegram_itinerary_reminder_deliveries (
        plan_id TEXT NOT NULL,
        reminder_key TEXT NOT NULL,
        day_id TEXT NOT NULL,
        place_id TEXT NOT NULL,
        scheduled_time TEXT NOT NULL,
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
      CREATE TABLE IF NOT EXISTS plan_destination_arrivals (
        plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
        city TEXT NOT NULL,
        arrived_at TEXT NOT NULL,
        confirmed INTEGER NOT NULL CHECK (confirmed IN (0, 1)),
        PRIMARY KEY (plan_id, city)
      );
      CREATE TABLE IF NOT EXISTS telegram_route_handoffs (
        plan_id TEXT PRIMARY KEY REFERENCES plans(id) ON DELETE CASCADE,
        offered_at TEXT NOT NULL,
        opened_at TEXT,
        route_duration_seconds INTEGER NOT NULL CHECK (route_duration_seconds >= 0),
        wait_buffer_seconds INTEGER NOT NULL CHECK (wait_buffer_seconds >= 0),
        safety_margin_seconds INTEGER NOT NULL CHECK (safety_margin_seconds >= 0),
        expected_arrival_at TEXT NOT NULL,
        guidance_sent_at TEXT,
        delay_count INTEGER NOT NULL DEFAULT 0 CHECK (delay_count >= 0),
        last_delayed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS telegram_plan_change_proposals (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
        base_version INTEGER NOT NULL,
        request TEXT NOT NULL,
        impact_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'applied', 'cancelled', 'stale')),
        created_at TEXT NOT NULL,
        resolved_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_plans_current ON plans(is_current, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_stages_plan_order ON stages(plan_id, sort_order);
      CREATE INDEX IF NOT EXISTS idx_tasks_stage_order ON tasks(stage_id, sort_order);
      CREATE INDEX IF NOT EXISTS idx_inbox_created_at ON inbox_items(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_source_snapshots_latest ON source_snapshots(source_id, url, retrieved_at DESC);
      CREATE INDEX IF NOT EXISTS idx_agent_runs_recent ON agent_runs(started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_planning_sessions_recent ON planning_sessions(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_travel_bookings_session_recent ON travel_bookings(planning_session_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_travel_bookings_plan_recent ON travel_bookings(plan_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_travel_bookings_source_hash ON travel_bookings(source_hash);
      CREATE INDEX IF NOT EXISTS idx_protected_booking_attachments_booking ON protected_booking_attachments(booking_id);
      CREATE INDEX IF NOT EXISTS idx_blueprint_generations_recent ON blueprint_generations(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_trip_blueprints_generation_version ON trip_blueprints(generation_key, version DESC);
      CREATE INDEX IF NOT EXISTS idx_blueprint_generation_events_stream ON blueprint_generation_events(generation_key, sequence);
      CREATE INDEX IF NOT EXISTS idx_blueprint_diagnostic_expiry ON blueprint_diagnostic_artifacts(expires_at);
      CREATE INDEX IF NOT EXISTS idx_plan_change_sets_recent ON plan_change_sets(plan_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_plan_replacement_audits_recent ON plan_replacement_audits(replacement_plan_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_task_reminder_runs_recent ON task_reminder_runs(started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_plan_compilation_runs_recent ON plan_compilation_runs(compiled_at DESC);
      CREATE INDEX IF NOT EXISTS idx_country_pack_skill_runs_recent ON country_pack_skill_runs(finished_at DESC);
      CREATE INDEX IF NOT EXISTS idx_plan_compilation_run_sources_snapshot ON plan_compilation_run_sources(source_snapshot_id);
      CREATE INDEX IF NOT EXISTS idx_country_pack_skill_run_sources_snapshot ON country_pack_skill_run_sources(source_snapshot_id);
      CREATE INDEX IF NOT EXISTS idx_telegram_pairing_requests_active ON telegram_pairing_requests(consumed_at, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_telegram_task_reminders_due ON telegram_task_reminder_deliveries(status, next_attempt_at);
      CREATE INDEX IF NOT EXISTS idx_telegram_itinerary_reminders_due ON telegram_itinerary_reminder_deliveries(status, next_attempt_at);
      CREATE INDEX IF NOT EXISTS idx_telegram_arrival_checkins_follow_up ON telegram_arrival_checkins(location_requested_at, location_received_at, check_in_sent_at);
      CREATE INDEX IF NOT EXISTS idx_plan_destination_arrivals_recent ON plan_destination_arrivals(plan_id, arrived_at DESC);
      CREATE INDEX IF NOT EXISTS idx_telegram_route_handoffs_due ON telegram_route_handoffs(guidance_sent_at, expected_arrival_at);
      CREATE INDEX IF NOT EXISTS idx_telegram_plan_changes_pending ON telegram_plan_change_proposals(status, created_at DESC);
      PRAGMA optimize;
    `);
    const planColumns = this.database.prepare("PRAGMA table_info(plans)").all() as unknown as Array<{ name: string }>;
    if (!planColumns.some((column) => column.name === "configuration_json")) {
      this.database.exec("ALTER TABLE plans ADD COLUMN configuration_json TEXT NOT NULL DEFAULT '{\"accommodation\":{\"status\":\"not_set\"}}'");
    }
    if (!planColumns.some((column) => column.name === "presentation_json")) this.database.exec("ALTER TABLE plans ADD COLUMN presentation_json TEXT");
    if (!planColumns.some((column) => column.name === "is_execution")) this.database.exec("ALTER TABLE plans ADD COLUMN is_execution INTEGER NOT NULL DEFAULT 0");
    this.database.exec(`UPDATE plans SET is_execution = 1
      WHERE is_current = 1 AND status = 'active' AND NOT EXISTS (SELECT 1 FROM plans WHERE is_execution = 1);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_plans_execution ON plans(is_execution) WHERE is_execution = 1;
      PRAGMA optimize;`);
    const taskColumns = this.database.prepare("PRAGMA table_info(tasks)").all() as unknown as Array<{ name: string }>;
    if (!taskColumns.some((column) => column.name === "activation_trigger")) this.database.exec("ALTER TABLE tasks ADD COLUMN activation_trigger TEXT");
    if (!taskColumns.some((column) => column.name === "preparation_category")) this.database.exec("ALTER TABLE tasks ADD COLUMN preparation_category TEXT");
    if (!taskColumns.some((column) => column.name === "reminder_json")) this.database.exec("ALTER TABLE tasks ADD COLUMN reminder_json TEXT");
    if (!taskColumns.some((column) => column.name === "requirement_id")) this.database.exec("ALTER TABLE tasks ADD COLUMN requirement_id TEXT");
    if (!taskColumns.some((column) => column.name === "description")) this.database.exec("ALTER TABLE tasks ADD COLUMN description TEXT");
    if (!taskColumns.some((column) => column.name === "origin_json")) this.database.exec("ALTER TABLE tasks ADD COLUMN origin_json TEXT");
    const stageColumns = this.database.prepare("PRAGMA table_info(stages)").all() as unknown as Array<{ name: string }>;
    if (!stageColumns.some((column) => column.name === "origin_json")) this.database.exec("ALTER TABLE stages ADD COLUMN origin_json TEXT");
    if (!stageColumns.some((column) => column.name === "presentation_kind")) this.database.exec("ALTER TABLE stages ADD COLUMN presentation_kind TEXT NOT NULL DEFAULT 'details'");
    if (existingVersion < 9) this.database.exec(`UPDATE stages SET presentation_kind = CASE
      WHEN lower(title) LIKE '%daily itinerary%' OR lower(title) LIKE '%day-by-day%' OR lower(title) LIKE '%itinerary%' OR title LIKE '%每日行程%' THEN 'itinerary'
      WHEN lower(title) LIKE '%trip overview%' OR lower(title) LIKE '%journey overview%' OR lower(title) LIKE '%overview%' OR title LIKE '%总行程%' THEN 'overview'
      WHEN lower(title) LIKE '%reservation%' OR lower(title) LIKE '%booking%' OR title LIKE '%预订%' THEN 'reservations'
      WHEN lower(title) LIKE '%budget%' OR lower(title) LIKE '%cost%' OR title LIKE '%预算%' THEN 'budget'
      WHEN lower(title) LIKE '%transport%' OR title LIKE '%交通方案%' THEN 'transport'
      ELSE 'details' END;`);
    this.database.exec("CREATE INDEX IF NOT EXISTS idx_tasks_arrival_trigger ON tasks(activation_trigger, status) WHERE activation_trigger = 'arrival' AND status = 'scheduled'; PRAGMA optimize;");
    const profileColumns = this.database.prepare("PRAGMA table_info(profiles)").all() as unknown as Array<{ name: string }>;
    if (!profileColumns.some((column) => column.name === "gender")) this.database.exec("ALTER TABLE profiles ADD COLUMN gender TEXT NOT NULL DEFAULT 'not_specified'");
    if (!profileColumns.some((column) => column.name === "immigration_status")) this.database.exec("ALTER TABLE profiles ADD COLUMN immigration_status TEXT NOT NULL DEFAULT 'unknown'");
    const locationIntentColumns = this.database.prepare("PRAGMA table_info(telegram_location_intent)").all() as unknown as Array<{ name: string }>;
    if (!locationIntentColumns.some((column) => column.name === "transport_override")) this.database.exec("ALTER TABLE telegram_location_intent ADD COLUMN transport_override TEXT CHECK (transport_override IN ('taxi', 'public_transit', 'walking'))");
    const locationIntentSchema = this.database.prepare("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'telegram_location_intent'").get() as { sql: string } | undefined;
    if (locationIntentSchema?.sql && !locationIntentSchema.sql.includes("'movement_go'")) {
      this.database.exec(`BEGIN;
        CREATE TABLE telegram_location_intent_next (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          purpose TEXT NOT NULL CHECK (purpose IN ('arrival_route', 'nearby_food', 'uber_test', 'movement_go')),
          plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
          started_at TEXT NOT NULL,
          transport_override TEXT CHECK (transport_override IN ('taxi', 'public_transit', 'walking'))
        );
        INSERT INTO telegram_location_intent_next (id, purpose, plan_id, started_at, transport_override)
          SELECT id, purpose, plan_id, started_at, transport_override FROM telegram_location_intent;
        DROP TABLE telegram_location_intent;
        ALTER TABLE telegram_location_intent_next RENAME TO telegram_location_intent;
        COMMIT;`);
    }
    if (existingVersion > 0 && existingVersion < 6) {
      this.database.exec(`BEGIN;
        CREATE TABLE agent_runs_v6 (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL CHECK (kind = 'plan_generation'),
          runtime_kind TEXT NOT NULL CHECK (runtime_kind IN ('codex', 'claude-code')),
          trigger TEXT NOT NULL CHECK (trigger IN ('web', 'telegram', 'whatsapp')),
          status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'fallback')),
          started_at TEXT NOT NULL,
          finished_at TEXT,
          output_plan_id TEXT,
          failure_code TEXT
        );
        INSERT INTO agent_runs_v6 SELECT id, kind, runtime_kind, trigger, status, started_at, finished_at, output_plan_id, failure_code FROM agent_runs;
        DROP TABLE agent_runs;
        ALTER TABLE agent_runs_v6 RENAME TO agent_runs;
        CREATE INDEX idx_agent_runs_recent ON agent_runs(started_at DESC);
        COMMIT;`);
    }
    this.migrateTripBlueprintGenerationKeyUniqueness();
    this.database.prepare("INSERT OR IGNORE INTO runtime_settings (id, selected_runtime, updated_at) VALUES (1, 'codex', ?)").run(new Date().toISOString());
    const migrationTime = new Date().toISOString();
    this.database.prepare("INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (1, 'v1-local-workspace-baseline', ?)").run(migrationTime);
    this.database.prepare("INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (2, 'country-pack-source-evidence-links', ?)").run(migrationTime);
    this.database.prepare("INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (3, 'telegram-one-route-transport-override', ?)").run(migrationTime);
    this.database.prepare("INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (4, 'telegram-route-handoff-timeline', ?)").run(migrationTime);
    this.database.prepare("INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (5, 'separate-plan-review-and-execution', ?)").run(migrationTime);
    this.database.prepare("INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (6, 'optional-whatsapp-messaging', ?)").run(migrationTime);
    this.database.prepare("INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (7, 'conversational-planning-sessions', ?)").run(migrationTime);
    this.database.prepare("INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (8, 'version-bound-plan-change-sets', ?)").run(migrationTime);
    this.database.prepare("INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (9, 'explicit-stage-presentation-kinds', ?)").run(migrationTime);
    this.database.prepare("INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (10, 'plan-replacement-impact-audits', ?)").run(migrationTime);
    this.database.prepare("INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (11, 'structured-plan-presentations', ?)").run(migrationTime);
    this.database.prepare("INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (12, 'telegram-version-bound-plan-change-proposals', ?)").run(migrationTime);
    this.database.prepare("INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (13, 'explicit-plan-destination-arrivals', ?)").run(migrationTime);
    this.database.prepare("INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (14, 'retryable-itinerary-mobile-reminders', ?)").run(migrationTime);
    this.database.prepare("INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (15, 'versioned-trip-blueprints-and-generation-events', ?)").run(migrationTime);
    this.database.prepare("INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (16, 'booking-evidence-imports', ?)").run(migrationTime);
    this.database.prepare("INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (17, 'telegram-uber-handoff-test', ?)").run(migrationTime);
    this.database.prepare("INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (18, 'telegram-movement-go-location-intent', ?)").run(migrationTime);
    this.database.prepare("INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (19, 'trip-blueprint-direct-revision-versions', ?)").run(migrationTime);
  }

  private migrateTripBlueprintGenerationKeyUniqueness(): void {
    const schema = this.database.prepare("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'trip_blueprints'").get() as { sql: string } | undefined;
    if (!schema?.sql || !/generation_key\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i.test(schema.sql)) return;
    this.database.exec("PRAGMA foreign_keys = OFF;");
    try {
      this.database.exec(`BEGIN;
        CREATE TABLE trip_blueprints_next (
          id TEXT NOT NULL,
          version INTEGER NOT NULL CHECK (version > 0),
          generation_key TEXT NOT NULL REFERENCES blueprint_generations(generation_key) ON DELETE RESTRICT,
          research_set_id TEXT NOT NULL REFERENCES research_sets(id) ON DELETE RESTRICT,
          schema_version INTEGER NOT NULL,
          content_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (id, version)
        );
        INSERT INTO trip_blueprints_next (id, version, generation_key, research_set_id, schema_version, content_json, created_at)
          SELECT id, version, generation_key, research_set_id, schema_version, content_json, created_at FROM trip_blueprints;
        DROP TABLE trip_blueprints;
        ALTER TABLE trip_blueprints_next RENAME TO trip_blueprints;
        CREATE INDEX IF NOT EXISTS idx_trip_blueprints_generation_version ON trip_blueprints(generation_key, version DESC);
        COMMIT;`);
    } catch (error) {
      try { this.database.exec("ROLLBACK;"); } catch { /* Nothing to roll back. */ }
      throw error;
    } finally {
      this.database.exec("PRAGMA foreign_keys = ON;");
    }
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
      this.insertCurrentPlan(plan);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  private insertCurrentPlan(plan: Plan): void {
    this.database.prepare("UPDATE plans SET is_current = 0 WHERE is_current = 1").run();
    this.database.prepare(`INSERT INTO plans (id, version, title, location, dates, status, known_information_json, assumptions_json, next_action, configuration_json, sources_json, presentation_json, is_current, is_execution, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?)`).run(
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
      plan.presentation ? JSON.stringify(plan.presentation) : null,
      plan.createdAt
    );
    this.insertPlanStages(plan);
  }

  private insertPlanStages(plan: Plan): void {
    plan.stages.forEach((stage, stageIndex) => {
      this.database.prepare("INSERT INTO stages (id, plan_id, title, description, presentation_kind, origin_json, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
        stage.id,
        plan.id,
        stage.title,
        stage.description,
        stage.presentationKind ?? "details",
        stage.origin ? JSON.stringify(stage.origin) : null,
        stageIndex
      );
      stage.tasks.forEach((task, taskIndex) => {
        this.database.prepare("INSERT INTO tasks (id, stage_id, title, description, owner, status, due_label, preparation_category, activation_trigger, reminder_json, requirement_id, origin_json, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
          task.id,
          stage.id,
          task.title,
          task.description ?? null,
          task.owner,
          task.status,
          task.dueLabel,
          task.preparationCategory ?? null,
          task.activationTrigger ?? null,
          task.reminder ? JSON.stringify(task.reminder) : null,
          task.requirementId ?? null,
          task.origin ? JSON.stringify(task.origin) : null,
          taskIndex
        );
      });
    });
  }

  private getCurrentPlan(): Plan | undefined {
    const plan = this.database.prepare(`SELECT id, version, title, location, dates, status, known_information_json, assumptions_json, next_action, configuration_json, sources_json, presentation_json, created_at
      FROM plans WHERE is_current = 1 ORDER BY created_at DESC LIMIT 1`).get() as PlanRow | undefined;
    return plan ? this.planFromRow(plan) : undefined;
  }

  private planFromRow(plan: PlanRow): Plan {
    const stageRows = this.database.prepare("SELECT id, title, description, presentation_kind, origin_json FROM stages WHERE plan_id = ? ORDER BY sort_order").all(plan.id) as unknown as StageRow[];
    const stages: Stage[] = stageRows.map((stage) => {
      const origin = parsePlanCompilationOrigin(stage.origin_json);
      return {
      id: stage.id,
      title: stage.title,
      description: stage.description,
      presentationKind: stage.presentation_kind ?? "details",
      tasks: (this.database.prepare("SELECT id, title, description, owner, status, due_label, preparation_category, activation_trigger, reminder_json, requirement_id, origin_json FROM tasks WHERE stage_id = ? ORDER BY sort_order").all(stage.id) as unknown as TaskRow[]).map((task) => {
        const reminder = parseTaskReminder(task.reminder_json);
        const taskOrigin = parsePlanCompilationOrigin(task.origin_json);
        return {
          id: task.id,
          title: task.title,
          ...(task.description ? { description: task.description } : {}),
          owner: task.owner,
          status: task.status,
          dueLabel: task.due_label,
          ...(task.preparation_category ? { preparationCategory: task.preparation_category } : {}),
          ...(task.activation_trigger === "arrival" ? { activationTrigger: "arrival" as const } : {}),
          ...(reminder ? { reminder } : {}),
          ...(task.requirement_id ? { requirementId: task.requirement_id } : {}),
          ...(taskOrigin ? { origin: taskOrigin } : {})
        };
      }),
      ...(origin ? { origin } : {})
    };
    });

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
      ...(plan.presentation_json ? { presentation: JSON.parse(plan.presentation_json) as PlanPresentation } : {}),
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

function travelBookingKnownInformation(booking: TravelBooking): string[] {
  if (booking.status === "cancelled") return [];
  return booking.segments
    .filter((segment) => segment.constraintStrength === "hard")
    .map((segment) => `Confirmed ${travelBookingTypeLabel(booking.type)}: ${booking.title}${segment.startAtLocal ? ` starts ${segment.startAtLocal}` : ""}${segment.endAtLocal ? ` ends ${segment.endAtLocal}` : ""}${segment.location ? ` at ${segment.location}` : ""}${segment.origin || segment.destination ? ` (${[segment.origin, segment.destination].filter(Boolean).join(" to ")})` : ""}`);
}

function travelBookingAssumptions(booking: TravelBooking): string[] {
  if (booking.status === "cancelled") return [`Imported booking '${booking.title}' is cancelled and should not constrain the itinerary.`];
  return booking.segments
    .filter((segment) => segment.constraintStrength === "soft")
    .map((segment) => `Imported ${travelBookingTypeLabel(booking.type)} '${booking.title}' needs review before it constrains this Plan.${segment.needsReviewReasons.length ? ` ${segment.needsReviewReasons.join(" ")}` : ""}`);
}

function configurationWithTravelBooking(configuration: PlanConfiguration, booking: TravelBooking): PlanConfiguration {
  const next = structuredClone(configuration);
  if (booking.status === "cancelled") return next;
  const hardSegments = booking.segments.filter((segment) => segment.constraintStrength === "hard");
  const accommodation = hardSegments.find((segment) => segment.segmentType === "hotel_stay" && (segment.location || segment.destination));
  if (accommodation) {
    next.accommodation = {
      status: "confirmed",
      name: booking.title,
      ...(accommodation.location ? { address: accommodation.location, location: accommodation.location } : accommodation.destination ? { location: accommodation.destination } : {}),
      source: "user",
      updatedAt: booking.updatedAt
    };
  }
  const arrival = hardSegments.find((segment) => (segment.segmentType === "flight_leg" || segment.segmentType === "train_leg") && (segment.endAtLocal || segment.startAtLocal));
  if (arrival) {
    const expectedAtLocal = arrival.endAtLocal ?? arrival.startAtLocal;
    const timeZone = arrival.endTimeZone ?? arrival.startTimeZone;
    if (expectedAtLocal) next.arrival.expectedAtLocal = expectedAtLocal;
    if (timeZone) next.arrival.timeZone = timeZone;
  }
  return next;
}

function uniqueStrings(items: string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

function travelBookingTypeLabel(type: TravelBooking["type"]): string {
  return type === "accommodation" ? "accommodation"
    : type === "flight" ? "flight"
      : type === "train" ? "train"
        : type === "rental_car" ? "rental car"
          : type === "restaurant" ? "restaurant"
            : type === "event" ? "event"
              : type === "tour" ? "tour"
                : type === "ticket" ? "ticket" : "booking";
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

function validateCompiledPlanWrite(input: { plan: Plan; expectedPlanId: string; expectedVersion: number; audit: PlanCompilationAudit; skillRuns?: Array<Pick<CountryPackSkillRun, "skillId" | "skillVersion" | "status"> & { sourceEvidence?: SourceEvidenceRef[] }> }, compiledAt: string): void {
  if (!input.expectedPlanId.trim() || !Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) throw new Error("A compiled Plan write needs an exact expected Plan version.");
  if (input.plan.id !== input.expectedPlanId || input.plan.version !== input.expectedVersion + 1 || input.plan.status !== "draft") throw new Error("The compiled Plan must be the next draft version of the expected Plan.");
  if (!Number.isFinite(Date.parse(compiledAt))) throw new Error("A compiled Plan write needs a valid audit time.");
  if (input.audit.sourcePlanVersion !== input.expectedVersion || input.audit.compiledPlanVersion !== input.plan.version) throw new Error("The compilation audit does not match the Plan version transition.");
  if (!isStableId(input.audit.countryPackId) || !isSemver(input.audit.countryPackVersion) || !isStableId(input.audit.compositionSkillId) || !isSemver(input.audit.compositionSkillVersion)) throw new Error("The compilation audit has invalid Country Pack or Skill identity.");
  if (!isValidEvidenceList(input.audit.sourceEvidence)) throw new Error("The compilation audit has invalid or duplicate source evidence.");
  const generatedStages = input.plan.stages.filter((stage) => stage.origin?.kind === "country_pack_compilation");
  if (generatedStages.length !== 1) throw new Error("A compiled Plan write needs exactly one generated Stage.");
  const generatedStage = generatedStages[0]!;
  const expectedOrigin = {
    countryPackId: input.audit.countryPackId,
    countryPackVersion: input.audit.countryPackVersion,
    compositionSkillId: input.audit.compositionSkillId,
    compositionSkillVersion: input.audit.compositionSkillVersion,
    sourcePlanVersion: input.expectedVersion
  };
  if (!originMatchesAudit(generatedStage.origin, expectedOrigin)) throw new Error("The generated Stage provenance does not match the compilation audit.");
  if (!sameEvidence(generatedStage.origin?.sourceEvidence ?? [], input.audit.sourceEvidence)) throw new Error("The generated Stage evidence does not match the compilation audit.");
  if (generatedStage.tasks.some((task) => !originMatchesAudit(task.origin, expectedOrigin))) throw new Error("Every generated Task needs provenance matching the compilation audit.");
  if (generatedStage.tasks.some((task) => !isEvidenceSubset(task.origin?.sourceEvidence ?? [], input.audit.sourceEvidence))) throw new Error("Every generated Task evidence reference must belong to the compilation audit.");
  const reminderCount = generatedStage.tasks.filter((task) => task.reminder).length;
  if (input.audit.taskCount !== generatedStage.tasks.length || input.audit.reminderCount !== reminderCount) throw new Error("The compilation audit counts do not match the generated Plan content.");
  const skillIds = (input.skillRuns ?? []).map((run) => run.skillId);
  if (new Set(skillIds).size !== skillIds.length || (input.skillRuns ?? []).some((run) => !isStableId(run.skillId) || !isSemver(run.skillVersion) || !["success", "degraded", "needs_input", "blocked", "failed", "not_supported"].includes(run.status) || !isValidEvidenceList(run.sourceEvidence ?? []))) {
    throw new Error("The compilation Skill audit contains an invalid or duplicate Skill result.");
  }
  if ((input.skillRuns ?? []).some((run) => !isEvidenceSubset(run.sourceEvidence ?? [], input.audit.sourceEvidence))) throw new Error("Every Skill evidence reference must belong to the compilation audit.");
}

function parsePlanCompilationOrigin(value: string | null | undefined): PlanCompilationOrigin | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return isPlanCompilationOrigin(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isPlanCompilationOrigin(value: unknown): value is PlanCompilationOrigin {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<PlanCompilationOrigin>;
  return candidate.kind === "country_pack_compilation"
    && typeof candidate.countryPackId === "string" && isStableId(candidate.countryPackId)
    && typeof candidate.countryPackVersion === "string" && isSemver(candidate.countryPackVersion)
    && typeof candidate.compositionSkillId === "string" && isStableId(candidate.compositionSkillId)
    && typeof candidate.compositionSkillVersion === "string" && isSemver(candidate.compositionSkillVersion)
    && typeof candidate.compilationKey === "string" && isStableId(candidate.compilationKey)
    && Number.isInteger(candidate.sourcePlanVersion) && candidate.sourcePlanVersion! >= 1
    && Array.isArray(candidate.sourceSkills) && candidate.sourceSkills.every((source) => typeof source === "object" && source !== null
      && typeof source.id === "string" && isStableId(source.id) && typeof source.version === "string" && isSemver(source.version))
    && (candidate.sourceEvidence === undefined || isValidEvidenceList(candidate.sourceEvidence));
}

function originMatchesAudit(origin: PlanCompilationOrigin | undefined, audit: { countryPackId: string; countryPackVersion: string; compositionSkillId: string; compositionSkillVersion: string; sourcePlanVersion: number }): boolean {
  return Boolean(origin && isPlanCompilationOrigin(origin)
    && origin.countryPackId === audit.countryPackId
    && origin.countryPackVersion === audit.countryPackVersion
    && origin.compositionSkillId === audit.compositionSkillId
    && origin.compositionSkillVersion === audit.compositionSkillVersion
    && origin.sourcePlanVersion === audit.sourcePlanVersion);
}

function planCompilationRunFromRow(row: PlanCompilationRunRow): Omit<PlanCompilationRun, "sourceEvidence"> {
  return {
    id: row.id,
    kind: "plan_compilation",
    planId: row.plan_id,
    countryPackId: row.country_pack_id,
    countryPackVersion: row.country_pack_version,
    compositionSkillId: row.composition_skill_id,
    compositionSkillVersion: row.composition_skill_version,
    sourcePlanVersion: row.source_plan_version,
    compiledPlanVersion: row.compiled_plan_version,
    taskCount: row.task_count,
    reminderCount: row.reminder_count,
    compiledAt: row.compiled_at
  };
}

function evidenceFromRow(value: unknown): SourceEvidenceRef {
  const row = value as { source_snapshot_id: string; content_hash: string };
  return { sourceSnapshotId: row.source_snapshot_id, contentHash: row.content_hash };
}

function isValidEvidenceList(value: unknown): value is SourceEvidenceRef[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "object" || item === null
    || typeof (item as SourceEvidenceRef).sourceSnapshotId !== "string" || !isStableId((item as SourceEvidenceRef).sourceSnapshotId)
    || typeof (item as SourceEvidenceRef).contentHash !== "string" || !/^[a-f0-9]{64}$/i.test((item as SourceEvidenceRef).contentHash))) return false;
  return new Set(value.map((item) => `${item.sourceSnapshotId}:${item.contentHash}`)).size === value.length;
}

function sameEvidence(left: SourceEvidenceRef[], right: SourceEvidenceRef[]): boolean {
  const key = (item: SourceEvidenceRef) => `${item.sourceSnapshotId}:${item.contentHash}`;
  return left.length === right.length && left.map(key).sort().every((value, index) => value === right.map(key).sort()[index]);
}

function isEvidenceSubset(subset: SourceEvidenceRef[], complete: SourceEvidenceRef[]): boolean {
  const completeKeys = new Set(complete.map((item) => `${item.sourceSnapshotId}:${item.contentHash}`));
  return subset.every((item) => completeKeys.has(`${item.sourceSnapshotId}:${item.contentHash}`));
}

function isStableId(value: string): boolean {
  return /^[a-z0-9]+(?:[-:][a-z0-9]+)*$/.test(value);
}

function isSemver(value: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(value);
}

function itineraryMinute(value?: string): number | undefined {
  const match = /^(\d{2}):(\d{2})$/.exec(value ?? "");
  if (!match) return undefined;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours <= 23 && minutes <= 59 ? hours * 60 + minutes : undefined;
}

function itineraryTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function fixedItineraryStop(role: string | undefined, priority: PlanPlacePriority): boolean {
  return priority === "booked" || /(?:fixed|reservation|booked|arrival|departure|flight|rail)/i.test(role ?? "");
}

function editedItineraryRouteMode(preference: TransportPreference): PlanRouteSegment["mode"] {
  if (preference === "taxi") return "driving";
  if (preference === "walking") return "walking";
  return "transit";
}

function routeRefreshPresentationForWorkspace(workspace: WorkspaceSnapshot): PlanPresentation {
  const presentation = workspace.activeBlueprint ? blueprintPresentation(workspace.activeBlueprint) : workspace.activePlan.presentation;
  if (!presentation || presentation.kind !== "itinerary") throw new Error("This Plan does not contain a structured itinerary presentation.");
  return presentation;
}

function latestRouteObservedAt(routes: Array<{ observedAt: string }>): string {
  return routes.map((route) => route.observedAt).sort().at(-1) ?? new Date().toISOString();
}

function routeRefreshProviderSource(provider: "google_maps", observedAt: string): BlueprintSource {
  return {
    id: provider,
    title: "Google Maps route facts",
    authority: "Google Maps",
    url: "https://www.google.com/maps",
    retrievedAt: observedAt,
    status: "verified"
  };
}

function refreshedBlueprintMovementDisplay(movement: BlueprintMovement, segment: PlanRouteSegment): NonNullable<BlueprintMovement["display"]> {
  const routeLabel = segment.label?.trim() || movement.display?.routeLabel?.trim() || movement.label?.trim() || "Reviewed route";
  if (segment.verification === "stale") {
    return {
      routeLabel,
      refreshReason: "This refreshed route conflicts with a fixed itinerary time and still needs replanning.",
      refreshScope: {
        dayId: movement.dayId,
        originPlaceId: movement.originPlaceId,
        destinationPlaceId: movement.destinationPlaceId,
        reason: "route_conflict"
      },
      showAsFormalRoute: movement.display?.showAsFormalRoute ?? true,
      mapLineState: "needs_refresh"
    };
  }
  return {
    routeLabel,
    showAsFormalRoute: movement.display?.showAsFormalRoute ?? true,
    mapLineState: "formal"
  };
}

function routeRefreshKnownInformation(knownInformation: string[], blueprint: TripBlueprint): string[] {
  const blueprintLine = `Trip Blueprint: ${blueprint.id} v${blueprint.version}`;
  const replaced = knownInformation.map((item) => item.startsWith("Trip Blueprint: ") ? blueprintLine : item);
  return replaced.includes(blueprintLine) ? replaced : [blueprintLine, ...knownInformation];
}

function routeRefreshAssumptions(assumptions: string[], blueprint: TripBlueprint): string[] {
  const retained = assumptions.filter((item) => !/travel facts? or map details? remain marked for recheck/i.test(item));
  const recheckCount = blueprint.movements.filter((movement) => movement.status !== "verified").length;
  if (!recheckCount) return retained;
  const factLabel = recheckCount === 1 ? "fact" : "facts";
  const detailLabel = recheckCount === 1 ? "detail" : "details";
  return [`${recheckCount} travel ${factLabel} or map ${detailLabel} remain marked for recheck.`, ...retained];
}

function updateBlueprintBlocksFromStops(day: TripBlueprint["days"][number], stops: NonNullable<ItineraryDay["stops"]>): BlueprintItineraryBlock[] {
  const scheduledPlaceIds = new Set(day.stops.map((stop) => stop.placeId));
  let routeIndex = 0;
  return [...(day.blocks ?? [])].sort((left, right) => left.order - right.order).flatMap((block) => {
    if (!block.placeId || !scheduledPlaceIds.has(block.placeId) || block.kind === "event") return [{ ...block, evidence: [...block.evidence] }];
    const stop = stops[routeIndex];
    routeIndex += 1;
    if (!stop) return [];
    const { startTime: _startTime, role: _role, ...base } = block;
    return [{
      ...base,
      placeId: stop.placeId,
      ...(stop.time ? { startTime: stop.time } : block.startTime ? { startTime: block.startTime } : {}),
      ...(stop.role ? { role: stop.role } : block.role ? { role: block.role } : {}),
      evidence: [...block.evidence]
    }];
  }).map((block, index) => ({ ...block, order: index + 1 }));
}

function taskRemindersEqual(left: TaskReminder, right: TaskReminder): boolean {
  return left.scheduledAtLocal === right.scheduledAtLocal
    && left.timeZone === right.timeZone
    && left.purpose === right.purpose
    && JSON.stringify(left.refreshFacts ?? []) === JSON.stringify(right.refreshFacts ?? []);
}

/** Keeps user-confirmed completion facts stable when an Agent replaces a draft. */
function carryForwardCompletedTasks(previousPlan: Plan, replacementPlan: Plan): PlanReplacementAudit["preservedCompletedTasks"] {
  const completed = previousPlan.stages.flatMap((stage) => stage.tasks
    .filter((task) => task.status === "completed")
    .map((task) => ({ stageTitle: stage.title, task })));

  const preserved: PlanReplacementAudit["preservedCompletedTasks"] = [];
  for (const item of completed) {
    const sameStage = replacementPlan.stages.find((stage) => normalizedPlanLabel(stage.title) === normalizedPlanLabel(item.stageTitle));
    const matchingTask = sameStage?.tasks.find((task) => normalizedPlanLabel(task.title) === normalizedPlanLabel(item.task.title))
      ?? replacementPlan.stages.flatMap((stage) => stage.tasks).find((task) => normalizedPlanLabel(task.title) === normalizedPlanLabel(item.task.title));

    if (matchingTask) {
      matchingTask.status = "completed";
      matchingTask.owner = item.task.owner;
      delete matchingTask.reminder;
      delete matchingTask.activationTrigger;
      preserved.push({ sourceTaskId: item.task.id, replacementTaskId: matchingTask.id, title: matchingTask.title });
      continue;
    }

    const targetStage = sameStage ?? replacementPlan.stages.at(-1);
    if (!targetStage) continue;
    const { id: _id, reminder: _reminder, activationTrigger: _activationTrigger, ...taskWithoutExecution } = structuredClone(item.task);
    const carriedTask: Task = {
      ...taskWithoutExecution,
      id: `task-${randomUUID()}`,
      status: "completed"
    };
    targetStage.tasks.push(carriedTask);
    preserved.push({ sourceTaskId: item.task.id, replacementTaskId: carriedTask.id, title: carriedTask.title });
  }
  return preserved;
}

function defaultPlanChangeImpact(plan: Plan): PlanChangeImpactPreview {
  return {
    planId: plan.id,
    baseVersion: plan.version,
    impact: "low",
    summary: "This revision creates a reviewable replacement draft.",
    reasons: [],
    affectedAreas: ["itinerary"],
    requiresConfirmation: false,
    createsReplacementDraft: true
  };
}

function revalidationScopesForAreas(areas: PlanChangeImpactPreview["affectedAreas"]): PlanRevalidationScope[] {
  const scopes = new Set<PlanRevalidationScope>();
  for (const area of areas) {
    if (["destination", "accommodation", "fixed_commitments", "party", "itinerary"].includes(area)) scopes.add("route_facts");
    if (["dates", "destination", "accommodation", "fixed_commitments", "party", "itinerary"].includes(area)) scopes.add("time_estimates");
    if (["dates", "destination", "fixed_commitments"].includes(area)) scopes.add("official_sources");
    if (["dates", "fixed_commitments", "reminders"].includes(area)) scopes.add("reminders");
    if (["destination", "accommodation", "party"].includes(area)) scopes.add("accommodation_options");
  }
  return [...scopes];
}

function normalizedPlanLabel(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function isLocalDateTime(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}:00Z`));
}

function isTimeZoneName(value: string): boolean {
  if (value === "UTC") return true;
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

function planningSessionFromRow(row: PlanningSessionRow): PlanningSession {
  return {
    id: row.id,
    status: row.status,
    objectiveType: row.objective_type,
    messages: JSON.parse(row.messages_json) as PlanningSession["messages"],
    facts: JSON.parse(row.facts_json) as PlanningSession["facts"],
    unresolved: JSON.parse(row.unresolved_json) as PlanningSession["unresolved"],
    deferred: JSON.parse(row.deferred_json) as PlanningSession["deferred"],
    ...(row.proposal_json ? { proposal: JSON.parse(row.proposal_json) as NonNullable<PlanningSession["proposal"]> } : {}),
    ...(row.confirmed_proposal_version === null ? {} : { confirmedProposalVersion: row.confirmed_proposal_version }),
    ...(row.output_plan_id ? { outputPlanId: row.output_plan_id } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function travelBookingFromRow(row: TravelBookingRow): TravelBooking {
  const booking = JSON.parse(row.content_json) as TravelBooking;
  return {
    ...booking,
    id: row.id,
    ...(row.planning_session_id ? { planningSessionId: row.planning_session_id } : {}),
    ...(row.plan_id ? { planId: row.plan_id } : {}),
    sourceHash: row.source_hash,
    status: row.status,
    type: row.type,
    updatedAt: row.updated_at
  };
}

function blueprintGenerationFromRow(row: BlueprintGenerationRow): BlueprintGeneration {
  return {
    generationKey: row.generation_key,
    proposalRef: { sessionId: row.session_id, proposalVersion: row.proposal_version },
    skillLineage: { skillId: row.skill_id, skillVersion: row.skill_version },
    status: row.status,
    stage: row.stage,
    ...(row.research_set_id ? { researchSetId: row.research_set_id } : {}),
    ...(row.blueprint_id ? { blueprintId: row.blueprint_id } : {}),
    ...(row.blueprint_version === null ? {} : { blueprintVersion: row.blueprint_version }),
    ...(row.failure_json ? { failure: JSON.parse(row.failure_json) as NonNullable<BlueprintGeneration["failure"]> } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function planBlueprintLineageFromRow(row: PlanBlueprintLineageRow): PlanBlueprintLineage {
  return {
    planId: row.plan_id,
    planVersion: row.plan_version,
    blueprintId: row.blueprint_id,
    blueprintVersion: row.blueprint_version,
    compilerVersion: row.compiler_version,
    compilationKey: row.compilation_key,
    createdAt: row.created_at
  };
}

function blueprintGenerationEventFromRow(row: BlueprintGenerationEventRow): BlueprintGenerationEvent {
  return {
    id: row.id,
    generationKey: row.generation_key,
    sequence: row.sequence,
    stage: row.stage,
    status: row.status,
    ...(row.scope_label ? { scopeLabel: row.scope_label } : {}),
    ...(row.saved_place_count === null ? {} : { savedPlaceCount: row.saved_place_count }),
    detail: row.detail,
    ...(row.next_action ? { nextAction: row.next_action } : {}),
    createdAt: row.created_at
  };
}

function planChangeSetFromRow(row: PlanChangeSetRow): PlanChangeSet {
  return {
    id: row.id,
    planId: row.plan_id,
    baseVersion: row.base_version,
    appliedVersion: row.applied_version,
    kind: row.kind,
    impact: row.impact,
    status: row.status,
    stageId: row.stage_id,
    taskId: row.task_id,
    fromIndex: row.from_index,
    toIndex: row.to_index,
    affectedTaskIds: JSON.parse(row.affected_task_ids_json) as string[],
    createdAt: row.created_at,
    ...(row.undone_at ? { undoneAt: row.undone_at } : {})
  };
}

function planReplacementAuditFromRow(row: PlanReplacementAuditRow): PlanReplacementAudit {
  return {
    id: row.id,
    sourcePlanId: row.source_plan_id,
    sourcePlanVersion: row.source_plan_version,
    replacementPlanId: row.replacement_plan_id,
    replacementPlanVersion: row.replacement_plan_version,
    impact: row.impact,
    affectedAreas: JSON.parse(row.affected_areas_json) as PlanReplacementAudit["affectedAreas"],
    revalidationScopes: JSON.parse(row.revalidation_scopes_json) as PlanReplacementAudit["revalidationScopes"],
    preservedCompletedTasks: JSON.parse(row.preserved_completed_tasks_json) as PlanReplacementAudit["preservedCompletedTasks"],
    createdAt: row.created_at
  };
}

function telegramPlanChangeProposalFromRow(row: TelegramPlanChangeProposalRow): TelegramPlanChangeProposal {
  return {
    id: row.id,
    planId: row.plan_id,
    baseVersion: row.base_version,
    request: row.request,
    impact: JSON.parse(row.impact_json) as PlanChangeImpactPreview,
    status: row.status,
    createdAt: row.created_at,
    ...(row.resolved_at ? { resolvedAt: row.resolved_at } : {})
  };
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

function telegramRouteHandoffFromRow(row: TelegramRouteHandoffRow): TelegramRouteHandoffState {
  return {
    planId: row.plan_id,
    offeredAt: row.offered_at,
    ...(row.opened_at ? { openedAt: row.opened_at } : {}),
    routeDurationSeconds: row.route_duration_seconds,
    waitBufferSeconds: row.wait_buffer_seconds,
    safetyMarginSeconds: row.safety_margin_seconds,
    expectedArrivalAt: row.expected_arrival_at,
    ...(row.guidance_sent_at ? { guidanceSentAt: row.guidance_sent_at } : {}),
    delayCount: row.delay_count,
    ...(row.last_delayed_at ? { lastDelayedAt: row.last_delayed_at } : {})
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
  return value === "web" || value === "telegram" || value === "whatsapp";
}

function isFinishedRunStatus(value: unknown): value is Exclude<RunStatus, "running"> {
  return value === "succeeded" || value === "failed" || value === "fallback";
}

function runtimeDisplayName(kind: AgentRuntimeKind): string {
  return kind === "claude-code" ? "Claude Code" : "Codex";
}

function completedRequirementIdsForWorkspace(workspace: WorkspaceSnapshot): string[] {
  return [workspace.activePlan, workspace.executionPlan]
    .filter((plan): plan is Plan => Boolean(plan))
    .flatMap((plan) => plan.stages.flatMap((stage) => stage.tasks))
    .filter((task) => task.status === "completed" && Boolean(task.requirementId))
    .map((task) => task.requirementId!);
}

function samePlanCity(left: string, right: string): boolean {
  const normalize = (value: string) => value.trim().toLocaleLowerCase().replace(/[\s,，.。-]+/g, "");
  const leftKey = normalize(left);
  const rightKey = normalize(right);
  if (leftKey === rightKey) return true;
  const aliases = [["paris", "巴黎"], ["versailles", "凡尔赛"], ["london", "伦敦"], ["tokyo", "东京"], ["kyoto", "京都"], ["osaka", "大阪"]];
  return aliases.some((group) => group.includes(leftKey) && group.includes(rightKey));
}

/** Google route facts use [longitude, latitude]; Plan places use [latitude, longitude]. */
function providerCoordinatesToPlanCoordinates([longitude, latitude]: [number, number]): [number, number] {
  return [latitude, longitude];
}
