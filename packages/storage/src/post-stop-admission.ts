import { readFileSync, lstatSync, realpathSync, existsSync, readdirSync, statSync, readlinkSync } from 'node:fs';
import { isAbsolute, dirname, relative, resolve } from 'node:path';
import { bytesSha256, factsSha256, reviewedHistorySchema, retainedSchemaDifferences } from './readonly-schema-admission.js';

const ensure = (v: unknown, code: string): void => { if (!v) throw new Error(`post_stop_${code}`); };
const sha = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const obj = (v: any): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
export interface PostStopEvidencePin { path: string; sha256: string }
/** Explicitly scoped to local review and requirement saving, never pre-stop drainage. */
export function assessPostStopAdmission(v: any, now = Date.now()) {
  const issues: string[] = [];
  if (!obj(v)) return { status: 'unverified' as const, issues: ['evidence_missing'], productionExecutable: false as const };
  if (v.version !== 1 || v.purpose !== 'post_stop_guarded_workbench' || v.scope !== 'post_stop_preserved_copy') issues.push('scope_invalid');
  for (const key of ['preStopDrained', 'gracefulExit', 'externalOperationOutcomes']) if (v[key] !== 'unverified') issues.push(`${key}_must_remain_unverified`);
  if (v.productionExecutable !== false || v.automaticResume !== false || v.restoreDatabase !== false) issues.push('unsafe_action');
  if (!obj(v.working) || !obj(v.preserved) || !sha(v.working.sha256) || !sha(v.preserved.sha256) || v.working.initialSha256 !== v.preserved.sha256) issues.push('copy_identity_missing');
  if (!obj(v.candidate) || !obj(v.rollback)) issues.push('release_pair_missing');
  else {
    for (const release of [v.candidate,v.rollback]) {
      if (release.mode !== 'guarded-workbench' || !['artifactSha256','dependenciesSha256','storageKeysSha256'].every(k => sha(release[k])) || release.schemaSha256 !== reviewedHistorySchema || typeof release.origin !== 'string' || !/^http:\/\/127\.0\.0\.1:\d+$/.test(release.origin)) issues.push('release_invalid');
    }
    for (const k of ['schemaSha256','origin','databasePath','configPath','storageKeysSha256']) if (v.candidate[k] !== v.rollback[k]) issues.push(`rollback_${k}_mismatch`);
    if (v.candidate.databasePath !== v.working?.path) issues.push('work_release_mismatch');
  }
  return { status: issues.length ? 'unverified' as const : 'consistent_unverified' as const, issues, productionExecutable: false as const };
}
function regular(path: string) {
  ensure(typeof path === 'string' && isAbsolute(path), 'absolute_path_required');
  const s = lstatSync(path);
  ensure(s.isFile() && !s.isSymbolicLink() && realpathSync(path) === path, 'canonical_regular_file_required');
  return s;
}
function jsonPin(pin: PostStopEvidencePin): any {
  ensure(obj(pin) && sha(pin.sha256), 'evidence_pin_invalid');
  ensure(regular(pin.path).size <= 4_000_000, 'evidence_too_large');
  const b = readFileSync(pin.path); ensure(bytesSha256(b) === pin.sha256, 'evidence_digest_mismatch');
  return JSON.parse(b.toString('utf8'));
}
const inside = (root: string, path: string) => { const r = relative(root,path); return r === '' || (!r.startsWith('..') && !isAbsolute(r)); };
/** Relative dependency links are pinned by spelling and canonical in-unit destination.
 * Do not follow links while walking: dependency graphs may contain legitimate cycles.
 */
export function validatePostStopReleaseLinks(root: string, files: Set<string>, entries: unknown): Set<string> {
  ensure(Array.isArray(entries), 'link_inventory_required');
  const links = new Set<string>();
  for (const entry of entries as any[]) {
    ensure(obj(entry) && typeof entry.path === 'string' && !isAbsolute(entry.path), 'link_path_invalid');
    const path = resolve(root,entry.path);
    ensure(inside(root,path) && relative(root,path) === entry.path && !files.has(path) && !links.has(path), 'link_path_invalid');
    ensure(realpathSync(dirname(path)) === dirname(path) && lstatSync(path).isSymbolicLink(), 'link_path_not_direct');
    ensure(typeof entry.target === 'string' && !isAbsolute(entry.target) && readlinkSync(path) === entry.target, 'link_target_mismatch');
    ensure(existsSync(path), 'link_dangling');
    const target = realpathSync(path);
    ensure(inside(root,target), 'link_target_escape');
    ensure(typeof entry.resolvedTarget === 'string' && !isAbsolute(entry.resolvedTarget) && relative(root,target) === entry.resolvedTarget, 'link_resolved_target_mismatch');
    const stat = statSync(target); ensure(stat.isFile() || stat.isDirectory(), 'link_target_type_invalid');
    links.add(path);
  }
  const walk = (directory: string): void => {
    for (const item of readdirSync(directory,{withFileTypes:true})) {
      const path = directory+'/'+item.name;
      if (item.isSymbolicLink()) ensure(links.has(path), 'link_unregistered');
      else if (item.isDirectory()) walk(path);
      else ensure(item.isFile() && files.has(path), 'release_inventory_incomplete');
    }
  };
  walk(root);
  return links;
}
/** Filesystem-only verification. Called again by the store before constructing SQLite. */
export function loadPostStopAdmission(databasePath: string, pin: PostStopEvidencePin, now = Date.now()) {
  const v = jsonPin(pin); const result = assessPostStopAdmission(v,now);
  ensure(result.status === 'consistent_unverified', 'contract_unverified');
  ensure(databasePath === v.working.path && databasePath !== v.originalDatabasePath && databasePath !== v.preserved.path, 'original_or_preserved_forbidden');
  regular(databasePath); regular(v.preserved.path);
  ensure(!['-wal','-shm','-journal'].some(s => existsSync(databasePath+s) || existsSync(v.preserved.path+s)), 'standalone_copy_required');
  ensure(bytesSha256(readFileSync(databasePath)) === v.working.sha256 && bytesSha256(readFileSync(v.preserved.path)) === v.preserved.sha256, 'copy_digest_mismatch');
  ensure((lstatSync(v.preserved.path).mode & 0o222) === 0, 'preserved_readonly_required');
  const refs = v.evidence;
  ensure(obj(refs), 'evidence_missing');
  const failure = jsonPin(refs.stopFailure), exit = jsonPin(refs.exitConfirmation), preservation = jsonPin(refs.preservation), verification = jsonPin(refs.workVerification), seal = jsonPin(refs.priorSeal);
  ensure(failure.status === 'failed_stopped' && exit.oldPidAbsent === true && exit.managerDefinitionAbsent === true && exit.disabledConfirmed === true && exit.port8787Released === true && exit.replacementProcessAbsentWithinScope === true, 'stop_chain_invalid');
  ensure(preservation.status === 'preserved' && preservation.snapshotScope === 'post_stop_file_set' && preservation.sourceSqliteOpened === false && preservation.sourceUnchangedDuringCopy === true && preservation.fsync === true && preservation.darwinFullFsync === true, 'preservation_invalid');
  ensure(!inside(preservation.preservedDirectory,databasePath) && inside(preservation.preservedDirectory,v.preserved.path), 'preservation_path_invalid');
  ensure(Array.isArray(preservation.sourceFiles) && preservation.sourceFiles.some((f: any) => f.path === v.originalDatabasePath && f.sha256 === v.preserved.sha256), 'preservation_source_mismatch');
  ensure(seal.status === 'sealed' && databasePath !== seal.snapshot?.path && !inside(dirname(refs.priorSeal.path),databasePath), 'sealed_backup_forbidden');
  ensure(verification.status === 'passed' && verification.schemaSha256 === reviewedHistorySchema && verification.integrity?.length === 1 && verification.integrity[0] === 'ok', 'prior_verification_invalid');
  // Preserve raw evidence references: none of these assertions independently proves graceful exit.
  for (const record of [exit, failure]) {
    ensure(Array.isArray(record.evidence) && record.evidence.length > 0, 'raw_stop_records_missing');
    for (const ref of record.evidence) jsonPin(ref);
  }
  const observation = jsonPin(refs.currentObservation);
  const time = Date.parse(observation.observedAt);
  ensure(Number.isFinite(time) && time <= now && now-time <= 60_000, 'observation_stale');
  ensure(observation.databasePath === databasePath && observation.oldPidAbsent === true && observation.managerDefinitionAbsent === true && observation.disabledConfirmed === true && observation.portReleased === true && observation.replacementAbsent === true && observation.fileUsersAbsent === true, 'exclusive_observation_unverified');
  ensure(Array.isArray(observation.records) && observation.records.length > 0, 'observation_records_missing');
  for (const ref of observation.records) jsonPin(ref);
  const copy = jsonPin(refs.copyLineage);
  ensure(copy.workingPath === databasePath && copy.preservedPath === v.preserved.path && copy.initialSha256 === v.preserved.sha256 && copy.currentSha256 === v.working.sha256 && copy.status === 'observed', 'copy_lineage_invalid');
  const audit = jsonPin(refs.compatibilityAudit);
  ensure(audit.status === 'passed' && audit.databasePath === databasePath && audit.databaseSha256 === v.working.sha256 && audit.factsSha256 === factsSha256(audit.facts) && factsSha256(audit.retainedDifferences) === factsSha256(retainedSchemaDifferences), 'compatibility_audit_invalid');
  for (const role of ['candidate','rollback']) {
    const manifest = jsonPin(refs[role+'Manifest']); const binding = v[role];
    ensure(refs[role+'Manifest'].sha256 === binding.artifactSha256 && manifest.mode === 'guarded-workbench' && manifest.databasePath === databasePath && manifest.schemaSha256 === reviewedHistorySchema && manifest.origin === binding.origin && manifest.envPath === binding.configPath && manifest.storageKeysSha256 === binding.storageKeysSha256, 'manifest_binding_mismatch');
    ensure(Array.isArray(manifest.files) && manifest.files.length > 0, 'manifest_inventory_missing');
    ensure(typeof manifest.projectRoot === 'string' && isAbsolute(manifest.projectRoot) && realpathSync(manifest.projectRoot) === manifest.projectRoot && statSync(manifest.projectRoot).isDirectory(), 'release_root_invalid');
    regular(binding.configPath);
    const paths = new Set<string>();
    for (const file of manifest.files) {
      ensure(typeof file.path === 'string' && !isAbsolute(file.path), 'artifact_path_invalid');
      const path = manifest.projectRoot+'/'+file.path; regular(path);
      ensure(inside(manifest.projectRoot,path) && !paths.has(path) && sha(file.sha256) && bytesSha256(readFileSync(path)) === file.sha256, 'artifact_digest_mismatch'); paths.add(path);
    }
    for (const required of ['apps/server/lib/index.js','packages/storage/lib/index.js','apps/web/dist/index.html','pnpm-lock.yaml']) ensure(paths.has(manifest.projectRoot+'/'+required), 'release_incomplete');
    validatePostStopReleaseLinks(manifest.projectRoot, paths, manifest.links ?? []);
    ensure(bytesSha256(readFileSync(manifest.projectRoot+'/pnpm-lock.yaml')) === binding.dependenciesSha256 && bytesSha256(readFileSync(binding.configPath)) === manifest.envSha256, 'release_configuration_mismatch');
  }
  return { record: v, audit, evidenceSha256: pin.sha256, scope: 'post_stop_preserved_copy' as const, preStopDrained: 'unverified' as const, productionExecutable: false as const };
}
