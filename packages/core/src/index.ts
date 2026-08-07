import { randomUUID } from "node:crypto";
import type { PlanCompilationOrigin } from "./plan-compiler.js";

export { recommendPlanTransport, type TransportMode, type TransportRecommendation, type TransportRouteFact } from "./transport.js";
export { assessPolicyPreparation, type PolicyPreparationAssessment, type PolicyPreparationItem, type PolicyPreparationStatus } from "./policy-applicability.js";
export { compilePlanProposal, type PlanCompilationAudit, type PlanCompilationBlockReason, type PlanCompilationDecision, type PlanCompilationOrigin, type PlanCompilationProposal, type PlanCompilationTaskProposal } from "./plan-compiler.js";

export type PlanStatus = "draft" | "active" | "completed" | "cancelled";
export type TaskStatus = "scheduled" | "ready" | "running" | "waiting_user" | "blocked" | "completed" | "skipped" | "failed" | "cancelled";
export type TaskActivationTrigger = "arrival";
export type ProfileGender = "not_specified" | "woman" | "man" | "nonbinary" | "prefer_not_to_say";
export type ImmigrationStatus = "unknown" | "short_term_visitor" | "tourist_visa" | "student_visa" | "work_visa" | "residence_permit" | "other";
export type AgentRuntimeKind = "codex" | "claude-code";
export type RunStatus = "running" | "succeeded" | "failed" | "fallback";
export type RunTrigger = "web" | "telegram";
export type TransportPreference = "plan_recommended" | "taxi" | "public_transit" | "walking";
export type LuggageLevel = "unknown" | "light" | "standard" | "heavy";
export type TaskReminderDynamicFact = "weather";

export interface TaskReminder {
  /** Local wall-clock time in YYYY-MM-DDTHH:mm form. */
  scheduledAtLocal: string;
  /** IANA time zone for the local wall-clock time. */
  timeZone: string;
  /** Why this reminder should run; final delivery copy is generated from current facts. */
  purpose: string;
  /** Explicit delivery-time facts to refresh. Missing means none for backward compatibility. */
  refreshFacts?: TaskReminderDynamicFact[];
}

export interface Task {
  id: string;
  title: string;
  /** Optional user-facing detail for a compiled preparation item. */
  description?: string;
  owner: "assistant" | "user" | "external";
  status: TaskStatus;
  dueLabel: string;
  /** An explicit event marker; Core must never infer this from a task title. */
  activationTrigger?: TaskActivationTrigger;
  /** A proposed reminder remains inert until this exact Plan version is confirmed. */
  reminder?: TaskReminder;
  /** Version-bound provenance for a task compiled from a Country Pack proposal. */
  origin?: PlanCompilationOrigin;
}

export interface Stage {
  id: string;
  title: string;
  description: string;
  tasks: Task[];
  /** Allows a later compilation to replace this exact generated stage safely. */
  origin?: PlanCompilationOrigin;
}

export interface SourceReference {
  title: string;
  authority: string;
  url: string;
  retrievedAt: string;
  /** Present only when this reference came from an immutable saved SourceSnapshot. */
  sourceSnapshotId?: string;
  /** SHA-256 fingerprint of the exact saved evidence version, when available. */
  contentHash?: string;
}

/** Immutable evidence retained after an allowlisted official-source fetch. */
export interface SourceSnapshot {
  id: string;
  sourceId: string;
  authority: string;
  titleOriginal: string;
  url: string;
  retrievedAt: string;
  contentHash: string;
  excerpt: string;
}

export interface SourceSnapshotInput {
  sourceId: string;
  authority: string;
  titleOriginal: string;
  url: string;
  retrievedAt: string;
  contentHash: string;
  excerpt: string;
}

export interface SourceSnapshotWriteResult {
  snapshot: SourceSnapshot;
  previousSnapshot?: SourceSnapshot;
  duplicate: boolean;
  contentChanged: boolean;
}

export interface PlanAccommodation {
  status: "not_set" | "candidate" | "confirmed";
  id?: string;
  name?: string;
  address?: string;
  location?: string;
  source?: "amap" | "user";
  updatedAt?: string;
}

/** A local arrival time belongs to one Plan, never to the long-term Profile. */
export interface PlanArrival {
  expectedAtLocal?: string;
  timeZone?: string;
}

/** Temporary, Plan-scoped facts. They must not leak into the long-term Profile. */
export interface PlanConfiguration {
  accommodation: PlanAccommodation;
  arrival: PlanArrival;
  transport: {
    preference: TransportPreference;
  };
  travelContext: {
    partySize?: number;
    luggage: LuggageLevel;
  };
}

export interface Plan {
  id: string;
  version: number;
  title: string;
  location: string;
  dates: string;
  status: PlanStatus;
  knownInformation: string[];
  assumptions: string[];
  nextAction: string;
  configuration: PlanConfiguration;
  stages: Stage[];
  sources: SourceReference[];
  createdAt: string;
}

export interface InboxItem {
  id: string;
  tone: "notice" | "attention" | "ready";
  title: string;
  body: string;
  timestamp: string;
}

export interface Profile {
  displayName: string;
  preferredLanguage: string;
  nationality: string;
  gender: ProfileGender;
  immigrationStatus: ImmigrationStatus;
  status: "incomplete" | "ready";
}

/** A per-instance choice only; credentials remain in the selected CLI's own login state. */
export interface RuntimeSelection {
  selectedKind: AgentRuntimeKind;
}

/** A privacy-preserving audit record for one user-requested Agent action. */
export interface AgentRun {
  id: string;
  kind: "plan_generation";
  runtimeKind: AgentRuntimeKind;
  trigger: RunTrigger;
  status: RunStatus;
  startedAt: string;
  finishedAt?: string;
  outputPlanId?: string;
  /** A short sanitized classification only; no prompt, model output, or secret. */
  failureCode?: string;
}

export type TaskReminderRunStatus = "running" | "retry_wait" | "succeeded" | "failed" | "cancelled";
export type TaskReminderWeatherStatus = "not_attempted" | "available" | "unavailable";

/** A minimized local audit record for one scheduled Reminder across all retry attempts. */
export interface TaskReminderRun {
  id: string;
  kind: "task_reminder";
  planId: string;
  taskId: string;
  reminderKey: string;
  dueAt: string;
  status: TaskReminderRunStatus;
  attemptCount: number;
  weatherStatus: TaskReminderWeatherStatus;
  weatherStage?: "amap" | "qweather" | "pipeline";
  weatherFailureCode?: string;
  telegramFailureCode?: string;
  startedAt: string;
  finishedAt?: string;
  updatedAt: string;
}

/** Minimized audit for one atomic Country Pack compilation into a new draft Plan version. */
export interface PlanCompilationRun {
  id: string;
  kind: "plan_compilation";
  planId: string;
  countryPackId: string;
  countryPackVersion: string;
  compositionSkillId: string;
  compositionSkillVersion: string;
  sourcePlanVersion: number;
  compiledPlanVersion: number;
  taskCount: number;
  reminderCount: number;
  compiledAt: string;
}

/** A Telegram account bound to this single-user local instance. */
export interface TelegramBinding {
  chatId: string;
  userId: string;
  firstName: string;
  username?: string;
  pairedAt: string;
}

export interface TelegramPairingStatus {
  state: "not_paired" | "waiting_for_start" | "paired";
  expiresAt?: string;
  binding?: TelegramBinding;
}

export interface WorkspaceSnapshot {
  profile: Profile;
  runtime: RuntimeSelection;
  activePlan: Plan;
  inbox: InboxItem[];
  sourceSnapshots: SourceSnapshot[];
  system: {
    core: "ready";
    storage: "local";
    runtime: "configured";
    telegram: "not_configured";
    amap: "not_configured";
  };
}

export interface CreatePlanInput {
  request: string;
}

export interface ProfileUpdate {
  displayName: string;
  preferredLanguage: string;
  nationality: string;
  gender: ProfileGender;
  immigrationStatus: ImmigrationStatus;
}

export interface RuntimeSelectionUpdate {
  kind: AgentRuntimeKind;
}

export interface PlanAccommodationInput {
  status: "candidate" | "confirmed";
  id?: string;
  name: string;
  address: string;
  location: string;
  source: "amap" | "user";
}

export interface PlanTransportPreferenceInput {
  preference: TransportPreference;
}

export interface PlanTravelContextInput {
  partySize?: number;
  luggage: LuggageLevel;
}

export interface PlanArrivalInput {
  expectedAtLocal?: string;
  timeZone?: string;
}

export interface GeneratedPlanDraft {
  title: string;
  location: string;
  dates: string;
  knownInformation: string[];
  assumptions: string[];
  nextAction: string;
  stages: Array<{
    title: string;
    description: string;
      tasks: Array<{
        title: string;
        owner: Task["owner"];
        dueLabel: string;
        activationTrigger?: TaskActivationTrigger;
        reminder?: TaskReminder;
    }>;
  }>;
}

export function createInitialWorkspace(): WorkspaceSnapshot {
  const activePlan = createPlanFromRequest({
    request: "I will attend an exhibition in Shanghai in September 2026."
  });

  return {
    profile: {
      displayName: "New explorer",
      preferredLanguage: "English",
      nationality: "To be confirmed",
      gender: "not_specified",
      immigrationStatus: "unknown",
      status: "incomplete"
    },
    runtime: { selectedKind: "codex" },
    activePlan: {
      ...activePlan,
      title: "Attend an exhibition in Shanghai",
      location: "Shanghai, China",
      dates: "September 2026",
      knownInformation: [
        "Purpose: attend an exhibition",
        "Destination: Shanghai, China",
        "Expected period: September 2026"
      ],
      assumptions: ["Arrival airport and accommodation are not confirmed yet.", "Transport preferences will be kept inside this Plan."],
      nextAction: "Review and confirm this Plan to activate its reminder scope."
    },
    inbox: [
      {
        id: "welcome",
        tone: "notice",
        title: "Your first Plan is ready to review",
        body: "This initial Plan is stored locally. No messages, reminders, or external actions have been sent.",
        timestamp: "Now"
      },
      {
        id: "setup",
        tone: "attention",
        title: "Profile details are still incomplete",
        body: "Nationality and relevant travel status are needed before policy guidance can be reliable.",
        timestamp: "Before plan activation"
      }
    ],
    sourceSnapshots: [],
    system: {
      core: "ready",
      storage: "local",
      runtime: "configured",
      telegram: "not_configured",
      amap: "not_configured"
    }
  };
}

export function createPlanFromRequest({ request }: CreatePlanInput): Plan {
  const normalizedRequest = request.trim();
  if (!normalizedRequest) throw new Error("A request is needed to create a Plan.");

  const title = normalizedRequest.length > 88 ? `${normalizedRequest.slice(0, 85).trimEnd()}…` : normalizedRequest;
  const location = inferLocation(normalizedRequest);
  const dates = inferDates(normalizedRequest);

  return {
    id: `plan-${randomUUID()}`,
    version: 1,
    title,
    location,
    dates,
    status: "draft",
    knownInformation: [
      `Your request: ${normalizedRequest}`,
      `Destination: ${location}`,
      `Time: ${dates}`
    ],
    assumptions: [
      "This initial template does not yet use Codex or Claude Code to interpret the request.",
      "Confirm the destination, dates, and purpose before automated guidance is enabled."
    ],
    nextAction: "Review and confirm this Plan to save its current reminder scope.",
    configuration: createDefaultPlanConfiguration(),
    stages: [
      {
        id: `stage-${randomUUID()}`,
        title: "Clarify essentials",
        description: "Confirm the details that make local guidance reliable.",
        tasks: [
          {
            id: `task-${randomUUID()}`,
            title: "Confirm destination, dates, and purpose",
            owner: "user",
            status: "waiting_user",
            dueLabel: "Before Plan activation"
          }
        ]
      },
      {
        id: `stage-${randomUUID()}`,
        title: "Before departure",
        description: "Prepare information and local-life decisions for this Plan.",
        tasks: [
          {
            id: `task-${randomUUID()}`,
            title: "Prepare a source-backed arrival checklist",
            owner: "assistant",
            status: "scheduled",
            dueLabel: "When the Agent Runtime is connected"
          }
        ]
      },
      {
        id: `stage-${randomUUID()}`,
        title: "Arrival",
        description: "Hand off the planned route when location services are connected.",
        tasks: [
          {
            id: `task-${randomUUID()}`,
            title: "Open the arrival route in Amap",
            owner: "external",
            status: "scheduled",
            dueLabel: "At expected arrival time",
            activationTrigger: "arrival"
          }
        ]
      }
    ],
    sources: [],
    createdAt: new Date().toISOString()
  };
}

export function createPlanFromDraft(draft: GeneratedPlanDraft): Plan {
  return {
    id: `plan-${randomUUID()}`,
    version: 1,
    title: draft.title,
    location: draft.location,
    dates: draft.dates,
    status: "draft",
    knownInformation: draft.knownInformation,
    assumptions: draft.assumptions,
    nextAction: draft.nextAction,
    configuration: createDefaultPlanConfiguration(),
    stages: draft.stages.map((stage) => ({
      id: `stage-${randomUUID()}`,
      title: stage.title,
      description: stage.description,
      tasks: stage.tasks.map((task) => ({
        id: `task-${randomUUID()}`,
        title: task.title,
        owner: task.owner,
        status: task.owner === "user" ? "waiting_user" : "scheduled",
        dueLabel: task.dueLabel,
        ...(task.activationTrigger ? { activationTrigger: task.activationTrigger } : {}),
        ...(task.reminder ? { reminder: task.reminder } : {})
      }))
    })),
    sources: [],
    createdAt: new Date().toISOString()
  };
}

export function createDefaultPlanConfiguration(): PlanConfiguration {
  return { accommodation: { status: "not_set" }, arrival: {}, transport: { preference: "plan_recommended" }, travelContext: { luggage: "unknown" } };
}


export function confirmPlan(snapshot: WorkspaceSnapshot, planId: string): WorkspaceSnapshot {
  if (snapshot.activePlan.id !== planId) {
    throw new Error(`Plan ${planId} was not found.`);
  }

  return {
    ...snapshot,
    activePlan: {
      ...snapshot.activePlan,
      status: "active",
      nextAction: "Complete the missing profile facts before policy-related tasks run."
    },
    inbox: [
      {
        id: `plan-confirmed-${snapshot.activePlan.version}`,
        tone: "ready",
        title: "Plan activated",
        body: "The Plan is active. Scheduler, Telegram, and external connectors are not connected yet.",
        timestamp: "Just now"
      },
      ...snapshot.inbox
    ]
  };
}

function inferLocation(request: string): string {
  const knownCities = ["Shanghai", "Beijing", "Guangzhou", "Shenzhen", "Hangzhou", "Chengdu", "上海", "北京", "广州", "深圳", "杭州", "成都"];
  const matchedCity = knownCities.find((city) => request.toLocaleLowerCase().includes(city.toLocaleLowerCase()));
  if (matchedCity) return `${matchedCity}, China`;

  const englishLocation = request.match(/\b(?:in|to|at)\s+([A-Z][A-Za-z -]{1,40})(?:[,.]|\s+(?:in|on|for)|$)/);
  return englishLocation?.[1]?.trim() ?? "Location to be confirmed";
}

function inferDates(request: string): string {
  const monthDate = request.match(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December)(?:\s+\d{1,2})?(?:,?\s+20\d{2})?/i);
  if (monthDate?.[0]) return monthDate[0];

  const year = request.match(/\b20\d{2}\b/);
  return year?.[0] ?? "Dates to be confirmed";
}
