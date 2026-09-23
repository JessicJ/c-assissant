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
  scheduler?: {
    setInterval(callback: () => void, intervalMs: number): unknown;
    clearInterval(handle: unknown): void;
  };
  installSignalHandlers?: boolean;
}) {
  const { server, store, port, host, pollTelegram, activePlanMonitoring, abortGenerationJobs } = dependencies;
  const scheduler = dependencies.scheduler ?? {
    setInterval: (callback: () => void, intervalMs: number) => setInterval(callback, intervalMs),
    clearInterval: (handle: unknown) => clearInterval(handle as ReturnType<typeof setInterval>)
  };

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
  const pending = new Set<Promise<void>>();
  const run = (operation: () => Promise<void>) => {
    const promise = operation().catch((error) => server.log.warn({ error }, "Scheduled operation failed")).finally(() => pending.delete(promise));
    pending.add(promise);
  };
  const timers = [
    scheduler.setInterval(() => run(pollTelegram), 1_000),
    scheduler.setInterval(() => run(activePlanMonitoring.runArrivalReminder), 15_000),
    scheduler.setInterval(() => run(activePlanMonitoring.runRouteHandoffGuidance), 15_000),
    scheduler.setInterval(() => run(activePlanMonitoring.runTaskReminders), 15_000),
    scheduler.setInterval(() => run(activePlanMonitoring.runItineraryDepartureReminders), 60_000),
    scheduler.setInterval(() => run(activePlanMonitoring.runPlanWeatherMonitor), 20 * 60_000),
    scheduler.setInterval(() => run(activePlanMonitoring.runPlanVenueMonitor), 6 * 60 * 60_000),
    scheduler.setInterval(() => run(activePlanMonitoring.runArrivalLocationPrompt), 15_000)
  ];
  run(pollTelegram);
  run(activePlanMonitoring.runArrivalReminder);
  run(activePlanMonitoring.runRouteHandoffGuidance);
  run(activePlanMonitoring.runTaskReminders);
  run(activePlanMonitoring.runItineraryDepartureReminders);
  run(activePlanMonitoring.runPlanWeatherMonitor);
  run(activePlanMonitoring.runPlanVenueMonitor);
  run(activePlanMonitoring.runArrivalLocationPrompt);

  let shuttingDown = false;
  const signalHandlers = new Map<NodeJS.Signals, () => void>();
  async function stop(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    for (const timer of timers) scheduler.clearInterval(timer);
    abortGenerationJobs();
    await Promise.allSettled([...pending]);
    await server.close();
    store.close();
    for (const [signal, handler] of signalHandlers) process.off(signal, handler);
  }
  if (dependencies.installSignalHandlers !== false) {
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      const handler = () => { void stop().finally(() => process.exit(0)); };
      signalHandlers.set(signal, handler);
      process.on(signal, handler);
    }
  }
  return { stop };
}
