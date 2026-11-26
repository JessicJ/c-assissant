import { createHash } from 'node:crypto';
import { isAbsolute, relative, resolve } from 'node:path';
import { lstatSync, readFileSync, realpathSync, readdirSync } from 'node:fs';

const sha = (value: Buffer) => createHash('sha256').update(value).digest('hex');
const validSha = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function absoluteFile(value: unknown) {
  if (typeof value !== 'string' || !isAbsolute(value) || !lstatSync(value).isFile()) throw new Error('maintenance_explicit_file_required');
  return realpathSync(value);
}

/** Reads release code/manifest only. Never reads .env, SQLite or cutover state. */
export function loadMaintenanceBootstrapPolicy(env: NodeJS.ProcessEnv) {
  if (env.LANDI_SERVER_MODE !== 'maintenance-bootstrap') throw new Error('maintenance_bootstrap_mode_required');
  const token = env.LANDI_MAINTENANCE_TOKEN;
  if (typeof token !== 'string' || token.length < 32) throw new Error('maintenance_token_required');
  const declaredRoot = env.LANDI_MAINTENANCE_APP_ROOT;
  if (!declaredRoot || !isAbsolute(declaredRoot) || !lstatSync(declaredRoot).isDirectory()) throw new Error('maintenance_explicit_root_required');
  const projectRoot = realpathSync(declaredRoot);
  if (!env.LANDI_MAINTENANCE_MANIFEST_PATH?.endsWith('.json')) throw new Error('maintenance_manifest_json_required');
  const manifestPath = absoluteFile(env.LANDI_MAINTENANCE_MANIFEST_PATH);
  const bytes = readFileSync(manifestPath);
  if (!validSha(env.LANDI_MAINTENANCE_MANIFEST_SHA256) || sha(bytes) !== env.LANDI_MAINTENANCE_MANIFEST_SHA256) throw new Error('maintenance_manifest_digest_mismatch');
  const manifest = JSON.parse(bytes.toString('utf8'));
  const port = Number(env.LANDI_MAINTENANCE_PORT);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('maintenance_explicit_port_required');
  const origin = `http://127.0.0.1:${port}`;
  const oldPort = typeof manifest?.oldOrigin === 'string' && /^http:\/\/127\.0\.0\.1:\d+$/.test(manifest.oldOrigin) ? Number(manifest.oldOrigin.split(':').at(-1)) : NaN;
  if (!manifest || manifest.version !== 1 || manifest.mode !== 'maintenance-bootstrap' || manifest.projectRoot !== projectRoot || manifest.origin !== origin ||
      !Number.isInteger(oldPort) || oldPort < 1 || oldPort > 65535 || oldPort === port || manifest.nodeVersion !== process.version) throw new Error('maintenance_bootstrap_binding_mismatch');
  // There is deliberately no database/config path in this phase's manifest.
  if (Object.keys(manifest).some(key => !['version', 'mode', 'projectRoot', 'origin', 'oldOrigin', 'nodeVersion', 'files'].includes(key))) throw new Error('maintenance_manifest_field_unsupported');
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) throw new Error('maintenance_artifacts_required');
  const paths = new Set<string>();
  for (const file of manifest.files) {
    if (!file || typeof file.path !== 'string' || isAbsolute(file.path) || file.path.split('/').some((part: string) => part === '..' || part === '') ||
        !(file.path.startsWith('apps/server/lib/') && /\.(?:js|d\.ts|map)$/.test(file.path) || file.path === 'pnpm-lock.yaml') || !validSha(file.sha256)) throw new Error('maintenance_artifact_invalid');
    const path = absoluteFile(resolve(projectRoot, file.path));
    const local = relative(projectRoot, path);
    if (local.startsWith('..') || isAbsolute(local) || paths.has(path) || sha(readFileSync(path)) !== file.sha256) throw new Error('maintenance_artifact_digest_mismatch');
    paths.add(path);
  }
  for (const file of ['index.js', 'maintenance-bootstrap-startup.js', 'maintenance-bootstrap-policy.js', 'maintenance-control.js', 'maintenance-control-routes.js']) {
    if (!paths.has(resolve(projectRoot, 'apps/server/lib', file))) throw new Error('maintenance_release_incomplete');
  }
  if (!paths.has(resolve(projectRoot, 'pnpm-lock.yaml'))) throw new Error('maintenance_release_incomplete');
  const checkTree = (directory: string) => {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, item.name);
      if (item.isDirectory()) checkTree(path);
      else if (!item.isFile() || !paths.has(realpathSync(path))) throw new Error('maintenance_release_incomplete');
    }
  };
  checkTree(resolve(projectRoot, 'apps/server/lib'));
  return Object.freeze({ projectRoot, origin, oldOrigin: manifest.oldOrigin as string, port, host: '127.0.0.1' as const,
    manifestSha256: sha(bytes), productionExecutable: false as const });
}
