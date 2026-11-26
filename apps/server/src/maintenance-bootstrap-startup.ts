import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import { loadMaintenanceBootstrapPolicy } from './maintenance-bootstrap-policy.js';
import { createMaintenanceControl } from './maintenance-control.js';
import { registerMaintenanceControl } from './maintenance-control-routes.js';

/** Construction supports injection. No business imports, storage, recovery or timers. */
export async function createMaintenanceBootstrap(env: NodeJS.ProcessEnv) {
  const config = loadMaintenanceBootstrapPolicy(env);
  const control = createMaintenanceControl({ initialMaintenance: true, role: 'candidate_bootstrap' });
  const server = Fastify({ logger: false });
  registerMaintenanceControl(server, control, env.LANDI_MAINTENANCE_TOKEN!);
  return { server, control, config };
}

/** Only this temporary diagnostic listener is owned by stop(); no service manager is touched. */
export async function startMaintenanceBootstrap(env: NodeJS.ProcessEnv) {
  const instance = await createMaintenanceBootstrap(env);
  let entry: string;
  try { entry = realpathSync(fileURLToPath(new URL('./index.js', import.meta.url))); }
  catch {
    await instance.server.close();
    throw new Error('maintenance_running_artifact_mismatch');
  }
  if (entry !== resolve(instance.config.projectRoot, 'apps/server/lib/index.js')) {
    await instance.server.close();
    throw new Error('maintenance_running_artifact_mismatch');
  }
  const handlers = new Map<NodeJS.Signals, () => void>();
  async function stop() {
    await instance.server.close();
    for (const [signal, handler] of handlers) process.off(signal, handler);
  }
  try {
    await instance.server.listen({ host: instance.config.host, port: instance.config.port });
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      const handler = () => { void stop().catch(() => { process.exitCode = 1; }); };
      handlers.set(signal, handler); process.on(signal, handler);
    }
    // No secret, business path, or automatic subsequent action is printed.
    process.stdout.write(`${JSON.stringify({ mode: 'maintenance-bootstrap', instanceId: instance.control.instanceId, origin: instance.config.origin, manifestSha256: instance.config.manifestSha256, executable: false })}\n`);
    return { ...instance, stop };
  } catch (error) { await stop(); throw error; }
}
