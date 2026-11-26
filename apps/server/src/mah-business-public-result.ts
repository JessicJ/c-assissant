import { execFile } from 'node:child_process';
import { isAbsolute, normalize } from 'node:path';
import { resolveMahCliBinding } from './mah-cli-binding.js';
import { sha256 } from './mah-generation-contract.js';
import { MahBusinessContractError, validateMahBusinessResult,
  type MahBusinessReceipt, type MahBusinessRequest } from './mah-business-contract.js';

export type MahPublicResultSubpath = 'artifacts/landi-business-result.json' | 'artifacts/landi-stage-result.json';
export const MAH_BUSINESS_RESULT_SUBPATH = 'artifacts/landi-business-result.json';
const MAX = 16 * 1024 * 1024;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
function fail(code: string): never { throw new MahBusinessContractError(code); }
export type MahPublicRead = (args: string[], signal?: AbortSignal) => Promise<{ code: number; stdout: string }>;

/** Fixed public read allowlist; no shell, fallback or automatic retry. */
export function createMahBusinessPublicRead(projectRoot: string, environment: NodeJS.ProcessEnv = process.env, subpath: MahPublicResultSubpath = MAH_BUSINESS_RESULT_SUBPATH): MahPublicRead {
  if (!isAbsolute(projectRoot) || normalize(projectRoot) !== projectRoot || projectRoot.includes('\0')) fail('mah_business_project_invalid');
  if (!['artifacts/landi-business-result.json','artifacts/landi-stage-result.json'].includes(subpath)) fail('mah_business_read_command_rejected');
  const binding = resolveMahCliBinding(environment);
  return async (args, signal) => {
    const show = args.length === 7 && args[0] === 'task' && args[1] === 'show';
    const replay = subpath === 'artifacts/landi-stage-result.json' && args.length === 7 && args[0] === 'task' && args[1] === 'replay';
    const list = args.length === 7 && args[0] === 'task' && args[1] === 'context';
    const read = args.length === 9 && args[0] === 'task' && args[1] === 'context'
      && args[5] === '--read' && args[6] === subpath;
    if ((!show && !replay && !list && !read) || !UUID.test(args[2] ?? '') || args[3] !== '--cwd'
      || args[4] !== projectRoot || args.at(-2) !== '--format' || args.at(-1) !== 'json') fail('mah_business_read_command_rejected');
    signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
      execFile(binding.command, args, { cwd: projectRoot, env: binding.environment, encoding: 'utf8',
        timeout: 30000, maxBuffer: MAX * 2 + 65536, ...(signal ? { signal } : {}) }, (error, stdout) => {
        if (error) { reject(new MahBusinessContractError('mah_business_public_read_failed')); return; }
        resolve({ code: 0, stdout });
      });
    });
  };
}

export interface MahBusinessArtifactCandidate {
  taskId: string; projectRoot: string; raw: string; artifactSha256: string;
  lifecycleRevision: number; verified: false;
}
export class MahBusinessPublicResultReader {
  private readonly read: MahPublicRead;
  constructor(private readonly projectRoot: string, read?: MahPublicRead, private readonly subpath: MahPublicResultSubpath = MAH_BUSINESS_RESULT_SUBPATH) {
    if (!isAbsolute(projectRoot) || normalize(projectRoot) !== projectRoot || projectRoot.includes('\0')) fail('mah_business_project_invalid');
    if (!['artifacts/landi-business-result.json','artifacts/landi-stage-result.json'].includes(subpath)) fail('mah_business_read_command_rejected');
    this.read = read ?? createMahBusinessPublicRead(projectRoot, process.env, subpath);
  }
  private async json(args: string[], signal?: AbortSignal): Promise<unknown> {
    signal?.throwIfAborted();
    const r = await this.read(args, signal);
    signal?.throwIfAborted();
    if (r.code !== 0 || typeof r.stdout !== 'string' || Buffer.byteLength(r.stdout) > MAX * 2 + 65536) fail('mah_business_public_read_failed');
    try { return JSON.parse(r.stdout); } catch { return fail('mah_business_public_json_invalid'); }
  }
  private async completed(taskId: string, signal?: AbortSignal) {
    const v = await this.json(['task','show',taskId,'--cwd',this.projectRoot,'--format','json'], signal);
    if (!record(v) || v.ok !== true || !record(v.task) || v.task.task_id !== taskId) fail('mah_business_task_identity_invalid');
    if (v.schema_version !== undefined && v.schema_version !== 1) fail('mah_business_projection_version_invalid');
    const task = v.task;
    const roots = [v.project_root, task.root_dir, task.project_root,
      ...(record(task.project) ? [task.project.root_dir] : [])].filter(x => x !== undefined);
    if (!roots.length || roots.some(x => x !== this.projectRoot)) fail('mah_business_task_project_mismatch');
    if (task.status !== 'completed') fail('mah_business_task_not_completed');
    if (!Number.isSafeInteger(task.task_lifecycle_revision) || Number(task.task_lifecycle_revision) < 0) fail('mah_business_lifecycle_unverified');
    return Number(task.task_lifecycle_revision);
  }
  async readCandidate(taskId: string, signal?: AbortSignal): Promise<MahBusinessArtifactCandidate> {
    if (!UUID.test(taskId)) fail('mah_business_task_identity_invalid');
    const revision = await this.completed(taskId, signal);
    const rows = await this.json(['task','context',taskId,'--cwd',this.projectRoot,'--format','json'], signal);
    if (!Array.isArray(rows)) fail('mah_business_artifact_list_invalid');
    const matches = rows.filter(item => record(item) && item.subpath === this.subpath);
    if (matches.length !== 1) fail('mah_business_artifact_not_unique');
    const size = matches[0].size;
    if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 1 || size > MAX) fail('mah_business_artifact_size_invalid');
    const value = await this.json(['task','context',taskId,'--cwd',this.projectRoot,'--read',this.subpath,'--format','json'], signal);
    if (!record(value) || value.ok === false || typeof value.content !== 'string') fail('mah_business_artifact_unavailable');
    if (Buffer.byteLength(value.content,'utf8') !== size) fail('mah_business_artifact_size_mismatch');
    if (await this.completed(taskId, signal) !== revision) fail('mah_business_task_changed_during_read');
    return { taskId, projectRoot: this.projectRoot, raw: value.content, artifactSha256: sha256(value.content), lifecycleRevision: revision, verified: false };
  }
}

/** receipt is a trusted external port; this function cannot authenticate its producer. */
export function acceptMahBusinessCandidate<T>(candidate: MahBusinessArtifactCandidate, request: MahBusinessRequest,
  receipt: MahBusinessReceipt | undefined, validatePayload: (payload: Record<string, unknown>, request: MahBusinessRequest) => T): T {
  if (!receipt || receipt.taskId !== candidate.taskId || receipt.artifactSha256 !== candidate.artifactSha256
    || candidate.artifactSha256 !== sha256(candidate.raw)) fail('mah_business_public_receipt_unverified');
  return validateMahBusinessResult(candidate.raw, request, receipt, validatePayload);
}
