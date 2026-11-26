import { TravelAdjustmentPersistence, TRAVEL_ADJUSTMENT_SCHEMA_SQL, TRAVEL_ADJUSTMENT_MIGRATION_NAME } from "./travel-adjustment-store.js";
import type { TravelAdjustmentEmailConsumption } from './travel-adjustment-store.js';
export type { TravelAdjustmentEmailConsumption } from './travel-adjustment-store.js';
import { applyPlanActivation, assertTravelPhase, assertTravelAdjustmentInput, travelAdjustmentEventIdentityBlocker, assertTravelAdjustmentReplacement, travelAdjustmentApplicationBlocker, type TravelAdjustmentContext, type TravelAdjustmentInput, type TravelAdjustmentReceipt, type TravelPhase } from "@c-assistant/core";
import { WorkspaceMutationError, workspaceMutationDigestInput } from "@c-assistant/core";
import { loadPostStopAdmission, type PostStopEvidencePin } from './post-stop-admission.js';
export { loadPostStopAdmission, assessPostStopAdmission, type PostStopEvidencePin } from './post-stop-admission.js';
import { assertGuardedSchema, assertPostStopHistory, BOOKING_MUTATION_RECEIPTS_SQL, BOOKING_MUTATION_RECEIPTS_MIGRATION_NAME } from "./guarded-schema.js";
import { readPlanningReturnSnapshot } from "./readonly-planning-store.js";
import { chmodSync, existsSync, mkdirSync, unlinkSync, statSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { dirname, join, isAbsolute } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { EMAIL_SCHEMA_SQL, EMAIL_TIMING_SCOPE_SCHEMA_SQL, EMAIL_TIMING_SCOPE_MIGRATION_NAME, EmailExecutionStorage } from "./email-store.js";
export type { EmailSettings, EmailJob, EmailDeliveryContent, EmailReviewScope, EmailPlanConfirmation } from "./email-store.js";
import { AGENT_WORK_SCHEMA_SQL, AgentWorkStore, AgentWorkError, workDigest } from "./agent-work-store.js";
export * from "./agent-work-store.js";
import { GENERATION_CARRIER_SCHEMA_SQL, GenerationCarrierStore } from "./generation-carrier-store.js";
export { assertGenerationCarrierBusinessContext, hasConfirmedPublicImageFailure, type FailedImageRetryIntent, GenerationCarrierStorageError, GenerationCarrierStore, type GenerationCarrierMapping, type GenerationCarrierProtocol } from "./generation-carrier-store.js";
import {
  isAssistantPersonalityId,
  type AssistantPersonalityId,
  applyDirectBlueprintRevisionBatchWithMetadata,
  reconcileBookingRelationshipAssessment,
  resolveBlueprintPlanCompilationIdentity,
  blueprintBookingConstraintsFromTravelBookings,
  bookingRelationshipReviewContext,
  bookingRelationshipDigest,
  bookingRelationshipSourceUnits,
  type BookingRelationshipSourceContext,
  type BlueprintBookingConstraint,
  undoDirectBlueprintRevision,
  assertPlanPresentationIntegrity,
  assertResearchSetIntegrity,
  assertTripBlueprintIntegrity,
  blueprintPresentation,
  createInitialWorkspace,
  createPlanFromDraft,
  createPlanFromRequest,
  createDefaultPlanConfiguration,
  compileTripBlueprint,
  effectiveBlueprintSchedulingDecision,
  isPreDepartureChecklistTask,
  type CreatePlanInput,
  type PreparationEvidenceRun,
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
  type TransportPreference,
  type WorkspaceSnapshot
} from "@c-assistant/core";

interface ProfileRow {
  display_name: string;
  preferred_language: string;
  travel_preferences: string;
  assistant_personality: AssistantPersonalityId;
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

export interface BlueprintMutationBeforeIdentity {
  planId: string;
  planVersion: number;
  blueprintId: string;
  blueprintVersion: number;
}
type DirectBlueprintUndoReceipt = WorkspaceSnapshot & { beforeIdentity?: BlueprintMutationBeforeIdentity };
export interface DirectBlueprintRevisionSaveResult {
  beforeIdentity?: BlueprintMutationBeforeIdentity;
  workspace: WorkspaceSnapshot;
  revision: DirectBlueprintRevisionBatchMetadata;
  originalResult?: { planId: string; planVersion: number; blueprintId: string; blueprintVersion: number; sourceSetDigest: string; targetDigests: Record<string,string>; revisionKinds: string[]; recoveryBinding?:{schemaVersion:1;draftDigest:string;seedDigest:string} };
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

interface PreparationEvidenceRunRow {
  id: string;
  compilation_run_id: string;
  plan_id: string;
  source_plan_version: number;
  skill_id: string;
  skill_version: string;
  status: PreparationEvidenceRun["status"];
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

interface PlanDestinationArrivalRow {
  city: string;
  arrived_at: string;
  confirmed: number;
}

const TASK_REMINDER_CATCH_UP_MS = 30 * 60_000;
const TASK_REMINDER_ATTEMPT_LEASE_MS = 60_000;
const TASK_REMINDER_RETRY_DELAYS_MS = [60_000, 5 * 60_000] as const;
const ITINERARY_REMINDER_CATCH_UP_MS = 20 * 60_000;
const ITINERARY_REMINDER_ATTEMPT_LEASE_MS = 60_000;
const ITINERARY_REMINDER_RETRY_DELAYS_MS = [60_000, 5 * 60_000] as const;
const CURRENT_SCHEMA_VERSION = 32;

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

export type GenerationCarrierCheckpoint = {
  expectedCarriers?: readonly { carrierTaskId: string; resultSha256: string; requestSha256: string }[] | undefined;
  carrierTaskIds: readonly string[];
  generationEvent: Omit<BlueprintGenerationEvent, "sequence">;
};

/** 仅经可信公开执行验证的候选可在原创建事务中取得事件关联；不登记已有草稿。 */
export interface TravelAdjustmentDraftOrigin {
  input: Omit<TravelAdjustmentInput,'requestId'|'replacement'>;
  verifyExecution: (decision:NonNullable<TravelAdjustmentInput['decision']>,input:TravelAdjustmentInput)=>boolean;
}

export class SqliteWorkspaceStore {
  readonly email: EmailExecutionStorage;
  readonly generationCarriers: GenerationCarrierStore;
  readonly agentWork: AgentWorkStore;
  private readonly database: DatabaseSync;
  private readonly databasePath: string;
  private readonly historicalPostStop: boolean;
  private bookingWriteDepth = 0;
  private directTransactionDepth = 0;

  constructor(databasePath: string, options?: { guardedSchemaSha256: string; postStopAdmission?: PostStopEvidencePin }) {
    if (!options && databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true });
    if (options && (!isAbsolute(databasePath) || !existsSync(databasePath) || !statSync(databasePath).isFile() || ["-wal", "-shm", "-journal"].some(suffix => existsSync(databasePath + suffix)))) throw new Error("guarded_existing_database_required");
    const postStop = options?.postStopAdmission ? loadPostStopAdmission(databasePath, options.postStopAdmission) : undefined;
    if (postStop && options?.guardedSchemaSha256 !== postStop.audit.facts.schemaSha256) throw new Error("post_stop_schema_binding_mismatch");
    this.historicalPostStop = Boolean(postStop);
    this.databasePath = databasePath;
    this.database = new DatabaseSync(databasePath);
    try {
      this.database.exec("PRAGMA foreign_keys = ON;");
      if (options) assertGuardedSchema(this.database, options.guardedSchemaSha256, postStop ? {historicalPostStop: true} : undefined);
      else this.migrate();
      if (postStop) assertPostStopHistory(this.database, postStop.audit.factsSha256);
      if (!options) this.database.exec("BEGIN IMMEDIATE");
      this.generationCarriers = new GenerationCarrierStore(this.database, databasePath, options ? { initialize: false } : undefined);
      if (!options) {
        try {
          this.database.exec(AGENT_WORK_SCHEMA_SQL);
          for (const row of this.database.prepare("SELECT id,messages_json FROM planning_sessions WHERE id NOT IN (SELECT session_id FROM planning_session_revisions)").all()) {
            this.database.prepare("INSERT OR IGNORE INTO planning_session_revisions VALUES (?,?)").run(String(row.id), JSON.parse(String(row.messages_json)).length);
          }
          this.database.prepare("INSERT OR IGNORE INTO schema_migrations (version,name,applied_at) VALUES (27,'agent-work-and-planning-revisions',?)").run(new Date().toISOString());
          this.database.exec(`CREATE TABLE IF NOT EXISTS direct_blueprint_edits (
            id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, fingerprint TEXT NOT NULL,
            plan_id TEXT NOT NULL, plan_version INTEGER NOT NULL, blueprint_id TEXT NOT NULL, blueprint_version INTEGER NOT NULL, base_blueprint_version INTEGER NOT NULL,
            before_json TEXT NOT NULL, after_json TEXT NOT NULL, metadata_json TEXT NOT NULL, result_json TEXT NOT NULL, created_at TEXT NOT NULL, undone INTEGER NOT NULL DEFAULT 0
          ); CREATE TABLE IF NOT EXISTS direct_blueprint_undos(request_id TEXT PRIMARY KEY, revision_id TEXT NOT NULL REFERENCES direct_blueprint_edits(id), fingerprint TEXT NOT NULL, result_json TEXT NOT NULL, created_at TEXT NOT NULL);`);
          this.database.prepare("INSERT OR IGNORE INTO schema_migrations(version,name,applied_at) VALUES(28,'持久直接蓝图编辑与撤销',?)").run(new Date().toISOString());
          this.database.exec(BOOKING_MUTATION_RECEIPTS_SQL);
          this.database.prepare("INSERT OR IGNORE INTO schema_migrations(version,name,applied_at) VALUES(30,?,?)").run(BOOKING_MUTATION_RECEIPTS_MIGRATION_NAME, new Date().toISOString());
          this.database.exec(TRAVEL_ADJUSTMENT_SCHEMA_SQL);
          this.database.prepare("INSERT OR IGNORE INTO schema_migrations(version,name,applied_at) VALUES(31,?,?)").run(TRAVEL_ADJUSTMENT_MIGRATION_NAME,new Date().toISOString());
          this.database.exec(EMAIL_TIMING_SCOPE_SCHEMA_SQL);
          this.database.prepare("INSERT OR IGNORE INTO schema_migrations(version,name,applied_at) VALUES(32,?,?)").run(EMAIL_TIMING_SCOPE_MIGRATION_NAME,new Date().toISOString());
          this.database.exec("COMMIT");
          this.generationCarriers.cleanupLegacySidecar(databasePath);
        } catch (error) { this.database.exec("ROLLBACK"); throw error; }
      }
      this.agentWork = new AgentWorkStore(this.database);
      if (!options) this.seedIfEmpty();
      this.email = new EmailExecutionStorage(this.database);
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
    const profile = this.database.prepare("SELECT display_name, preferred_language, travel_preferences, assistant_personality, nationality, gender, immigration_status, status FROM profiles WHERE id = 1").get() as ProfileRow | undefined;
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
        travelPreferences: profile.travel_preferences,
        assistantPersonality: profile.assistant_personality,
        nationality: profile.nationality,
        gender: profile.gender,
        immigrationStatus: profile.immigration_status,
        status: profile.status
      },
      runtime: { selectedKind: runtime.selected_runtime },
      activePlan: presentedActivePlan,
      ...(activeBlueprint ? { activeBlueprint } : {}),
      ...(() => { if(this.historicalPostStop) return {}; const row = this.database.prepare("SELECT id,plan_id,plan_version,blueprint_id,blueprint_version,base_blueprint_version,created_at FROM direct_blueprint_edits WHERE plan_id=? AND plan_version=? AND undone=0 ORDER BY rowid DESC LIMIT 1").get(activePlan.id,activePlan.version) as {id:string;plan_id:string;plan_version:number;blueprint_id:string;blueprint_version:number;base_blueprint_version:number;created_at:string} | undefined; return row ? {latestDirectBlueprintRevision:{id:row.id,planId:row.plan_id,planVersion:row.plan_version,blueprintId:row.blueprint_id,blueprintVersion:row.blueprint_version,baseBlueprintVersion:row.base_blueprint_version,createdAt:row.created_at}} : {}; })(),
      ...(planningSession ? { planningSession } : {}),
      ...(latestPlanChange ? { latestPlanChange } : {}),
      ...(latestPlanReplacement ? { latestPlanReplacement } : {}),
      ...(executionPlan && executionPlan.id !== activePlan.id ? { executionPlan } : {}),
      destinationArrivals: this.listPlanDestinationArrivals(activePlan.id),
      inbox: (this.database.prepare("SELECT id, tone, title, body, timestamp FROM inbox_items ORDER BY created_at DESC, rowid DESC").all() as unknown as InboxRow[]).map((row) => ({
        id: row.id,
        tone: row.tone,
        title: row.title === "行程已调整" ? "Itinerary updated" : row.title,
        body: row.body === "已根据可靠客观变化应用新版安排。" ? "The updated itinerary was applied based on verified objective changes." : row.body,
        timestamp: row.timestamp
      })),
      sourceSnapshots: this.listSourceSnapshots(),
      system: {
        core: "ready",
        storage: "local",
        runtime: "configured",
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
    this.database.exec("SAVEPOINT save_planning_session");
    try {
    const previous = this.getPlanningSessionById(session.id);
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
    if (previous && JSON.stringify([previous.messages, previous.facts, previous.proposal, previous.unresolved, previous.deferred]) !== JSON.stringify([session.messages, session.facts, session.proposal, session.unresolved, session.deferred])) {
      this.database.prepare("INSERT INTO planning_session_revisions VALUES (?,?) ON CONFLICT(session_id) DO UPDATE SET revision=revision+1").run(session.id, previous.messages.length + 1);
    }
    this.database.exec("RELEASE save_planning_session");
    return session;
    } catch (error) { this.database.exec("ROLLBACK TO save_planning_session; RELEASE save_planning_session"); throw error; }
  }

  /** Readback only; initialization remains the responsibility of the normal constructor. */
  readPlanningReturnSnapshot(sessionId: string) {
    return readPlanningReturnSnapshot(this.database, sessionId);
  }

  getPlanningRevision(sessionId: string): number {
    const row = this.database.prepare("SELECT revision FROM planning_session_revisions WHERE session_id=?").get(sessionId);
    if (row) return Number(row.revision);
    const session = this.getPlanningSessionById(sessionId);
    if (!session) throw new AgentWorkError("planning_session_missing");
    return session.messages.length;
  }

  /** Read the original save receipt, never infer it from the current revision. */
  readPlanningMessageReceipt(sessionId: string, messageId: string) {
    const row = this.database.prepare("SELECT * FROM planning_message_receipts WHERE session_id=? AND message_id=?").get(sessionId, messageId);
    if (!row) return null;
    const message = this.getPlanningSessionById(sessionId)?.messages.find(item => item.id === messageId && item.role === "user");
    const expectedRevision = Number(row.expected_revision), savedRevision = Number(row.saved_revision);
    if (!message || row.input_sha256 !== workDigest({ text: message.text.trim() }) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0
      || !Number.isSafeInteger(savedRevision) || savedRevision !== expectedRevision + 1) throw new AgentWorkError("planning_save_receipt_invalid");
    return { sessionId, messageId, expectedRevision, savedRevision };
  }

  /** 仅按原消息身份读回，不扫描或创建当前会话。 */
  readPlanningMessageSaveStatus(identity: { messageId: string; expectedRevision: number; inputSha256: string; sessionId?: string }) {
    const row = this.database.prepare("SELECT session_id,input_sha256,expected_revision FROM planning_message_receipts WHERE message_id=?").get(identity.messageId);
    if (!row) return null;
    if (row.input_sha256 !== identity.inputSha256 || Number(row.expected_revision) !== identity.expectedRevision
      || (identity.sessionId !== undefined && row.session_id !== identity.sessionId)) throw new AgentWorkError("planning_message_conflict");
    const receipt = this.readPlanningMessageReceipt(String(row.session_id), identity.messageId);
    if (!receipt) throw new AgentWorkError("planning_save_receipt_invalid");
    const revision = this.database.prepare("SELECT revision FROM planning_session_revisions WHERE session_id=?").get(receipt.sessionId);
    if (!revision || !Number.isSafeInteger(Number(revision.revision)) || Number(revision.revision) < receipt.savedRevision) throw new AgentWorkError("planning_save_receipt_invalid");
    return { saveReceipt: receipt, inputSha256: identity.inputSha256, planningRevision: Number(revision.revision) };
  }

  savePlanningMessage(input: { sessionId?: string; messageId: string; expectedRevision: number; text: string }) {
    if ((input.sessionId !== undefined && (typeof input.sessionId !== "string" || !input.sessionId.trim() || input.sessionId.length > 128)) || typeof input.messageId !== "string" || !input.messageId.trim() || input.messageId.length > 128 || typeof input.text !== "string" || !input.text.trim() || input.text.trim().length > 1500 || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) throw new AgentWorkError("planning_message_invalid");
    const text = input.text.trim();
    const digest = workDigest({ text });
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const old = this.database.prepare("SELECT * FROM planning_message_receipts WHERE message_id=?").get(input.messageId);
      if (old) {
        if ((input.sessionId && input.sessionId !== old.session_id) || old.input_sha256 !== digest || input.expectedRevision !== old.expected_revision) throw new AgentWorkError("planning_message_conflict");
        const session = this.getPlanningSessionById(String(old.session_id))!;
        this.database.exec("COMMIT");
        return { session, revision: this.getPlanningRevision(session.id), savedRevision: Number(old.saved_revision), reused: true };
      }
      const session = input.sessionId ? this.getPlanningSessionById(input.sessionId) : this.getPlanningSession() ?? this.createPlanningSession("travel");
      if (!session) throw new AgentWorkError("planning_session_missing");
      if (["generating", "draft_ready", "abandoned"].includes(session.status)) throw new AgentWorkError("planning_session_not_editable");
      const revision = this.getPlanningRevision(session.id);
      if (revision !== input.expectedRevision) throw new AgentWorkError("planning_revision_conflict");
      const { confirmedProposalVersion: _approval, ...unconfirmed } = session;
      const next: PlanningSession = { ...unconfirmed, status: "collecting", updatedAt: new Date().toISOString(), messages: [...session.messages, { id: input.messageId, role: "user", text, createdAt: new Date().toISOString() }] };
      this.savePlanningSession(next);
      this.database.prepare("INSERT INTO planning_session_revisions VALUES (?,?) ON CONFLICT(session_id) DO UPDATE SET revision=excluded.revision").run(session.id, revision + 1);
      this.database.prepare("INSERT INTO planning_message_receipts VALUES (?,?,?,?,?)").run(input.messageId, session.id, digest, revision, revision + 1);
      this.database.exec("COMMIT");
      return { session: next, revision: revision + 1, savedRevision: revision + 1, reused: false };
    } catch (error) { this.database.exec("ROLLBACK"); throw error; }
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

  /** 精确版本的结构快照；调用者不能把它当作真实源或当前供应商事实。 */
  listApprovedBookingConstraintsForPlan(planId: string): BlueprintBookingConstraint[] {
    const lineage = this.getPlanBlueprintLineage(planId);
    return structuredClone(lineage ? this.getTripBlueprint(lineage.blueprintId, lineage.blueprintVersion)?.bookingConstraints ?? [] : []);
  }

  /** 当前资料集合仅由请求 Plan 的精确 Blueprint 来源白名单决定。 */
  listCurrentTravelBookingSourcesForPlan(planId: string,options:{includePending?:boolean}={}): TravelBooking[] {
    const state=this.bookingSourceState(planId);
    return options.includePending?[...state.bookings,...state.pendingBookings]:state.bookings;
  }
  getCurrentTravelBookingSourceSetDigest(planId:string):string {return this.bookingSourceState(planId).sourceSetDigest;}

  getBookingRelationshipReviewContext(planId: string) {
    const workspace = this.getWorkspace();
    if (workspace.activePlan.id !== planId || !workspace.activeBlueprint) throw new WorkspaceMutationError("请返回当前草稿审阅预订关联。", "version_conflict");
    const state = this.bookingSourceState(planId);
    const safeSource = (booking: TravelBooking) => { const constraint = blueprintBookingConstraintsFromTravelBookings([booking])[0]!; return { bookingId: booking.id, title: constraint.title, type: constraint.type, status: constraint.status, constraintStrength:constraint.constraintStrength,sourceLabel: constraint.sourceLabel, segments: constraint.segments, ownership: booking.planningSessionId ? "planning_session" as const : "plan" as const, recordDigest: this.bookingRecordDigest(booking), sourceDigest: this.bookingSourceDigest(booking) }; };
    return { expectedPlanId: planId, expectedVersion: workspace.activePlan.version, ...bookingRelationshipReviewContext(workspace.activeBlueprint), sourceSetDigest: state.sourceSetDigest,pendingSourceBookingIds:state.pendingBookings.map(booking=>booking.id), sourceIssues: state.issues, sourceRecords: state.bookings.map(safeSource), sourceCandidates: this.bookingSourceCandidates(planId).map(safeSource), sourceConstraints: blueprintBookingConstraintsFromTravelBookings(state.bookings), constraints: structuredClone(workspace.activeBlueprint.bookingConstraints ?? []), assessment: workspace.activeBlueprint.bookingRelationshipAssessment };
  }

  private bookingRecordDigest(booking: TravelBooking): string { return bookingRelationshipDigest(booking); }
  private bookingSourceDigest(booking: TravelBooking): string {
    return bookingRelationshipDigest(bookingRelationshipSourceUnits(blueprintBookingConstraintsFromTravelBookings([booking])));
  }
  private directOwnedBookings(planId: string): TravelBooking[] {
    return (this.database.prepare("SELECT * FROM travel_bookings WHERE plan_id=? ORDER BY created_at,rowid").all(planId) as unknown as TravelBookingRow[]).map(travelBookingFromRow);
  }
  private bookingSourceCandidates(planId: string): TravelBooking[] {
    const lineage = this.getPlanBlueprintLineage(planId);
    if (!lineage) return this.directOwnedBookings(planId);
    const blueprint = this.getTripBlueprint(lineage.blueprintId, lineage.blueprintVersion);
    if (!blueprint) return [];
    const plans = this.database.prepare("SELECT DISTINCT plan_id FROM plan_blueprint_lineage WHERE blueprint_id=?").all(blueprint.id) as {plan_id:string}[];
    const scopedPlans=plans.filter(plan=>{const owner=this.getPlanBlueprintLineage(plan.plan_id);const snapshot=owner?this.getTripBlueprint(owner.blueprintId,owner.blueprintVersion):undefined;return snapshot?.proposalRef.sessionId===blueprint.proposalRef.sessionId&&snapshot.proposalRef.proposalVersion===blueprint.proposalRef.proposalVersion;});
    const values = [...this.listTravelBookingsForPlanningSession(blueprint.proposalRef.sessionId), ...scopedPlans.flatMap(plan => this.directOwnedBookings(plan.plan_id))];
    return [...new Map(values.map(booking => [booking.id, booking])).values()];
  }
  /** 仅沿正规提交的精确结果身份回溯，不把兄弟候选当作来源义务。 */
  private bookingSourceObligations(planId:string,blueprint:TripBlueprint) {
    const bookings=new Map<string,TravelBooking>(),mappedIds=new Set<string>(),issues:string[]=[],visited=new Set<string>(),resolutionIssues:BookingRelationshipSourceContext["resolutionIssues"]=[];
    const candidates=new Map(this.bookingSourceCandidates(planId).map(booking=>[booking.id,booking]));
    const inScope=(value:TripBlueprint)=>value.id===blueprint.id&&value.proposalRef.sessionId===blueprint.proposalRef.sessionId&&value.proposalRef.proposalVersion===blueprint.proposalRef.proposalVersion;
    const validNumber=(value:unknown):value is number=>typeof value==="number"&&Number.isSafeInteger(value)&&value>0;
    const readNode=(id:string)=>{
      const plan=this.database.prepare("SELECT id,version FROM plans WHERE id=?").get(id) as {id:string;version:number}|undefined;
      const lineage=this.getPlanBlueprintLineage(id),snapshot=lineage?this.getTripBlueprint(lineage.blueprintId,lineage.blueprintVersion):undefined;
      if(!plan||!lineage||!snapshot||!validNumber(plan.version)||!validNumber(lineage.planVersion)||!validNumber(snapshot.version)||plan.version<lineage.planVersion||!inScope(snapshot))throw new Error("来源节点当前范围无法核对");
      return {plan,lineage,snapshot};
    };
    const verifyParent=(parentId:string,expectedVersion:number,before:TripBlueprint,receipt:object,currentId:string)=>{
      if(parentId===currentId||!validNumber(expectedVersion)||!inScope(before))throw new Error("来源父身份无效");
      const parent=readNode(parentId);
      if(expectedVersion>parent.plan.version||before.version>parent.snapshot.version||(parent.snapshot.version===before.version&&expectedVersion<parent.lineage.planVersion))throw new Error("来源父版本超出已存边界");
      if(Object.hasOwn(receipt,"beforeIdentity")) {
        const identity=(receipt as {beforeIdentity?:BlueprintMutationBeforeIdentity}).beforeIdentity;
        if(!identity||identity.planId!==parentId||identity.planVersion!==expectedVersion||identity.blueprintId!==before.id||identity.blueprintVersion!==before.version)throw new Error("来源回执基准身份不一致");
      }
      return parent;
    };
    const verifyOrigin=(current:ReturnType<typeof readNode>,identity:{planId:string;planVersion:number;blueprintId:string;blueprintVersion:number},after:TripBlueprint)=>{
      if(identity.planId!==current.plan.id||identity.planVersion!==1||identity.planVersion>current.plan.version||identity.blueprintId!==after.id||identity.blueprintVersion!==after.version||after.version>current.snapshot.version||!inScope(after)||!resolveBlueprintPlanCompilationIdentity(after.id,after.version,identity.planId))throw new Error("来源创建结果身份无效");
    };
    const corrupt=()=>{issues.push("来源继承记录无法完整核对，请保留当前草稿并重新核对来源。");resolutionIssues.push({code:"unverified_ancestor"});};
    let node:string|undefined=planId;
    while(node) {
      if(visited.has(node)){corrupt();break;}visited.add(node);
      let current:ReturnType<typeof readNode>;
      try{current=readNode(node);}catch{corrupt();break;}
      const {snapshot}=current;
      for(const booking of this.directOwnedBookings(node))bookings.set(booking.id,booking);
      for(const constraint of snapshot.bookingConstraints??[])if(constraint.sourceBookingId)mappedIds.add(constraint.sourceBookingId);
      const parents=new Set<string>();
      let originProofs=0;
      const edits=this.database.prepare("SELECT plan_id,plan_version,blueprint_id,blueprint_version,base_blueprint_version,before_json,after_json,fingerprint,result_json FROM direct_blueprint_edits WHERE plan_id=?").all(node) as Array<{plan_id:string;plan_version:number;blueprint_id:string;blueprint_version:number;base_blueprint_version:number;before_json:string;after_json:string;fingerprint:string;result_json:string}>;
      for(const edit of edits)try{
        const before=JSON.parse(edit.before_json) as TripBlueprint,after=JSON.parse(edit.after_json) as TripBlueprint,request=JSON.parse(edit.fingerprint) as Record<string,unknown>,result=JSON.parse(edit.result_json) as DirectBlueprintRevisionSaveResult;
        const identity=result.originalResult??{planId:result.workspace?.activePlan.id,planVersion:result.workspace?.activePlan.version,blueprintId:result.workspace?.activeBlueprint?.id,blueprintVersion:result.workspace?.activeBlueprint?.version};
        if(identity.planId!==node||identity.planVersion!==edit.plan_version||identity.blueprintId!==edit.blueprint_id||identity.blueprintVersion!==edit.blueprint_version||!inScope(before)||!inScope(after)||before.version!==edit.base_blueprint_version||after.version!==edit.blueprint_version||after.version!==before.version+1||typeof request.expectedPlanId!=="string"||!validNumber(request.expectedVersion)||(request.expectedBlueprintVersion!==undefined&&request.expectedBlueprintVersion!==before.version)||!isDeepStrictEqual(this.getTripBlueprint(before.id,before.version),before)||!isDeepStrictEqual(this.getTripBlueprint(after.id,after.version),after))throw new Error("来源继承身份不一致");
        verifyOrigin(current,{planId:identity.planId,planVersion:identity.planVersion,blueprintId:edit.blueprint_id,blueprintVersion:edit.blueprint_version},after);
        if(result.workspace?.activePlan.id!==identity.planId||result.workspace.activePlan.version!==identity.planVersion||result.workspace.activeBlueprint?.id!==identity.blueprintId||result.workspace.activeBlueprint.version!==identity.blueprintVersion||!isDeepStrictEqual(result.workspace.activeBlueprint,after))throw new Error("来源原工作区与创建结果不一致");
        verifyParent(request.expectedPlanId,request.expectedVersion,before,result,node);
        for(const constraint of before.bookingConstraints??[])if(constraint.sourceBookingId)mappedIds.add(constraint.sourceBookingId);
        originProofs++;parents.add(request.expectedPlanId);
      }catch{corrupt();}
      const receipts=this.database.prepare("SELECT result_json FROM booking_mutation_receipts WHERE CASE WHEN json_valid(result_json) THEN json_extract(result_json,'$.planId') END=?").all(node) as {result_json:string}[];
      for(const receipt of receipts)try{
        const result=JSON.parse(receipt.result_json) as Record<string,unknown>,request=result.originalRequest as Record<string,unknown>|undefined;
        if(!request||request.operation!=="import_booking"||request.targetKind!=="plan"||typeof request.targetId!=="string"||!validNumber(request.expectedVersion)||!validNumber(result.planVersion))throw new Error("预订原请求身份缺失");
        if(request.targetId===node){
          if(result.planVersion>current.plan.version||request.expectedVersion>current.plan.version||result.blueprintId!==undefined&&(result.blueprintId!==blueprint.id||result.blueprintVersion!==request.expectedBlueprintVersion||!validNumber(result.blueprintVersion)||result.blueprintVersion>current.snapshot.version))throw new Error("预订原结果身份不一致");
          if(Object.hasOwn(result,"beforeIdentity")){const identity=result.beforeIdentity as BlueprintMutationBeforeIdentity|undefined;if(!identity||identity.planId!==node||identity.planVersion!==request.expectedVersion||identity.blueprintId!==blueprint.id||identity.blueprintVersion!==request.expectedBlueprintVersion)throw new Error("预订资料回执基准身份不一致");}
          continue;
        }
        if(result.blueprintId!==blueprint.id||!validNumber(result.blueprintVersion)||!validNumber(request.expectedBlueprintVersion)||result.blueprintVersion!==request.expectedBlueprintVersion+1)throw new Error("预订来源结果不属于本次旅行");
        const before=this.getTripBlueprint(blueprint.id,request.expectedBlueprintVersion),after=this.getTripBlueprint(blueprint.id,result.blueprintVersion);
        if(!before||!after||!inScope(before)||!inScope(after))throw new Error("预订来源基准缺失");
        verifyOrigin(current,{planId:String(result.planId),planVersion:result.planVersion,blueprintId:String(result.blueprintId),blueprintVersion:result.blueprintVersion},after);
        verifyParent(request.targetId,request.expectedVersion,before,result,node);
        for(const constraint of before.bookingConstraints??[])if(constraint.sourceBookingId)mappedIds.add(constraint.sourceBookingId);
        originProofs++;parents.add(request.targetId);
      }catch{corrupt();}
      const undos=this.database.prepare("SELECT revision_id,fingerprint,result_json FROM direct_blueprint_undos WHERE CASE WHEN json_valid(result_json) THEN json_extract(result_json,'$.activePlan.id') END=?").all(node) as Array<{revision_id:string;fingerprint:string;result_json:string}>;
      for(const undo of undos)try{
        const request=JSON.parse(undo.fingerprint) as Record<string,unknown>,result=JSON.parse(undo.result_json) as DirectBlueprintUndoReceipt;
        if(result.activePlan.id!==node||!validNumber(result.activePlan.version)||!result.activeBlueprint||!inScope(result.activeBlueprint)||typeof request.expectedPlanId!=="string"||!validNumber(request.expectedVersion)||!validNumber(request.expectedBlueprintVersion)||result.activeBlueprint.version!==request.expectedBlueprintVersion+1||!isDeepStrictEqual(this.getTripBlueprint(blueprint.id,result.activeBlueprint.version),result.activeBlueprint))throw new Error("撤销来源结果身份不一致");
        const before=this.getTripBlueprint(blueprint.id,request.expectedBlueprintVersion);
        const original=this.database.prepare("SELECT plan_id,blueprint_id,blueprint_version,after_json FROM direct_blueprint_edits WHERE id=?").get(undo.revision_id) as {plan_id:string;blueprint_id:string;blueprint_version:number;after_json:string}|undefined;
        if(!before||!inScope(before)||request.revisionId!==undo.revision_id||!original||original.plan_id!==request.expectedPlanId||original.blueprint_id!==before.id||original.blueprint_version!==before.version||!isDeepStrictEqual(JSON.parse(original.after_json),before))throw new Error("撤销来源基准无法核对");
        verifyOrigin(current,{planId:result.activePlan.id,planVersion:result.activePlan.version,blueprintId:result.activeBlueprint.id,blueprintVersion:result.activeBlueprint.version},result.activeBlueprint);
        verifyParent(request.expectedPlanId,request.expectedVersion,before,result,node);
        for(const constraint of before.bookingConstraints??[])if(constraint.sourceBookingId)mappedIds.add(constraint.sourceBookingId);
        originProofs++;parents.add(request.expectedPlanId);
      }catch{corrupt();}
      if(parents.size>1||originProofs>1){corrupt();break;}
      node=parents.values().next().value;
    }
    for(const id of mappedIds){const booking=candidates.get(id);if(booking)bookings.set(id,booking);else {issues.push("既有预订来源无法读取，请重新核对原资料。");resolutionIssues.push({code:"missing_source",sourceBookingId:id});}}
    return {bookings:[...bookings.values()],issues,resolutionIssues};
  }
  private bookingSourceState(planId: string) {
    const lineage = this.getPlanBlueprintLineage(planId);
    if (!lineage) {
      const bookings = this.directOwnedBookings(planId);
      return { bookings,pendingBookings:[] as TravelBooking[], issues: [] as string[],resolutionIssues:[] as BookingRelationshipSourceContext["resolutionIssues"], sourceSetDigest: bookingRelationshipDigest(bookings.map(booking => ({ id: booking.id, digest: this.bookingSourceDigest(booking) })).sort((a,b)=>a.id.localeCompare(b.id))) };
    }
    const blueprint = this.getTripBlueprint(lineage.blueprintId, lineage.blueprintVersion);
    if (!blueprint) throw new WorkspaceMutationError("当前蓝图来源无法读取。", "blueprint_required");
    const candidates = new Map(this.bookingSourceCandidates(planId).map(booking => [booking.id, booking]));
    const bookings: TravelBooking[] = [], issues: string[] = [], seen = new Set<string>(),resolutionIssues:BookingRelationshipSourceContext["resolutionIssues"]=[];
    for (const constraint of blueprint.bookingConstraints ?? []) {
      const id = constraint.sourceBookingId;
      if (!id || seen.has(id)) { issues.push("预订来源尚未确定或重复，请明确选择保存资料。");resolutionIssues.push({code:"invalid_mapping",bookingConstraintId:constraint.id,...(id?{sourceBookingId:id}:{})}); continue; }
      seen.add(id);
      const booking = candidates.get(id);
      if (!booking) { issues.push("预订来源已变化，请重新核对。");resolutionIssues.push({code:this.database.prepare("SELECT 1 FROM travel_bookings WHERE id=?").get(id)?"source_scope_unresolved":"missing_source",sourceBookingId:id,bookingConstraintId:constraint.id}); continue; }
      bookings.push(booking);
      const mappedSegments=constraint.segments.map(segment=>segment.sourceSegmentId);
      if (constraint.segments.some(segment => !segment.sourceSegmentId || !booking.segments.some(source => source.id === segment.sourceSegmentId))||mappedSegments.length!==booking.segments.length||new Set(mappedSegments).size!==mappedSegments.length) {issues.push("预订分段已变化，请重新核对。");resolutionIssues.push({code:"invalid_mapping",sourceBookingId:id,bookingConstraintId:constraint.id});}
    }
    if (bookingRelationshipDigest(bookingRelationshipReviewContext(blueprint).units) !== bookingRelationshipDigest(bookingRelationshipReviewContext({...blueprint,bookingConstraints:blueprintBookingConstraintsFromTravelBookings(bookings)}).units)) issues.push("当前保存资料与此版本采用的预订不同，请先选择来源并保存更正。");
    const obligation=this.bookingSourceObligations(planId,blueprint),pendingBookings=obligation.bookings.filter(booking=>!seen.has(booking.id));issues.push(...obligation.issues);resolutionIssues.push(...obligation.resolutionIssues);
    if(pendingBookings.length)issues.push("尚有已保存的预订资料未纳入本版本，请先选择来源并核对。");
    const sourceSetDigest = bookingRelationshipDigest({ sources: bookings.map(booking => ({ id: booking.id, digest: this.bookingSourceDigest(booking) })).sort((a,b)=>a.id.localeCompare(b.id)),pending:pendingBookings.map(booking=>({id:booking.id,digest:this.bookingSourceDigest(booking)})).sort((a,b)=>a.id.localeCompare(b.id)),candidates: [...candidates.values()].map(booking=>({id:booking.id,digest:this.bookingSourceDigest(booking)})).sort((a,b)=>a.id.localeCompare(b.id)), unresolved: issues, bindings: (blueprint.bookingConstraints ?? []).map(value => ({ id: value.id, sourceBookingId: value.sourceBookingId })) });
    return { bookings,pendingBookings, issues,resolutionIssues, sourceSetDigest };
  }
  private bookingRuntimeSourceContext(plan:Plan,blueprint:TripBlueprint,state=this.bookingSourceState(plan.id)):BookingRelationshipSourceContext {
    return {planId:plan.id,planVersion:plan.version,blueprintId:blueprint.id,blueprintVersion:blueprint.version,sourceSetDigest:state.sourceSetDigest,adoptedUnits:bookingRelationshipSourceUnits(blueprintBookingConstraintsFromTravelBookings(state.bookings)),pendingSources:state.pendingBookings.map(booking=>({sourceBookingId:booking.id,sourceDigest:this.bookingSourceDigest(booking)})),resolutionIssues:state.resolutionIssues};
  }

  hasTravelBookingSourceHash(scope: { planningSessionId?: string; planId?: string }, sourceHash: string): boolean {
    const hash = sourceHash.trim();
    if (!hash) return false;
    if (scope.planningSessionId) {
      const row = this.database.prepare("SELECT id FROM travel_bookings WHERE planning_session_id = ? AND source_hash = ? LIMIT 1").get(scope.planningSessionId, hash);
      if (row) return true;
    }
    if (scope.planId) {
      if (this.listCurrentTravelBookingSourcesForPlan(scope.planId,{includePending:true}).some(booking => booking.sourceHash === hash)) return true;
    }
    return false;
  }

  saveTravelBooking(booking: TravelBooking): TravelBooking {
    if (!booking.planningSessionId && !booking.planId) throw new Error("A booking must belong to a Planning Session or Plan.");
    if (booking.planningSessionId && !this.getPlanningSessionById(booking.planningSessionId)) throw new Error("The planning session was not found.");
    if (booking.planId && !this.database.prepare("SELECT id FROM plans WHERE id = ?").get(booking.planId)) throw new Error("The Plan was not found.");
    if (!this.bookingWriteDepth && ((booking.planId && this.getPlanBlueprintLineage(booking.planId)) || (booking.planningSessionId && this.database.prepare("SELECT 1 FROM trip_blueprints WHERE json_extract(content_json,'$.proposalRef.sessionId')=? LIMIT 1").get(booking.planningSessionId)))) throw new WorkspaceMutationError("已发布旅行的预订须通过精确版本更正保存。", "version_conflict");
    if(!this.bookingWriteDepth&&booking.planId&&this.getExecutionPlan()?.id===booking.planId)throw new WorkspaceMutationError("旧版执行行程须先重新规划取得可审阅蓝图。","blueprint_required");
    if (new Set(booking.segments.map(segment => segment.id)).size !== booking.segments.length || booking.segments.some(segment => !segment.id.trim())) throw new WorkspaceMutationError("预订分段身份无效。", "invalid_edit");
    const existing = this.database.prepare("SELECT planning_session_id,plan_id FROM travel_bookings WHERE id=?").get(booking.id) as {planning_session_id:string|null;plan_id:string|null}|undefined;
    if (existing && ((existing.planning_session_id ?? undefined) !== booking.planningSessionId || (existing.plan_id ?? undefined) !== booking.planId)) throw new WorkspaceMutationError("预订所属计划或规划会话不能改变。", "invalid_edit");
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

  /** 补充导入、保护附件和新草稿共享一个事务，失败不留下部分预订。 */
  savePlanTravelBooking(input: { targetPlanId?: string; booking: TravelBooking; expectedVersion: number; expectedBlueprintVersion?: number; expectedSourceSetDigest?: string; expectedRecordDigest?: string; requestId?: string; requestDigest?: string; requestIdentity?: Record<string,unknown>; sourceContent?: string }): WorkspaceSnapshot {
    return this.directBlueprintTransaction(() => {
      if (input.requestId && input.requestDigest) {
        const receipt = this.database.prepare("SELECT request_digest FROM booking_mutation_receipts WHERE request_id=?").get(input.requestId) as {request_digest:string}|undefined;
        if (receipt) { if (receipt.request_digest !== input.requestDigest) throw new WorkspaceMutationError("预订请求身份不能用于不同载荷。", "request_identity_conflict"); return this.getWorkspace(); }
      }
      const current = this.getWorkspace();
      const targetPlanId = input.targetPlanId ?? input.booking.planId;
      const plan = current.activePlan.id === targetPlanId ? current.activePlan : current.executionPlan?.id === targetPlanId ? current.executionPlan : undefined;
      if (!plan || plan.version !== input.expectedVersion) throw new WorkspaceMutationError("预订审阅期间计划已变化。", "version_conflict");
      if (current.activePlan.id !== plan.id) throw new WorkspaceMutationError("请在当前替换草稿处理预订更正。", "version_conflict");
      const state = this.bookingSourceState(plan.id);
      const lineage = this.getPlanBlueprintLineage(plan.id);
      const blueprint = lineage ? this.getTripBlueprint(lineage.blueprintId,lineage.blueprintVersion) : undefined;
      if(input.expectedSourceSetDigest!==state.sourceSetDigest||(!blueprint&&input.expectedBlueprintVersion!==undefined))throw new WorkspaceMutationError("预订源集合已变化，请重新打开预览。","version_conflict");
      if (blueprint && (input.expectedBlueprintVersion !== blueprint.version || input.expectedSourceSetDigest !== state.sourceSetDigest)) throw new WorkspaceMutationError("预订或蓝图已变化，请重新审阅。", "version_conflict");
      const existingRow = this.database.prepare("SELECT * FROM travel_bookings WHERE id=?").get(input.booking.id) as TravelBookingRow|undefined;
      const existing = existingRow ? travelBookingFromRow(existingRow) : undefined;
      if (existing && (!state.bookings.some(booking=>booking.id===existing.id) || input.expectedRecordDigest !== this.bookingRecordDigest(existing))) throw new WorkspaceMutationError("预订资料已变化或不属于当前旅行。", "version_conflict");
      if (!existing && (input.booking.planId !== plan.id || input.booking.planningSessionId)) throw new WorkspaceMutationError("新预订须属于当前目标计划。", "invalid_edit");
      if(!blueprint&&plan.status==="active"&&(!existing||this.bookingSourceDigest(existing)!==this.bookingSourceDigest(input.booking)))throw new WorkspaceMutationError("旧版执行行程须先重新规划取得可审阅蓝图。","blueprint_required");
      const booking = existing ? { ...input.booking, ...(existing.planId ? {planId:existing.planId} : {}), ...(existing.planningSessionId ? {planningSessionId:existing.planningSessionId} : {}) } : input.booking;
      if (existing?.planId === undefined) delete booking.planId;
      if (existing?.planningSessionId === undefined) delete booking.planningSessionId;
      if (!existing) booking.planId = plan.id;
      this.bookingWriteDepth++;
      try { this.saveTravelBooking(booking); } finally { this.bookingWriteDepth--; }
      if (input.sourceContent?.trim()) {
        if (input.sourceContent.length > 80_000) throw new WorkspaceMutationError("预订附件过长。", "invalid_edit");
        this.saveProtectedBookingAttachment({ bookingId: input.booking.id, sourceHash: input.booking.sourceHash, sourceLabel: input.booking.sourceLabel, contentText: input.sourceContent, createdAt: input.booking.importedAt });
      }
      let result: WorkspaceSnapshot;
      if (blueprint) {
        if (current.activeBlueprint?.id !== blueprint.id) throw new WorkspaceMutationError("请先返回当前旅行处理预订更正。", "version_conflict");
        const sources = [...state.bookings.filter(value=>value.id!==booking.id),booking];
        const constraints = blueprintBookingConstraintsFromTravelBookings(sources);
        const beforeDigest = bookingRelationshipReviewContext(blueprint).units;
        const afterDigest = bookingRelationshipReviewContext({...blueprint,bookingConstraints:constraints}).units;
        if (bookingRelationshipDigest(beforeDigest) !== bookingRelationshipDigest(afterDigest)) {
          const next = reconcileBookingRelationshipAssessment({ ...structuredClone(current.activeBlueprint), version: current.activeBlueprint.version + 1, createdAt: booking.updatedAt }, constraints);
          this.saveTripBlueprint(next);
          const previousLineage=this.getPlanBlueprintLineage(current.activePlan.id);
          const compilation = compileTripBlueprint(next, {createdAt:next.createdAt,completedRequirementIds:completedRequirementIdsForWorkspace(current),...(previousLineage&&current.activeBlueprint?{previousCompilation:{blueprint:current.activeBlueprint,plan:current.activePlan,lineage:previousLineage}}:{})});
          compilation.plan.configuration = mergeUserPlanConfiguration(compilation.plan.configuration,current.activePlan.configuration,current.activeBlueprint);
          this.createCompiledBlueprintPlan(compilation);
        }
        result = this.getWorkspace();
      } else result = plan.status==="active"?this.getWorkspace():this.applyTravelBookingToCurrentPlan(booking,input.expectedVersion);
      if (input.requestId && input.requestDigest) this.database.prepare("INSERT INTO booking_mutation_receipts VALUES(?,?,?,?)").run(input.requestId,input.requestDigest,JSON.stringify({...(blueprint?{beforeIdentity:{planId:plan.id,planVersion:plan.version,blueprintId:blueprint.id,blueprintVersion:blueprint.version}}:{}),originalRequest:input.requestIdentity,bookingId:booking.id,planId:result.activePlan.id,planVersion:result.activePlan.version,blueprintId:result.activeBlueprint?.id,blueprintVersion:result.activeBlueprint?.version}),booking.updatedAt);
      return result;
    });
  }

  savePlanningTravelBooking(input: { booking: TravelBooking; expectedRevision: number; expectedRecordDigest?: string; requestId: string; requestDigest: string; requestIdentity?:Record<string,unknown>; sourceContent?: string }, applyFacts: () => void): TravelBooking {
    return this.directBlueprintTransaction(() => {
      const receipt = this.database.prepare("SELECT request_digest,result_json FROM booking_mutation_receipts WHERE request_id=?").get(input.requestId) as {request_digest:string;result_json:string}|undefined;
      if (receipt) { if (receipt.request_digest !== input.requestDigest) throw new WorkspaceMutationError("预订请求身份不能用于不同载荷。", "request_identity_conflict");const saved=JSON.parse(receipt.result_json) as {bookingId:string}; const row=this.database.prepare("SELECT * FROM travel_bookings WHERE id=?").get(saved.bookingId) as TravelBookingRow|undefined; if (!row) throw new WorkspaceMutationError("预订回执无法核对。", "version_conflict"); return travelBookingFromRow(row); }
      const sessionId = input.booking.planningSessionId;
      const session = sessionId ? this.getPlanningSessionById(sessionId) : undefined;
      if (!session || ["generating","draft_ready","abandoned"].includes(session.status) || this.database.prepare("SELECT 1 FROM trip_blueprints WHERE json_extract(content_json,'$.proposalRef.sessionId')=? LIMIT 1").get(session.id)) throw new WorkspaceMutationError("已发布旅行的预订请在当前行程中更正。", "version_conflict");
      if (this.getPlanningRevision(session.id) !== input.expectedRevision) throw new WorkspaceMutationError("规划会话已变化，请重新审阅预订。", "version_conflict");
      const existingRow = this.database.prepare("SELECT * FROM travel_bookings WHERE id=?").get(input.booking.id) as TravelBookingRow|undefined;
      if (existingRow && this.bookingRecordDigest(travelBookingFromRow(existingRow)) !== input.expectedRecordDigest) throw new WorkspaceMutationError("预订资料已变化，请重新审阅。", "version_conflict");
      this.saveTravelBooking(input.booking);
      if (input.sourceContent?.trim()) { if(input.sourceContent.length>80_000) throw new WorkspaceMutationError("预订附件过长。","invalid_edit"); this.saveProtectedBookingAttachment({bookingId:input.booking.id,sourceHash:input.booking.sourceHash,sourceLabel:input.booking.sourceLabel,contentText:input.sourceContent,createdAt:input.booking.importedAt}); }
      applyFacts();
      this.database.prepare("INSERT INTO planning_session_revisions VALUES (?,?) ON CONFLICT(session_id) DO UPDATE SET revision=excluded.revision").run(session.id,input.expectedRevision+1);
      this.database.prepare("INSERT INTO booking_mutation_receipts VALUES(?,?,?,?)").run(input.requestId,input.requestDigest,JSON.stringify({originalRequest:input.requestIdentity,sessionId:session.id,bookingId:input.booking.id,revision:input.expectedRevision+1}),input.booking.updatedAt);
      return input.booking;
    });
  }

  getBookingMutationReceipt(requestId: string, requestDigest: string, expectedIdentity:Record<string,unknown>) {
    const row=this.database.prepare("SELECT request_digest,result_json FROM booking_mutation_receipts WHERE request_id=?").get(requestId) as {request_digest:string;result_json:string}|undefined;
    if(!row) return {requestId,requestDigest,status:"not_found" as const};
    if(row.request_digest!==requestDigest) throw new WorkspaceMutationError("预订回执载荷不匹配。","request_identity_conflict");
    const originalResult=JSON.parse(row.result_json) as Record<string,unknown>;
    if(bookingRelationshipDigest(originalResult.originalRequest)!==bookingRelationshipDigest(expectedIdentity))throw new WorkspaceMutationError("预订回执目标或原版本不匹配。","request_identity_conflict");
    const bookingRow=typeof originalResult.bookingId==="string"?this.database.prepare("SELECT * FROM travel_bookings WHERE id=?").get(originalResult.bookingId) as TravelBookingRow|undefined:undefined;
    return {requestId,requestDigest,status:"committed" as const,originalRequest:originalResult.originalRequest,originalResult,workspace:this.getWorkspace(),...(bookingRow?{booking:travelBookingFromRow(bookingRow)}:{}),...(typeof originalResult.sessionId==="string"?{planningSession:this.getPlanningSessionById(originalResult.sessionId)}:{})};
  }

  atomicBookingImport<T>(operation:()=>T):T { return this.directBlueprintTransaction(operation); }

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
    if(plan.status==="active")throw new WorkspaceMutationError("执行行程预订须先审阅替换草稿。","draft_required");
    if (this.getPlanBlueprintLineage(plan.id)) throw new WorkspaceMutationError("蓝图预订须通过完整版本化保存命令。", "version_conflict");
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

  getGenerationCarrierCheckpoint(generationKey: string): ReturnType<GenerationCarrierStore["getGenerationCarrierCheckpoint"]> {
    return this.generationCarriers.getGenerationCarrierCheckpoint(generationKey);
  }

  saveBlueprintGeneration(generation: BlueprintGeneration): BlueprintGeneration {
    if (!generation.generationKey.trim() || !generation.proposalRef.sessionId.trim() || !Number.isInteger(generation.proposalRef.proposalVersion) || generation.proposalRef.proposalVersion < 1) throw new Error("Blueprint Generation needs a valid key and Proposal reference.");
    if (!generation.skillLineage.skillId.trim() || !generation.skillLineage.skillVersion.trim()) throw new Error("Blueprint Generation needs Skill lineage.");
    this.database.prepare(`INSERT INTO blueprint_generations (generation_key, session_id, proposal_version, skill_id, skill_version, status, stage,
      research_set_id, blueprint_id, blueprint_version, failure_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(generation_key) DO UPDATE SET status = CASE WHEN blueprint_generations.status = 'cancelled' THEN blueprint_generations.status ELSE excluded.status END, stage = excluded.stage,
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

  saveResearchSet(research: ResearchSet, carrierCheckpoint?: GenerationCarrierCheckpoint): ResearchSet {
    assertResearchSetIntegrity(research);
    const generation = this.getBlueprintGeneration(research.generationKey);
    if (!generation) throw new Error("Save Blueprint Generation before its Research Set.");
    if (generation.proposalRef.sessionId !== research.proposalRef.sessionId || generation.proposalRef.proposalVersion !== research.proposalRef.proposalVersion) throw new Error("Research Set does not match its confirmed Proposal.");
    if (generation.skillLineage.skillId !== research.skillLineage.skillId || generation.skillLineage.skillVersion !== research.skillLineage.skillVersion) throw new Error("Research Set does not match its Skill lineage.");
    if (carrierCheckpoint && carrierCheckpoint.generationEvent.generationKey !== research.generationKey) throw new Error("Research carrier 检查点属于另一个 Generation。");
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.assertGenerationWrite(research.generationKey, carrierCheckpoint);
      this.database.prepare(`INSERT INTO research_sets (id, generation_key, schema_version, status, content_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET status = excluded.status, content_json = excluded.content_json, updated_at = excluded.updated_at`).run(
        research.id, research.generationKey, research.schemaVersion, research.status, JSON.stringify(research), research.createdAt, research.updatedAt
      );
      this.database.prepare("UPDATE blueprint_generations SET research_set_id = ?, updated_at = ? WHERE generation_key = ?").run(research.id, research.updatedAt, research.generationKey);
      if (carrierCheckpoint) {
        this.generationCarriers.markCarriersImported({
          generationKey: research.generationKey,
          carrierTaskIds: carrierCheckpoint.carrierTaskIds,
          expectedCarriers: carrierCheckpoint.expectedCarriers,
          validatedStatus: "validated",
          importedStatus: "imported",
          updatedAt: carrierCheckpoint.generationEvent.createdAt
        });
        this.insertBlueprintGenerationEvent(carrierCheckpoint.generationEvent);
      }
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return this.getResearchSet(research.id)!;
  }

  saveResearchSetAndTripBlueprint(
    research: ResearchSet,
    blueprint: TripBlueprint,
    imageContinuation?: { planId: string; expectedBlueprint: TripBlueprint; expectedResearch: ResearchSet },
    carrierCheckpoint?: GenerationCarrierCheckpoint
  ): { research: ResearchSet; blueprint: TripBlueprint } {
    assertResearchSetIntegrity(research);
    const generation = this.getBlueprintGeneration(research.generationKey);
    if (!generation) throw new Error("Save Blueprint Generation before its Research Set.");
    if (generation.proposalRef.sessionId !== research.proposalRef.sessionId || generation.proposalRef.proposalVersion !== research.proposalRef.proposalVersion) throw new Error("Research Set does not match its confirmed Proposal.");
    if (generation.skillLineage.skillId !== research.skillLineage.skillId || generation.skillLineage.skillVersion !== research.skillLineage.skillVersion) throw new Error("Research Set does not match its Skill lineage.");
    if (blueprint.researchSetId !== research.id || blueprint.generationKey !== research.generationKey) throw new Error("Trip Blueprint does not belong to the supplied Research Set.");
    assertTripBlueprintIntegrity(blueprint, { expectedResearchPlaceIds: research.places.map((place) => place.id) });
    if (carrierCheckpoint && carrierCheckpoint.generationEvent.generationKey !== research.generationKey) throw new Error("Blueprint carrier 检查点属于另一个 Generation。");
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.assertGenerationWrite(research.generationKey, carrierCheckpoint);
      let imagePlan: Plan | undefined;
      if (imageContinuation) {
        const workspace = this.getWorkspace();
        const saved = workspace.activeBlueprint;
        const latest = this.getTripBlueprintByGenerationKey(blueprint.generationKey);
        if (!latest || !isDeepStrictEqual(latest, imageContinuation.expectedBlueprint)) throw new Error("The blueprint changed before image continuation completed.");
        const savedResearch = this.getResearchSet(research.id);
        if (!savedResearch || !isDeepStrictEqual(savedResearch, imageContinuation.expectedResearch)) throw new Error("Research changed before image continuation completed.");
        if (workspace.activePlan.id !== imageContinuation.planId || !saved || !isDeepStrictEqual(saved, imageContinuation.expectedBlueprint)) throw new Error("The plan changed before image continuation completed.");
        // Photos keep the published lineage and execution version stable.
        blueprint = { ...blueprint, version: saved.version, createdAt: saved.createdAt };
        const withoutImages = (value: TripBlueprint) => {
          const copy = structuredClone(value);
          copy.sources = [];
          for (const place of copy.places) delete place.images;
          return copy;
        };
        if (!isDeepStrictEqual(withoutImages(saved), withoutImages(blueprint))) throw new Error("Image continuation cannot change itinerary content.");
        for (const source of saved.sources) if (!blueprint.sources.some(candidate => isDeepStrictEqual(candidate, source))) throw new Error("Image continuation cannot replace saved evidence.");
        const withoutResearchImages = (value: ResearchSet) => {
          const copy = structuredClone(value);
          copy.sources = [];
          copy.updatedAt = "";
          for (const place of copy.places) delete place.images;
          return copy;
        };
        if (!isDeepStrictEqual(withoutResearchImages(savedResearch), withoutResearchImages(research))) throw new Error("Image continuation cannot change researched facts.");
        for (const source of savedResearch.sources) if (!research.sources.some(candidate => isDeepStrictEqual(candidate, source))) throw new Error("Image continuation cannot replace research evidence.");
        imagePlan = workspace.activePlan;
      }
      if (!imageContinuation) this.assertBlueprintCandidateWrite(blueprint);
      this.database.prepare(`INSERT INTO research_sets (id, generation_key, schema_version, status, content_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET status = excluded.status, content_json = excluded.content_json, updated_at = excluded.updated_at`).run(
        research.id, research.generationKey, research.schemaVersion, research.status, JSON.stringify(research), research.createdAt, research.updatedAt
      );
      this.database.prepare(`INSERT INTO trip_blueprints (id, version, generation_key, research_set_id, schema_version, content_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id, version) DO UPDATE SET content_json = excluded.content_json`).run(
        blueprint.id, blueprint.version, blueprint.generationKey, blueprint.researchSetId, blueprint.schemaVersion, JSON.stringify(blueprint), blueprint.createdAt
      );
      this.database.prepare("UPDATE blueprint_generations SET research_set_id = ?, blueprint_id = ?, blueprint_version = ?, updated_at = ? WHERE generation_key = ?")
        .run(research.id, blueprint.id, blueprint.version, new Date().toISOString(), blueprint.generationKey);
      if (carrierCheckpoint) {
        this.generationCarriers.markCarriersImported({
          generationKey: research.generationKey,
          carrierTaskIds: carrierCheckpoint.carrierTaskIds,
          expectedCarriers: carrierCheckpoint.expectedCarriers,
          validatedStatus: "validated",
          importedStatus: "imported",
          updatedAt: carrierCheckpoint.generationEvent.createdAt
        });
        this.insertBlueprintGenerationEvent(carrierCheckpoint.generationEvent);
      }
      if (imagePlan?.presentation) {
        const images = new Map(blueprintPresentation(blueprint).places.map(place => [place.id, place.images]));
        const presentation = structuredClone(imagePlan.presentation);
        for (const place of presentation.places) {
          const candidates = images.get(place.id);
          if (candidates) place.images = structuredClone(candidates);
          else delete place.images;
        }
        this.database.prepare("UPDATE plans SET presentation_json = ? WHERE id = ? AND version = ?")
          .run(JSON.stringify(presentation), imagePlan.id, imagePlan.version);
      }
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return { research: this.getResearchSet(research.id)!, blueprint: this.getTripBlueprint(blueprint.id, blueprint.version)! };
  }

  getResearchSet(id: string): ResearchSet | undefined {
    const row = this.database.prepare("SELECT id, generation_key, content_json FROM research_sets WHERE id = ?").get(id) as ResearchSetRow | undefined;
    return row ? JSON.parse(row.content_json) as ResearchSet : undefined;
  }

  getResearchSetByGenerationKey(generationKey: string): ResearchSet | undefined {
    const row = this.database.prepare("SELECT id, generation_key, content_json FROM research_sets WHERE generation_key = ?").get(generationKey) as ResearchSetRow | undefined;
    return row ? JSON.parse(row.content_json) as ResearchSet : undefined;
  }

  saveTripBlueprint(blueprint: TripBlueprint, carrierCheckpoint?: GenerationCarrierCheckpoint): TripBlueprint {
    this.database.exec("SAVEPOINT publish_blueprint");
    try {
      this.assertGenerationWrite(blueprint.generationKey, carrierCheckpoint, true);
      const existing = this.getTripBlueprint(blueprint.id, blueprint.version);
      if (existing && isDeepStrictEqual(existing, blueprint)) { this.importGenerationCheckpoint(blueprint.generationKey, carrierCheckpoint); this.database.exec("RELEASE publish_blueprint"); return existing; }
      this.assertBlueprintCandidateWrite(blueprint);
      const research = this.getResearchSet(blueprint.researchSetId);
      if (!research) throw new Error("Publish a Trip Blueprint only after its Research Set is saved.");
      if (research.generationKey !== blueprint.generationKey) throw new Error("Trip Blueprint does not belong to its Research Set Generation.");
      assertTripBlueprintIntegrity(blueprint, { expectedResearchPlaceIds: research.places.map((place) => place.id) });
      this.database.prepare(`INSERT INTO trip_blueprints (id, version, generation_key, research_set_id, schema_version, content_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id, version) DO UPDATE SET content_json = excluded.content_json, created_at = excluded.created_at`).run(
        blueprint.id, blueprint.version, blueprint.generationKey, blueprint.researchSetId, blueprint.schemaVersion, JSON.stringify(blueprint), blueprint.createdAt
      );
      this.database.prepare("UPDATE blueprint_generations SET blueprint_id = ?, blueprint_version = ?, updated_at = ? WHERE generation_key = ?").run(blueprint.id, blueprint.version, new Date().toISOString(), blueprint.generationKey);
      this.importGenerationCheckpoint(blueprint.generationKey, carrierCheckpoint);
      this.database.exec("RELEASE publish_blueprint");
    } catch (error) {
      this.database.exec("ROLLBACK TO publish_blueprint"); this.database.exec("RELEASE publish_blueprint");
      throw error;
    }
    return this.getTripBlueprint(blueprint.id, blueprint.version)!;
  }

  private assertGenerationWrite(generationKey: string, checkpoint?: GenerationCarrierCheckpoint, allowCompletedCarrierCancellation = false): void {
    // 包括 SAVEPOINT 调用者在内，先获取写锁再读取身份。
    this.database.prepare("UPDATE blueprint_generations SET updated_at=updated_at WHERE generation_key=?").run(generationKey);
    if (checkpoint && checkpoint.generationEvent.generationKey !== generationKey) throw new Error("Carrier 检查点属于另一个 Generation。");
    const carriers = this.generationCarriers.listForGeneration(generationKey);
    const generation = this.getBlueprintGeneration(generationKey);
    if (generation?.status === "cancelled") throw new Error("取消后的 Generation 不能保存结果。");
    const cancellation = this.database.prepare("SELECT carrier_cancel_requested_at FROM blueprint_generations WHERE generation_key=?").get(generationKey);
    // 停止可选 carrier 工作后，已完成的旅行内容仍可直接编辑。
    if (checkpoint || carriers.length || cancellation?.carrier_cancel_requested_at != null) this.generationCarriers.assertGenerationCurrent(generationKey, undefined, false, allowCompletedCarrierCancellation && !checkpoint && generation?.status === "completed");
    for (const carrier of carriers) if (checkpoint?.carrierTaskIds.includes(carrier.carrierTaskId) && carrier.status === "validated") this.generationCarriers.assertGenerationCurrent(generationKey, carrier.request, true);
  }

  private importGenerationCheckpoint(generationKey: string, checkpoint?: GenerationCarrierCheckpoint): void {
    if (!checkpoint) return;
    this.generationCarriers.markCarriersImported({ generationKey, carrierTaskIds: checkpoint.carrierTaskIds, expectedCarriers: checkpoint.expectedCarriers, validatedStatus: "validated", importedStatus: "imported", updatedAt: checkpoint.generationEvent.createdAt });
    this.insertBlueprintGenerationEvent(checkpoint.generationEvent);
  }

  private assertBlueprintCandidateWrite(blueprint: TripBlueprint): void {
    const existing = this.getTripBlueprint(blueprint.id,blueprint.version);
    if (!existing || isDeepStrictEqual(existing,blueprint)) return;
    const published = this.database.prepare("SELECT 1 FROM plan_blueprint_lineage WHERE blueprint_id=? AND blueprint_version=? UNION ALL SELECT 1 FROM direct_blueprint_edits WHERE blueprint_id=? AND (blueprint_version=? OR base_blueprint_version=?) LIMIT 1").get(blueprint.id,blueprint.version,blueprint.id,blueprint.version,blueprint.version);
    if (published) throw new Error("同一旅行蓝图版本不能保存不同内容。");
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
      const event = this.insertBlueprintGenerationEvent(input);
      this.database.exec("COMMIT");
      return event;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  requestBlueprintGenerationCancellation(generationKey: string, message: string, cancelledAt = new Date().toISOString()): void {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const current = this.getBlueprintGeneration(generationKey);
      const cancellation = this.database.prepare("SELECT carrier_cancel_requested_at FROM blueprint_generations WHERE generation_key=?").get(generationKey);
      if (!current || cancellation?.carrier_cancel_requested_at != null) { this.database.exec("COMMIT"); return; }
      this.database.prepare("UPDATE blueprint_generations SET carrier_cancel_requested_at=? WHERE generation_key=?").run(cancelledAt,generationKey);
      if (current.status !== "completed") this.database.prepare(`UPDATE blueprint_generations SET status = 'cancelled', failure_json = ?, updated_at = ? WHERE generation_key = ?`)
        .run(JSON.stringify({ code: "cancelled", stage: current.stage, issues: [{ path: current.stage, code: "cancelled", message }], resumable: true }), cancelledAt, generationKey);
      this.generationCarriers.markGenerationCancelRequested(generationKey, "cancel_requested", cancelledAt);
      this.insertBlueprintGenerationEvent({
        id: `mah-cancel-requested-${generationKey}`,
        generationKey,
        stage: current.stage,
        status: current.status === "completed" ? "completed" : "cancelled",
        detail: message,
        savedPlaceCount: this.getResearchSetByGenerationKey(generationKey)?.places.length ?? 0,
        nextAction: "Continue with this confirmed proposal when you are ready.",
        createdAt: cancelledAt
      });
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  private insertBlueprintGenerationEvent(input: Omit<BlueprintGenerationEvent, "id" | "sequence"> & { id?: string }): BlueprintGenerationEvent {
    if (input.id) {
      const existing = this.database.prepare(`SELECT id, generation_key, sequence, stage, status, scope_label, saved_place_count, detail, next_action, created_at
        FROM blueprint_generation_events WHERE id = ?`).get(input.id) as BlueprintGenerationEventRow | undefined;
      if (existing) {
        const event = blueprintGenerationEventFromRow(existing);
        const expected = { ...input, id: input.id };
        const actual = { ...event } as Partial<BlueprintGenerationEvent>;
        delete actual.sequence;
        if (!isDeepStrictEqual(actual, expected)) throw new Error("Generation Event ID 已绑定到不同内容。");
        return event;
      }
    }
    const sequence = ((this.database.prepare("SELECT MAX(sequence) AS sequence FROM blueprint_generation_events WHERE generation_key = ?").get(input.generationKey) as { sequence: number | null } | undefined)?.sequence ?? 0) + 1;
    const event: BlueprintGenerationEvent = { ...input, id: input.id ?? randomUUID(), sequence };
    this.database.prepare(`INSERT INTO blueprint_generation_events (id, generation_key, sequence, stage, status, scope_label, saved_place_count, detail, next_action, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(event.id, event.generationKey, event.sequence, event.stage, event.status, event.scopeLabel ?? null, event.savedPlaceCount ?? null, event.detail, event.nextAction ?? null, event.createdAt);
    return event;
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

  listDiagnosticArtifacts(generationKey: string): Array<{ id: string; generationKey: string; rawResponse: string; createdAt: string; expiresAt: string }> {
    const rows = this.database.prepare(`SELECT id, generation_key, raw_response, created_at, expires_at
      FROM blueprint_diagnostic_artifacts WHERE generation_key = ? ORDER BY created_at, rowid`).all(generationKey) as Array<{ id: string; generation_key: string; raw_response: string; created_at: string; expires_at: string }>;
    return rows.map((row) => ({ id: row.id, generationKey: row.generation_key, rawResponse: row.raw_response, createdAt: row.created_at, expiresAt: row.expires_at }));
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
    if (!plan || plan.id !== input.planId) throw new WorkspaceMutationError("The current Plan was not found.", "operation_not_found");
    if (plan.status !== "draft") throw new WorkspaceMutationError("Reorder a draft Plan before confirming it for execution.", "draft_required");
    if (plan.version !== input.expectedVersion) throw new WorkspaceMutationError("The Plan changed before this reorder was applied.", "version_conflict");
    const selected = this.database.prepare(`SELECT tasks.stage_id, tasks.sort_order FROM tasks JOIN stages ON stages.id = tasks.stage_id
      WHERE tasks.id = ? AND stages.plan_id = ?`).get(input.taskId, input.planId) as { stage_id: string; sort_order: number } | undefined;
    if (!selected) throw new WorkspaceMutationError("The Plan task was not found.", "operation_not_found");
    const comparison = input.direction === "up" ? "<" : ">";
    const ordering = input.direction === "up" ? "DESC" : "ASC";
    const adjacent = this.database.prepare(`SELECT id, sort_order FROM tasks WHERE stage_id = ? AND sort_order ${comparison} ? ORDER BY sort_order ${ordering} LIMIT 1`).get(selected.stage_id, selected.sort_order) as { id: string; sort_order: number } | undefined;
    if (!adjacent) throw new WorkspaceMutationError(`The task is already at the ${input.direction === "up" ? "start" : "end"} of this section.`, "task_at_boundary");
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
    if (!plan || plan.id !== input.planId) throw new WorkspaceMutationError("The current Plan was not found.", "operation_not_found");
    if (plan.status !== "draft") throw new WorkspaceMutationError("Only draft Plan changes can be undone here.", "draft_required");
    if (plan.version !== input.expectedVersion) throw new WorkspaceMutationError("The Plan changed before this undo was applied.", "version_conflict");
    const latest = this.getLatestAppliedPlanChange(input.planId);
    if (!latest || latest.id !== input.changeId) throw new WorkspaceMutationError("Only the latest Plan change can be undone.", "edit_unavailable");
    const adjacentTaskId = latest.affectedTaskIds.find((taskId) => taskId !== latest.taskId);
    if (!adjacentTaskId) throw new WorkspaceMutationError("The Plan change cannot be reversed safely.", "edit_unavailable");
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
    if (plan.id !== input.planId || plan.version !== input.expectedVersion) throw new WorkspaceMutationError("The Plan changed before this route refresh was saved.", "version_conflict");
    if (workspace.activeBlueprint && input.expectedBlueprintVersion !== undefined && workspace.activeBlueprint.version !== input.expectedBlueprintVersion) throw new WorkspaceMutationError("The Trip Blueprint changed before this route refresh was saved.", "version_conflict");
    const sourcePresentation = routeRefreshPresentationForWorkspace(workspace);
    if (!Number.isFinite(Date.parse(input.observedAt)) || !Number.isInteger(input.distanceMeters) || input.distanceMeters <= 0 || (input.durationSeconds !== undefined && (!Number.isInteger(input.durationSeconds) || input.durationSeconds <= 0))) throw new WorkspaceMutationError("A refreshed route needs valid observed distance and duration facts.");
    if (![input.originCoordinates, input.destinationCoordinates].every(([longitude, latitude]) => Number.isFinite(longitude) && longitude >= -180 && longitude <= 180 && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90)) throw new WorkspaceMutationError("A refreshed route needs valid place coordinates.");
    const presentation = structuredClone(sourcePresentation);
    const segment = presentation.routeSegments.find((candidate) => candidate.id === input.segmentId);
    if (!segment) throw new WorkspaceMutationError("The Plan route segment was not found.", "operation_not_found");
    const origin = presentation.places.find((place) => place.id === segment.originPlaceId);
    const destination = presentation.places.find((place) => place.id === segment.destinationPlaceId);
    if (!origin || !destination) throw new WorkspaceMutationError("The Plan route segment references a missing place.");
    origin.coordinates = providerCoordinatesToPlanCoordinates(input.originCoordinates);
    destination.coordinates = providerCoordinatesToPlanCoordinates(input.destinationCoordinates);
    const { distanceMeters: _oldDistance, checkedAt: _oldCheckedAt, sourceRefs: _oldSourceRefs, display: _oldDisplay, ...stableSegment } = segment;
    const durationMinutes = input.durationSeconds !== undefined
      ? Math.max(1, Math.round(input.durationSeconds / 60))
      : segment.durationMinutes;
    const routeText = refreshedRouteText({
      mode: segment.mode,
      originName: origin.name,
      destinationName: destination.name,
      ...(durationMinutes ? { durationMinutes } : {}),
      distanceMeters: input.distanceMeters
    });
    const refreshed: PlanRouteSegment = {
      ...stableSegment,
      verification: "verified",
      distanceMeters: input.distanceMeters,
      ...(durationMinutes !== undefined ? { durationMinutes } : {}),
      checkedAt: input.observedAt,
      sourceRefs: [input.provider],
      label: routeText.label,
      detail: routeText.detail,
      display: {
        routeLabel: routeText.label,
        showAsFormalRoute: segment.display?.showAsFormalRoute ?? true,
        mapLineState: "formal"
      }
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
    if (updated.changes !== 1) throw new WorkspaceMutationError("The Plan changed before this route refresh was saved.", "version_conflict");
    this.addInbox({ id: `route-refreshed-${input.planId}-${input.segmentId}-${Date.now()}`, tone: "notice", title: "Route facts refreshed", body: "One Plan route segment was refreshed from Google Maps facts. No navigation, booking, or transport action was started.", timestamp: "Just now" });
    return this.getWorkspace();
  }

  /** Saves a best-effort batch of Connector-observed route facts after generation. */
  saveGeneratedPlanRouteRefresh(input: { planId: string; expectedVersion: number; expectedBlueprintVersion?: number; provider: "google_maps"; routes: Array<{ segmentId: string; observedAt: string; distanceMeters: number; durationSeconds?: number; originCoordinates: [number, number]; destinationCoordinates: [number, number]; geometry?: Array<[number, number]> }> }): { workspace: WorkspaceSnapshot; scheduleConflictDayIds: string[] } {
    if (!input.routes.length) return { workspace: this.getWorkspace(), scheduleConflictDayIds: [] };
    const workspace = this.getWorkspace();
    const plan = workspace.activePlan;
    if (plan.id !== input.planId || plan.version !== input.expectedVersion) throw new WorkspaceMutationError("The Plan changed before generated routes were saved.", "version_conflict");
    if (workspace.activeBlueprint && input.expectedBlueprintVersion !== undefined && workspace.activeBlueprint.version !== input.expectedBlueprintVersion) throw new WorkspaceMutationError("The Trip Blueprint changed before generated routes were saved.", "version_conflict");
    const presentation = structuredClone(routeRefreshPresentationForWorkspace(workspace));
    const routeById = new Map(input.routes.map((route) => [route.segmentId, route]));
    const validCoordinate = ([longitude, latitude]: [number, number]) => Number.isFinite(longitude) && longitude >= -180 && longitude <= 180 && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90;
    for (const route of input.routes) {
      if (!Number.isFinite(Date.parse(route.observedAt)) || !Number.isInteger(route.distanceMeters) || route.distanceMeters <= 0 || (route.durationSeconds !== undefined && (!Number.isInteger(route.durationSeconds) || route.durationSeconds <= 0))) throw new WorkspaceMutationError("Generated routes need valid observed distance and duration facts.");
      if (!validCoordinate(route.originCoordinates) || !validCoordinate(route.destinationCoordinates) || route.geometry?.some((point) => !validCoordinate(point))) throw new WorkspaceMutationError("Generated routes need valid map coordinates.");
    }
    const refreshedSegments = new Map(presentation.routeSegments.map((segment) => {
      const route = routeById.get(segment.id);
      if (!route) return [segment.id, segment] as const;
      const origin = presentation.places.find((place) => place.id === segment.originPlaceId);
      const destination = presentation.places.find((place) => place.id === segment.destinationPlaceId);
      if (!origin || !destination) throw new WorkspaceMutationError("A generated route references a missing place.");
      origin.coordinates = providerCoordinatesToPlanCoordinates(route.originCoordinates);
      destination.coordinates = providerCoordinatesToPlanCoordinates(route.destinationCoordinates);
      const durationMinutes = route.durationSeconds !== undefined ? Math.max(1, Math.round(route.durationSeconds / 60)) : segment.durationMinutes;
      const routeText = refreshedRouteText({
        mode: segment.mode,
        originName: origin.name,
        destinationName: destination.name,
        ...(durationMinutes ? { durationMinutes } : {}),
        distanceMeters: route.distanceMeters
      });
      return [segment.id, {
        ...segment,
        verification: "verified",
        distanceMeters: route.distanceMeters,
        ...(durationMinutes ? { durationMinutes } : {}),
        checkedAt: route.observedAt,
        sourceRefs: [input.provider],
        label: routeText.label,
        detail: routeText.detail,
        display: {
          routeLabel: routeText.label,
          showAsFormalRoute: segment.display?.showAsFormalRoute ?? true,
          mapLineState: "formal"
        }
      } satisfies PlanRouteSegment] as const;
    }));
    const scheduleConflictDayIds = new Set<string>();
    for (const day of presentation.days) {
      const stops = (day.stops ?? []).map((stop) => ({ ...stop }));
      if (stops.length < 2 || stops.some((stop) => itineraryMinute(stop.time) === undefined)) continue;
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
        scheduleConflictDayIds.add(day.id);
        break;
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
      const conflictConstraint = "Google Maps found a travel-time conflict with a fixed itinerary time; this day must be replanned before execution.";
      if (!daySegments.length || geometries.length !== daySegments.length) return {
        ...day,
        ...(scheduleConflict ? { routeReview: { ...day.routeReview, fixedConstraints: [...new Set([...(day.routeReview?.fixedConstraints ?? []), conflictConstraint])] } } : {})
      };
      const routeGeometry = geometries.flatMap((geometry, index) => index === 0 ? geometry : geometry.slice(1));
      if (routeGeometry.length < 2) return day;
      const modes = new Set(daySegments.map((segment) => segment.mode));
      const reviewedAt = daySegments.map((segment) => segment.checkedAt).filter((value): value is string => Boolean(value)).sort().at(-1);
      return {
        ...day,
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
    if (updated.changes !== 1) throw new WorkspaceMutationError("The Plan changed before generated routes were saved.", "version_conflict");
    return { workspace: this.getWorkspace(), scheduleConflictDayIds: [...scheduleConflictDayIds] };
  }

  private saveBlueprintRouteRefresh(input: { workspace: WorkspaceSnapshot; presentation: PlanPresentation; routes: Array<{ segmentId: string; observedAt: string; distanceMeters: number; durationSeconds?: number; originCoordinates: [number, number]; destinationCoordinates: [number, number]; geometry?: Array<[number, number]> }>; provider: "google_maps"; observedAt: string }): WorkspaceSnapshot {
    const { workspace, presentation } = input;
    const plan = workspace.activePlan;
    const blueprint = workspace.activeBlueprint;
    const lineage = this.getPlanBlueprintLineage(plan.id);
    if (!blueprint || !lineage) throw new WorkspaceMutationError("Route refresh needs the current Trip Blueprint lineage.");
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
        if (!coordinates) return place;
        const refreshed = { ...place, coordinates };
        return effectiveBlueprintSchedulingDecision(refreshed) === "schedulable" && place.schedulingEligibility?.decision === "informational"
          ? {
            ...refreshed,
            schedulingEligibility: {
              ...place.schedulingEligibility,
              decision: "schedulable",
              reason: "Verified route coordinates now support direct itinerary editing for this place."
            }
          }
          : refreshed;
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
      // Route refresh owns route facts only. It must never reschedule itinerary
      // occurrences or rewrite stop/block projections.
      days: structuredClone(blueprint.days)
    };
    reconcileBookingRelationshipAssessment(nextBlueprint);
    const nextPlanVersion = plan.version + 1;
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const saved = this.saveTripBlueprint(nextBlueprint);
      const nextPresentation = blueprintPresentation(saved);
      const updated = this.database.prepare("UPDATE plans SET version = ?, known_information_json = ?, assumptions_json = ?, sources_json = ?, presentation_json = ? WHERE id = ? AND version = ? AND is_current = 1").run(
        nextPlanVersion,
        JSON.stringify(routeRefreshKnownInformation(plan.knownInformation, saved)),
        JSON.stringify(routeRefreshAssumptions(plan.assumptions, saved)),
        JSON.stringify(saved.sources.map((source) => ({ title: source.title, authority: source.authority, url: source.url, retrievedAt: source.retrievedAt }))),
        JSON.stringify(nextPresentation),
        plan.id,
        plan.version
      );
      if (updated.changes !== 1) throw new WorkspaceMutationError("The Plan changed before generated routes were saved.", "version_conflict");
      const nextCompilationKey = `route-refresh:${lineage.compilerVersion.replaceAll(".", "-")}:${plan.id}:plan-v${nextPlanVersion}:blueprint-${saved.id}-v${saved.version}`;
      const lineageUpdated = this.database.prepare("UPDATE plan_blueprint_lineage SET plan_version = ?, blueprint_version = ?, compilation_key = ?, created_at = ? WHERE plan_id = ?").run(nextPlanVersion, saved.version, nextCompilationKey, input.observedAt, plan.id);
      if (lineageUpdated.changes !== 1) throw new WorkspaceMutationError("The Plan Blueprint lineage changed before generated routes were saved.", "version_conflict");
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
    if (plan.id !== input.planId || plan.version !== input.expectedVersion) throw new WorkspaceMutationError("The Plan changed before these itinerary edits were saved.", "version_conflict");
    if (plan.status !== "draft" && plan.status !== "active") throw new WorkspaceMutationError("Only the current draft or active Plan can receive itinerary map edits.");
    if (!plan.presentation || plan.presentation.kind !== "itinerary") throw new WorkspaceMutationError("This Plan does not contain a structured itinerary presentation.");
    const presentation = structuredClone(plan.presentation);
    const placeIds = new Set(presentation.places.map((place) => place.id));
    const dayIds = new Set(presentation.days.map((day) => day.id));
    if (Object.keys(input.assignments).some((placeId) => !placeIds.has(placeId) || (input.assignments[placeId] && !dayIds.has(input.assignments[placeId]!)))) throw new WorkspaceMutationError("The itinerary assignment contains an unknown place or day.");
    if (Object.keys(input.priorities).some((placeId) => !placeIds.has(placeId) || !["must", "preferred", "nearby", "archive", "pending", "recheck", "booked"].includes(input.priorities[placeId]!))) throw new WorkspaceMutationError("The itinerary priority contains an unsupported value.");
    if (Object.entries(input.orders).some(([dayId, ids]) => !dayIds.has(dayId) || !Array.isArray(ids) || ids.some((placeId, index) => !placeIds.has(placeId) || ids.indexOf(placeId) !== index))) throw new WorkspaceMutationError("The itinerary order contains an unknown or duplicate place.");

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
      if (day.capacity !== undefined && nextPlaceIds.length > day.capacity) throw new WorkspaceMutationError(`The itinerary edit exceeds the capacity of ${day.label}.`);
      const wrongCity = nextPlaceIds.map((placeId) => presentation.places.find((place) => place.id === placeId)).find((place) => place?.city && day.city && !day.city.trim().toLocaleLowerCase().includes(place.city.trim().toLocaleLowerCase()));
      if (wrongCity) throw new WorkspaceMutationError(`The itinerary edit would move ${wrongCity.name} into a day for a different city.`);
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
        if (destination && fixedItineraryStop(next.role, destination.priority)) throw new WorkspaceMutationError(`The itinerary order conflicts with the fixed time for ${destination.name}. Revise the time before moving this stop.`);
        if (earliest >= 24 * 60) throw new WorkspaceMutationError(`The itinerary edit would push ${destination?.name ?? next.placeId} beyond the end of the day.`);
        next.time = itineraryTime(earliest);
      }
      return { ...day, stops };
    });
    assertPlanPresentationIntegrity(presentation, { executionReady: false });
    const updated = this.database.prepare("UPDATE plans SET presentation_json = ?, version = version + 1 WHERE id = ? AND version = ? AND is_current = 1 AND status IN ('draft', 'active')").run(JSON.stringify(presentation), input.planId, input.expectedVersion);
    if (updated.changes !== 1) throw new WorkspaceMutationError("The Plan changed before these itinerary edits were saved.", "version_conflict");
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
    if (row.is_current || row.is_execution) throw new WorkspaceMutationError("The current or executing Plan cannot be deleted from history.", "history_plan_protected");
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
    if (!current || !current.is_current) throw new WorkspaceMutationError("The current draft Plan was not found.", "operation_not_found");
    if (current.status !== "draft" || current.is_execution) throw new WorkspaceMutationError("Only an unconfirmed draft Plan can be discarded.", "unconfirmed_draft_required");
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
    if (!current || !current.is_current) throw new WorkspaceMutationError("The active Plan was not found.", "operation_not_found");
    if (!current.is_execution || current.status !== "active") throw new WorkspaceMutationError("Only the active Plan can be abandoned.", "active_plan_required");
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
    if (!task) throw new WorkspaceMutationError("The current Plan task was not found.", "operation_not_found");
    if (!isPreDepartureChecklistTask({ owner: task.owner, title: task.title, ...(task.description ? { description: task.description } : {}), dueLabel: task.due_label, ...(task.preparation_category ? { preparationCategory: task.preparation_category } : {}) }, task.stage_title)) {
      throw new WorkspaceMutationError("Only packing items and pre-departure tasks can be checked here.");
    }
    const nextStatus: Task["status"] = checked ? "completed" : "waiting_user";
    if (task.status !== nextStatus) {
      this.database.prepare("UPDATE tasks SET status = ? WHERE id = ?").run(nextStatus, taskId);
      // Preparation progress does not revise an approved itinerary. Keeping its
      // version preserves execution progress, reminder receipts and live buttons.
      this.database.prepare("UPDATE plans SET version = version + 1 WHERE id = ? AND status <> 'active'").run(planId);
    }
    return this.getWorkspace();
  }

  /** Returns the Plan whose reminders and timeline are currently allowed to execute. */
  getExecutionPlan(): Plan | undefined {
    const plan = this.database.prepare(`SELECT id, version, title, location, dates, status, known_information_json, assumptions_json, next_action, configuration_json, sources_json, presentation_json, created_at
      FROM plans WHERE is_execution = 1 ORDER BY created_at DESC LIMIT 1`).get() as PlanRow | undefined;
    if (!plan) return undefined;
    const restored = this.planFromRow(plan);
    const lineage = this.getPlanBlueprintLineage(restored.id);
    const blueprint = lineage ? this.getTripBlueprint(lineage.blueprintId, lineage.blueprintVersion) : undefined;
    return blueprint ? { ...restored, presentation: blueprintPresentation(blueprint) } : restored;
  }

  /** Reads one exact persisted Plan version, including its canonical Blueprint projection. */
  getPlanVersion(planId:string,version:number): Plan | undefined {
    const row=this.database.prepare("SELECT id,version,title,location,dates,status,known_information_json,assumptions_json,next_action,configuration_json,sources_json,presentation_json,created_at FROM plans WHERE id=? AND version=?").get(planId,version) as PlanRow|undefined;
    if(!row)return;
    const plan=this.planFromRow(row);const lineage=this.getPlanBlueprintLineage(planId);
    const blueprint=lineage ? this.getTripBlueprint(lineage.blueprintId,lineage.blueprintVersion) : undefined;
    return blueprint?{...plan,presentation:blueprintPresentation(blueprint)}:plan;
  }

  getExecutionAssistantState(planId: string, version: number): { revision: number; data: unknown } | undefined {
    const row = this.database.prepare("SELECT revision, state_json FROM execution_assistant_states WHERE plan_id = ? AND plan_version = ?").get(planId, version) as { revision: number; state_json: string } | undefined;
    return row ? { revision: row.revision, data: JSON.parse(row.state_json) } : undefined;
  }

  saveExecutionAssistantState(planId: string, version: number, expectedRevision: number, data: unknown): boolean {
    const active = this.database.prepare("SELECT id FROM plans WHERE id = ? AND version = ? AND status = 'active' AND is_execution = 1").get(planId, version);
    if (!active) return false;
    const json = JSON.stringify(data);
    if (expectedRevision === 0) {
      return this.database.prepare("INSERT OR IGNORE INTO execution_assistant_states (plan_id, plan_version, revision, state_json) VALUES (?, ?, 1, ?)").run(planId, version, json).changes === 1;
    }
    return this.database.prepare("UPDATE execution_assistant_states SET revision = revision + 1, state_json = ? WHERE plan_id = ? AND plan_version = ? AND revision = ?").run(json, planId, version, expectedRevision).changes === 1;
  }

  private itineraryReminderStillCurrent(input: { planId: string; dayId: string; placeId: string; scheduledTime: string }): boolean {
    const plan = this.getExecutionPlan();
    if (plan?.id !== input.planId || plan.status !== "active" || plan.presentation?.kind !== "itinerary") return false;
    const day = plan.presentation.days.find((candidate) => candidate.id === input.dayId);
    return Boolean(day?.stops?.some((stop) => stop.placeId === input.placeId && stop.time === input.scheduledTime));
  }

  cancelTaskReminder(planId: string, taskId: string): WorkspaceSnapshot {
    const workspace = this.getWorkspace();
    if (workspace.activePlan.id !== planId) throw new WorkspaceMutationError(`Plan ${planId} was not found.`);
    const task = workspace.activePlan.stages.flatMap((stage) => stage.tasks).find((candidate) => candidate.id === taskId);
    if (!task) throw new WorkspaceMutationError("The Task was not found in the current Plan.");
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
      if (!["plan_recommended", "taxi", "public_transit", "walking", "driving"].includes(context.transportPreference)) throw new Error("Choose a supported transport preference.");
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

  createCompiledBlueprintPlan(compilation: BlueprintPlanCompilation, runtime: AgentRuntimeKind = "codex", carrierCompletion?: {
    generationKey: string;
    carrierTaskIds: readonly string[];
    expectedCarriers?: GenerationCarrierCheckpoint["expectedCarriers"];
    generationEvent: Omit<BlueprintGenerationEvent, "sequence">;
  }, adjustmentOrigin?: TravelAdjustmentDraftOrigin): WorkspaceSnapshot {
    const { plan, lineage } = compilation;
    if (lineage.planId !== plan.id || lineage.planVersion !== plan.version) throw new Error("Compilation Lineage does not match its Draft Plan.");
    const blueprint = this.getTripBlueprint(lineage.blueprintId, lineage.blueprintVersion);
    if (!blueprint) throw new Error("Compile a Draft Plan only from a published Trip Blueprint.");
    if (carrierCompletion && (blueprint.generationKey !== carrierCompletion.generationKey || carrierCompletion.generationEvent.generationKey !== carrierCompletion.generationKey)) {
      throw new Error("Carrier 完成状态不属于本次已编译 Trip Blueprint 的 Generation。");
    }
    const existing = this.getPlanBlueprintLineageByCompilationKey(lineage.compilationKey);
    if (existing) {
      if(adjustmentOrigin)throw new WorkspaceMutationError('已有草稿不能事后登记为旅行事件候选。','version_conflict');
      if (existing.planId !== plan.id || existing.blueprintId !== lineage.blueprintId || existing.blueprintVersion !== lineage.blueprintVersion || existing.compilerVersion !== lineage.compilerVersion) throw new Error("Compilation Key already belongs to a different Draft Plan.");
      if (carrierCompletion) {
        this.database.exec("SAVEPOINT compile_blueprint");
        try {
          this.assertGenerationWrite(blueprint.generationKey, carrierCompletion);
          this.generationCarriers.markCarriersImported({
            generationKey: carrierCompletion.generationKey,
            carrierTaskIds: carrierCompletion.carrierTaskIds,
            expectedCarriers: carrierCompletion.expectedCarriers,
            validatedStatus: "validated",
            importedStatus: "imported",
            updatedAt: carrierCompletion.generationEvent.createdAt,
            requireAllValidated: true
          });
          this.insertBlueprintGenerationEvent(carrierCompletion.generationEvent);
          this.database.exec("RELEASE compile_blueprint");
        } catch (error) {
          this.database.exec("ROLLBACK TO compile_blueprint"); this.database.exec("RELEASE compile_blueprint");
          throw error;
        }
      }
      return this.getWorkspace();
    }
    const presentablePlan = { ...plan, presentation: blueprintPresentation(blueprint) };
    this.database.exec("SAVEPOINT compile_blueprint");
    try {
      this.assertGenerationWrite(blueprint.generationKey, carrierCompletion, true);
      if(adjustmentOrigin){
        const origin:TravelAdjustmentInput={...adjustmentOrigin.input,requestId:'draft-origin:'+plan.id};
        assertTravelAdjustmentInput(origin);this.assertAdjustmentContext(origin.context);
        const identityBlocker=travelAdjustmentEventIdentityBlocker(origin.observations);
        if(identityBlocker)throw new WorkspaceMutationError(identityBlocker,'version_conflict');
        if(origin.context.draft||!origin.context.execution||!origin.context.blueprint||origin.context.blueprint.id!==blueprint.id||origin.context.phase.value!=='on_trip'||origin.decision?.verdict!=='eligible'||origin.decision.changeKind!=='objective_disruption'||origin.observations.some(o=>!['changed','unchanged'].includes(o.status))||!origin.observations.some(o=>o.status==='changed')||adjustmentOrigin.verifyExecution(origin.decision,origin)!==true)throw new WorkspaceMutationError('旅行变化候选缺少原执行版本与负责公开判断。','version_conflict');
      }
      this.insertCurrentPlan(presentablePlan);
      this.database.prepare(`INSERT INTO plan_blueprint_lineage (plan_id, plan_version, blueprint_id, blueprint_version, compiler_version, compilation_key, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(lineage.planId, lineage.planVersion, lineage.blueprintId, lineage.blueprintVersion, lineage.compilerVersion, lineage.compilationKey, lineage.createdAt);
      this.database.prepare("UPDATE blueprint_generations SET status = 'completed', stage = 'ready', updated_at = ? WHERE blueprint_id = ? AND blueprint_version = ?").run(lineage.createdAt, lineage.blueprintId, lineage.blueprintVersion);
      if (carrierCompletion) {
        this.generationCarriers.markCarriersImported({
          generationKey: carrierCompletion.generationKey,
          carrierTaskIds: carrierCompletion.carrierTaskIds,
            expectedCarriers: carrierCompletion.expectedCarriers,
          validatedStatus: "validated",
          importedStatus: "imported",
          updatedAt: carrierCompletion.generationEvent.createdAt,
          requireAllValidated: true
        });
        this.insertBlueprintGenerationEvent(carrierCompletion.generationEvent);
      }
      this.addInbox({ id: `blueprint-plan-compiled-${plan.id}`, tone: "notice", title: `${runtimeDisplayName(runtime)} trip draft ready for review`, body: "The complete Trip Blueprint and its execution work are saved locally. Nothing will run before you confirm the Draft Plan.", timestamp: "Just now" });
      if(adjustmentOrigin)this.travelAdjustments.bindDraft(plan.id,plan.version,adjustmentOrigin.input.context,adjustmentOrigin.input.observations,this.travelAdjustmentProposalDigest());
      this.database.exec("RELEASE compile_blueprint");
    } catch (error) {
      this.database.exec("ROLLBACK TO compile_blueprint"); this.database.exec("RELEASE compile_blueprint");
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

  applyDirectBlueprintRevisionBatch(input: Parameters<SqliteWorkspaceStore["applyDirectBlueprintRevisionBatchInTransaction"]>[0]): DirectBlueprintRevisionSaveResult {
    return this.directBlueprintTransaction(() => this.applyDirectBlueprintRevisionBatchInTransaction(input));
  }
  undoDirectBlueprintRevision(input: Parameters<SqliteWorkspaceStore["undoDirectBlueprintRevisionInTransaction"]>[0]): WorkspaceSnapshot {
    return this.directBlueprintTransaction(() => this.undoDirectBlueprintRevisionInTransaction(input));
  }
  /** 回执只读：原请求身份与事务审计核对，不把历史快照当作当前状态。 */
  getDirectBlueprintMutationReceipt(input: { operation: "save" | "undo"; requestId: string; requestDigest: string; expectedPlanId: string; expectedVersion: number; expectedBlueprintVersion: number; revisionId?: string }) {
    const table = input.operation === "save" ? "direct_blueprint_edits" : "direct_blueprint_undos";
    const row = this.database.prepare("SELECT fingerprint,result_json FROM " + table + " WHERE request_id=?").get(input.requestId) as { fingerprint: string; result_json: string } | undefined;
    const identity = { operation: input.operation, requestId: input.requestId, requestDigest: input.requestDigest, expectedPlanId: input.expectedPlanId, expectedVersion: input.expectedVersion, expectedBlueprintVersion: input.expectedBlueprintVersion, ...(input.revisionId ? { revisionId: input.revisionId } : {}) };
    if (!row) return { ...identity, status: "not_found" as const };
    const original = JSON.parse(row.fingerprint) as Record<string, unknown>;
    const digest = createHash("sha256").update(workspaceMutationDigestInput(input.operation, String(original.expectedPlanId), original)).digest("hex");
    if (digest !== input.requestDigest) throw new WorkspaceMutationError("回执载荷与原请求不一致。", "request_identity_conflict");
    if (original.expectedPlanId !== input.expectedPlanId || original.expectedVersion !== input.expectedVersion || original.expectedBlueprintVersion !== input.expectedBlueprintVersion || (input.operation === "undo" && original.revisionId !== input.revisionId)) throw new WorkspaceMutationError("回执身份与原请求不一致。", "request_identity_conflict");
    const saved = input.operation === "save" ? JSON.parse(row.result_json) as DirectBlueprintRevisionSaveResult : undefined;
    return { ...identity, status: "committed" as const, workspace: this.getWorkspace(), ...(saved ? { revision: saved.revision, originalResult: saved.originalResult } : {}) };
  }
  private directBlueprintTransaction<T>(operation: () => T): T {
    const nested=this.directTransactionDepth>0;
    const savepoint=`direct_mutation_${this.directTransactionDepth}`;
    this.database.exec(nested?`SAVEPOINT ${savepoint}`:"BEGIN IMMEDIATE");
    this.directTransactionDepth++;
    try { const result=operation();this.database.exec(nested?`RELEASE ${savepoint}`:"COMMIT");return result; }
    catch(error) { this.database.exec(nested?`ROLLBACK TO ${savepoint}`:"ROLLBACK");if(nested)this.database.exec(`RELEASE ${savepoint}`);throw error; }
    finally {this.directTransactionDepth--;}
  }
  private applyDirectBlueprintRevisionBatchInTransaction(input: { expectedPlanId: string; expectedVersion: number; expectedBlueprintVersion?: number; revisions: DirectBlueprintRevision[]; requestId?: string; highImpactConfirmation?: string; runtime?: AgentRuntimeKind; recoveryBinding?:{schemaVersion:1;draftDigest:string;seedDigest:string} }): DirectBlueprintRevisionSaveResult {
    const requestId = input.requestId ?? randomUUID();
    if(input.recoveryBinding&&(input.revisions.length!==1||input.revisions[0]!.kind!=="review_booking_relationships"||input.recoveryBinding.schemaVersion!==1||!/^[a-f0-9]{64}$/.test(input.recoveryBinding.draftDigest)||!/^[a-f0-9]{64}$/.test(input.recoveryBinding.seedDigest))) throw new WorkspaceMutationError("关联审阅恢复身份无效。","invalid_edit");
    const fingerprint = JSON.stringify({ ...input, requestId: undefined, runtime: undefined, revisions: input.revisions.map(({createdAt, ...revision}) => revision) });
    const replay = this.database.prepare("SELECT * FROM direct_blueprint_edits WHERE request_id = ?").get(requestId) as { fingerprint: string; result_json: string } | undefined;
    if (replay) { if (replay.fingerprint !== fingerprint) throw new WorkspaceMutationError("请求身份不能用于不同的蓝图编辑。", "request_identity_conflict"); const receipt = JSON.parse(replay.result_json) as DirectBlueprintRevisionSaveResult; return {...receipt,workspace: this.getWorkspace()}; }
    const workspace = this.getWorkspace();
    if (workspace.activePlan.id !== input.expectedPlanId || workspace.activePlan.version !== input.expectedVersion) throw new WorkspaceMutationError("The Plan changed before this Blueprint Revision was applied.", "version_conflict");
    if (!workspace.activeBlueprint) throw new WorkspaceMutationError("Direct Blueprint Revision requires a current Trip Blueprint.", "blueprint_required");
    if (input.expectedBlueprintVersion !== undefined && workspace.activeBlueprint.version !== input.expectedBlueprintVersion) throw new WorkspaceMutationError("The Trip Blueprint changed before this Blueprint Revision was applied.", "version_conflict");
    const sourceState = this.bookingSourceState(input.expectedPlanId);
    const sourceContext=this.bookingRuntimeSourceContext(workspace.activePlan,workspace.activeBlueprint,sourceState);
    if(sourceContext.planId!==input.expectedPlanId||sourceContext.planVersion!==input.expectedVersion)throw new WorkspaceMutationError("预订来源基准已变化。","version_conflict");
    const sourceRevision = input.revisions.find(revision=>revision.kind === "review_booking_relationships" || revision.kind === "select_booking_sources");
    if (sourceRevision && sourceRevision.expectedSourceSetDigest !== sourceState.sourceSetDigest) throw new WorkspaceMutationError("预订资料已变化，请重新审阅。", "version_conflict");
    let resolvedBookingConstraints: BlueprintBookingConstraint[]|undefined;
    if (sourceRevision?.kind === "select_booking_sources") {
      const candidates = new Map(this.bookingSourceCandidates(input.expectedPlanId).map(booking=>[booking.id,booking]));
      const selected = sourceRevision.sourceBookingIds.map(id=>candidates.get(id));
      if (selected.some(booking=>!booking)) throw new WorkspaceMutationError("请选择当前旅行的合法预订来源。", "invalid_edit");
      resolvedBookingConstraints = blueprintBookingConstraintsFromTravelBookings(selected as TravelBooking[]);
    }
    // 先降级另存的必访地点仍需删除影响确认。
    const protectedBlueprint = structuredClone(workspace.activeBlueprint);
    const prior = this.database.prepare("SELECT before_json FROM direct_blueprint_edits WHERE blueprint_id = ? AND undone = 0").all(protectedBlueprint.id) as {before_json: string}[];
    for (const row of prior) {
      const before = JSON.parse(row.before_json) as TripBlueprint;
      for (const revision of input.revisions) if (revision.kind === "remove_place_from_day" && before.places.some((place) => place.id === revision.placeId && place.priority === "must")) {
        const place = protectedBlueprint.places.find((place) => place.id === revision.placeId); if (place && place.priority !== "booked") place.priority = "must";
      }
    }
    const result = applyDirectBlueprintRevisionBatchWithMetadata(protectedBlueprint, input.revisions, {sourceContext, ...(input.highImpactConfirmation ? { highImpactConfirmation: input.highImpactConfirmation } : {}), ...(resolvedBookingConstraints ? {resolvedBookingConstraints} : {}),...(sourceRevision?.kind==="select_booking_sources"?{sourceSelectionDecision:{source:"traveler",actorId:"local-traveler",decidedAt:sourceRevision.createdAt}}:{}) });
    // 影响确认完成后保留不属于本批次的优先级编辑。
    for (const place of result.blueprint.places) if (!input.revisions.some((revision) => revision.kind === "update_place_priority" && revision.placeId === place.id)) place.priority = workspace.activeBlueprint.places.find((candidate) => candidate.id === place.id)!.priority;
    {
      const saved = this.saveTripBlueprint(result.blueprint);
      const previousLineage=this.getPlanBlueprintLineage(workspace.activePlan.id);
      const compilation = compileTripBlueprint(saved, { createdAt: result.metadata.createdAt, completedRequirementIds: completedRequirementIdsForWorkspace(workspace),...(previousLineage?{previousCompilation:{blueprint:workspace.activeBlueprint,plan:workspace.activePlan,lineage:previousLineage}}:{}) });
      compilation.plan.configuration = mergeUserPlanConfiguration(compilation.plan.configuration,workspace.activePlan.configuration,workspace.activeBlueprint);
      this.createCompiledBlueprintPlan(compilation, input.runtime);
      this.database.prepare("INSERT INTO direct_blueprint_edits(id,request_id,fingerprint,plan_id,plan_version,blueprint_id,blueprint_version,base_blueprint_version,before_json,after_json,metadata_json,result_json,created_at,undone) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,0)").run(result.metadata.id,requestId,fingerprint,compilation.plan.id,compilation.plan.version,saved.id,saved.version,workspace.activeBlueprint.version,JSON.stringify(workspace.activeBlueprint),JSON.stringify(saved),JSON.stringify(result.metadata),"{}",result.metadata.createdAt);
      const currentWorkspace = this.getWorkspace();
      const response: DirectBlueprintRevisionSaveResult = { workspace: currentWorkspace, revision: result.metadata, originalResult: { planId:currentWorkspace.activePlan.id,planVersion:currentWorkspace.activePlan.version,blueprintId:saved.id,blueprintVersion:saved.version,sourceSetDigest:"",targetDigests:bookingRelationshipReviewContext(saved).targetDigests,revisionKinds:input.revisions.map(revision=>revision.kind),...(input.recoveryBinding?{recoveryBinding:structuredClone(input.recoveryBinding)}:{}) } };
      response.beforeIdentity = { planId: workspace.activePlan.id, planVersion: workspace.activePlan.version, blueprintId: workspace.activeBlueprint.id, blueprintVersion: workspace.activeBlueprint.version };
      // 原结果身份先在同一未提交事务内齐备，供规范祖先解析器验证；外部只会读到最终提交结果。
      this.database.prepare("UPDATE direct_blueprint_edits SET result_json=? WHERE id=?").run(JSON.stringify(response),result.metadata.id);
      response.originalResult!.sourceSetDigest=this.bookingSourceState(currentWorkspace.activePlan.id).sourceSetDigest;
      this.database.prepare("UPDATE direct_blueprint_edits SET result_json=? WHERE id=?").run(JSON.stringify(response),result.metadata.id);
      return response;
    }
  }

  private undoDirectBlueprintRevisionInTransaction(input: { expectedPlanId: string; expectedVersion: number; expectedBlueprintVersion: number; revisionId: string; requestId: string }): WorkspaceSnapshot {
    const fingerprint = JSON.stringify(input);
    const replay = this.database.prepare("SELECT fingerprint,result_json FROM direct_blueprint_undos WHERE request_id=?").get(input.requestId) as {fingerprint: string; result_json: string} | undefined;
    if (replay) { if (replay.fingerprint !== fingerprint) throw new WorkspaceMutationError("撤销请求身份不能复用于不同编辑。", "request_identity_conflict"); return this.getWorkspace(); }
    const workspace = this.getWorkspace();
    const edit = this.database.prepare("SELECT * FROM direct_blueprint_edits WHERE id=? AND undone=0").get(input.revisionId) as {plan_id:string;plan_version:number;blueprint_id:string;blueprint_version:number;before_json:string;after_json:string} | undefined;
    if (!edit || workspace.activePlan.id !== input.expectedPlanId || workspace.activePlan.version !== input.expectedVersion || edit.plan_id !== input.expectedPlanId || edit.plan_version !== input.expectedVersion || !workspace.activeBlueprint || workspace.activeBlueprint.id !== edit.blueprint_id || workspace.activeBlueprint.version !== input.expectedBlueprintVersion || edit.blueprint_version !== input.expectedBlueprintVersion) throw new WorkspaceMutationError("当前计划或旅行蓝图已变化，无法撤销该编辑。", "edit_unavailable");
    const createdAt = new Date().toISOString();
    const sourceState = this.bookingSourceState(workspace.activePlan.id);
    const sourceContext=this.bookingRuntimeSourceContext(workspace.activePlan,workspace.activeBlueprint,sourceState);
    if(sourceContext.planId!==input.expectedPlanId||sourceContext.planVersion!==input.expectedVersion)throw new WorkspaceMutationError("撤销来源基准已变化。","version_conflict");
    const blueprint = undoDirectBlueprintRevision(workspace.activeBlueprint, JSON.parse(edit.before_json) as TripBlueprint, JSON.parse(edit.after_json) as TripBlueprint, createdAt,sourceContext);
    {
      this.saveTripBlueprint(blueprint);
      const previousLineage=this.getPlanBlueprintLineage(workspace.activePlan.id);
      const compilation = compileTripBlueprint(blueprint, {createdAt,completedRequirementIds:completedRequirementIdsForWorkspace(workspace),...(previousLineage?{previousCompilation:{blueprint:workspace.activeBlueprint,plan:workspace.activePlan,lineage:previousLineage}}:{})});
      compilation.plan.configuration = mergeUserPlanConfiguration(compilation.plan.configuration,workspace.activePlan.configuration,workspace.activeBlueprint);
      this.createCompiledBlueprintPlan(compilation);
      this.database.prepare("UPDATE direct_blueprint_edits SET undone=1 WHERE id=?").run(input.revisionId);
      const result = this.getWorkspace();
      const receipt: DirectBlueprintUndoReceipt = { ...result, beforeIdentity: {planId: workspace.activePlan.id,planVersion: workspace.activePlan.version,blueprintId: workspace.activeBlueprint.id,blueprintVersion: workspace.activeBlueprint.version} };
      this.database.prepare("INSERT INTO direct_blueprint_undos(request_id,revision_id,fingerprint,result_json,created_at) VALUES(?,?,?,?,?)").run(input.requestId,input.revisionId,fingerprint,JSON.stringify(receipt),createdAt);
      return result;
    }
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

  /** Attach a saved, source-grounded execution repair without replacing the approved Plan. */
  saveExecutionBlueprintRepair(input: { planId: string; expectedVersion: number; expectedBlueprintVersion: number; blueprint: TripBlueprint }): WorkspaceSnapshot {
    const workspace = this.getWorkspace();
    const lineage = this.getPlanBlueprintLineage(input.planId);
    if (workspace.activePlan.id !== input.planId || workspace.activePlan.version !== input.expectedVersion || workspace.activePlan.status !== "active" || !workspace.activeBlueprint || workspace.activeBlueprint.version !== input.expectedBlueprintVersion || !lineage) throw new Error("The approved Plan changed before execution repair.");
    if (input.blueprint.id !== workspace.activeBlueprint.id || input.blueprint.version !== input.expectedBlueprintVersion + 1 || !this.getTripBlueprint(input.blueprint.id, input.blueprint.version)) throw new Error("Execution repair requires the saved next Blueprint version.");
    const nextVersion = input.expectedVersion + 1;
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const updated = this.database.prepare("UPDATE plans SET version = ?, presentation_json = ?, known_information_json = ?, sources_json = ? WHERE id = ? AND version = ? AND is_current = 1 AND is_execution = 1 AND status = 'active'").run(nextVersion, JSON.stringify(blueprintPresentation(input.blueprint)), JSON.stringify(routeRefreshKnownInformation(workspace.activePlan.knownInformation, input.blueprint)), JSON.stringify(input.blueprint.sources.map(source => ({ title: source.title, authority: source.authority, url: source.url, retrievedAt: source.retrievedAt }))), input.planId, input.expectedVersion);
      if (updated.changes !== 1) throw new Error("The approved Plan changed during execution repair.");
      const linked = this.database.prepare("UPDATE plan_blueprint_lineage SET plan_version = ?, blueprint_version = ?, compilation_key = ?, created_at = ? WHERE plan_id = ? AND blueprint_version = ?").run(nextVersion, input.blueprint.version, `execution-repair:${input.planId}:v${nextVersion}:blueprint-v${input.blueprint.version}`, new Date().toISOString(), input.planId, input.expectedBlueprintVersion);
      if (linked.changes !== 1) throw new Error("Blueprint lineage changed during execution repair.");
      this.database.exec("COMMIT");
    } catch (error) { this.database.exec("ROLLBACK"); throw error; }
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
  saveCompiledPlan(input: { plan: Plan; expectedPlanId: string; expectedVersion: number; audit: PlanCompilationAudit; skillRuns?: Array<Pick<PreparationEvidenceRun, "skillId" | "skillVersion" | "status"> & { sourceEvidence?: SourceEvidenceRef[] }>; compiledAt?: string }): WorkspaceSnapshot {
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

  listRecentPreparationEvidenceRuns(limit = 100): PreparationEvidenceRun[] {
    const safeLimit = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 500) : 100;
    return (this.database.prepare(`SELECT id, compilation_run_id, plan_id, source_plan_version, skill_id, skill_version, status, finished_at
      FROM country_pack_skill_runs ORDER BY finished_at DESC, rowid DESC LIMIT ?`).all(safeLimit) as unknown as PreparationEvidenceRunRow[]).map((row) => ({
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

  private get travelAdjustments(): TravelAdjustmentPersistence { return new TravelAdjustmentPersistence(this.database); }

  captureAdjustmentContext(): TravelAdjustmentContext {
    const workspace=this.getWorkspace(), execution=this.getExecutionPlan();
    const lineage=execution?this.getPlanBlueprintLineage(execution.id):undefined;
    const draft=execution && (workspace.activePlan.id!==execution.id || workspace.activePlan.version!==execution.version)?workspace.activePlan:undefined;
    const settings=this.email.settings();
    const savedPhase=this.travelAdjustments.phase(lineage?.blueprintId??execution?.id??'unbound');
    const phase:TravelPhase=savedPhase.execution?.id===execution?.id&&savedPhase.execution?.version===execution?.version?savedPhase:{value:'unknown',revision:savedPhase.revision,basis:'unresolved',recordedAt:savedPhase.recordedAt,evidenceRefs:[]};
    return {execution:execution?{id:execution.id,version:execution.version}:null,blueprint:lineage?{id:lineage.blueprintId,version:lineage.blueprintVersion}:null,
      draft:draft?{id:draft.id,version:draft.version}:null,draftBlueprint:draft&&workspace.activeBlueprint?{id:workspace.activeBlueprint.id,version:workspace.activeBlueprint.version}:null,
      phase,
      sourceSetDigest:execution?bookingRelationshipDigest(this.listCurrentTravelBookingSourcesForPlan(execution.id).map(b=>({id:b.id,digest:this.bookingSourceDigest(b)})).sort((a,b)=>a.id.localeCompare(b.id))):bookingRelationshipDigest([]),
      observationSetDigest:execution?this.travelAdjustments.observationDigest(execution.id,execution.version):bookingRelationshipDigest([]),
      authorizationDigest:bookingRelationshipDigest(settings),recipientRevision:settings.revision};
  }
  private assertAdjustmentContext(context: TravelAdjustmentContext): void {
    if(!isDeepStrictEqual(this.captureAdjustmentContext(),context)) throw new WorkspaceMutationError('旅行版本、来源、阶段或授权已变化，请重新审阅。','version_conflict');
  }
  recordTravelPhase(input: {context:TravelAdjustmentContext;value:TravelPhase['value'];basis:TravelPhase['basis'];recordedAt:string;evidenceRefs:string[];agent?:TravelPhase['agent']},authority:{verifyExecution?:(agent:NonNullable<TravelPhase['agent']>)=>boolean}={}):TravelPhase {
    const phase:TravelPhase={value:input.value,basis:input.basis,recordedAt:input.recordedAt,evidenceRefs:input.evidenceRefs,revision:input.context.phase.revision+1,...(input.context.execution?{execution:input.context.execution}:{}),...(input.agent?{agent:input.agent}:{})};
    assertTravelPhase(phase);
    if(phase.basis==='verified_actual_fact'&&(!phase.agent||authority.verifyExecution?.(phase.agent)!==true))throw new Error('实际旅行事实缺少经验证的负责执行合同。');
    this.database.exec('BEGIN IMMEDIATE');
    try { this.assertAdjustmentContext(input.context);if(!input.context.execution)throw new Error('尚无执行旅行。');this.travelAdjustments.savePhase(input.context.blueprint?.id??input.context.execution.id,phase);this.database.exec('COMMIT');return phase; }
    catch(error){this.database.exec('ROLLBACK');throw error;}
  }
  getTravelAdjustmentReceiptForPlan(planId:string,version:number){return this.travelAdjustments.receiptForPlan(planId,version);}
  getTravelAdjustmentReceipt(requestId:string){return this.travelAdjustments.receipt(requestId);}
  /** 以原逻辑身份识别旧版待发应用通知，不依赖后来增加的正文元数据。 */
  travelAdjustmentEmailAuthorization(job:{id:string;planId:string;planVersion:number;recipientRevision:number},now:string):'not_adjustment'|'authorized'|'rejected' {
    const requests=this.travelAdjustments.emailJobRequests(job.planId,job.planVersion,job.id,job.recipientRevision);
    if(!requests.length)return 'not_adjustment';
    return requests.length===1&&this.getTravelAdjustmentEmailConsumption(requests[0]!,now)?'authorized':'rejected';
  }
  /** 从同一请求持久事实生成可信消费投影；不改变已生效事实。 */
  getTravelAdjustmentEmailConsumption(requestId:string,now:string):TravelAdjustmentEmailConsumption|undefined {
    let opened=false;
    try {
      this.database.exec('SAVEPOINT travel_email_consumption');opened=true;
      const result=this.readTravelAdjustmentEmailConsumption(requestId,now);
      this.database.exec('RELEASE travel_email_consumption');opened=false;
      return result;
    }catch{
      if(opened){this.database.exec('ROLLBACK TO travel_email_consumption');this.database.exec('RELEASE travel_email_consumption');}
      return undefined;
    }
  }
  private readTravelAdjustmentEmailConsumption(requestId:string,now:string):TravelAdjustmentEmailConsumption|undefined {
    try {
      const at=Date.parse(now);if(!Number.isFinite(at))return undefined;
      const saved=this.travelAdjustments.storedRequest(requestId);if(!saved)return undefined;
      const {receipt,context,observations,decision,handoff}=saved;
      if(saved.requestId!==requestId||saved.handoffRequestId!==requestId||receipt.requestId!==requestId||handoff.requestId!==requestId||saved.intentId!==handoff.intentId||receipt.status!=='applied'||!receipt.handoff)return undefined;
      if(!this.travelAdjustments.hasUniqueAppliedHandoff(requestId,handoff.replacement.plan.id,handoff.replacement.plan.version))return undefined;
      // ACK 仅修改交接表的消费状态；应用时保存的其余快照必须逐字段一致。
      const initial={...handoff,status:receipt.handoff.status,readbackRef:receipt.handoff.readbackRef};
      if(!isDeepStrictEqual(initial,receipt.handoff)||!['pending','acknowledged'].includes(handoff.status)||handoff.basis!==receipt.basis||handoff.reason!==receipt.reason||!receipt.reason.trim()||handoff.arrangementRef!==receipt.receiptRef||handoff.invalidateOldPending!==true||handoff.updateFutureWork!==true)return undefined;
      if(!receipt.appliedAt||!Number.isFinite(Date.parse(receipt.appliedAt))||Date.parse(receipt.appliedAt)>at||!receipt.proposalDigest||!/^[a-f0-9]{64}$/.test(receipt.proposalDigest))return undefined;
      assertTravelPhase(context.phase);
      const same=(left:unknown,right:unknown)=>isDeepStrictEqual(left,right);
      if(!same(context.execution,handoff.base.plan)||!same(context.blueprint,handoff.base.blueprint)||!same(context.draft,handoff.replacement.plan)||!same(context.draftBlueprint,handoff.replacement.blueprint)||!same(context.phase.execution,context.execution))return undefined;
      const settings=this.email.settings();
      if(!settings.enabled||!settings.verified||settings.revision!==context.recipientRevision||bookingRelationshipDigest(settings)!==context.authorizationDigest)return undefined;
      const execution=this.getExecutionPlan(),arrangement=handoff.arrangement;
      if(!execution||execution.status!=='active'||!same({id:execution.id,version:execution.version},handoff.replacement.plan)||!same(execution,arrangement.plan))return undefined;
      for(const side of [handoff.base,handoff.replacement]){
        const plan=this.getPlanVersion(side.plan.id,side.plan.version),blueprint=this.getTripBlueprint(side.blueprint.id,side.blueprint.version),lineage=this.getPlanBlueprintLineage(side.plan.id);
        if(!plan||!blueprint||!lineage||lineage.planVersion>side.plan.version||lineage.blueprintId!==side.blueprint.id||lineage.blueprintVersion!==side.blueprint.version)return undefined;
        if(side===handoff.replacement&&(!same(plan,arrangement.plan)||!same(blueprint,arrangement.blueprint)))return undefined;
      }
      const base=this.getTripBlueprint(handoff.base.blueprint.id,handoff.base.blueprint.version)!;
      assertTravelAdjustmentReplacement(base,arrangement.blueprint,settings.cityTimeZones,{requireCompleteTiming:false});
      // 旧客观应用只持久化 verifyExecution 的布尔结果，无法证明公开执行核验。
      // 在规范 producer 提供可读回核验依据前，不从自报 executionRef 推造证明。
      if(receipt.basis!=='user_confirmation')return undefined;
      if(context.phase.value!=='pre_departure'||decision!==null||observations.length!==0||receipt.events.length!==0||receipt.applicationKey!==undefined||receipt.validationRef!==undefined||requestId!=='manual:'+receipt.proposalDigest||saved.digest!==receipt.proposalDigest||receipt.receiptRef!==requestId||handoff.intentId!==requestId)return undefined;
      const confirmation=this.email.planConfirmation(handoff.replacement.plan.id,handoff.replacement.plan.version);
      if(!confirmation||confirmation.basePlanId!==handoff.base.plan.id||confirmation.baseVersion!==handoff.base.plan.version||confirmation.confirmedAt!==receipt.appliedAt)return undefined;
      return {receipt:{...receipt,handoff},context,observations,decision,arrangement,confirmation};
    }catch{return undefined;}
  }
  listTravelAdjustmentObservations(planId:string,version:number){return this.travelAdjustments.observations(planId,version);}
  listPendingTravelAdjustmentHandoffs(){return this.travelAdjustments.pending();}
  acknowledgeTravelAdjustmentHandoff(intentId:string,readbackRef:string){return this.travelAdjustments.acknowledge(intentId,readbackRef);}
  travelAdjustmentProposalDigest():string {const w=this.getWorkspace();return bookingRelationshipDigest({plan:w.activePlan,blueprint:w.activeBlueprint??null});}
  readTravelAdjustmentArrangement(requestId:string){
    const result=this.travelAdjustments.receipt(requestId);if(!result?.handoff)return undefined;
    return structuredClone(result.handoff.arrangement);
  }
  commitTravelAdjustment(input:TravelAdjustmentInput,authority:{verifyExecution?:(decision:NonNullable<TravelAdjustmentInput['decision']>,input:TravelAdjustmentInput)=>boolean}={}):TravelAdjustmentReceipt {
    assertTravelAdjustmentInput(input);const digest=bookingRelationshipDigest(input);
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const old=this.travelAdjustments.receipt(input.requestId);
      if(old){if(this.travelAdjustments.requestDigest(input.requestId)!==digest)throw new WorkspaceMutationError('旅行请求身份已用于其他内容。','version_conflict');this.database.exec('COMMIT');return old;}
      try {this.assertAdjustmentContext(input.context);}catch {
        const applied=this.travelAdjustments.appliedInput(input);if(applied){this.database.exec('COMMIT');return applied;}
        const rejected:TravelAdjustmentReceipt={requestId:input.requestId,status:'rejected',reason:'旅行版本、来源、阶段或授权已经变化。',events:[]};
        this.travelAdjustments.save(input.requestId,digest,input.context,input.observations,input.decision,rejected);this.database.exec('COMMIT');return rejected;
      }
      if(!input.context.execution)throw new WorkspaceMutationError('当前没有执行旅行。','version_conflict');
      const verified=Boolean(input.decision && authority.verifyExecution?.(input.decision,input)===true);
      const fresh=verified&&input.observations.every(o=>o.validUntil&&Date.parse(o.validUntil)>Date.parse(input.now));
      const events=this.travelAdjustments.observe(input.context,input.observations,fresh&&input.decision?.verdict==='eligible',fresh&&input.decision?.changeKind==='none'&&input.decision.verdict==='eligible');
      const changedKeys=new Set(input.observations.filter(observation=>observation.status==='changed').map(observation=>observation.key));
      const applicationEvents=events.filter(event=>event.status==='open'&&changedKeys.has(event.key));
      const applicationKey=bookingRelationshipDigest({base:input.context.execution,events:applicationEvents.map(event=>({eventId:event.eventId,episode:event.episode})).sort((a,b)=>a.eventId.localeCompare(b.eventId))});
      const observed=this.travelAdjustments.observations(input.context.execution.id,input.context.execution.version).map(row=>row.observation);
      let blocker=travelAdjustmentApplicationBlocker({...input,observations:observed},verified);
      if(!blocker && observed.some(o=>!o.validUntil||Date.parse(o.validUntil)<=Date.parse(input.now)))blocker='旅行来源有效窗口已经结束。';
      if(!blocker&&!this.travelAdjustments.coversChanges(input.observations,applicationEvents))blocker='旅行变化缺少完整持久事件，请保留现行安排并重新核实。';
      if(!blocker&&this.travelAdjustments.consumed(applicationEvents))blocker='同一旅行事件已经应用，请等待可靠恢复后重新判断。';
      const receipt:TravelAdjustmentReceipt={requestId:input.requestId,status:'unresolved',reason:blocker??'',events};
      if(!blocker){
        const w=this.getWorkspace(),replacement=input.replacement!,base=input.context.blueprint;
        if(!base||!input.context.draft||w.activePlan.id!==replacement.planId||w.activePlan.version!==replacement.version||w.activeBlueprint?.version!==replacement.blueprintVersion||w.activeBlueprint.id!==base.id||this.travelAdjustmentProposalDigest()!==replacement.proposalDigest)blocker='完整替代草稿与审阅基准不一致。';
        else if(!this.travelAdjustments.matchesDraft(w.activePlan.id,w.activePlan.version,input.context,input.observations,replacement.proposalDigest))blocker='当前草稿不属于本次可靠旅行事件，请保留原草稿并重新规划。';
        else {
          this.database.exec('SAVEPOINT travel_application');
          try {
            const before=this.getTripBlueprint(base.id,base.version);if(!before)throw new Error('原旅行蓝图无法读取。');
            const lineage=this.getPlanBlueprintLineage(w.activePlan.id);if(!lineage||lineage.blueprintId!==w.activeBlueprint.id||lineage.blueprintVersion!==w.activeBlueprint.version||lineage.planVersion>w.activePlan.version)throw new Error('替代安排缺少精确编译来源。');
            const state=this.bookingSourceState(w.activePlan.id);if(state.issues.length||state.pendingBookings.length)throw new Error('替代安排的预订来源尚未解决。');
            assertTravelAdjustmentReplacement(before,w.activeBlueprint,this.email.settings().cityTimeZones);
            if(!this.email.settings().enabled||!this.email.settings().verified)throw new Error('旅行授权尚未有效。');
            this.applyPlanInTransaction(w.activePlan.id,w.activePlan.version,{expectedBase:input.context.execution,expectedBlueprintVersion:replacement.blueprintVersion},'objective_change',input.now);
            receipt.applicationKey=applicationKey;receipt.status='applied';receipt.reason=input.decision!.rationale;receipt.basis='objective_change';receipt.appliedAt=input.now;receipt.proposalDigest=replacement.proposalDigest;receipt.receiptRef='travel-adjustment:'+input.requestId;receipt.validationRef='blueprint-validation:'+replacement.proposalDigest;
            receipt.handoff={basis:'objective_change',arrangement:{plan:structuredClone(this.getWorkspace().activePlan),blueprint:structuredClone(w.activeBlueprint)},intentId:bookingRelationshipDigest({base:input.context.execution,events}),requestId:input.requestId,status:'pending',reason:receipt.reason,arrangementRef:receipt.receiptRef,base:{plan:input.context.execution,blueprint:base},replacement:{plan:{id:w.activePlan.id,version:w.activePlan.version},blueprint:{id:w.activeBlueprint.id,version:w.activeBlueprint.version}},invalidateOldPending:true,updateFutureWork:true,readbackRef:null};
            this.travelAdjustments.consume(applicationEvents,input.requestId);
            this.database.exec('RELEASE travel_application');
          } catch(error) { this.database.exec('ROLLBACK TO travel_application');this.database.exec('RELEASE travel_application');if(receipt.status==='applied')throw error;blocker='完整替代安排未通过版本、预订、交通或授权校验。'; }
        }
      }
      if(blocker)receipt.reason=blocker;
      if(fresh&&input.decision?.verdict==='eligible'&&input.decision.changeKind==='none'&&input.observations.every(o=>o.status==='unchanged')){receipt.status='observed';receipt.reason=input.decision.rationale;}
      this.travelAdjustments.save(input.requestId,digest,input.context,input.observations,input.decision,receipt);
      this.database.exec('COMMIT');return receipt;
    }catch(error){this.database.exec('ROLLBACK');throw error;}
  }

  confirmPlan(planId: string, expectedVersion?: number, options: {expectedBase?:{id:string;version:number};expectedBlueprintVersion?:number;expectedRecipientRevision?:number;confirmedAt?:string;adjustmentContext?:TravelAdjustmentContext;proposalDigest?:string} = {}): WorkspaceSnapshot {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      if(options.adjustmentContext){this.assertAdjustmentContext(options.adjustmentContext);if(options.adjustmentContext.phase.value!=='pre_departure')throw new WorkspaceMutationError('请先核实出发前旅行阶段再明确确认。','version_conflict');}
      if(options.proposalDigest && options.proposalDigest!==this.travelAdjustmentProposalDigest())throw new WorkspaceMutationError('替代安排内容已变化。','version_conflict');
      if(options.adjustmentContext?.blueprint){
        const w=this.getWorkspace(),base=this.getTripBlueprint(options.adjustmentContext.blueprint.id,options.adjustmentContext.blueprint.version);
        if(!base||!w.activeBlueprint)throw new WorkspaceMutationError('明确确认缺少完整旅行蓝图。','activation_review_required');
        const state=this.bookingSourceState(w.activePlan.id);if(state.issues.length||state.pendingBookings.length)throw new WorkspaceMutationError('旅行预订来源仍需审阅。','booking_source_review_required');
        assertTravelAdjustmentReplacement(base,w.activeBlueprint,this.email.settings().cityTimeZones,{requireCompleteTiming:false});
      }
      const switchedAt=options.confirmedAt??new Date().toISOString();
      this.applyPlanInTransaction(planId,expectedVersion,options,'manual_confirmation',switchedAt);
      if(options.adjustmentContext?.execution && options.adjustmentContext.blueprint && options.proposalDigest){
        const w=this.getWorkspace(),c=options.adjustmentContext;
        if(!w.activeBlueprint)throw new Error('明确确认缺少旅行蓝图。');
        const requestId='manual:'+options.proposalDigest;
        const receipt:TravelAdjustmentReceipt={requestId,status:'applied',basis:'user_confirmation',reason:'旅行者已明确确认精确替代安排。',events:[],appliedAt:switchedAt,proposalDigest:options.proposalDigest,receiptRef:requestId};
        receipt.handoff={basis:'user_confirmation',arrangement:{plan:w.activePlan,blueprint:w.activeBlueprint},intentId:requestId,requestId,status:'pending',reason:receipt.reason,arrangementRef:requestId,base:{plan:c.execution!,blueprint:c.blueprint!},replacement:{plan:{id:w.activePlan.id,version:w.activePlan.version},blueprint:{id:w.activeBlueprint.id,version:w.activeBlueprint.version}},invalidateOldPending:true,updateFutureWork:true,readbackRef:null};
        this.travelAdjustments.save(requestId,options.proposalDigest,c,[],null,receipt);
      }
      this.database.exec('COMMIT');
    }catch(error){this.database.exec('ROLLBACK');throw error;}
    return this.getWorkspace();
  }
  private applyPlanInTransaction(planId:string,expectedVersion:number|undefined,options:{expectedBase?:{id:string;version:number};expectedBlueprintVersion?:number;expectedRecipientRevision?:number},basis:'manual_confirmation'|'objective_change',switchedAt:string):void {
    const workspace=this.getWorkspace(),previousExecution=this.getExecutionPlan();
    if(options.expectedRecipientRevision!==undefined){const recipient=this.email.settings();if(!recipient.enabled||!recipient.verified||recipient.revision!==options.expectedRecipientRevision)throw new WorkspaceMutationError('旅行收件授权已变化。','version_conflict');}
    if(expectedVersion!==undefined&&(workspace.activePlan.id!==planId||workspace.activePlan.version!==expectedVersion))throw new WorkspaceMutationError('旅行草稿已变化。','version_conflict');
    if(options.expectedBase&&(previousExecution?.id!==options.expectedBase.id||previousExecution.version!==options.expectedBase.version||previousExecution.status!=='active'))throw new WorkspaceMutationError('执行旅行已变化。','version_conflict');
    if(options.expectedBlueprintVersion!==undefined&&workspace.activeBlueprint?.version!==options.expectedBlueprintVersion)throw new WorkspaceMutationError('旅行蓝图已变化。','version_conflict');
    const confirmed=applyPlanActivation(workspace,planId,basis);
    if(previousExecution&&previousExecution.id!==planId){
      this.database.prepare("UPDATE task_reminder_runs SET status='cancelled',finished_at=?,updated_at=? WHERE plan_id=? AND status IN ('running','retry_wait')").run(switchedAt,switchedAt,previousExecution.id);
      if(basis==='manual_confirmation')this.email.recordPlanConfirmation({planId,version:confirmed.activePlan.version,basePlanId:previousExecution.id,baseVersion:previousExecution.version,confirmedAt:switchedAt});
    }
    this.database.prepare('UPDATE plans SET is_execution=0 WHERE is_execution=1').run();
    this.database.prepare('UPDATE plans SET status=?,next_action=?,is_execution=1 WHERE id=? AND is_current=1').run(confirmed.activePlan.status,confirmed.activePlan.nextAction,planId);
    this.email.cancelObsolete(planId,confirmed.activePlan.version,switchedAt);this.addInbox(confirmed.inbox[0]!);
  }

  undoLatestPlanReplacement(input: { expectedPlanId: string; expectedVersion: number }): WorkspaceSnapshot {
    const workspace = this.getWorkspace();
    if (workspace.activePlan.id !== input.expectedPlanId || workspace.activePlan.version !== input.expectedVersion || workspace.activePlan.status !== "active") {
      throw new WorkspaceMutationError("The active Plan changed before this replacement could be undone.", "version_conflict");
    }
    const audit = this.getLatestPlanReplacementAudit(workspace.activePlan.id);
    if (!audit || audit.replacementPlanVersion !== workspace.activePlan.version) throw new WorkspaceMutationError("There is no latest replacement activation to undo.", "edit_unavailable");
    const source = this.database.prepare("SELECT id, status FROM plans WHERE id = ? AND is_current = 0 AND is_execution = 0").get(audit.sourcePlanId) as { id: string; status: Plan["status"] } | undefined;
    if (!source) throw new WorkspaceMutationError("The previous Plan is no longer available to restore.", "edit_unavailable");
    const restoredAt = new Date().toISOString();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare(`UPDATE task_reminder_runs SET status = 'cancelled', finished_at = ?, updated_at = ?
        WHERE plan_id = ? AND status IN ('running', 'retry_wait')`).run(restoredAt, restoredAt, workspace.activePlan.id);
      this.database.prepare("UPDATE telegram_plan_change_proposals SET status = 'cancelled', resolved_at = ? WHERE plan_id = ? AND status = 'pending'").run(restoredAt, workspace.activePlan.id);
      this.database.prepare("UPDATE plans SET is_current = 0, is_execution = 0 WHERE id = ? AND is_current = 1 AND is_execution = 1").run(workspace.activePlan.id);
      const restored = this.database.prepare("UPDATE plans SET is_current = 1, is_execution = 1, status = 'active' WHERE id = ? AND is_current = 0 AND is_execution = 0").run(source.id);
      if (restored.changes !== 1) throw new WorkspaceMutationError("The previous Plan could not be restored atomically.");
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
    const preferredLanguage = "English";
    if (input.assistantPersonality !== undefined && !isAssistantPersonalityId(input.assistantPersonality)) throw new Error("Choose a supported assistant personality.");
    const assistantPersonality = input.assistantPersonality ?? this.getWorkspace().profile.assistantPersonality ?? "local_insider";
    const travelPreferences = input.travelPreferences?.trim() ?? "";
    const nationality = input.nationality.trim();
    if (!displayName || !preferredLanguage || !nationality) throw new Error("Name, preferred language, and nationality are required.");
    if (displayName.length > 80 || preferredLanguage.length > 80 || nationality.length > 100 || travelPreferences.length > 300) throw new Error("Keep each Profile text field concise.");
    if (!["not_specified", "woman", "man", "nonbinary", "prefer_not_to_say"].includes(input.gender)) throw new Error("Choose a supported gender setting.");
    if (!["unknown", "no_visa", "short_term_visitor", "tourist_visa", "student_visa", "work_visa", "residence_permit", "other"].includes(input.immigrationStatus)) throw new Error("Choose a supported immigration status setting.");

    // Entry permission is destination-specific. An unknown visa status must stay
    // unknown for policy checks, but it does not prevent domestic trip planning.
    const status = "ready";
    this.database.prepare("UPDATE profiles SET display_name = ?, preferred_language = ?, travel_preferences = ?, assistant_personality = ?, nationality = ?, gender = ?, immigration_status = ?, status = ?, updated_at = ? WHERE id = 1").run(
      displayName,
      preferredLanguage,
      travelPreferences,
      assistantPersonality,
      nationality,
      input.gender,
      input.immigrationStatus,
      status,
      new Date().toISOString()
    );
    if (status === "ready") this.database.prepare("DELETE FROM inbox_items WHERE id = 'setup'").run();
    this.addInbox({
      id: `profile-updated-${Date.now()}`,
      tone: status === "ready" ? "ready" : "notice",
      title: "Profile saved locally",
      body: "Only confirmed long-term information is stored in the Profile.",
      timestamp: "Just now"
    });
    return this.getWorkspace();
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
    if (workspace.activePlan.id !== planId) throw new WorkspaceMutationError(`Plan ${planId} was not found.`);
    if (workspace.activePlan.status !== "draft") throw new WorkspaceMutationError("Official evidence can be linked only while the current Plan is a draft.");
    const snapshot = this.database.prepare(`SELECT id, source_id, authority, title_original, url, retrieved_at, content_hash, excerpt
      FROM source_snapshots WHERE id = ?`).get(sourceSnapshotId.trim()) as SourceSnapshotRow | undefined;
    if (!snapshot) throw new WorkspaceMutationError("The saved official evidence was not found.", "operation_not_found");

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
    if (Number(updated.changes) !== 1) throw new WorkspaceMutationError("The Plan changed before official evidence could be linked.", "version_conflict");
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
    if (workspace.activePlan.id !== planId) throw new WorkspaceMutationError(`Plan ${planId} was not found.`);
    const name = input.name.trim();
    const address = input.address.trim();
    const location = input.location.trim();
    if (!name || !address || !location) throw new WorkspaceMutationError("A saved accommodation candidate needs a name, address, and location.");

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
    if (plan.id !== input.planId || plan.version !== input.expectedVersion) throw new WorkspaceMutationError("The Plan changed before this accommodation update was saved.", "version_conflict");
    if (plan.status !== "draft") throw new WorkspaceMutationError("An active Plan must use a replacement draft before changing accommodation.", "draft_required");
    if (!plan.presentation || plan.presentation.kind !== "itinerary") throw new WorkspaceMutationError("This Plan does not contain a structured itinerary presentation.");
    const name = input.accommodation.name.trim();
    const address = input.accommodation.address.trim();
    const location = input.accommodation.location.trim();
    if (!name || !address || !location) throw new WorkspaceMutationError("Accommodation linkage needs a resolved name, address, and location.");
    const dayById = new Map(plan.presentation.days.map((day) => [day.id, day]));
    const placeIds = new Set(plan.presentation.places.map((place) => place.id));
    if (input.departures.some(({ dayId, departure }) => !dayById.has(dayId) || !placeIds.has(departure.destinationPlaceId) || departure.accommodationName !== name || departure.accommodationAddress !== address)) throw new WorkspaceMutationError("Accommodation departure facts do not match this Plan.");
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
    if (updated.changes !== 1) throw new WorkspaceMutationError("The Plan changed before this accommodation update was saved.", "version_conflict");
    const verified = input.departures.filter((item) => item.departure.verification === "verified").length;
    this.addInbox({ id: `accommodation-linked-${input.planId}-${Date.now()}`, tone: verified === input.departures.length ? "ready" : "attention", title: "Accommodation linked to the Travel Plan", body: `${name} was saved. Departure routes were updated for ${verified} travel days, while ${input.departures.length - verified} still need verification.`, timestamp: "Just now" });
    return this.getWorkspace();
  }

  updatePlanTransportPreference(planId: string, input: PlanTransportPreferenceInput): WorkspaceSnapshot {
    const workspace = this.getWorkspace();
    const plan = workspace.activePlan.id === planId ? workspace.activePlan : workspace.executionPlan?.id === planId ? workspace.executionPlan : undefined;
    if (!plan) throw new WorkspaceMutationError(`Plan ${planId} was not found.`);
    if (!["plan_recommended", "taxi", "public_transit", "walking", "driving"].includes(input.preference)) throw new WorkspaceMutationError("Choose a supported transport preference.");
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
    if (!plan) throw new WorkspaceMutationError(`Plan ${planId} was not found.`);
    const partySize = input.partySize;
    if (partySize !== undefined && (!Number.isInteger(partySize) || partySize < 1 || partySize > 20)) throw new WorkspaceMutationError("Party size must be a whole number from 1 to 20.");
    if (!["unknown", "light", "standard", "heavy"].includes(input.luggage)) throw new WorkspaceMutationError("Choose a supported luggage level.");
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
        travel_preferences TEXT NOT NULL DEFAULT '',
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
        carrier_cancel_requested_at TEXT,
        failure_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      ${GENERATION_CARRIER_SCHEMA_SQL}
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
        transport_override TEXT CHECK (transport_override IN ('taxi', 'public_transit', 'walking', 'driving'))
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
    if (!profileColumns.some((column) => column.name === "travel_preferences")) this.database.exec("ALTER TABLE profiles ADD COLUMN travel_preferences TEXT NOT NULL DEFAULT ''");
    if (!profileColumns.some((column) => column.name === "assistant_personality")) this.database.exec("ALTER TABLE profiles ADD COLUMN assistant_personality TEXT NOT NULL DEFAULT 'local_insider' CHECK (assistant_personality IN ('local_insider', 'travel_buddy', 'miles'))");
    this.database.exec("UPDATE profiles SET preferred_language = 'English' WHERE preferred_language <> 'English'");
    const locationIntentColumns = this.database.prepare("PRAGMA table_info(telegram_location_intent)").all() as unknown as Array<{ name: string }>;
    if (!locationIntentColumns.some((column) => column.name === "transport_override")) this.database.exec("ALTER TABLE telegram_location_intent ADD COLUMN transport_override TEXT CHECK (transport_override IN ('taxi', 'public_transit', 'walking', 'driving'))");
    const locationIntentSchema = this.database.prepare("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'telegram_location_intent'").get() as { sql: string } | undefined;
    if (locationIntentSchema?.sql && (!locationIntentSchema.sql.includes("'movement_go'") || !locationIntentSchema.sql.includes("'driving'"))) {
      this.database.exec(`BEGIN;
        CREATE TABLE telegram_location_intent_next (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          purpose TEXT NOT NULL CHECK (purpose IN ('arrival_route', 'nearby_food', 'uber_test', 'movement_go')),
          plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
          started_at TEXT NOT NULL,
          transport_override TEXT CHECK (transport_override IN ('taxi', 'public_transit', 'walking', 'driving'))
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
    this.database.exec(`CREATE TABLE IF NOT EXISTS execution_assistant_states (
      plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
      plan_version INTEGER NOT NULL,
      revision INTEGER NOT NULL,
      state_json TEXT NOT NULL,
      PRIMARY KEY (plan_id, plan_version)
    );`);
    const migrationTime = new Date().toISOString();
    this.database.exec(EMAIL_SCHEMA_SQL);
    if(existingVersion<24){
      this.database.prepare("UPDATE email_outbox SET status='cancelled',failure_code='timing_replaced' WHERE kind IN ('morning','transfer','dining') AND status IN ('pending','retry')").run();
      const columns=this.database.prepare("PRAGMA table_info(email_settings)").all() as {name:string}[];
      for(const name of ["morning_time","transfer_lead","dining_lead"]){
        if(columns.some(column=>column.name===name))this.database.exec(`ALTER TABLE email_settings DROP COLUMN ${name}`);
      }
      this.database.prepare("INSERT OR IGNORE INTO schema_migrations(version,name,applied_at) VALUES(24,'agent-email-timing',?)").run(new Date().toISOString());
    }
    const emailColumns = this.database.prepare("PRAGMA table_info(email_settings)").all() as unknown as Array<{name:string}>;
    if (!emailColumns.some(column => column.name === "city_time_zones_json")) this.database.exec("ALTER TABLE email_settings ADD COLUMN city_time_zones_json TEXT NOT NULL DEFAULT '{}'");
    if (existingVersion > 0 && existingVersion < 23) {
      const legacy = this.database.prepare("SELECT id,version,presentation_json FROM plans WHERE is_execution=1 AND status='active'").get() as { id: string; version: number; presentation_json: string | null } | undefined;
      if (legacy?.presentation_json) {
        const presentation = JSON.parse(legacy.presentation_json) as { endDate?: string };
        if (presentation.endDate && /^\d{4}-\d{2}-\d{2}$/.test(presentation.endDate) && Number.isFinite(Date.parse(presentation.endDate))) {
          const until = new Date(Date.parse(`${presentation.endDate}T23:59:59Z`) + 12 * 3_600_000).toISOString();
          this.database.prepare("UPDATE email_settings SET legacy_plan_id=?,legacy_plan_version=?,legacy_until=? WHERE id=1").run(legacy.id,legacy.version,until);
        }
      }
    }

    this.database.prepare("INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (23, 'email-settings-and-outbox', ?)").run(migrationTime);
    this.database.prepare("INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (22, 'assistant-personality', ?)").run(migrationTime);
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
    this.database.prepare("INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (20, 'profile-travel-preferences', ?)").run(migrationTime);
    this.database.prepare("INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (21, 'execution-assistant-progress', ?)").run(migrationTime);
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
    this.database.prepare("INSERT INTO profiles (id, display_name, preferred_language, travel_preferences, nationality, gender, immigration_status, status, updated_at) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      workspace.profile.displayName,
      workspace.profile.preferredLanguage,
      workspace.profile.travelPreferences ?? "",
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
    const preference = parsed.transport && ["plan_recommended", "taxi", "public_transit", "walking", "driving"].includes(parsed.transport.preference) ? parsed.transport.preference : defaults.transport.preference;
    const travelContext = parsed.travelContext && ["unknown", "light", "standard", "heavy"].includes(parsed.travelContext.luggage) ? { ...(Number.isInteger(parsed.travelContext.partySize) && parsed.travelContext.partySize! >= 1 && parsed.travelContext.partySize! <= 20 ? { partySize: parsed.travelContext.partySize } : {}), luggage: parsed.travelContext.luggage } : defaults.travelContext;
    const arrival = parsed.arrival && typeof parsed.arrival === "object" ? { ...(typeof parsed.arrival.expectedAtLocal === "string" && isLocalDateTime(parsed.arrival.expectedAtLocal) ? { expectedAtLocal: parsed.arrival.expectedAtLocal } : {}), ...(typeof parsed.arrival.timeZone === "string" && isTimeZoneName(parsed.arrival.timeZone) ? { timeZone: parsed.arrival.timeZone } : {}) } : defaults.arrival;
    return { accommodation, arrival, transport: { preference }, travelContext };
  } catch {
    // Old local data can safely fall back to an empty Plan configuration.
  }
  return defaults;
}

function mergeUserPlanConfiguration(compiled: PlanConfiguration, previous: PlanConfiguration, beforeBlueprint?: TripBlueprint): PlanConfiguration {
  const baseline = beforeBlueprint ? compileTripBlueprint(beforeBlueprint,{createdAt:beforeBlueprint.createdAt}).plan.configuration : undefined;
  const accommodation = compiled.accommodation.status !== "not_set" || (baseline && isDeepStrictEqual(previous.accommodation,baseline.accommodation)) ? compiled.accommodation : previous.accommodation;
  const arrival=compiled.arrival.expectedAtLocal || (baseline&&isDeepStrictEqual(previous.arrival,baseline.arrival))?compiled.arrival:previous.arrival;
  return { ...structuredClone(compiled), accommodation: structuredClone(accommodation), arrival: structuredClone(arrival), transport: structuredClone(previous.transport), travelContext: structuredClone(previous.travelContext) };
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

function validateCompiledPlanWrite(input: { plan: Plan; expectedPlanId: string; expectedVersion: number; audit: PlanCompilationAudit; skillRuns?: Array<Pick<PreparationEvidenceRun, "skillId" | "skillVersion" | "status"> & { sourceEvidence?: SourceEvidenceRef[] }> }, compiledAt: string): void {
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

function refreshedRouteText(input: { mode: PlanRouteSegment["mode"]; originName: string; destinationName: string; durationMinutes?: number; distanceMeters: number }): { label: string; detail: string } {
  const distance = routeDistanceLabel(input.distanceMeters);
  const origin = input.originName.trim() || "the previous stop";
  const destination = input.destinationName.trim() || "the next stop";
  if (input.mode === "walking") {
    return {
      label: input.durationMinutes ? `${input.durationMinutes} min walk` : distance ? `${distance} walk` : "Walk between stops",
      detail: routeDetail(`Walk from ${origin} to ${destination}`, input.durationMinutes, distance)
    };
  }
  if (input.mode === "transit") {
    return {
      label: input.durationMinutes ? transitRouteLabel(input.durationMinutes) : "Transit between stops",
      detail: routeDetail(`Take transit from ${origin} to ${destination}`, input.durationMinutes, distance)
    };
  }
  if (input.mode === "driving") {
    return {
      label: input.durationMinutes ? `${input.durationMinutes} min by car` : "Go by car",
      detail: routeDetail(`Go from ${origin} to ${destination} by car or taxi`, input.durationMinutes, distance)
    };
  }
  return {
    label: input.durationMinutes ? `${input.durationMinutes} min journey` : "Move between stops",
    detail: routeDetail(`Travel from ${origin} to ${destination}`, input.durationMinutes, distance)
  };
}

function transitRouteLabel(durationMinutes: number): string {
  if (durationMinutes <= 20) return "Short transit ride";
  if (durationMinutes <= 45) return `${durationMinutes} min by transit`;
  return `${durationMinutes} min transit transfer`;
}

function routeDetail(prefix: string, durationMinutes: number | undefined, distance: string | undefined): string {
  const facts = [
    durationMinutes ? `allow about ${durationMinutes} minutes` : undefined,
    distance ? `about ${distance}` : undefined
  ].filter(Boolean);
  return facts.length ? `${prefix}; ${facts.join(", ")}.` : `${prefix}.`;
}

function routeDistanceLabel(distanceMeters: number): string | undefined {
  if (!Number.isInteger(distanceMeters) || distanceMeters <= 0) return undefined;
  if (distanceMeters < 1000) return `${distanceMeters} m`;
  return `${(distanceMeters / 1000).toFixed(1)} km`;
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
  return knownInformation.filter(item => !item.startsWith("Trip Blueprint: "));
}

function routeRefreshAssumptions(assumptions: string[], blueprint: TripBlueprint): string[] {
  const retained = assumptions.filter((item) => !/travel facts? or map details? remain marked for recheck/i.test(item) && item !== "Some opening hours and travel details need checking closer to your trip.");
  const recheckCount = blueprint.movements.filter((movement) => movement.status !== "verified").length;
  if (!recheckCount) return retained;
  return ["Some opening hours and travel details need checking closer to your trip.", ...retained];
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
    const bookingTask = item.task.requirementId?.startsWith("booking:");
    const matches = (task:Task) => bookingTask ? task.requirementId === item.task.requirementId : !task.requirementId?.startsWith("booking:") && normalizedPlanLabel(task.title) === normalizedPlanLabel(item.task.title);
    const matchingTask = sameStage?.tasks.find(matches) ?? replacementPlan.stages.flatMap((stage) => stage.tasks).find(matches);

    if (matchingTask) {
      matchingTask.status = "completed";
      matchingTask.owner = item.task.owner;
      delete matchingTask.reminder;
      delete matchingTask.activationTrigger;
      preserved.push({ sourceTaskId: item.task.id, replacementTaskId: matchingTask.id, title: matchingTask.title });
      continue;
    }

    if (bookingTask) continue;
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
