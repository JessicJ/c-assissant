import { guardedProcessControlConfig, attachGuardedProcessControl } from './guarded-process-control.js';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import { SqliteWorkspaceStore } from '@c-assistant/storage';
import { loadGuardedStartupPolicy } from './guarded-startup-policy.js';
import { registerGuardedRequestAdmission } from './guarded-request-admission.js';
import { startServerLifecycle } from './server-lifecycle.js';
import { registerAppRoutes } from './app-routes.js';
import { createAppServices } from './app-services.js';
import { buildMahReadinessReport } from './mah-readiness-report.js';

/** Construction is separate from listening so all checks can use request injection. */
export async function createGuardedWorkbench(env: NodeJS.ProcessEnv) {
  const config = loadGuardedStartupPolicy(env);
  const server = Fastify({ logger: false });
  const store = new SqliteWorkspaceStore(config.databasePath, { guardedSchemaSha256: config.schemaSha256, ...(config.postStopAdmission ? { postStopAdmission: config.postStopAdmission } : {}) });
  server.addHook('onClose', async () => store.close());
  try {
    registerGuardedRequestAdmission(server);
    const services = createAppServices({ ...config, store, guarded: true,
      logGenerationFailure: (details, message) => server.log.error(details, message),
      logWarning: (details, message) => server.log.warn(details, message) });
    await registerAppRoutes(server, { ...config, store,
      getMahDiagnostics: async () => buildMahReadinessReport(),
      getConnectors: services.connectorServices.getConnectors,
      replaceConnectors: services.connectorServices.replaceConnectors,
      getLocalConfiguration: services.connectorServices.getLocalConfiguration,
      runtimeServices: services.runtimeServices, activePlanMonitoring: services.activePlanMonitoring,
      destinationResearch: services.destinationResearch, prepareGeneratedPlanEvidence: services.prepareGeneratedPlanEvidence });
    return { server, store, config, services };
  } catch (error) {
    await server.close();
    throw error;
  }
}

export async function startGuardedWorkbench(env: NodeJS.ProcessEnv) {
  const processControl = guardedProcessControlConfig(env, env.LANDI_GUARDED_ADMISSION_KIND === 'post-stop-preserved-copy');
  const policy = loadGuardedStartupPolicy(env);
  if (realpathSync(fileURLToPath(new URL('./index.js', import.meta.url))) !== resolve(policy.projectRoot, 'apps/server/lib/index.js')) throw new Error('guarded_running_artifact_mismatch');
  const instance = await createGuardedWorkbench(env);
  // onClose owns the store: lifecycle must not close it twice.
  const closeOnlyThroughServer = { close() {} } as SqliteWorkspaceStore;
  let lifecycle: Awaited<ReturnType<typeof startServerLifecycle>> | undefined;
  let control: ReturnType<typeof attachGuardedProcessControl> | undefined;
  try {
    if (processControl) control = attachGuardedProcessControl(processControl, {
      manifestSha256: env.LANDI_GUARDED_MANIFEST_SHA256!, databasePath: instance.config.databasePath,
      origin: `http://127.0.0.1:${instance.config.port}`
    }, async () => { if (lifecycle) await lifecycle.stop(); else await instance.server.close(); });
    if (control && control.state() !== 'running') throw new Error('guarded_controller_unavailable');
    lifecycle = await startServerLifecycle({ guarded: true, server: instance.server,
      ...(control ? { installSignalHandlers: false } : {}),
      store: closeOnlyThroughServer, port: instance.config.port, host: instance.config.host,
      activePlanMonitoring: instance.services.activePlanMonitoring,
      abortGenerationJobs: instance.services.runtimeServices.abortGenerationJobs });
    if (control) await control.ready();
    return { server: instance.server, stop: lifecycle.stop };
  } catch (error) {
    control?.dispose();
    await instance.server.close();
    throw error;
  }
}
