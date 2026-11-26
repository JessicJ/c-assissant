import { IsolatedGenerationAdmission } from './generation-admission.js';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, writeFileSync } from 'node:fs';
import { MahPlanningConversationService } from './mah-planning-conversation.js';
import { createMahPlanningRuntimeFactory } from './mah-planning-runtime.js';
import { MAH_BUSINESS_JOURNAL_SCHEMA, SqliteMahBusinessSubmissionJournal } from './mah-business-journal.js';
import type { MaintenanceControl } from "./maintenance-control.js";
import { createGuardedRuntimeServices } from "./guarded-runtime-services.js";
import { productionReadiness } from "./production-readiness.js";
import type { BlueprintRuntime } from "./agent-work-contract.js";
import { blockedBusinessOperation } from "./agent-work-contract.js";
import { ClaudeCodeRuntimeAdapter, CodexRuntimeAdapter } from "@c-assistant/agent-adapters";
import type { SqliteWorkspaceStore } from "@c-assistant/storage";
import { createPlanningGenerationService } from "./planning-generation.js";
import type { RuntimeServices } from "./runtime-services-contract.js";
import type { SemanticShadowConfig } from "./semantic-shadow.js";
import type { SemanticDraftCanaryConfig } from "./semantic-draft-canary.js";
import { MAH_SUPERVISION_STOP_REASON, MahCliTransport } from "./mah-cli-transport.js";
import { MahBlueprintRuntimeAdapter } from "./mah-blueprint-runtime.js";
import { resolveMahProjectRoot } from "./mah-project-root.js";
import type { MahGenerationMappings } from "./mah-generation-contract.js";

const isolatedGenerationServices = new WeakSet<RuntimeServices>();
type IsolatedGenerationOptions = Pick<Parameters<typeof createPlanningGenerationService>[0],
  "plannedPlaceImageEnrichment" | "probeImageUrl" | "lookupKnownImages"> & { validationSessionId?: string };

export function isIsolatedGenerationRuntimeServices(services: RuntimeServices): boolean {
  return isolatedGenerationServices.has(services);
}

export function createRuntimeServices(dependencies: {
  maintenance?: MaintenanceControl;
  guarded?: boolean;
  componentRoot?: string;
  databasePath?: string;
  store: SqliteWorkspaceStore;
  semanticShadow: SemanticShadowConfig;
  semanticDraftCanary: SemanticDraftCanaryConfig;
  logGenerationFailure: (details: Record<string, unknown>, message: string) => void;
}): RuntimeServices {
  return composeRuntimeServices(dependencies);
}

/** 仅供内部隔离验证显式构造；生产配置、HTTP 参数和环境变量均不能启用。 */
export function createIsolatedGenerationRuntimeServices(
  dependencies: Parameters<typeof createRuntimeServices>[0],
  transport: MahCliTransport,
  options?: IsolatedGenerationOptions
): RuntimeServices {
  const services = composeRuntimeServices(dependencies, transport, options);
  isolatedGenerationServices.add(services);
  return services;
}

function composeRuntimeServices(
  dependencies: Parameters<typeof createRuntimeServices>[0],
  isolatedTransport?: MahCliTransport,
  isolatedOptions?: IsolatedGenerationOptions
): RuntimeServices {
  if (dependencies.guarded) return createGuardedRuntimeServices();
  const { store, semanticShadow, semanticDraftCanary, logGenerationFailure } = dependencies;
  const claudeCode = new ClaudeCodeRuntimeAdapter();
  const mahMappings = store.generationCarriers as MahGenerationMappings;
  const componentRoot = dependencies.componentRoot ?? process.cwd();
  const mahTransport = isolatedTransport ?? new MahCliTransport({
    mahProjectRoot: () => resolveMahProjectRoot(componentRoot),
    store: mahMappings
  });
  const generationAdmission = isolatedTransport && isolatedOptions?.validationSessionId
    ? new IsolatedGenerationAdmission({ store, sessionId: isolatedOptions.validationSessionId,
      projectRoot: resolveMahProjectRoot(componentRoot) }) : undefined;
  const mahBlueprint = new MahBlueprintRuntimeAdapter({
    mappings: mahMappings,
    transport: mahTransport,
    checkpoint: generationKey => store.getGenerationCarrierCheckpoint(generationKey)
  });
  const blueprint: BlueprintRuntime = {
    generateSkillResearchBatch: async request => { requireProduction(); return mahBlueprint.generateSkillResearchBatch(request); },
    generateSkillItinerary: async request => { requireProduction(); return mahBlueprint.generateSkillItinerary(request); },
    reviewSkillItinerary: async request => { requireProduction(); return mahBlueprint.reviewSkillItinerary(request); },
    generatePlannedPlaceImageEnrichment: async request => { requireProduction(); return mahBlueprint.generatePlannedPlaceImageEnrichment(request); },
    generateSemanticTravelPlan: async request => { requireProduction(); return mahBlueprint.generateSemanticTravelPlan(request); },
    generateSemanticTravelPlanRepair: async request => { requireProduction(); return mahBlueprint.generateSemanticTravelPlanRepair(request); }
  };
  function requireProduction() { if (generationAdmission) { generationAdmission.assertExecution(); return; } if (isolatedTransport) return; if (!productionReadiness().generation) blockedBusinessOperation(); }
  let generatingPlan = false;
  const planningGeneration = createPlanningGenerationService({
    ...(dependencies.maintenance ? { maintenance: dependencies.maintenance } : {}),
    store,
    codex: blueprint,
    semanticShadow,
    semanticDraftCanary,
    plannedPlaceImageEnrichment: isolatedOptions?.plannedPlaceImageEnrichment ?? true,
    ...(isolatedOptions?.probeImageUrl ? { probeImageUrl: isolatedOptions.probeImageUrl } : {}),
    ...(isolatedOptions?.lookupKnownImages ? { lookupKnownImages: isolatedOptions.lookupKnownImages } : {}),
    itineraryContentReview: (request) => blueprint.reviewSkillItinerary(request),
    runWithGenerationContext: (context, operation) => {
      const run = () => mahBlueprint.runWithGenerationContext(context, operation);
      return generationAdmission ? generationAdmission.run(context.proposalRef, run) : run();
    },
    runWithStageContext: (identity, operation) => mahBlueprint.runWithStageContext(identity, operation),
    cancelCarrierGeneration: (generationKey) => mahBlueprint.cancelGeneration(generationKey),
    rejectCarrierBusinessPayload: (input) => mahBlueprint.rejectValidatedStage(input),
    carrierForCandidate: candidate => mahBlueprint.carrierForCandidate(candidate),
    authoritativeMahCarriers: true,
    setGeneratingPlan: (running) => { generatingPlan = running; },
    logGenerationFailure
  });

  async function recoverMahGenerations(): Promise<void> {
    if (!isolatedTransport && !productionReadiness().generation) return;
    let selectedGenerationKey: string | undefined;
    if (generationAdmission) {
      const session = store.getPlanningSessionById(isolatedOptions!.validationSessionId!);
      if (!session?.confirmedProposalVersion || !generationAdmission.owns({ sessionId: session.id, proposalVersion: session.confirmedProposalVersion })) return;
      selectedGenerationKey = planningGeneration.blueprintGenerationKey(session.id, session.confirmedProposalVersion);
      if (!store.getBlueprintGeneration(selectedGenerationKey)) return;
      try {
        await generationAdmission.authorize({ sessionId: session.id, revision: store.getPlanningRevision(session.id), proposalVersion: session.confirmedProposalVersion });
      } catch { return; }
    }
    const recovered = await mahTransport.recoverActiveMappings(selectedGenerationKey);
    const resumableKeys = [...new Set(recovered
      .filter((entry) => ["submission_unknown", "queued", "running", "completed", "validated"].includes(entry.status))
      .map((entry) => entry.generationKey))];
    for (const generationKey of resumableKeys) {
      try {
        const generation = store.getBlueprintGeneration(generationKey);
        if (!generation || ["completed", "cancelled", "superseded"].includes(generation.status)) continue;
        const session = store.getPlanningSessionById(generation.proposalRef.sessionId);
        if (!session || session.confirmedProposalVersion !== generation.proposalRef.proposalVersion) throw new Error("恢复的 MAH carrier 与已确认 Proposal 版本不一致。");
        const resume = async () => mahBlueprint.runRecovery(() => planningGeneration.enqueuePlanningSessionGeneration(session, store.getWorkspace()));
        if (generationAdmission) await generationAdmission.run({ sessionId: session.id, proposalVersion: session.confirmedProposalVersion }, resume);
        else await resume();
      } catch (error) {
        logGenerationFailure({ generationKey, code: "mah_recovery_import_failed", message: error instanceof Error ? error.message : "MAH carrier 恢复失败。" }, "MAH carrier 恢复未能继续；既有检查点保持不变");
      }
    }
  }

  let businessJournal: DatabaseSync | undefined;
  const planningConversation = dependencies.databasePath && dependencies.databasePath !== ':memory:' ? new MahPlanningConversationService({
    store,
    runtimeForWork: (work, readOnly) => {
      if (!businessJournal) {
        const path = `${dependencies.databasePath}.mah-business.sqlite`;
        const created = !existsSync(path);
        if (created) {
          try { writeFileSync(path, '', { mode: 0o600, flag: 'wx' }); }
          catch (error) { if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'EEXIST') throw error; }
        }
        businessJournal = new DatabaseSync(path);
        businessJournal.exec('PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000');
        businessJournal.exec(MAH_BUSINESS_JOURNAL_SCHEMA.replace('CREATE TABLE ', 'CREATE TABLE IF NOT EXISTS '));
      }
      return createMahPlanningRuntimeFactory({ projectRoot: resolveMahProjectRoot(componentRoot),
        journal: new SqliteMahBusinessSubmissionJournal(businessJournal), waitMs: 60000 })(work, readOnly);
    }
  }) : undefined;

  async function abortGenerationJobs(): Promise<void> {
    await planningGeneration.stopGenerationSupervision(MAH_SUPERVISION_STOP_REASON);
    await planningConversation?.waitForPendingRequests();
    businessJournal?.close();
    businessJournal = undefined;
  }

  return {
    runtimes: { codex: new CodexRuntimeAdapter(), "claude-code": claudeCode },
    business: {
      ...blueprint,
      continuePlanningConversation: async () => blockedBusinessOperation(),
      generateEmailResearch: async () => blockedBusinessOperation(),
      generateEmailTiming: async () => blockedBusinessOperation()
    },
    ...(planningConversation ? { planningConversation } : {}),
    planningGeneration,
    ...(generationAdmission ? { generationAdmission } : {}),
    getGeneratingPlan: () => generatingPlan,
    setGeneratingPlan: (running: boolean) => { generatingPlan = running; },
    itineraryContentReview: (request) => blueprint.reviewSkillItinerary(request),
    recoverMahGenerations,
    abortGenerationJobs
  };
}
