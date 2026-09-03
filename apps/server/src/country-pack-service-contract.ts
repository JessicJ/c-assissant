import type { WorkspaceSnapshot } from "@c-assistant/core";
import type { ChinaPlanWorkflowResult } from "./china-plan-workflow.js";
import type { ChinaSourcePreparationResult } from "./china-source-preparation.js";
import type { CountryPackResolution } from "./country-pack-resolver.js";
import type { JapanSourcePreparationResult } from "./japan-source-preparation.js";
import type { OfficialSourceService } from "./official-source-service.js";

export type PreparedJapanPlan =
  | { status: "blocked"; stage: "source_preparation" | "compilation"; reasonCode: string; message: string; sources: unknown[] }
  | { status: "saved"; message: string; workspace: WorkspaceSnapshot; taskCount: number; reminderCount: number; sources: unknown[] };

export interface CountryPackServices {
  officialSources: OfficialSourceService;
  japanOfficialSources: OfficialSourceService;
  chinaPlanWorkflow: {
    prepareCurrentPlan(options: { planId: string; now?: string }): Promise<ChinaPlanWorkflowResult>;
  };
  chinaSourcePreparation: {
    prepareCurrentPlan(options: { planId: string; now?: string }): Promise<ChinaSourcePreparationResult>;
  };
  japanSourcePreparation: {
    prepareCurrentPlan(options: { planId: string; now?: string }): Promise<JapanSourcePreparationResult>;
  };
  resolvePlanCountryPack(planId: string): Promise<CountryPackResolution>;
  prepareJapanPlan(planId: string): Promise<PreparedJapanPlan>;
}
