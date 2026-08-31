import { orchestrateJapanArrivalPlan, type JapanArrivalOrchestrationInput, type JapanArrivalOrchestrationResult } from "@c-assistant/japan-country-pack/orchestrator";
import type { CountryPackSkillRun, Plan, PlanCompilationAudit, Profile, SourceEvidenceRef, WorkspaceSnapshot } from "@c-assistant/core";

export type JapanArrivalCollectedFacts = Omit<JapanArrivalOrchestrationInput, "plan" | "profile" | "now">;
export interface JapanFactCollector { collect(input: { plan: Plan; profile: Pick<Profile, "nationality">; now: string }): Promise<JapanArrivalCollectedFacts> }
export interface JapanCompilationStore {
  getWorkspace(): WorkspaceSnapshot;
  saveCompiledPlan(input: { plan: Plan; expectedPlanId: string; expectedVersion: number; audit: PlanCompilationAudit; skillRuns?: Array<Pick<CountryPackSkillRun, "skillId" | "skillVersion" | "status"> & { sourceEvidence?: SourceEvidenceRef[] }>; compiledAt?: string }): WorkspaceSnapshot;
}
export type JapanCompilationResult = { status: "saved"; workspace: WorkspaceSnapshot; planId: string; sourcePlanVersion: number; compiledPlanVersion: number; taskCount: number; reminderCount: number } | { status: "blocked"; stage: "precondition" | "fact_collection" | "orchestration" | "persistence"; reasonCode: string; message: string; orchestration?: Extract<JapanArrivalOrchestrationResult, { status: "blocked" }> };

export function createJapanCompilationService(input: { store: JapanCompilationStore; factCollector: JapanFactCollector; orchestrate?: typeof orchestrateJapanArrivalPlan }) {
  const orchestrate = input.orchestrate ?? orchestrateJapanArrivalPlan;
  return { async compileCurrentPlan(options: { now?: string } = {}): Promise<JapanCompilationResult> {
    const now = options.now ?? new Date().toISOString();
    if (!Number.isFinite(Date.parse(now))) return blocked("precondition", "invalid_now", "Compilation requires a valid current instant.");
    const current = input.store.getWorkspace();
    if (current.activePlan.status !== "draft") return blocked("precondition", "plan_not_draft", "Only the current draft Plan can receive a Japan proposal.");
    const plan = structuredClone(current.activePlan);
    const profile = { nationality: current.profile.nationality };
    let facts: JapanArrivalCollectedFacts;
    try { facts = await input.factCollector.collect({ plan: structuredClone(plan), profile, now }); } catch { return blocked("fact_collection", "fact_collection_failed", "Current provider facts could not be prepared safely; the Plan was preserved."); }
    let result: JapanArrivalOrchestrationResult;
    try { result = await orchestrate({ ...facts, plan, profile, now }); } catch { return blocked("orchestration", "orchestration_failed", "The Japan Country Pack could not validate the prepared facts; the Plan was preserved."); }
    if (result.status === "blocked") return { status: "blocked", stage: "orchestration", reasonCode: result.reasonCode, message: result.message, orchestration: result };
    try {
      const workspace = input.store.saveCompiledPlan({ plan: result.compilation.plan, expectedPlanId: plan.id, expectedVersion: plan.version, audit: result.compilation.audit, skillRuns: [...result.supportingResults, result.composite].map((item) => ({ skillId: item.skill.id, skillVersion: item.skill.version, status: item.status, sourceEvidence: item.skill.id === result.composite.skill.id ? result.compilation.audit.sourceEvidence : result.sourceEvidenceBySkill[item.skill.id as keyof typeof result.sourceEvidenceBySkill] ?? [] })), compiledAt: now });
      return { status: "saved", workspace, planId: plan.id, sourcePlanVersion: plan.version, compiledPlanVersion: result.compilation.plan.version, taskCount: result.compilation.audit.taskCount, reminderCount: result.compilation.audit.reminderCount };
    } catch (error) { return blocked("persistence", error instanceof Error && /changed before/i.test(error.message) ? "plan_changed" : "persistence_failed", "The compiled Japan draft could not be saved safely; the current Plan was preserved."); }
  } };
}
function blocked(stage: Extract<JapanCompilationResult, { status: "blocked" }>["stage"], reasonCode: string, message: string): JapanCompilationResult { return { status: "blocked", stage, reasonCode, message }; }
