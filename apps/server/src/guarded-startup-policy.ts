import { loadPostStopAdmission, type PostStopEvidencePin } from '@c-assistant/storage';
import { assessGuardedCutover } from './guarded-cutover-contract.js';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync, existsSync, readdirSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

function existingPath(value: unknown, directory = false): string {
  if (typeof value !== 'string' || !isAbsolute(value)) throw new Error('guarded_explicit_path_required');
  const path = realpathSync(value);
  if (directory ? !statSync(path).isDirectory() : !statSync(path).isFile()) throw new Error('guarded_path_invalid');
  return path;
}
const digest = (value: Buffer) => createHash('sha256').update(value).digest('hex');

/** Selected before .env is loaded. No ambient/default business database or port. */
export function loadGuardedStartupPolicy(env: NodeJS.ProcessEnv) {
  if (env.LANDI_SERVER_MODE !== 'guarded-workbench') throw new Error('guarded_mode_required');
  const projectRoot = existingPath(env.LANDI_GUARDED_APP_ROOT, true);
  const databasePath = existingPath(env.LANDI_GUARDED_DATABASE_PATH);
  const envPath = existingPath(env.LANDI_GUARDED_ENV_PATH);
  const manifestPath = existingPath(env.LANDI_GUARDED_MANIFEST_PATH);
  const bytes = readFileSync(manifestPath);
  if (!/^[a-f0-9]{64}$/.test(env.LANDI_GUARDED_MANIFEST_SHA256 ?? '') || digest(bytes) !== env.LANDI_GUARDED_MANIFEST_SHA256) throw new Error('guarded_manifest_digest_mismatch');
  const manifest = JSON.parse(bytes.toString('utf8'));
  const port = Number(env.LANDI_GUARDED_PORT);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('guarded_port_required');
  if (manifest.version !== 1 || manifest.mode !== 'guarded-workbench' || manifest.projectRoot !== projectRoot || manifest.databasePath !== databasePath || manifest.envPath !== envPath || manifest.origin !== `http://127.0.0.1:${port}` || manifest.envSha256 !== digest(readFileSync(envPath)) || !/^[a-f0-9]{64}$/.test(manifest.schemaSha256 ?? '')) throw new Error('guarded_binding_mismatch');
  if (!Array.isArray(manifest.files) || !manifest.files.length) throw new Error('guarded_artifacts_required');
  const paths = new Set<string>();
  for (const file of manifest.files) {
    if (!file || typeof file.path !== 'string' || isAbsolute(file.path)) throw new Error('guarded_artifact_invalid');
    const path = existingPath(resolve(projectRoot, file.path));
    const local = relative(projectRoot, path);
    if (local.startsWith('..') || isAbsolute(local) || paths.has(path) || digest(readFileSync(path)) !== file.sha256) throw new Error('guarded_artifact_digest_mismatch');
    paths.add(path);
  }
  for (const file of ['apps/server/lib/index.js', 'packages/storage/lib/index.js', 'apps/web/dist/index.html', 'pnpm-lock.yaml']) {
    if (!paths.has(resolve(projectRoot, file))) throw new Error('guarded_release_unit_incomplete');
  }
  // Every release-owned compiled file must belong to the pinned release unit.
  const checkTree = (directory: string): void => {
    if (!existsSync(directory)) return;
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, item.name);
      if (item.isDirectory()) checkTree(path);
      else if (!item.isFile() || !paths.has(realpathSync(path))) throw new Error('guarded_release_unit_incomplete');
    }
  };
  checkTree(resolve(projectRoot, 'apps/server/lib'));
  checkTree(resolve(projectRoot, 'apps/web/dist'));
  const packagesPath = resolve(projectRoot, 'packages');
  if (existsSync(packagesPath)) for (const item of readdirSync(packagesPath, { withFileTypes: true })) {
    if (item.isDirectory()) checkTree(resolve(packagesPath, item.name, 'lib'));
  }
  let postStopAdmission: PostStopEvidencePin | undefined;
  const kind = env.LANDI_GUARDED_ADMISSION_KIND;
  if (kind === 'post-stop-preserved-copy') {
    postStopAdmission = { path: existingPath(env.LANDI_GUARDED_POST_STOP_EVIDENCE_PATH), sha256: env.LANDI_GUARDED_POST_STOP_EVIDENCE_SHA256 ?? '' };
    const admission = loadPostStopAdmission(databasePath, postStopAdmission);
    const candidate = admission.record.candidate;
    if (candidate.artifactSha256 !== env.LANDI_GUARDED_MANIFEST_SHA256 || candidate.dependenciesSha256 !== digest(readFileSync(resolve(projectRoot, 'pnpm-lock.yaml'))) || candidate.schemaSha256 !== manifest.schemaSha256 || candidate.configPath !== envPath || candidate.origin !== manifest.origin) throw new Error('post_stop_release_binding_mismatch');
  } else {
    if (kind !== undefined && kind !== 'drained-cutover') throw new Error('guarded_admission_kind_invalid');
    const evidencePath = existingPath(env.LANDI_GUARDED_CUTOVER_EVIDENCE_PATH);
    const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
    const assessment = assessGuardedCutover(evidence);
    if (assessment.status !== 'consistent_unverified' || evidence.candidate.artifactSha256 !== env.LANDI_GUARDED_MANIFEST_SHA256 || evidence.candidate.dependenciesSha256 !== digest(readFileSync(resolve(projectRoot, 'pnpm-lock.yaml'))) || evidence.candidate.schemaSha256 !== manifest.schemaSha256 || evidence.candidate.databasePath !== databasePath || evidence.candidate.configPath !== envPath || evidence.candidate.origin !== manifest.origin) throw new Error('guarded_cutover_evidence_unverified');
  }
  // The manifest pins .env for later configuration writes; startup never loads it.
  // Neither .env nor legacy environment flags may re-enable background execution.
  return Object.freeze({ projectRoot, databasePath, envPath, ...(postStopAdmission ? { postStopAdmission: Object.freeze(postStopAdmission) } : {}), schemaSha256: String(manifest.schemaSha256), host: '127.0.0.1', port,
    blueprintGenerationEnabled: false as const,
    semanticShadow: Object.freeze({ enabled: false, sampleRate: 0, timeoutMs: 600_000 }),
    semanticDraftCanary: Object.freeze({ enabled: false, localEnvironment: true, allowedSessionIds: [] as string[] }),
    webAssetsPath: resolve(projectRoot, 'apps/web/dist/assets'), webTripMapPath: resolve(projectRoot, 'apps/web/dist/trip-map'), webIndexPath: resolve(projectRoot, 'apps/web/dist/index.html') });
}
