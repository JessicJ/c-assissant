import type { FastifyInstance } from "fastify";
import type { SqliteWorkspaceStore } from "@c-assistant/storage";
import type { ActivePlanMonitoringService } from "./active-plan-monitoring-service.js";

export async function startServerLifecycle(dependencies: {
  server: FastifyInstance;
  store: SqliteWorkspaceStore;
  port: number;
  host: string;
  pollTelegram: () => Promise<void>;
  activePlanMonitoring: ActivePlanMonitoringService;
  abortGenerationJobs: () => void;
}) {
  const { server, store, port, host, pollTelegram, activePlanMonitoring, abortGenerationJobs } = dependencies;

  try {
    await server.listen({ port, host });
  } catch (error) {
    store.close();
    throw error;
  }
  const interruptedGenerationRecovery = store.recoverInterruptedPlanGenerations();
  if (interruptedGenerationRecovery.runs || interruptedGenerationRecovery.sessions) {
    server.log.warn({ interruptedGenerationRecovery }, "Recovered interrupted Plan generation state");
  }
  const telegramPollTimer = setInterval(() => void pollTelegram(), 1_000);
  const arrivalReminderTimer = setInterval(() => void activePlanMonitoring.runArrivalReminder(), 15_000);
  const routeHandoffGuidanceTimer = setInterval(() => void activePlanMonitoring.runRouteHandoffGuidance(), 15_000);
  const taskReminderTimer = setInterval(() => void activePlanMonitoring.runTaskReminders(), 15_000);
  const itineraryDepartureReminderTimer = setInterval(() => void activePlanMonitoring.runItineraryDepartureReminders(), 60_000);
  const planWeatherTimer = setInterval(() => void activePlanMonitoring.runPlanWeatherMonitor(), 20 * 60_000);
  const planVenueTimer = setInterval(() => void activePlanMonitoring.runPlanVenueMonitor(), 6 * 60 * 60_000);
  const arrivalLocationPromptTimer = setInterval(() => void activePlanMonitoring.runArrivalLocationPrompt(), 15_000);
  void pollTelegram();
  void activePlanMonitoring.runArrivalReminder();
  void activePlanMonitoring.runRouteHandoffGuidance();
  void activePlanMonitoring.runTaskReminders();
  void activePlanMonitoring.runItineraryDepartureReminders();
  activePlanMonitoring.startActivePlanMonitoring();
  void activePlanMonitoring.runArrivalLocationPrompt();

  let shuttingDown = false;
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      if (shuttingDown) return;
      shuttingDown = true;
      clearInterval(telegramPollTimer);
      clearInterval(arrivalReminderTimer);
      clearInterval(routeHandoffGuidanceTimer);
      clearInterval(taskReminderTimer);
      clearInterval(itineraryDepartureReminderTimer);
      clearInterval(planWeatherTimer);
      clearInterval(planVenueTimer);
      clearInterval(arrivalLocationPromptTimer);
      abortGenerationJobs();
      void server.close().finally(() => {
        store.close();
        process.exit(0);
      });
    });
  }
}
