import type { ChinaArrivalCompilationServiceResult } from "./china-plan-compilation.js";
import type { ChinaSourcePreparationItem, ChinaSourcePreparationResult } from "./china-source-preparation.js";

export interface ChinaSourcePreparationRunner {
  prepareCurrentPlan(input: { planId: string; now?: string }): Promise<ChinaSourcePreparationResult>;
}

export interface ChinaCompilationRunner {
  compileCurrentPlan(input: { now?: string }): Promise<ChinaArrivalCompilationServiceResult>;
}

export type ChinaPlanWorkflowResult =
  | {
    status: "saved";
    sources: ChinaSourcePreparationItem[];
    compilation: Extract<ChinaArrivalCompilationServiceResult, { status: "saved" }>;
  }
  | {
    status: "blocked";
    stage: "source_preparation" | "compilation";
    reasonCode: string;
    message: string;
    sources: ChinaSourcePreparationItem[];
    compilation?: Extract<ChinaArrivalCompilationServiceResult, { status: "blocked" }>;
  };

/** One user-triggered, reversible workflow; it never confirms a Plan or sends a message. */
export function createChinaPlanWorkflow(input: { sourcePreparation: ChinaSourcePreparationRunner; compilation: ChinaCompilationRunner }) {
  return {
    async prepareCurrentPlan(options: { planId: string; now?: string }): Promise<ChinaPlanWorkflowResult> {
      const sourceResult = await input.sourcePreparation.prepareCurrentPlan(options);
      if (sourceResult.status === "blocked") {
        return { status: "blocked", stage: "source_preparation", reasonCode: sourceResult.reasonCode, message: sourceResult.message, sources: sourceResult.sources };
      }
      const compilation = await input.compilation.compileCurrentPlan({ ...(options.now ? { now: options.now } : {}) });
      if (compilation.status === "blocked") {
        return { status: "blocked", stage: "compilation", reasonCode: compilation.reasonCode, message: compilation.message, sources: sourceResult.sources, compilation };
      }
      return { status: "saved", sources: sourceResult.sources, compilation };
    }
  };
}
