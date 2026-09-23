import { LANDI_BLUEPRINT_SKILL, LEGACY_BLUEPRINT_SKILL, RuntimeAdapterError } from "@c-assistant/agent-adapters";
import type {
  BlueprintGeneration,
  BlueprintGenerationStage
} from "@c-assistant/core";

export type PlanGenerationJob = {
  runId: string;
  sessionId: string;
  generationKey: string;
  stage: BlueprintGenerationStage | "failed" | "cancelled";
  status: "running" | "succeeded" | "failed" | "cancelled";
  startedAt: string;
  updatedAt: string;
  scopeLabel?: string | undefined;
  savedPlaceCount?: number;
  failureCode?: string;
  message?: string;
  strategy: GenerationStrategy;
  controller: AbortController;
};

export type GenerationStrategy = "legacy" | "semantic_canary";

export const SEMANTIC_DRAFT_CANARY_POLICY = {
  policyId: "semantic-draft-canary",
  policyVersion: "1.0.0"
} as const;

export function publicGenerationJob(job: PlanGenerationJob): Omit<PlanGenerationJob, "controller"> {
  const { controller: _controller, ...safe } = job;
  return safe;
}

export function publicPersistedGeneration(generation: BlueprintGeneration) {
  return {
    runId: generation.generationKey,
    sessionId: generation.proposalRef.sessionId,
    generationKey: generation.generationKey,
    strategy: generationStrategyFromKey(generation.generationKey),
    stage: generation.stage,
    status: generation.status === "completed" ? "succeeded" : generation.status,
    startedAt: generation.createdAt,
    updatedAt: generation.updatedAt,
    ...(generation.failure ? { failureCode: generation.failure.code, message: generation.failure.issues[0]?.message } : {})
  };
}

export function updateGenerationJob(job: PlanGenerationJob, update: Partial<Pick<PlanGenerationJob, "stage" | "status" | "scopeLabel" | "savedPlaceCount" | "failureCode" | "message">>): void {
  Object.assign(job, update, { updatedAt: new Date().toISOString() });
}

export function blueprintGenerationKey(sessionId: string, proposalVersion: number): string {
  return `${sessionId}:${proposalVersion}:${LANDI_BLUEPRINT_SKILL.skillId}@${LANDI_BLUEPRINT_SKILL.skillVersion}`;
}

export function semanticCanaryGenerationKey(sessionId: string, proposalVersion: number): string {
  return `${blueprintGenerationKey(sessionId, proposalVersion)}:${SEMANTIC_DRAFT_CANARY_POLICY.policyId}@${SEMANTIC_DRAFT_CANARY_POLICY.policyVersion}`;
}

export function generationStrategyFromKey(generationKey: string): GenerationStrategy {
  return generationKey.endsWith(`:${SEMANTIC_DRAFT_CANARY_POLICY.policyId}@${SEMANTIC_DRAFT_CANARY_POLICY.policyVersion}`)
    ? "semantic_canary"
    : "legacy";
}

export function savedBlueprintGenerationKey(sessionId: string, proposalVersion: number, lookup: (key: string) => BlueprintGeneration | undefined): string {
  const semanticKey = semanticCanaryGenerationKey(sessionId, proposalVersion);
  if (lookup(semanticKey)) return semanticKey;
  const currentKey = blueprintGenerationKey(sessionId, proposalVersion);
  if (lookup(currentKey)) return currentKey;
  const legacyKey = `${sessionId}:${proposalVersion}:${LEGACY_BLUEPRINT_SKILL.skillId}@${LEGACY_BLUEPRINT_SKILL.skillVersion}`;
  return lookup(legacyKey) ? legacyKey : currentKey;
}

export function selectedBlueprintGenerationKey(
  sessionId: string,
  proposalVersion: number,
  lookup: (key: string) => BlueprintGeneration | undefined,
  selectSemanticCanary: boolean
): string {
  const saved = savedBlueprintGenerationKey(sessionId, proposalVersion, lookup);
  if (lookup(saved)) return saved;
  return selectSemanticCanary ? semanticCanaryGenerationKey(sessionId, proposalVersion) : saved;
}

export function generationFailurePath(error: unknown, stage: BlueprintGenerationStage): string {
  if (error instanceof Error && /day|movement|place|source|requirement|blueprint|research/i.test(error.message)) return `${stage}.contract`;
  return stage;
}

export function planGenerationFailureCode(error: unknown): string {
  return error instanceof RuntimeAdapterError ? error.code : "generation_failed";
}

export function errorDiagnostic(error: unknown): string | undefined {
  if (!(error instanceof Error) || !(error.cause instanceof Error)) return undefined;
  return error.cause.message.slice(0, 500);
}
