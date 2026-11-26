import { readAdaptiveStageWitness } from './mah-adaptive-stage-witness.js';
import { canonicalJson, sha256 } from './mah-generation-contract.js';
import { assertMahBusinessRequest, MahBusinessContractError, type MahBusinessRequest, type MahBusinessReceipt } from './mah-business-contract.js';
import { createMahBusinessPublicRead, MahBusinessPublicResultReader, type MahBusinessArtifactCandidate, type MahPublicRead, type MahPublicResultSubpath } from './mah-business-public-result.js';

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function reject(): never { throw new MahBusinessContractError('mah_business_public_receipt_unverified'); }
function timestamp(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) && Number.isFinite(Date.parse(value));
}

/** Public Task projection witness, not an audit signature or permission grant.
 * Attachment digest binds the submitted request. A fresh public artifact read
 * binds its bytes; a matching completed lifecycle binds the MAH Agent/model.
 * Never reads a path, Agent provenance, preferences or private runtime records.
 */
export function createMahBusinessPublicReceiptVerifier(projectRoot: string, suppliedRead?: MahPublicRead) {
  const verify = createMahPublicReceiptVerifier(projectRoot, 'artifacts/landi-business-result.json', suppliedRead);
  return async (request: MahBusinessRequest, candidate: MahBusinessArtifactCandidate): Promise<MahBusinessReceipt> => {
    assertMahBusinessRequest(request);
    return verify(canonicalJson(request), candidate);
  };
}

export type MahStagePublicReceipt = MahBusinessReceipt & {
  execution?: { attemptId: string; startedAt: string; completedAt: string; runtimeMs?: number };
};

export function createMahPublicReceiptVerifier(projectRoot: string, subpath: MahPublicResultSubpath, suppliedRead?: MahPublicRead) {
  const read = suppliedRead ?? createMahBusinessPublicRead(projectRoot, process.env, subpath);
  const reader = new MahBusinessPublicResultReader(projectRoot, read, subpath);
  return async (requestJson: string, candidate: MahBusinessArtifactCandidate, signal?: AbortSignal): Promise<MahStagePublicReceipt> => {
    if (candidate.projectRoot !== projectRoot || candidate.artifactSha256 !== sha256(candidate.raw)) reject();
    const observed = await reader.readCandidate(candidate.taskId, signal);
    if (observed.raw !== candidate.raw || observed.artifactSha256 !== candidate.artifactSha256
      || observed.lifecycleRevision !== candidate.lifecycleRevision) reject();
    const response = await read(['task','show',candidate.taskId,'--cwd',projectRoot,'--format','json'], signal);
    if (response.code !== 0 || Buffer.byteLength(response.stdout) > 32 * 1024 * 1024) reject();
    let value: unknown; try { value = JSON.parse(response.stdout); } catch { reject(); }
    if (!record(value) || value.ok !== true || !record(value.task)) reject();
    if (value.schema_version !== undefined && value.schema_version !== 1) reject();
    const task = value.task;
    const stage = subpath === 'artifacts/landi-stage-result.json';
    const adaptiveTopology = stage && task.orchestration_topology === 'adaptive';
    let validatorNodePath: string | undefined;
    let usesWorktree = false;
    if (adaptiveTopology) {
      let request: unknown;
      try { request = JSON.parse(requestJson); } catch { reject(); }
      if (!record(request) || !record(request.execution)) reject();
      const clock = request.execution.adaptiveProducerClockV1;
      if (record(clock) && typeof clock.validatorNodePath === 'string') {
        if (clock.artifactValidation !== undefined && clock.artifactValidation !== 'worktree_then_published_v1') reject();
        validatorNodePath = clock.validatorNodePath;
        usesWorktree = clock.artifactValidation === 'worktree_then_published_v1';
      }
    }
    const adaptive = validatorNodePath !== undefined;
    if (task.task_id !== candidate.taskId || task.root_dir !== projectRoot || task.status !== 'completed'
      || task.task_lifecycle_revision !== candidate.lifecycleRevision
      || (stage ? value.task_record_materialized !== undefined && value.task_record_materialized !== true : value.task_record_materialized === false)
      || (!adaptive && (typeof task.agent !== 'string' || !task.agent.trim()
      || typeof task.direct_runtime_model_id !== 'string' || !task.direct_runtime_model_id.trim()
      || !record(task.model_routing) || !record(task.model_routing.selected)
      || task.model_routing.selected.agent_id !== task.agent)) || !Array.isArray(task.attachments)) reject();
    // Ordinary completed Task projections can omit the materialization marker and
    // describe the selected route by family/profile. The concrete execution model
    // comes from the public direct-runtime field; a family ID is not a model ID.
    const selected = (task.model_routing as { selected: Record<string,unknown> } | undefined)?.selected;
    if (stage && !adaptive && selected && (selected.model_id !== undefined
      ? selected.model_id !== task.direct_runtime_model_id
      : typeof selected.model_family_id !== 'string' || !selected.model_family_id.trim()
        || typeof selected.runtime_profile !== 'string' || !selected.runtime_profile.trim())) reject();
    const requestSha256 = sha256(requestJson);
    const attachments = task.attachments.filter(item => record(item) && item.sha256 === requestSha256);
    if (attachments.length !== 1 || !record(attachments[0]) || attachments[0].read_state !== 'present'
      || attachments[0].size !== Buffer.byteLength(requestJson)) reject();
    if (!record(task.observability) || !record(task.observability.lifecycle)) reject();
    const life = task.observability.lifecycle;
    if (life.last_status !== 'completed' || !timestamp(task.created_at) || !timestamp(task.updated_at)
      || !timestamp(life.running_at) || !timestamp(life.completed_at)
      || Date.parse(task.created_at) > Date.parse(life.running_at)
      || Date.parse(life.running_at) > Date.parse(life.completed_at)
      || Date.parse(life.completed_at) > Date.parse(task.updated_at)) reject();
    const identity = validatorNodePath !== undefined ? await readAdaptiveStageWitness(read, task, observed, requestSha256, validatorNodePath, signal, usesWorktree)
      : { agentId: task.agent as string, modelId: task.direct_runtime_model_id as string };
    if (!identity) reject();
    if (adaptive) {
      const final = await reader.readCandidate(candidate.taskId, signal);
      if (final.lifecycleRevision !== observed.lifecycleRevision || final.raw !== observed.raw) reject();
    }
    return { requestSha256, artifactSha256: observed.artifactSha256, taskId: observed.taskId,
      ...identity, startedAt: life.running_at, completedAt: life.completed_at };
  };
}
