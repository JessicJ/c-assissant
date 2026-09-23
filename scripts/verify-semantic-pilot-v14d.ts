import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import Fastify from "../apps/server/node_modules/fastify/fastify.js";
import { SqliteWorkspaceStore } from "../packages/storage/src/index.js";
import { registerPlanManagementRoutes } from "../apps/server/src/plan-management-routes.js";

const databasePath = resolve(process.argv[2] ?? "/tmp/landi-v14d-porto-transition-20260918.sqlite");
const reportPath = "/tmp/landi-v14d-porto-transition-report.json";
const cathedralId = "place-scope-1-porto-cathedral-1skjp2d";
const stationId = "place-scope-1-sao-bento-station-5y48j9";
const captures: Array<Record<string, unknown>> = [];

for (const key of ["TELEGRAM_BOT_TOKEN", "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_BUSINESS_ACCOUNT_ID", "WHATSAPP_APP_SECRET", "GOOGLE_MAPS_API_KEY"]) delete process.env[key];

function executionSnapshot(store: SqliteWorkspaceStore) {
  const plan = store.getExecutionPlan();
  if (!plan || plan.presentation?.kind !== "itinerary") throw new Error("Expected an itinerary Execution Plan.");
  const day = plan.presentation.days.find((candidate) => candidate.id === "day-1")!;
  return {
    planId: plan.id,
    planVersion: plan.version,
    status: plan.status,
    lineage: store.getPlanBlueprintLineage(plan.id),
    day1Stops: day.stops,
    day1Route: plan.presentation.routeSegments.find((route) => route.dayId === "day-1"),
    startContext: day.startContext,
    endContext: day.endContext
  };
}

const store = new SqliteWorkspaceStore(databasePath);
const server = Fastify({ logger: false });
try {
  const initial = store.getWorkspace();
  const executionA = executionSnapshot(store);
  if (initial.activePlan.id !== executionA.planId || initial.activeBlueprint?.version !== 5) throw new Error("The V1.4D copy is not at active Porto Plan A / Blueprint v5.");
  registerPlanManagementRoutes(server, {
    store,
    getMaps: () => new Proxy({}, { get: () => async () => { throw new Error("Provider calls are blocked in V1.4D transition verification."); } }) as never,
    startActivePlanMonitoring: () => { captures.push({ kind: "monitoring_start_captured" }); },
    getGeneratingPlan: () => false
  });

  const edit = await server.inject({
    method: "POST",
    url: `/api/plans/${initial.activePlan.id}/blueprint-revisions/direct`,
    payload: { kind: "move_place_within_day", expectedVersion: initial.activePlan.version, expectedBlueprintVersion: 5, placeId: stationId, dayId: "day-1", position: { kind: "start" } }
  });
  if (edit.statusCode !== 200) throw new Error(`Draft B edit failed: ${edit.statusCode} ${edit.body}`);
  const draftB = store.getWorkspace();
  const executionWhileBIsDraft = executionSnapshot(store);
  if (draftB.activePlan.status !== "draft" || draftB.activePlan.id === executionA.planId) throw new Error("The normal edit did not create a replacement Draft B.");
  if (executionWhileBIsDraft.planId !== executionA.planId || executionWhileBIsDraft.lineage?.blueprintVersion !== 5) throw new Error("Unconfirmed Draft B leaked into Execution Plan A.");
  if (executionWhileBIsDraft.day1Stops[0]?.placeId !== cathedralId) throw new Error("Execution Plan A order changed before Draft B confirmation.");

  const confirmation = await server.inject({ method: "POST", url: `/api/plans/${draftB.activePlan.id}/confirm` });
  if (confirmation.statusCode !== 200) throw new Error(`Draft B confirmation failed: ${confirmation.statusCode} ${confirmation.body}`);
  const executionB = executionSnapshot(store);
  if (executionB.planId !== draftB.activePlan.id || executionB.day1Stops[0]?.placeId !== stationId) throw new Error("Execution did not switch atomically to confirmed Plan B.");

  const database = new DatabaseSync(databasePath, { readOnly: true });
  const planRows = database.prepare("SELECT id, version, status, is_current, is_execution FROM plans ORDER BY created_at").all();
  const executionCount = Number((database.prepare("SELECT COUNT(*) AS count FROM plans WHERE is_execution = 1").get() as { count: number }).count);
  const openOldReminderRuns = Number((database.prepare("SELECT COUNT(*) AS count FROM task_reminder_runs WHERE plan_id = ? AND status IN ('running', 'retry_wait')").get(executionA.planId) as { count: number }).count);
  database.close();

  const report = {
    databasePath,
    externalCredentialsCleared: true,
    providerCalls: 0,
    externalSends: 0,
    executionA,
    draftB: {
      planId: draftB.activePlan.id,
      planVersion: draftB.activePlan.version,
      status: draftB.activePlan.status,
      blueprintId: draftB.activeBlueprint?.id,
      blueprintVersion: draftB.activeBlueprint?.version,
      day1Stops: draftB.activeBlueprint?.days.find((day) => day.id === "day-1")?.stops
    },
    executionWhileBIsDraft,
    confirmationStatus: confirmation.statusCode,
    executionB,
    planRows,
    executionCount,
    openOldReminderRuns,
    monitoringStartsCaptured: captures.length
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ reportPath, ...report }, null, 2));
} finally {
  await server.close();
  store.close();
}
