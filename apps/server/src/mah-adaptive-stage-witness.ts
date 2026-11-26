import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { sha256 } from "./mah-generation-contract.js";
import type { MahBusinessArtifactCandidate, MahPublicRead } from "./mah-business-public-result.js";

type Row = Record<string, unknown>;
const row = (value: unknown): value is Row => !!value && typeof value === "object" && !Array.isArray(value);
const rows = (value: unknown): Row[] => Array.isArray(value) && value.every(row) ? value : [];
const present = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const time = (value: unknown) => typeof value === "string" ? Date.parse(value) : NaN;

export async function readAdaptiveProductionClock(
  read: MahPublicRead, task: Row, projectRoot: string, signal?: AbortSignal
): Promise<{ attemptId: string; startedAt: number; endedAt?: number } | undefined> {
  const taskId = task.task_id;
  if (!present(taskId) || !present(task.trace_id) || !present(task.active_request_id)
    || !Number.isSafeInteger(task.task_lifecycle_revision)) return;
  const observedAt = Date.now();
  const response = await read(["task", "replay", taskId, "--cwd", projectRoot, "--format", "json"], signal);
  if (response.code !== 0 || Buffer.byteLength(response.stdout) > 32 * 1024 * 1024) return;
  let replay: unknown;
  try { replay = JSON.parse(response.stdout); } catch { return; }
  if (!row(replay) || !row(replay.metadata) || !row(replay.project_identity)
    || !row(replay.orchestration) || !row(replay.orchestration.task_state)) return;
  const { metadata, project_identity: identity, orchestration } = replay;
  const state = orchestration.task_state as Row;
  if (identity.canonical_root !== projectRoot || identity.requested_root !== projectRoot
    || metadata.root_dir !== projectRoot || metadata.task_id !== taskId || metadata.trace_id !== task.trace_id
    || metadata.active_request_id !== task.active_request_id || metadata.status !== "running"
    || metadata.task_lifecycle_revision !== task.task_lifecycle_revision || metadata.orchestration_topology !== "adaptive"
    || orchestration.schema_version !== 2 || orchestration.topology !== "adaptive" || orchestration.task_id !== taskId
    || state.schema_version !== 1 || state.task_id !== taskId || state.lifecycle_state !== "active"
    || !Number.isSafeInteger(state.activation_epoch)) return;
  const revisions = rows(state.subtask_revisions);
  const syntheses = revisions.filter(revision => row(revision.intent_frame)
    && revision.intent_frame.operation === "synthesize");
  if (syntheses.length !== 1 || syntheses[0]!.activation_epoch !== state.activation_epoch
    || !present(syntheses[0]!.revision_id)) return;
  const attempts = rows(state.attempts).filter(attempt => attempt.revision_id === syntheses[0]!.revision_id);
  if (attempts.length !== 1) return;
  const attempt = attempts[0]!;
  if (!present(attempt.attempt_id) || !present(attempt.executor_agent_id) || !present(attempt.resolved_model_id)
    || !present(attempt.executor_model_family_id) || !row(attempt.model_routing)
    || !row(attempt.model_routing.selected)
    || attempt.model_routing.selected.agent_id !== attempt.executor_agent_id
    || attempt.model_routing.selected.model_family_id !== attempt.executor_model_family_id
    || (attempt.model_routing.selected.model_id !== undefined && attempt.model_routing.selected.model_id !== attempt.resolved_model_id)
    || attempt.route_wait != null
    || (attempt.route_history !== undefined && (!Array.isArray(attempt.route_history) || attempt.route_history.length > 0))) return;
  const startedAt = time(attempt.started_at);
  const lifecycle = row(task.observability) ? task.observability.lifecycle : undefined;
  if (!row(lifecycle) || !(time(lifecycle.running_at) <= startedAt && startedAt <= observedAt)) return;
  if (attempt.status === "running" && attempt.ended_at == null) return { attemptId: attempt.attempt_id, startedAt };
  const endedAt = time(attempt.ended_at);
  if (attempt.status === "completed" && startedAt <= endedAt && endedAt <= Date.now()) return { attemptId: attempt.attempt_id, startedAt, endedAt };
}

export async function readAdaptiveStageWitness(
  read: MahPublicRead, task: Row, candidate: MahBusinessArtifactCandidate, requestSha256: string, node: string, signal?: AbortSignal, usesWorktree = false
): Promise<{ agentId: string; modelId: string; execution: { attemptId: string; startedAt: string; completedAt: string; runtimeMs?: number } } | undefined> {
  const { taskId, projectRoot, artifactSha256, lifecycleRevision } = candidate;
  const result = await read(["task", "replay", taskId, "--cwd", projectRoot, "--format", "json"], signal);
  if (result.code !== 0 || Buffer.byteLength(result.stdout) > 32 * 1024 * 1024) return;
  const replay: unknown = JSON.parse(result.stdout);
  if (!row(replay) || !row(replay.metadata) || !row(replay.project_identity)
    || !row(replay.orchestration) || !row(replay.orchestration.task_state)) return;
  const { metadata, project_identity: identity } = replay;
  const state = replay.orchestration.task_state;
  if (replay.orchestration.schema_version !== 2 || replay.orchestration.topology !== "adaptive"
    || replay.orchestration.task_id !== taskId || typeof state.activation_epoch !== "number") return;
  if (metadata.status !== "completed" || metadata.orchestration_topology !== "adaptive"
    || metadata.task_id !== taskId || metadata.root_dir !== projectRoot || identity.canonical_root !== projectRoot
    || identity.requested_root !== projectRoot || metadata.task_lifecycle_revision !== lifecycleRevision
    || !present(task.last_request_id) || metadata.last_request_id !== task.last_request_id
    || !present(task.trace_id) || metadata.trace_id !== task.trace_id
    || !row(metadata.observability) || !row(task.observability)
    || !isDeepStrictEqual(metadata.observability.lifecycle, task.observability.lifecycle)
    || state.schema_version !== 1 || state.task_id !== taskId || state.lifecycle_state !== "closed"
    || !row(state.close_decision) || state.close_decision.outcome !== "task_accepted") return;

  const assets = new URL("../lib/mah-stage-validation/", import.meta.url);
  const schemaName = "landi-mah-stage-result.v2.schema.json";
  const validatorName = "landi-validate-stage-result.cjs.txt";
  const [schema, validator] = await Promise.all([
    readFile(new URL(schemaName, assets), "utf8"),
    readFile(new URL(validatorName, assets), "utf8"),
  ]);
  const schemaSha256 = sha256(schema);
  const validatorSha256 = sha256(validator);
  for (const [name, body, digest] of [[schemaName, schema, schemaSha256], [validatorName, validator, validatorSha256]] as const) {
    const matches = rows(task.attachments).filter(item => item.origin_name === name);
    if (matches.length !== 1 || matches[0]!.sha256 !== digest || matches[0]!.size !== Buffer.byteLength(body)
      || matches[0]!.read_state !== "present") return;
  }

  const invocation = adaptiveValidatorInvocation(projectRoot, taskId, node, schemaSha256, requestSha256, validatorSha256);
  const worktreeInvocation = adaptiveValidatorInvocation(projectRoot, taskId, node, schemaSha256, requestSha256, validatorSha256, "worktree");
  if (!invocation || !worktreeInvocation) return;

  const artifactRef = `task-artifact:${taskId}:landi-stage-result.json`;
  const nativeEvidence = (outcome: Row, ref: string) => {
    const entries = rows(outcome.verification_evidence).filter(evidence => evidence.evidence_ref === ref);
    return entries.length === 1 && entries[0]!.verdict === "passed" && entries[0]!.freshness === "current";
  };
  const revisions = rows(state.subtask_revisions);
  const attempts = rows(state.attempts);
  const outcomes = rows(state.effective_subtask_outcomes);
  const messages = Array.isArray(replay.streamMessages) ? replay.streamMessages.filter(row) : [];
  const accepted = outcomes.filter(outcome => outcome.outcome === "accepted" && outcome.native_contract_verdict === "passed");

  function toolPairs(attempt: Row, subtaskId: unknown) {
    // Resume may replace the root request ID. Bind events to the Attempt's request.
    const refs = row(attempt.model_routing) ? attempt.model_routing.observability_refs : undefined;
    const requestRefs = Array.isArray(refs) ? refs.filter(ref => typeof ref === "string" && ref.startsWith("task-request:")) : [];
    if (requestRefs.length !== 1 || !/^task-request:[0-9a-f-]{36}$/.test(requestRefs[0])) return [];
    const requestId = requestRefs[0].slice("task-request:".length);
    const scope = messages.filter(event => event.protocol === "mah/1" && event.message_type === "task_event"
      && event.attempt_id === attempt.attempt_id && event.revision_id === attempt.revision_id
      && event.subtask_id === subtaskId && event.agent_id === attempt.executor_agent_id
      && event.tool_name === "command_execution" && present(event.tool_call_id)
      && event.request_id === requestId && event.trace_id === task.trace_id);
    return scope.flatMap(start => {
      if (start.event_type !== "tool_call_started" || !present(start.delta)) return [];
      const starts = scope.filter(event => event.event_type === "tool_call_started" && event.tool_call_id === start.tool_call_id);
      const ends = scope.filter(event => event.event_type === "tool_call_completed" && event.tool_call_id === start.tool_call_id);
      if (starts.length !== 1 || ends.length !== 1) return [];
      const end = ends[0]!;
      if (!row(start.meta) || !row(end.meta) || !(time(attempt.started_at) <= time(start.meta.timestamp))
        || !(time(start.meta.timestamp) <= time(end.meta.timestamp)) || !(time(end.meta.timestamp) <= time(attempt.ended_at))
        || !present(end.delta) || !present(end.tool_evidence_ref) || start.tool_evidence_ref !== end.tool_evidence_ref
        || typeof start.sequence !== "number" || typeof end.sequence !== "number" || end.sequence <= start.sequence
        || !end.tool_evidence_ref.startsWith(`.mah/tasks/${taskId}/execution-evidence/tool-calls/${attempt.attempt_id}-`)) return [];
      return [{ start, end, output: end.delta, command: start.delta, evidencePath: `${projectRoot}/${end.tool_evidence_ref}`, requestId }];
    });
  }

  function orderedWorktreeToolPairs(attempt: Row, subtaskId: unknown, commands: readonly string[]): ReturnType<typeof toolPairs> | undefined {
    const native = messages.filter(event => event.attempt_id === attempt.attempt_id && event.tool_name === "command_execution"
      && ["tool_call_started", "tool_call_completed"].includes(String(event.event_type)));
    if (!native.length) return [];
    const refs = row(attempt.model_routing) ? attempt.model_routing.observability_refs : undefined;
    const requests = Array.isArray(refs) ? refs.filter(ref => typeof ref === "string" && ref.startsWith("task-request:")) : [];
    if (requests.length !== 1 || !/^task-request:[0-9a-f-]{36}$/.test(requests[0])) return;
    const requestId = requests[0].slice("task-request:".length);
    const sequences = new Set<number>();
    const calls = new Map<string, Row[]>();
    for (const event of native) {
      if (event.protocol !== "mah/1" || event.message_type !== "task_event" || event.request_id !== requestId
        || event.trace_id !== task.trace_id || event.revision_id !== attempt.revision_id
        || event.subtask_id !== subtaskId || event.agent_id !== attempt.executor_agent_id || !present(event.tool_call_id)
        || !Number.isSafeInteger(event.sequence) || Number(event.sequence) < 0 || sequences.has(Number(event.sequence))) return;
      sequences.add(Number(event.sequence));
      calls.set(event.tool_call_id, [...(calls.get(event.tool_call_id) ?? []), event]);
    }
    const pairs: ReturnType<typeof toolPairs> = [];
    for (const events of calls.values()) {
      const starts = events.filter(event => event.event_type === "tool_call_started");
      const ends = events.filter(event => event.event_type === "tool_call_completed");
      if (starts.length !== 1 || ends.length !== 1) return;
      const start = starts[0]!, end = ends[0]!;
      if (!present(start.delta) || typeof end.delta !== "string" || !row(start.meta) || !row(end.meta)
        || !(time(attempt.started_at) <= time(start.meta.timestamp))
        || !(time(start.meta.timestamp) <= time(end.meta.timestamp)) || !(time(end.meta.timestamp) <= time(attempt.ended_at))
        || Number(start.sequence) >= Number(end.sequence) || !present(end.tool_evidence_ref)
        || start.tool_evidence_ref !== end.tool_evidence_ref
        || !end.tool_evidence_ref.startsWith(`.mah/tasks/${taskId}/execution-evidence/tool-calls/${attempt.attempt_id}-`)) return;
      if (commands.includes(start.delta)) {
        if (!Number.isSafeInteger(end.tool_exit_code)) return;
        pairs.push({ start, end, command: start.delta, output: end.delta,
          evidencePath: `${projectRoot}/${end.tool_evidence_ref}`, requestId });
      }
    }
    pairs.sort((left, right) => Number(left.start.sequence) - Number(right.start.sequence));
    for (let index = 1; index < pairs.length; index++) {
      const previous = pairs[index - 1]!, next = pairs[index]!;
      if (Number(previous.end.sequence) >= Number(next.start.sequence)
        || !row(previous.end.meta) || !row(next.start.meta)
        || time(previous.end.meta.timestamp) > time(next.start.meta.timestamp)) return;
    }
    return pairs;
  }

  const findWitness = (operation: "synthesize" | "verify", earliestStart?: number) => {
    const matches = [];
    for (const outcome of accepted) {
      const matchingRevisions = revisions.filter(item => item.revision_id === outcome.revision_id);
      const matchingAttempts = attempts.filter(item => item.attempt_id === outcome.attempt_id);
      if (matchingRevisions.length !== 1 || matchingAttempts.length !== 1) continue;
      const revision = matchingRevisions[0]!;
      const attempt = matchingAttempts[0]!;
      if (revision.activation_epoch !== state.activation_epoch || typeof revision.revision_index !== "number"
        || revisions.some(other => other.subtask_id === revision.subtask_id && other.activation_epoch === state.activation_epoch
          && other.revision_id !== revision.revision_id && (typeof other.revision_index !== "number"
            || other.revision_index >= (revision.revision_index as number)))
        || !row(revision.intent_frame) || revision.intent_frame.operation !== operation
        || attempt.revision_id !== outcome.revision_id || attempt.status !== "completed" || !present(attempt.attempt_id)
        || !present(attempt.executor_agent_id) || !present(attempt.resolved_model_id)
        || !row(attempt.model_routing) || !row(attempt.model_routing.selected)
        || attempt.model_routing.selected.agent_id !== attempt.executor_agent_id
        || !present(attempt.executor_model_family_id)
        || attempt.model_routing.selected.model_family_id !== attempt.executor_model_family_id
        || (attempt.route_history !== undefined && (!Array.isArray(attempt.route_history) || attempt.route_history.length !== 0))
        || !nativeEvidence(outcome, artifactRef)) continue;
      const evidenceOutcomes = [outcome];
      // Invalid current native events are not an absence of current validators.
      // Only a complete scope with no canonical calls may adopt earlier evidence.
      const inspectingCurrentVerification = usesWorktree && operation === "verify";
      const currentVerificationPairs = inspectingCurrentVerification
        ? orderedWorktreeToolPairs(attempt, revision.subtask_id, invocation.eventCommands) : [];
      if (currentVerificationPairs === undefined) continue;
      const currentWorktreeVerification = inspectingCurrentVerification && currentVerificationPairs.length > 0;
      if (operation === "verify" && !currentWorktreeVerification && Array.isArray(outcome.evidence_refs)) {
        // An accepted verification revision may explicitly adopt the successful
        // validator evidence of an earlier revision of the same verification step.
        const earlier = new Set<unknown>();
        let previous = revision.revises_revision_id;
        while (present(previous) && !earlier.has(previous)) {
          const parents = revisions.filter(item => item.revision_id === previous);
          if (parents.length !== 1 || parents[0]!.subtask_id !== revision.subtask_id
            || parents[0]!.activation_epoch !== state.activation_epoch) break;
          earlier.add(previous);
          previous = parents[0]!.revises_revision_id;
        }
        const citedRefs = outcome.evidence_refs;
        evidenceOutcomes.push(...outcomes.filter(prior => earlier.has(prior.revision_id)
          && (prior.outcome === "accepted" || prior.outcome === "repair_required")
          && prior.native_contract_verdict === "passed" && nativeEvidence(prior, artifactRef)
          && citedRefs.includes(`subtask-attempt:${prior.attempt_id}`)));
      }
      let proved = false;
      for (const evidenceOutcome of evidenceOutcomes) {
        const evidenceAttempts = attempts.filter(item => item.attempt_id === evidenceOutcome.attempt_id);
        if (evidenceAttempts.length !== 1) continue;
        const proof = evidenceAttempts[0]!;
        if (proof.status !== "completed" || proof.revision_id !== evidenceOutcome.revision_id
          || !present(proof.attempt_id) || !present(proof.executor_agent_id) || !present(proof.resolved_model_id)
          || !row(proof.model_routing) || !row(proof.model_routing.selected)
          || proof.model_routing.selected.agent_id !== proof.executor_agent_id
          || proof.model_routing.selected.model_family_id !== proof.executor_model_family_id
          || (proof.route_history !== undefined && (!Array.isArray(proof.route_history) || proof.route_history.length !== 0))
          || (earliestStart !== undefined && !(earliestStart <= time(proof.started_at)))
          || !(time(proof.ended_at) <= time(attempt.ended_at))) continue;
        const validator = operation === "synthesize" && usesWorktree ? worktreeInvocation : invocation;
        const worktreeProduction = operation === "synthesize" && usesWorktree;
        const orderedWorktree = worktreeProduction || currentWorktreeVerification;
        const pairs = currentWorktreeVerification ? currentVerificationPairs : worktreeProduction
          ? orderedWorktreeToolPairs(proof, revision.subtask_id, validator.eventCommands)
          : toolPairs(proof, revision.subtask_id).filter(pair => validator.eventCommands.includes(pair.command));
        if (!pairs?.length || (!orderedWorktree && pairs.length !== 1)) continue;
        const required = currentWorktreeVerification ? pairs : [pairs[pairs.length - 1]!];
        if (required.every(({ end, evidencePath, output: rawOutput }) => {
          if (end.tool_exit_code !== 0 || !rows(evidenceOutcome.verification_evidence).some(evidence => {
            const ref = evidence.evidence_ref;
            return typeof ref === "string" && /^sha256:[0-9a-f]{64}:file:/.test(ref)
              && ref.slice(77) === evidencePath && nativeEvidence(evidenceOutcome, ref);
          })) return false;
          let output: unknown;
          try { output = JSON.parse(rawOutput); } catch { return false; }
          return isDeepStrictEqual(output, { valid: true, schemaSha256, requestSha256, artifactSha256 });
        })) proved = true;
      }
      if (proved) matches.push(attempt);
    }
    return matches.length === 1 ? matches[0] : undefined;
  };
  const synthesisRevisions = revisions.filter(revision => row(revision.intent_frame) && revision.intent_frame.operation === "synthesize");
  const productionAttempts = attempts.filter(attempt => synthesisRevisions.some(revision => revision.revision_id === attempt.revision_id));
  if (productionAttempts.length !== 1 && (usesWorktree || productionAttempts.length !== 2)) return;
  const acceptedProduction = findWitness("synthesize");
  const verifier = acceptedProduction ? findWitness("verify", time(acceptedProduction.ended_at)) : undefined;
  if (!acceptedProduction || !productionAttempts.includes(acceptedProduction) || !verifier
    || acceptedProduction.attempt_id === verifier.attempt_id
    || !(time(acceptedProduction.started_at) <= time(acceptedProduction.ended_at))
    || !(time(acceptedProduction.ended_at) <= time(verifier.started_at))
    || !(time(verifier.ended_at) <= time(state.close_decision.decided_at))
    || !Array.isArray(state.close_decision.evidence_refs)
    || !state.close_decision.evidence_refs.includes(`subtask-attempt:${verifier.attempt_id}`)) return;
  const provenance: unknown = JSON.parse(candidate.raw).provenance;
  if (!row(provenance)) return;
  const origin = productionAttempts.find(attempt => attempt !== acceptedProduction);
  const producer = origin ?? acceptedProduction;
  let runtimeMs: number | undefined;
  if (origin) {
    // Legacy publication repair may validate already-written bytes in a second
    // Attempt. Preserve the original writer and charge both active intervals.
    const originRevision = synthesisRevisions.find(revision => revision.revision_id === origin.revision_id);
    const acceptedRevision = synthesisRevisions.find(revision => revision.revision_id === acceptedProduction.revision_id);
    const verifierRevision = revisions.find(revision => revision.revision_id === verifier.revision_id);
    const prior = outcomes.filter(outcome => outcome.attempt_id === origin.attempt_id && outcome.revision_id === origin.revision_id);
    const production = accepted.find(outcome => outcome.attempt_id === acceptedProduction.attempt_id);
    const verification = accepted.find(outcome => outcome.attempt_id === verifier.attempt_id);
    const originRef = `subtask-attempt:${origin.attempt_id}`;
    if (synthesisRevisions.length !== 2 || !originRevision || !acceptedRevision || !verifierRevision
      || originRevision.subtask_id !== acceptedRevision.subtask_id || originRevision.activation_epoch !== state.activation_epoch
      || acceptedRevision.revises_revision_id !== originRevision.revision_id || !present(origin.attempt_id)
      || !Array.isArray(verifierRevision.depends_on_revision_ids) || !verifierRevision.depends_on_revision_ids.includes(acceptedRevision.revision_id)
      || origin.status !== "completed" || !(time(origin.started_at) <= time(origin.ended_at))
      || !(time(origin.ended_at) <= time(acceptedProduction.started_at))
      || !present(origin.executor_agent_id) || !present(origin.resolved_model_id) || !present(origin.executor_model_family_id)
      || !row(origin.model_routing) || !row(origin.model_routing.selected)
      || origin.model_routing.selected.agent_id !== origin.executor_agent_id
      || origin.model_routing.selected.model_family_id !== origin.executor_model_family_id
      || (origin.model_routing.selected.model_id !== undefined && origin.model_routing.selected.model_id !== origin.resolved_model_id)
      || (origin.route_history !== undefined && (!Array.isArray(origin.route_history) || origin.route_history.length !== 0))
      || prior.length !== 1 || prior[0]!.outcome !== "repair_required" || prior[0]!.native_contract_verdict !== "passed"
      || !Array.isArray(production?.evidence_refs) || !production.evidence_refs.includes(originRef)
      || !Array.isArray(verification?.evidence_refs) || !verification.evidence_refs.includes(originRef)
      || !verification.evidence_refs.includes(`subtask-attempt:${acceptedProduction.attempt_id}`)
      || !state.close_decision.evidence_refs.includes(`subtask-attempt:${acceptedProduction.attempt_id}`)) return;
    const pairs = toolPairs(origin, originRevision.subtask_id);
    const publishedPath = `${projectRoot}/.mah/tasks/${taskId}/artifacts/landi-stage-result.json`;
    const missing = pairs.filter(pair => invocation.eventCommands.includes(pair.command)
      && pair.end.tool_exit_code === 1 && pair.end.delta === `ENOENT: no such file or directory, stat '${publishedPath}'`);
    if (missing.length !== 1) return;
    const failed = missing[0]!;
    const failedRefs = rows(prior[0]!.verification_evidence).filter(evidence =>
      typeof evidence.evidence_ref === "string" && /^sha256:[0-9a-f]{64}:file:/.test(evidence.evidence_ref)
      && evidence.evidence_ref.slice(77) === failed.evidencePath && evidence.verdict === "failed" && evidence.freshness === "current");
    if (failedRefs.length !== 1 || !production.evidence_refs.includes(failedRefs[0]!.evidence_ref)) return;
    const locator = (failedRefs[0]!.evidence_ref as string).slice(0, 71);
    if (!messages.some(event => event.protocol === "mah/1" && event.message_type === "task_event"
      && event.event_type === "artifact_ready" && event.trace_id === task.trace_id && event.request_id === failed.requestId
      && event.attempt_id === origin.attempt_id && event.revision_id === origin.revision_id && event.subtask_id === originRevision.subtask_id
      && event.agent_id === origin.executor_agent_id && row(event.artifact_ref)
      && event.artifact_ref.path === failed.evidencePath && event.artifact_ref.locator === locator)) return;
    const writes = pairs.filter(pair => pair.end.tool_exit_code === 0 && pair.evidencePath === failed.evidencePath
      && (pair.end.sequence as number) < (failed.start.sequence as number) && row(pair.start.meta)
      && time(provenance.completedAt) <= time(pair.start.meta.timestamp) && isWorktreeWrite(pair.end.delta, taskId, candidate, provenance));
    if (writes.length !== 1) return;
    runtimeMs = time(origin.ended_at) - time(origin.started_at)
      + time(acceptedProduction.ended_at) - time(acceptedProduction.started_at);
  }
  const lifecycle = task.observability.lifecycle;
  if (!row(lifecycle) || !(time(lifecycle.running_at) <= time(producer.started_at))
    || !(time(state.close_decision.decided_at) <= time(lifecycle.completed_at))) return;
  if (provenance.agentId !== producer.executor_agent_id || provenance.modelId !== producer.resolved_model_id
    || !(time(producer.started_at) <= time(provenance.startedAt))
    || !(time(provenance.startedAt) <= time(provenance.completedAt))
    || !(time(provenance.completedAt) <= time(producer.ended_at))) return;
  return {
    agentId: producer.executor_agent_id as string,
    modelId: producer.resolved_model_id as string,
    execution: {
      attemptId: producer.attempt_id as string,
      startedAt: producer.started_at as string,
      completedAt: producer.ended_at as string,
      ...(runtimeMs === undefined ? {} : { runtimeMs }),
    },
  };
}

function isWorktreeWrite(delta: unknown, taskId: string, candidate: MahBusinessArtifactCandidate, provenance: Row): boolean {
  if (typeof delta !== "string") return false;
  let output: unknown;
  try { output = JSON.parse(delta); } catch { return false; }
  if (!row(output) || !present(output.path) || !output.path.startsWith("/")) return false;
  const marker = `/.mah/runtime/worktrees/mah-wt-${taskId}-`;
  const offset = output.path.indexOf(marker);
  if (offset < 0) return false;
  const path = output.path.slice(offset + marker.length);
  const suffix = `/repo/.mah/tasks/${taskId}/artifacts/landi-stage-result.json`;
  return path.endsWith(suffix) && /^[A-Za-z0-9_-]+$/.test(path.slice(0, -suffix.length))
    && output.bytes === Buffer.byteLength(candidate.raw) && output.sha256 === candidate.artifactSha256
    && isDeepStrictEqual(output.provenance, provenance);
}

/** Build the exact safe shell invocation that MAH's command event must attest. */
export function adaptiveValidatorInvocation(
  projectRoot: string, taskId: string, node: string, schemaSha256: string, requestSha256: string, validatorSha256: string,
  artifactLocation: "published" | "worktree" = "published",
): { command: string; eventCommands: string[] } | undefined {
  const root = `${projectRoot}/.mah/tasks/${taskId}`;
  if (!node.startsWith("/") || /['"\\$`\r\n]/.test(root) || /['"\\$`\r\n]/.test(node)) return;
  const artifact = artifactLocation === "worktree"
    ? `./.mah/tasks/${taskId}/artifacts/landi-stage-result.json`
    : `${root}/artifacts/landi-stage-result.json`;
  const command = `/bin/zsh -lc '${node} --input-type=commonjs - "${root}/context/attachments/${schemaSha256}" "${root}/context/attachments/${requestSha256}" "${artifact}" < "${root}/context/attachments/${validatorSha256}"'`;
  const shellCommand = `'${node}' --input-type=commonjs - '${root}/context/attachments/${schemaSha256}' '${root}/context/attachments/${requestSha256}' '${artifact}' < '${root}/context/attachments/${validatorSha256}'`;
  const eventCommands = [`/bin/zsh -lc "${shellCommand}"`];
  if (/^[a-zA-Z0-9_./@-]+$/.test(node)) eventCommands.push(command);
  return { command: shellCommand, eventCommands };
}
