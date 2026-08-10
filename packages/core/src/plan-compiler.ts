import { randomUUID } from "node:crypto";

import type { Plan, Stage, Task, TaskReminderDynamicFact } from "./index.js";

export interface SourceEvidenceRef {
  sourceSnapshotId: string;
  contentHash: string;
}

export interface PlanCompilationOrigin {
  kind: "country_pack_compilation";
  countryPackId: string;
  countryPackVersion: string;
  compositionSkillId: string;
  compositionSkillVersion: string;
  compilationKey: string;
  sourcePlanVersion: number;
  sourceSkills: Array<{ id: string; version: string }>;
  /** Exact immutable official evidence versions used for this Stage or Task. */
  sourceEvidence?: SourceEvidenceRef[];
}

export interface PlanCompilationTaskProposal {
  proposalId: string;
  title: string;
  description: string;
  owner: Task["owner"];
  dueLabel: string;
  sourceSkills: Array<{ id: string; version: string }>;
  sourceEvidence?: SourceEvidenceRef[];
  reminder?: {
    dueAt: string;
    timeZone: string;
    purpose: string;
    refreshFacts: TaskReminderDynamicFact[];
  };
}

export interface PlanCompilationProposal {
  planRef: { id: string; version: number };
  countryPack: { id: string; version: string; name: string };
  composition: { skillId: string; version: string; status: "success" | "degraded" };
  compilationKey: string;
  stage: { title: string; description: string };
  tasks: PlanCompilationTaskProposal[];
  /** All immutable official evidence versions used by this compilation. */
  sourceEvidence?: SourceEvidenceRef[];
  /** Source-backed orientation that belongs in the complete Plan but is not a Task. */
  knownInformation?: string[];
  assumptions: string[];
  limitations: string[];
}

export type PlanCompilationBlockReason = "plan_reference_mismatch" | "plan_not_draft" | "composition_not_ready" | "invalid_proposal" | "stale_reminder";

export interface PlanCompilationAudit {
  countryPackId: string;
  countryPackVersion: string;
  compositionSkillId: string;
  compositionSkillVersion: string;
  sourcePlanVersion: number;
  compiledPlanVersion: number;
  taskCount: number;
  reminderCount: number;
  sourceEvidence: SourceEvidenceRef[];
}

export type PlanCompilationDecision =
  | { status: "compiled"; plan: Plan; audit: PlanCompilationAudit; warnings: string[] }
  | { status: "blocked"; reasonCode: PlanCompilationBlockReason; message: string };

/**
 * Compiles one version-bound Country Pack proposal into a new draft Plan.
 * Persistence, confirmation, activation, and external actions remain outside.
 */
export function compilePlanProposal(plan: Plan, proposal: PlanCompilationProposal, now = new Date()): PlanCompilationDecision {
  if (!hasProposalScaffold(proposal)) return blocked("invalid_proposal", "The Country Pack proposal did not pass the Core compilation contract.");
  if (plan.id !== proposal.planRef.id || plan.version !== proposal.planRef.version) return blocked("plan_reference_mismatch", "The proposal does not target the current Plan version.");
  if (plan.status !== "draft") return blocked("plan_not_draft", "Only a draft Plan can accept a compiled Country Pack proposal.");
  if (proposal.composition.status !== "success" && proposal.composition.status !== "degraded") return blocked("composition_not_ready", "The Country Pack composition is not ready for Plan compilation.");
  if (!isValidProposal(proposal)) return blocked("invalid_proposal", "The Country Pack proposal did not pass the Core compilation contract.");
  if (!Number.isFinite(now.getTime())) return blocked("invalid_proposal", "Plan compilation needs a valid current time.");

  const compiledTasks: Task[] = [];
  let reminderCount = 0;
  for (const task of proposal.tasks) {
    const reminder = task.reminder ? compileReminder(task.reminder) : undefined;
    if (task.reminder && !reminder) return blocked("invalid_proposal", `Reminder for ${task.proposalId} is malformed or inconsistent with its time zone.`);
    if (task.reminder && Date.parse(task.reminder.dueAt) <= now.getTime()) return blocked("stale_reminder", `Reminder for ${task.proposalId} is not in the future.`);
    if (reminder) reminderCount += 1;
    const origin = compilationOrigin(proposal, task.sourceSkills, task.sourceEvidence ?? []);
    compiledTasks.push({
      id: `task-${randomUUID()}`,
      title: task.title.trim(),
      description: task.description.trim(),
      owner: task.owner,
      status: task.owner === "user" ? "waiting_user" : "scheduled",
      dueLabel: reminder ? `Reminder proposed for ${reminder.scheduledAtLocal} ${reminder.timeZone}` : task.dueLabel.trim(),
      ...(reminder ? { reminder } : {}),
      origin
    });
  }

  const stageOrigin = compilationOrigin(
    proposal,
    uniqueSources(proposal.tasks.flatMap((task) => task.sourceSkills)),
    proposal.sourceEvidence ?? proposal.tasks.flatMap((task) => task.sourceEvidence ?? [])
  );
  const stage: Stage = {
    id: `stage-${randomUUID()}`,
    title: proposal.stage.title.trim(),
    description: proposal.stage.description.trim(),
    tasks: compiledTasks,
    origin: stageOrigin
  };
  const retainedStages = plan.stages.filter((candidate) => candidate.origin?.compilationKey !== proposal.compilationKey);
  const limitations = proposal.limitations.map((value) => `${proposal.countryPack.name} limitation: ${value.trim()}`);
  const knownInformation = [...plan.knownInformation, ...(proposal.knownInformation ?? []).map((value) => value.trim())].filter((value, index, all) => value && all.indexOf(value) === index);
  const assumptions = [...plan.assumptions, ...proposal.assumptions.map((value) => value.trim()), ...limitations].filter((value, index, all) => value && all.indexOf(value) === index);
  const compiled: Plan = {
    ...plan,
    version: plan.version + 1,
    status: "draft",
    knownInformation,
    assumptions,
    nextAction: "Review the complete compiled Plan. Confirm it only after its Tasks, Reminders, assumptions, and sources are correct.",
    stages: [...retainedStages, stage]
  };
  return {
    status: "compiled",
    plan: compiled,
    audit: {
      countryPackId: proposal.countryPack.id,
      countryPackVersion: proposal.countryPack.version,
      compositionSkillId: proposal.composition.skillId,
      compositionSkillVersion: proposal.composition.version,
      sourcePlanVersion: plan.version,
      compiledPlanVersion: compiled.version,
      taskCount: compiledTasks.length,
      reminderCount,
      sourceEvidence: uniqueEvidence(proposal.sourceEvidence ?? proposal.tasks.flatMap((task) => task.sourceEvidence ?? []))
    },
    warnings: [...proposal.limitations]
  };
}

function blocked(reasonCode: PlanCompilationBlockReason, message: string): PlanCompilationDecision {
  return { status: "blocked", reasonCode, message };
}

function isValidProposal(proposal: PlanCompilationProposal): boolean {
  return typeof proposal.planRef.id === "string" && Boolean(proposal.planRef.id.trim()) && Number.isInteger(proposal.planRef.version) && proposal.planRef.version >= 1
    && typeof proposal.countryPack.id === "string" && isSlug(proposal.countryPack.id)
    && typeof proposal.countryPack.version === "string" && isSemver(proposal.countryPack.version)
    && typeof proposal.countryPack.name === "string" && Boolean(proposal.countryPack.name.trim())
    && typeof proposal.composition.skillId === "string" && isSlug(proposal.composition.skillId)
    && typeof proposal.composition.version === "string" && isSemver(proposal.composition.version)
    && (proposal.composition.status === "success" || proposal.composition.status === "degraded")
    && typeof proposal.compilationKey === "string" && isSlug(proposal.compilationKey)
    && typeof proposal.stage.title === "string" && Boolean(proposal.stage.title.trim())
    && typeof proposal.stage.description === "string" && Boolean(proposal.stage.description.trim())
    && Array.isArray(proposal.tasks) && proposal.tasks.length <= 50 && proposal.tasks.every(isValidTaskProposal)
    && (proposal.sourceEvidence === undefined || (Array.isArray(proposal.sourceEvidence) && proposal.sourceEvidence.every(isValidSourceEvidence)))
    && new Set(proposal.tasks.map((task) => task.proposalId)).size === proposal.tasks.length
    && (proposal.knownInformation === undefined || (Array.isArray(proposal.knownInformation) && proposal.knownInformation.length <= 20 && proposal.knownInformation.every(isNonEmptyString)))
    && Array.isArray(proposal.assumptions) && proposal.assumptions.every(isNonEmptyString)
    && Array.isArray(proposal.limitations) && proposal.limitations.every(isNonEmptyString)
    && (proposal.composition.status !== "degraded" || proposal.limitations.length > 0);
}

function isValidTaskProposal(task: unknown): task is PlanCompilationTaskProposal {
  if (typeof task !== "object" || task === null) return false;
  const candidate = task as Partial<PlanCompilationTaskProposal>;
  if (typeof candidate.proposalId !== "string" || typeof candidate.title !== "string" || typeof candidate.description !== "string" || typeof candidate.owner !== "string" || typeof candidate.dueLabel !== "string" || !Array.isArray(candidate.sourceSkills)) return false;
  if (!candidate.sourceSkills.every(isValidSourceSkill)) return false;
  if (candidate.sourceEvidence !== undefined && (!Array.isArray(candidate.sourceEvidence) || !candidate.sourceEvidence.every(isValidSourceEvidence))) return false;
  const reminder = candidate.reminder;
  if (reminder !== undefined && (typeof reminder !== "object" || reminder === null || !isNonEmptyString(reminder.dueAt) || !isNonEmptyString(reminder.timeZone) || !isNonEmptyString(reminder.purpose)
    || !Array.isArray(reminder.refreshFacts) || !reminder.refreshFacts.every((fact) => fact === "weather"))) return false;
  return isSlug(candidate.proposalId) && isNonEmptyString(candidate.title) && isNonEmptyString(candidate.description)
    && ["assistant", "user", "external"].includes(candidate.owner) && isNonEmptyString(candidate.dueLabel)
    && candidate.sourceSkills.length > 0;
}

function compileReminder(input: NonNullable<PlanCompilationTaskProposal["reminder"]>) {
  const instant = Date.parse(input.dueAt);
  if (!Number.isFinite(instant) || !isIanaTimeZone(input.timeZone)) return undefined;
  const scheduledAtLocal = localMinute(new Date(instant), input.timeZone);
  if (!scheduledAtLocal) return undefined;
  return { scheduledAtLocal, timeZone: input.timeZone, purpose: input.purpose.trim(), refreshFacts: [...new Set(input.refreshFacts)] };
}

function localMinute(instant: Date, timeZone: string): string | undefined {
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(instant).map((part) => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
  } catch {
    return undefined;
  }
}

function compilationOrigin(proposal: PlanCompilationProposal, sourceSkills: Array<{ id: string; version: string }>, sourceEvidence: SourceEvidenceRef[] = []): PlanCompilationOrigin {
  return {
    kind: "country_pack_compilation",
    countryPackId: proposal.countryPack.id,
    countryPackVersion: proposal.countryPack.version,
    compositionSkillId: proposal.composition.skillId,
    compositionSkillVersion: proposal.composition.version,
    compilationKey: proposal.compilationKey,
    sourcePlanVersion: proposal.planRef.version,
    sourceSkills: uniqueSources(sourceSkills),
    sourceEvidence: uniqueEvidence(sourceEvidence)
  };
}

function uniqueSources(sources: Array<{ id: string; version: string }>) {
  return sources.filter((source, index, all) => all.findIndex((candidate) => candidate.id === source.id && candidate.version === source.version) === index).map((source) => ({ ...source }));
}

function uniqueEvidence(evidence: SourceEvidenceRef[]) {
  return evidence.filter((item, index, all) => all.findIndex((candidate) => candidate.sourceSnapshotId === item.sourceSnapshotId && candidate.contentHash === item.contentHash) === index).map((item) => ({ ...item }));
}

function isIanaTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return value === "UTC" || value.includes("/");
  } catch {
    return false;
  }
}

function isSlug(value: string): boolean {
  return /^[a-z0-9]+(?:[-:][a-z0-9]+)*$/.test(value);
}

function isSemver(value: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}

function hasProposalScaffold(value: unknown): value is PlanCompilationProposal {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<PlanCompilationProposal>;
  return typeof candidate.planRef === "object" && candidate.planRef !== null
    && typeof candidate.countryPack === "object" && candidate.countryPack !== null
    && typeof candidate.composition === "object" && candidate.composition !== null
    && typeof candidate.stage === "object" && candidate.stage !== null
    && Array.isArray(candidate.tasks) && (candidate.knownInformation === undefined || Array.isArray(candidate.knownInformation)) && Array.isArray(candidate.assumptions) && Array.isArray(candidate.limitations);
}

function isValidSourceSkill(value: unknown): value is { id: string; version: string } {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { id?: unknown; version?: unknown };
  return typeof candidate.id === "string" && isSlug(candidate.id) && typeof candidate.version === "string" && isSemver(candidate.version);
}

function isValidSourceEvidence(value: unknown): value is SourceEvidenceRef {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<SourceEvidenceRef>;
  return typeof candidate.sourceSnapshotId === "string" && isSlug(candidate.sourceSnapshotId)
    && typeof candidate.contentHash === "string" && /^[a-f0-9]{64}$/i.test(candidate.contentHash);
}
