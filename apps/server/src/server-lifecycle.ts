import type { MaintenanceControl } from "./maintenance-control.js";
import type { FastifyInstance } from "fastify";
import type { SqliteWorkspaceStore } from "@c-assistant/storage";
import type { EmailPlanMonitoringService } from "./email-plan-monitoring.js";

export async function startServerLifecycle(dependencies: {
  maintenance?: MaintenanceControl;
  guarded?: boolean;
  server: FastifyInstance;
  store: SqliteWorkspaceStore;
  port: number;
  host: string;
  activePlanMonitoring: EmailPlanMonitoringService;
  abortGenerationJobs: () => void | Promise<void>;
  recoverMahGenerations?: () => Promise<void>;
  scheduler?: {
    setInterval(callback: () => void, intervalMs: number): unknown;
    clearInterval(handle: unknown): void;
  };
  installSignalHandlers?: boolean;
}) {
  const { server, store, port, host, activePlanMonitoring, abortGenerationJobs } = dependencies;
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
  if (!dependencies.guarded && (!dependencies.maintenance || dependencies.maintenance.accepting())) {
    const interruptedGenerationRecovery = store.recoverInterruptedPlanGenerations();
    if (interruptedGenerationRecovery.runs || interruptedGenerationRecovery.sessions) {
      server.log.warn({ interruptedGenerationRecovery }, "Recovered interrupted Plan generation state");
    }
    if (dependencies.recoverMahGenerations && (!dependencies.maintenance || dependencies.maintenance.accepting())) {
      const recover = dependencies.recoverMahGenerations;
      await (dependencies.maintenance ? dependencies.maintenance.run('background', recover) : recover()).catch((error) => server.log.warn({ error }, "MAH generation 恢复失败"));
    }
  }
  const pending = new Set<Promise<void>>();
  const run = (operation: () => Promise<void>) => {
    const promise = operation().catch((error) => server.log.warn({ error }, "Scheduled operation failed")).finally(() => pending.delete(promise));
    pending.add(promise);
  };
  const timers = dependencies.guarded ? [] : [
    scheduler.setInterval(() => run(activePlanMonitoring.runItineraryDepartureReminders), 60_000),
    scheduler.setInterval(() => run(activePlanMonitoring.runPlanWeatherMonitor), 5 * 60_000),
    scheduler.setInterval(() => run(activePlanMonitoring.runPlanVenueMonitor), 30 * 60_000),
  ];
  if (!dependencies.guarded) {
    run(activePlanMonitoring.runItineraryDepartureReminders);
    run(activePlanMonitoring.runPlanWeatherMonitor);
    run(activePlanMonitoring.runPlanVenueMonitor);
  }

  dependencies.maintenance?.onPause(() => {
    for (const timer of timers) scheduler.clearInterval(timer);
  });
  let stopPromise: Promise<void> | undefined;
  const signalHandlers = new Map<NodeJS.Signals, () => void>();
  function stop(): Promise<void> {
    if (stopPromise) return stopPromise;
    if (dependencies.maintenance && !dependencies.maintenance.snapshot().readyToStop) return Promise.reject(new Error('maintenance_stop_unverified'));
    stopPromise = (async () => {
      for (const timer of timers) scheduler.clearInterval(timer);
      if (!dependencies.guarded && !dependencies.maintenance) await abortGenerationJobs();
      await Promise.allSettled([...pending]);
      await server.close();
      store.close();
      for (const [signal, handler] of signalHandlers) process.off(signal, handler);
    })();
    return stopPromise;
  }
  if (dependencies.installSignalHandlers !== false) {
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      const handler = () => {
        if (dependencies.maintenance || dependencies.guarded) {
          void stop().then(() => process.exit(0)).catch(error => server.log.warn({ error }, 'Controlled shutdown failed or is unverified; no successful exit reported'));
        } else { void stop().finally(() => process.exit(0)); }
      };
      signalHandlers.set(signal, handler);
      process.on(signal, handler);
    }
  }
  return { stop };
}
