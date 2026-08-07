import type { CountryPackSkillRun, Plan, PlanCompilationAudit, Profile, WorkspaceSnapshot } from "@c-assistant/core";
import {
  orchestrateChinaArrivalPlan,
  type ChinaArrivalOrchestrationInput,
  type ChinaArrivalOrchestrationResult
} from "@c-assistant/china-country-pack/orchestrator";

export type ChinaArrivalCollectedFacts = Omit<ChinaArrivalOrchestrationInput, "plan" | "profile" | "now">;

export interface ChinaArrivalFactCollector {
  collect(input: {
    plan: Plan;
    profile: Pick<Profile, "nationality" | "immigrationStatus">;
    now: string;
  }): Promise<ChinaArrivalCollectedFacts>;
}

export interface ChinaArrivalCompilationStore {
  getWorkspace(): WorkspaceSnapshot;
  saveCompiledPlan(input: {
    plan: Plan;
    expectedPlanId: string;
    expectedVersion: number;
    audit: PlanCompilationAudit;
    skillRuns?: Array<Pick<CountryPackSkillRun, "skillId" | "skillVersion" | "status">>;
    compiledAt?: string;
  }): WorkspaceSnapshot;
}

export type ChinaArrivalCompilationServiceResult =
  | {
    status: "saved";
    planId: string;
    sourcePlanVersion: number;
    compiledPlanVersion: number;
    taskCount: number;
    reminderCount: number;
    workspace: WorkspaceSnapshot;
  }
  | {
    status: "blocked";
    stage: "precondition" | "fact_collection" | "orchestration" | "persistence";
    reasonCode: string;
    message: string;
    orchestration?: Extract<ChinaArrivalOrchestrationResult, { status: "blocked" }>;
  };

type ChinaArrivalOrchestrator = (input: ChinaArrivalOrchestrationInput) => Promise<ChinaArrivalOrchestrationResult>;

/** Coordinates one version-bound compilation. It owns no Connector credentials and sends no messages. */
export function createChinaArrivalCompilationService(input: {
  store: ChinaArrivalCompilationStore;
  factCollector: ChinaArrivalFactCollector;
  orchestrate?: ChinaArrivalOrchestrator;
}) {
  const orchestrate = input.orchestrate ?? orchestrateChinaArrivalPlan;
  return {
    async compileCurrentPlan(options: { now?: string } = {}): Promise<ChinaArrivalCompilationServiceResult> {
      const now = options.now ?? new Date().toISOString();
      if (!isIsoInstant(now)) return blocked("precondition", "invalid_now", "Compilation requires a valid current instant.");

      const current = input.store.getWorkspace();
      if (current.activePlan.status !== "draft") {
        return blocked("precondition", "plan_not_draft", "Only the current draft Plan can receive a Country Pack proposal.");
      }
      const plan = structuredClone(current.activePlan);
      const profile = {
        nationality: current.profile.nationality,
        immigrationStatus: current.profile.immigrationStatus
      };

      let facts: ChinaArrivalCollectedFacts;
      try {
        facts = await input.factCollector.collect({ plan: structuredClone(plan), profile: structuredClone(profile), now });
      } catch {
        return blocked("fact_collection", "fact_collection_failed", "Current provider facts could not be prepared safely. The Plan was not changed.");
      }

      let orchestration: ChinaArrivalOrchestrationResult;
      try {
        // Plan, Profile, and clock are authoritative even if a runtime object contains extra keys.
        orchestration = await orchestrate({ ...facts, plan, profile, now });
      } catch {
        return blocked("orchestration", "orchestration_failed", "The China Country Pack could not validate the prepared facts. The Plan was not changed.");
      }
      if (orchestration.status === "blocked") {
        return {
          status: "blocked",
          stage: "orchestration",
          reasonCode: orchestration.reasonCode,
          message: orchestration.message,
          orchestration
        };
      }

      try {
        const workspace = input.store.saveCompiledPlan({
          plan: orchestration.compilation.plan,
          expectedPlanId: plan.id,
          expectedVersion: plan.version,
          audit: orchestration.compilation.audit,
          skillRuns: [...orchestration.supportingResults, orchestration.composite].map((result) => ({ skillId: result.skill.id, skillVersion: result.skill.version, status: result.status })),
          compiledAt: now
        });
        return {
          status: "saved",
          planId: plan.id,
          sourcePlanVersion: plan.version,
          compiledPlanVersion: orchestration.compilation.plan.version,
          taskCount: orchestration.compilation.audit.taskCount,
          reminderCount: orchestration.compilation.audit.reminderCount,
          workspace
        };
      } catch (error) {
        if (error instanceof Error && /changed before/i.test(error.message)) {
          return blocked("persistence", "plan_changed", "The Plan changed before the compiled draft could be saved. Review the current Plan and try again.");
        }
        return blocked("persistence", "persistence_failed", "The compiled draft could not be saved safely. The current Plan was preserved.");
      }
    }
  };
}

function blocked(stage: Extract<ChinaArrivalCompilationServiceResult, { status: "blocked" }>["stage"], reasonCode: string, message: string): ChinaArrivalCompilationServiceResult {
  return { status: "blocked", stage, reasonCode, message };
}

function isIsoInstant(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) && Number.isFinite(Date.parse(value));
}
