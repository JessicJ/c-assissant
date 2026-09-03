import type { FastifyInstance } from "fastify";
import type { PolicyApplicabilitySkillResult } from "@c-assistant/china-country-pack";
import { chinaSkillRegistry } from "@c-assistant/china-country-pack/registry";
import { runJapanPolicyApplicabilitySkill } from "@c-assistant/japan-country-pack";
import type { SqliteWorkspaceStore } from "@c-assistant/storage";
import { presentChinaPlanPreparation } from "./china-plan-presentation.js";
import type { ChinaPlanWorkflowResult } from "./china-plan-workflow.js";
import type { CountryPackResolution } from "./country-pack-resolver.js";

type PreparationResult =
  | ({ status: "saved" } & Record<string, unknown>)
  | ({ status: "blocked"; reasonCode: string } & Record<string, unknown>);

export function registerCountryPackRoutes(server: FastifyInstance, dependencies: {
  store: SqliteWorkspaceStore;
  resolvePlanCountryPack: (planId: string) => Promise<CountryPackResolution>;
  chinaPlanWorkflow: { prepareCurrentPlan(input: { planId: string; now?: string }): Promise<ChinaPlanWorkflowResult> };
  prepareJapanPlan: (planId: string) => Promise<PreparationResult>;
}): void {
  const { store, resolvePlanCountryPack, chinaPlanWorkflow, prepareJapanPlan } = dependencies;

  server.get("/api/policy-applicability", async () => {
    const workspace = store.getWorkspace();
    const resolution = await resolvePlanCountryPack(workspace.activePlan.id);
    if (resolution.status !== "resolved") return { status: "needs_input", knownInformation: [], missingInformation: [{ field: "plan.country", reason: resolution.message }], evidence: [], nextAction: resolution.message, warning: "No Country Pack was selected." };
    if (resolution.countryPackId === "japan") {
      const plan = workspace.activePlan;
      const linked = new Map(plan.sources.flatMap((item) => item.sourceSnapshotId && item.contentHash ? [[item.sourceSnapshotId, item.contentHash] as const] : []));
      const dates = plan.dates.match(/\d{4}-\d{2}-\d{2}/g);
      const purpose = plan.knownInformation.map((item) => /^purpose\s*:\s*(.+)$/i.exec(item)?.[1]?.trim()).find(Boolean);
      const passport = plan.knownInformation.map((item) => /^passport confirmed\s*:\s*(.+)$/i.exec(item)?.[1]?.trim()).find(Boolean);
      const result = runJapanPolicyApplicabilitySkill({
        nationality: workspace.profile.nationality,
        ...(purpose ? { travelPurpose: purpose } : {}),
        ...(dates?.[0] && dates[1] ? { departureDate: dates[0], arrivalDate: dates[0], stayDays: Math.max(1, Math.round((Date.parse(`${dates[1]}T00:00:00Z`) - Date.parse(`${dates[0]}T00:00:00Z`)) / 86_400_000)) } : {}),
        ...(passport ? { passportConfirmed: /^(?:yes|true|confirmed)$/i.test(passport) } : {}),
        evidence: workspace.sourceSnapshots.filter((item) => item.sourceId.startsWith("jp-") && linked.get(item.id) === item.contentHash).map((item) => ({ id: item.id, sourceId: item.sourceId, authority: item.authority, titleOriginal: item.titleOriginal, url: item.url, retrievedAt: item.retrievedAt, contentHash: item.contentHash })),
        now: new Date().toISOString()
      });
      return { status: result.preparationState, knownInformation: result.facts, missingInformation: result.needsInput, evidence: result.sources, nextAction: result.nextAction, warning: result.warnings.join(" "), skill: result.skill };
    }
    const result = await chinaSkillRegistry.invoke("policy-applicability", {
      ...(workspace.profile.nationality ? { nationality: workspace.profile.nationality } : {}),
      immigrationStatus: workspace.profile.immigrationStatus,
      location: workspace.activePlan.location,
      dates: workspace.activePlan.dates,
      evidence: workspace.sourceSnapshots.map((snapshot) => ({ id: snapshot.id, sourceId: snapshot.sourceId, authority: snapshot.authority, titleOriginal: snapshot.titleOriginal, url: snapshot.url, retrievedAt: snapshot.retrievedAt, contentHash: snapshot.contentHash })),
      now: new Date().toISOString()
    }) as PolicyApplicabilitySkillResult;
    return {
      status: result.status === "success" ? "ready_for_review" : result.status === "blocked" && result.reasonCode === "needs_evidence" ? "needs_evidence" : result.status,
      knownInformation: result.facts,
      missingInformation: result.needsInput,
      evidence: result.sources,
      nextAction: result.nextAction,
      warning: result.warnings.join(" "),
      skill: result.skill
    };
  });

  server.post<{ Params: { planId: string } }>("/api/plans/:planId/china/prepare", async (request, reply) => {
    const resolution = await resolvePlanCountryPack(request.params.planId);
    if (resolution.status !== "resolved" || resolution.countryPackId !== "china") return reply.code(409).send({ status: "blocked", reasonCode: "country_pack_mismatch", message: "The normalized destination country does not select the China Country Pack." });
    const result = await chinaPlanWorkflow.prepareCurrentPlan({ planId: request.params.planId });
    if (result.status === "blocked") {
      const statusCode = result.reasonCode === "critical_source_unavailable" || result.reasonCode === "fact_collection_failed" ? 503 : result.reasonCode === "plan_not_draft" || result.reasonCode === "plan_changed" ? 409 : 422;
      return reply.code(statusCode).send(presentChinaPlanPreparation(result));
    }
    return presentChinaPlanPreparation(result);
  });

  server.post<{ Params: { planId: string } }>("/api/plans/:planId/japan/prepare", async (request, reply) => {
    const resolution = await resolvePlanCountryPack(request.params.planId);
    if (resolution.status !== "resolved" || resolution.countryPackId !== "japan") return reply.code(409).send({ status: "blocked", reasonCode: "country_pack_mismatch", message: "The normalized destination country does not select the Japan Country Pack." });
    const result = await prepareJapanPlan(request.params.planId);
    return reply.code(japanPreparationStatusCode(result)).send(result);
  });

  server.post<{ Params: { planId: string } }>("/api/plans/:planId/country-pack/prepare", async (request, reply) => {
    const resolution = await resolvePlanCountryPack(request.params.planId);
    if (resolution.status !== "resolved") return reply.code(422).send({ ...resolution, preparationStatus: "blocked" });
    if (resolution.countryPackId === "china") {
      const result = await chinaPlanWorkflow.prepareCurrentPlan({ planId: request.params.planId });
      return reply.code(result.status === "saved" ? 200 : 422).send(presentChinaPlanPreparation(result));
    }
    const result = await prepareJapanPlan(request.params.planId);
    return reply.code(result.status === "saved" ? 200 : 422).send(result);
  });
}

function japanPreparationStatusCode(result: PreparationResult): number {
  if (result.status === "saved") return 200;
  return result.reasonCode === "critical_source_unavailable" || result.reasonCode === "fact_collection_failed"
    ? 503
    : result.reasonCode === "plan_changed" || result.reasonCode === "plan_not_draft"
      ? 409
      : 422;
}
