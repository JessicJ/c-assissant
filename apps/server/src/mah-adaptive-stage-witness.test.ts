import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { adaptiveValidatorInvocation, readAdaptiveStageWitness } from "./mah-adaptive-stage-witness.js";
import { sha256 } from "./mah-generation-contract.js";

async function fixture() {
  const taskId = "00000000-0000-4000-8000-000000000001";
  const requestId = "00000000-0000-4000-8000-000000000002";
  const projectRoot = "/tmp/Synthetic Landi";
  const node = "/fixture/Node A/bin/node";
  const requestSha256 = "b".repeat(64);
  const traceId = "synthetic-trace";
  const at = (second: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, second)).toISOString();
  const raw = JSON.stringify({ provenance: { agentId: "producer", modelId: "model", startedAt: at(2), completedAt: at(4) } });
  const artifactSha256 = sha256(raw);
  const assets = new URL("../lib/mah-stage-validation/", import.meta.url);
  const attachments = await Promise.all(["landi-mah-stage-result.v2.schema.json", "landi-validate-stage-result.cjs.txt"].map(async origin_name => {
    const body = await readFile(new URL(origin_name, assets), "utf8");
    return { origin_name, sha256: sha256(body), size: Buffer.byteLength(body), read_state: "present" };
  }));
  const schemaSha256 = attachments[0]!.sha256;
  const invocation = adaptiveValidatorInvocation(projectRoot, taskId, node, schemaSha256, requestSha256, attachments[1]!.sha256)!;
  assert.ok(invocation.command.startsWith("'/fixture/Node A/bin/node' "));
  const command = invocation.eventCommands[0]!;
  const worktree = adaptiveValidatorInvocation(projectRoot, taskId, node, schemaSha256, requestSha256, attachments[1]!.sha256, "worktree")!;
  assert.ok(worktree.command.includes(`'./.mah/tasks/${taskId}/artifacts/landi-stage-result.json'`));
  assert.ok(invocation.command.includes(`'${projectRoot}/.mah/tasks/${taskId}/artifacts/landi-stage-result.json'`));
  const task = {
    task_id: taskId, root_dir: projectRoot, trace_id: traceId, last_request_id: requestId, attachments,
    status: "completed", orchestration_topology: "adaptive", task_lifecycle_revision: 7,
    observability: { lifecycle: { running_at: at(0), completed_at: at(12) } },
  };
  const artifactRef = `task-artifact:${taskId}:landi-stage-result.json`;
  const steps = ["synthesize", "verify"].map((operation, index) => {
    const agent = index === 0 ? "producer" : "verifier";
    const start = index === 0 ? 1 : 6;
    const attemptId = `attempt-${index}`;
    const revisionId = `revision-${index}`;
    const subtaskId = `subtask-${index}`;
    const toolRef = `.mah/tasks/${taskId}/execution-evidence/tool-calls/${attemptId}-tool.json`;
    const common = {
      protocol: "mah/1", message_type: "task_event", tool_name: "command_execution", request_id: requestId, trace_id: traceId,
      tool_call_id: `tool-${index}`, tool_evidence_ref: toolRef, attempt_id: attemptId, revision_id: revisionId,
      subtask_id: subtaskId, agent_id: agent,
    };
    return {
      revision: { revision_id: revisionId, subtask_id: subtaskId, activation_epoch: 1, revision_index: 1, intent_frame: { operation } },
      attempt: { attempt_id: attemptId, revision_id: revisionId, status: "completed", started_at: at(start), ended_at: at(start + 4),
        executor_agent_id: agent, resolved_model_id: "model", executor_model_family_id: "family",
        model_routing: { selected: { agent_id: agent, model_family_id: "family" }, observability_refs: [`task-request:${requestId}`] } },
      outcome: { attempt_id: attemptId, revision_id: revisionId, outcome: "accepted", native_contract_verdict: "passed",
        verification_evidence: [artifactRef, `sha256:${"c".repeat(64)}:file:${projectRoot}/${toolRef}`]
          .map(evidence_ref => ({ evidence_ref, verdict: "passed", freshness: "current" })) },
      events: [
        { ...common, sequence: start, event_type: "tool_call_started", meta: { timestamp: at(start + 1) }, delta: command },
        { ...common, sequence: start + 1, event_type: "tool_call_completed", meta: { timestamp: at(start + 2) }, tool_exit_code: 0,
          delta: JSON.stringify({ valid: true, schemaSha256, requestSha256, artifactSha256 }) },
      ],
    };
  });
  const replay = {
    project_identity: { canonical_root: projectRoot, requested_root: projectRoot }, metadata: task,
    orchestration: { schema_version: 2, task_id: taskId, topology: "adaptive", task_state: {
      schema_version: 1, task_id: taskId, activation_epoch: 1, lifecycle_state: "closed",
      close_decision: { outcome: "task_accepted", decided_at: at(11), evidence_refs: ["subtask-attempt:attempt-1"] },
      subtask_revisions: steps.map(step => step.revision), attempts: steps.map(step => step.attempt),
      effective_subtask_outcomes: steps.map(step => step.outcome),
    } },
    streamMessages: steps.flatMap(step => step.events),
  };
  const candidate = { taskId, projectRoot, raw, artifactSha256, lifecycleRevision: 7, verified: false as const };
  const read = async () => ({ code: 0, stdout: JSON.stringify(replay), stderr: "" });
  return { task, candidate, read, requestSha256, node, replay, worktree, command, at, schemaSha256, artifactSha256, projectRoot };
}

test("Adaptive 回执绑定冻结的 Node 路径、原生生产和验收证据", async () => {
  const { task, candidate, read, requestSha256, node, replay, worktree, command, at, schemaSha256, artifactSha256 } = await fixture();
  assert.deepEqual(await readAdaptiveStageWitness(read, task, candidate, requestSha256, node), {
    agentId: "producer", modelId: "model", execution: { attemptId: "attempt-0", startedAt: at(1), completedAt: at(5) },
  });
  assert.equal(await readAdaptiveStageWitness(read, task, candidate, requestSha256, "/fixture/Node B/bin/node"), undefined);
  assert.equal(await readAdaptiveStageWitness(read, task, candidate, requestSha256, node, undefined, true), undefined);
  replay.streamMessages[0]!.delta = worktree.eventCommands[0]!;
  assert.equal((await readAdaptiveStageWitness(read, task, candidate, requestSha256, node, undefined, true))?.execution.attemptId, "attempt-0");
  replay.streamMessages[2]!.delta = worktree.eventCommands[0]!;
  assert.equal(await readAdaptiveStageWitness(read, task, candidate, requestSha256, node, undefined, true), undefined);
  replay.streamMessages[2]!.delta = command;
  replay.streamMessages[1]!.delta = JSON.stringify({ valid: true, schemaSha256, requestSha256, artifactSha256: "d".repeat(64) });
  assert.equal(await readAdaptiveStageWitness(read, task, candidate, requestSha256, node, undefined, true), undefined);
  replay.streamMessages[1]!.delta = JSON.stringify({ valid: true, schemaSha256, requestSha256, artifactSha256 });
  replay.streamMessages.pop();
  assert.equal(await readAdaptiveStageWitness(read, task, candidate, requestSha256, node, undefined, true), undefined);
});

async function repeatedWorktreeFixture() {
  const f = await fixture();
  const production = f.replay.streamMessages.slice(0, 2);
  production[0]!.delta = f.worktree.eventCommands[0]!;
  production[1]!.delta = JSON.stringify({ valid: true, schemaSha256: f.schemaSha256, requestSha256: f.requestSha256, artifactSha256: 'd'.repeat(64) });
  const next: any[] = structuredClone(production);
  for (const event of next) { event.tool_call_id = 'production-final'; event.tool_evidence_ref = production[0]!.tool_evidence_ref; }
  next[0].sequence = 3; next[0].meta.timestamp = f.at(3);
  next[1].sequence = 4; next[1].meta.timestamp = f.at(4);
  next[1].delta = JSON.stringify({ valid: true, schemaSha256: f.schemaSha256, requestSha256: f.requestSha256, artifactSha256: f.artifactSha256 });
  f.replay.streamMessages.splice(2, 0, ...next);
  return f;
}

test('worktree production may revise and validate again inside one ordered Attempt with a shared native evidence file', async () => {
  const f = await repeatedWorktreeFixture();
  const witness = await readAdaptiveStageWitness(f.read, f.task, f.candidate, f.requestSha256, f.node, undefined, true);
  assert.equal(witness?.execution.attemptId, 'attempt-0');
  assert.equal(await readAdaptiveStageWitness(f.read, f.task, f.candidate, f.requestSha256, f.node), undefined);
});

for (const [name, change] of [
  ['missing last completion', (r: any) => { r.streamMessages.splice(3, 1); }],
  ['last validator failure', (r: any) => { r.streamMessages[3].tool_exit_code = 1; }],
  ['late different artifact hash', (r: any) => { const value = JSON.parse(r.streamMessages[3].delta); value.artifactSha256 = 'e'.repeat(64); r.streamMessages[3].delta = JSON.stringify(value); }],
  ['duplicate invocation identity', (r: any) => { r.streamMessages[2].tool_call_id = r.streamMessages[0].tool_call_id; r.streamMessages[3].tool_call_id = r.streamMessages[0].tool_call_id; }],
  ['missing invocation identity', (r: any) => { delete r.streamMessages[2].tool_call_id; }],
  ['duplicate sequence', (r: any) => { r.streamMessages[2].sequence = r.streamMessages[1].sequence; }],
  ['unsafe sequence', (r: any) => { r.streamMessages[2].sequence = Number.MAX_SAFE_INTEGER + 1; }],
  ['overlapping sequence intervals', (r: any) => { r.streamMessages[1].sequence = 4; r.streamMessages[2].sequence = 2; r.streamMessages[3].sequence = 3; }],
  ['overlapping timestamps', (r: any) => { r.streamMessages[2].meta.timestamp = '2026-01-01T00:00:02.000Z'; }],
  ['cross agent', (r: any) => { r.streamMessages[2].agent_id = 'other-agent'; }],
  ['cross trace', (r: any) => { r.streamMessages[2].trace_id = 'other-trace'; }],
  ['cross request', (r: any) => { r.streamMessages[2].request_id = '00000000-0000-4000-8000-000000000099'; }],
  ['cross revision', (r: any) => { r.streamMessages[2].revision_id = 'other-revision'; }],
  ['missing native file evidence', (r: any) => { r.orchestration.task_state.effective_subtask_outcomes[0].verification_evidence.pop(); }],
] as const) test(`worktree repeated validation rejects ${name}`, async () => {
  const f = await repeatedWorktreeFixture();
  change(f.replay);
  assert.equal(await readAdaptiveStageWitness(f.read, f.task, f.candidate, f.requestSha256, f.node, undefined, true), undefined);
});

test('earlier successful validation cannot hide an incomplete later validator call', async () => {
  const f = await repeatedWorktreeFixture();
  f.replay.streamMessages[1]!.delta = f.replay.streamMessages[3]!.delta;
  f.replay.streamMessages.splice(3, 1);
  assert.equal(await readAdaptiveStageWitness(f.read, f.task, f.candidate, f.requestSha256, f.node, undefined, true), undefined);
});

test('well-paired unrelated native commands sharing the evidence file do not hide the final validator', async () => {
  const f = await repeatedWorktreeFixture();
  const unrelated: any[] = structuredClone(f.replay.streamMessages.slice(0, 2));
  for (const event of unrelated) event.tool_call_id = 'unrelated-read';
  unrelated[0].sequence = 3; unrelated[0].meta.timestamp = f.at(3); unrelated[0].delta = 'read a source file';
  unrelated[1].sequence = 4; unrelated[1].meta.timestamp = f.at(3); unrelated[1].delta = '';
  f.replay.streamMessages[2]!.sequence = 5; f.replay.streamMessages[3]!.sequence = 6;
  f.replay.streamMessages[4]!.sequence = 7; f.replay.streamMessages[5]!.sequence = 8;
  f.replay.streamMessages.splice(2, 0, ...unrelated);
  assert.equal((await readAdaptiveStageWitness(f.read, f.task, f.candidate, f.requestSha256, f.node, undefined, true))?.execution.attemptId, 'attempt-0');
});

test('a final validator requires its own accepted native evidence reference', async () => {
  const f = await repeatedWorktreeFixture();
  const ref = `${f.replay.streamMessages[2]!.tool_evidence_ref}-unaccepted.json`;
  f.replay.streamMessages[2]!.tool_evidence_ref = ref; f.replay.streamMessages[3]!.tool_evidence_ref = ref;
  assert.equal(await readAdaptiveStageWitness(f.read, f.task, f.candidate, f.requestSha256, f.node, undefined, true), undefined);
});

test('a failed earlier worktree validation may be corrected before the final accepted validation', async () => {
  const f = await repeatedWorktreeFixture();
  (f.replay.streamMessages[1]! as { tool_exit_code?: number }).tool_exit_code = 1;
  f.replay.streamMessages[1]!.delta = 'validation failed before correction';
  assert.equal((await readAdaptiveStageWitness(f.read, f.task, f.candidate, f.requestSha256, f.node, undefined, true))?.execution.attemptId, 'attempt-0');
});

test('published production retains its single canonical validation rule', async () => {
  const f = await repeatedWorktreeFixture();
  f.replay.streamMessages[0]!.delta = f.command;
  f.replay.streamMessages[2]!.delta = f.command;
  assert.equal(await readAdaptiveStageWitness(f.read, f.task, f.candidate, f.requestSha256, f.node), undefined);
});

test('worktree independent verification accepts repeated identical successful canonical validations', async () => {
  const f = await repeatedWorktreeFixture();
  const extra: any[] = structuredClone(f.replay.streamMessages.slice(-2));
  for (const event of extra) event.tool_call_id = 'verification-extra';
  extra[0].sequence = 8; extra[0].meta.timestamp = f.at(8);
  extra[1].sequence = 9; extra[1].meta.timestamp = f.at(9);
  f.replay.streamMessages.push(...extra);
  assert.equal((await readAdaptiveStageWitness(f.read, f.task, f.candidate, f.requestSha256, f.node, undefined, true))?.execution.attemptId, 'attempt-0');
});

async function multipleVerificationFixture() {
  const f = await fixture();
  f.replay.streamMessages[0]!.delta = f.worktree.eventCommands[0]!;
  const extra: any[] = structuredClone(f.replay.streamMessages.slice(2, 4));
  const ref = `.mah/tasks/${f.task.task_id}/execution-evidence/tool-calls/attempt-1-second-validation.json`;
  for (const event of extra) { event.tool_call_id = 'second-verification'; event.tool_evidence_ref = ref; }
  extra[0].sequence = 8; extra[0].meta.timestamp = f.at(8);
  extra[1].sequence = 9; extra[1].meta.timestamp = f.at(9);
  f.replay.streamMessages.push(...extra);
  f.replay.orchestration.task_state.effective_subtask_outcomes[1]!.verification_evidence.push({
    evidence_ref: `sha256:${'f'.repeat(64)}:file:${f.projectRoot}/${ref}`, verdict: 'passed', freshness: 'current' });
  return f;
}

test('every repeated worktree verification is successful, identical and accepted by the current native outcome', async () => {
  const f = await multipleVerificationFixture();
  assert.equal((await readAdaptiveStageWitness(f.read, f.task, f.candidate, f.requestSha256, f.node, undefined, true))?.execution.attemptId, 'attempt-0');
});

for (const [name, change] of [
  ['first failed', (r: any) => { r.streamMessages[3].tool_exit_code = 1; }],
  ['last failed', (r: any) => { r.streamMessages[5].tool_exit_code = 1; }],
  ['first malformed output', (r: any) => { r.streamMessages[3].delta = 'unverified'; }],
  ['first artifact drift', (r: any) => { const x = JSON.parse(r.streamMessages[3].delta); x.artifactSha256 = 'd'.repeat(64); r.streamMessages[3].delta = JSON.stringify(x); }],
  ['last artifact drift', (r: any) => { const x = JSON.parse(r.streamMessages[5].delta); x.artifactSha256 = 'd'.repeat(64); r.streamMessages[5].delta = JSON.stringify(x); }],
  ['schema drift', (r: any) => { const x = JSON.parse(r.streamMessages[3].delta); x.schemaSha256 = 'd'.repeat(64); r.streamMessages[3].delta = JSON.stringify(x); }],
  ['request drift', (r: any) => { const x = JSON.parse(r.streamMessages[5].delta); x.requestSha256 = 'd'.repeat(64); r.streamMessages[5].delta = JSON.stringify(x); }],
  ['last completion missing', (r: any) => { r.streamMessages.pop(); }],
  ['first completion missing', (r: any) => { r.streamMessages.splice(3, 1); }],
  ['duplicate call identity', (r: any) => { r.streamMessages[4].tool_call_id = r.streamMessages[2].tool_call_id; r.streamMessages[5].tool_call_id = r.streamMessages[2].tool_call_id; }],
  ['unsafe sequence', (r: any) => { r.streamMessages[4].sequence = Number.MAX_SAFE_INTEGER + 1; }],
  ['overlapping sequence intervals', (r: any) => { r.streamMessages[3].sequence = 9; r.streamMessages[5].sequence = 10; }],
  ['overlapping times', (r: any) => { r.streamMessages[4].meta.timestamp = '2026-01-01T00:00:07.000Z'; }],
  ['cross attempt', (r: any) => { r.streamMessages[4].attempt_id = 'other'; }],
  ['cross revision', (r: any) => { r.streamMessages[4].revision_id = 'other'; }],
  ['cross request', (r: any) => { r.streamMessages[4].request_id = 'other'; }],
  ['cross agent', (r: any) => { r.streamMessages[4].agent_id = 'other'; }],
  ['cross trace', (r: any) => { r.streamMessages[4].trace_id = 'other'; }],
  ['unaccepted first native file', (r: any) => { r.orchestration.task_state.effective_subtask_outcomes[1].verification_evidence.splice(1, 1); }],
  ['unaccepted last native file', (r: any) => { r.orchestration.task_state.effective_subtask_outcomes[1].verification_evidence.pop(); }],
  ['stale native file', (r: any) => { r.orchestration.task_state.effective_subtask_outcomes[1].verification_evidence[2].freshness = 'stale'; }],
] as const) test(`repeated worktree verification refuses ${name}`, async () => {
  const f = await multipleVerificationFixture(); change(f.replay);
  assert.equal(await readAdaptiveStageWitness(f.read, f.task, f.candidate, f.requestSha256, f.node, undefined, true), undefined);
});

test('published independent verification keeps its single-call rule', async () => {
  const f = await multipleVerificationFixture();
  f.replay.streamMessages[0]!.delta = f.command;
  assert.equal(await readAdaptiveStageWitness(f.read, f.task, f.candidate, f.requestSha256, f.node), undefined);
});

async function adoptedVerificationFixture() {
  const f = await fixture();
  f.replay.streamMessages[0]!.delta = f.worktree.eventCommands[0]!;
  const state = f.replay.orchestration.task_state as any;
  const oldRevision = state.subtask_revisions[1], oldAttempt = state.attempts[1], oldOutcome = state.effective_subtask_outcomes[1];
  const revision = { ...oldRevision, revision_id: 'revision-adopt', revision_index: 2, revises_revision_id: oldRevision.revision_id };
  const attempt = { ...structuredClone(oldAttempt), attempt_id: 'attempt-adopt', revision_id: revision.revision_id, started_at: f.at(10), ended_at: f.at(11) };
  const outcome = { ...structuredClone(oldOutcome), attempt_id: attempt.attempt_id, revision_id: revision.revision_id,
    evidence_refs: [`subtask-attempt:${oldAttempt.attempt_id}`] };
  oldOutcome.outcome = 'repair_required';
  state.subtask_revisions.push(revision); state.attempts.push(attempt); state.effective_subtask_outcomes.push(outcome);
  state.close_decision.decided_at = f.at(12); state.close_decision.evidence_refs = [`subtask-attempt:${attempt.attempt_id}`];
  f.task.observability.lifecycle.completed_at = f.at(13);
  return { ...f, adopted: { revision, attempt, outcome } };
}

test('worktree verification with no current canonical call retains explicit adoption of the prior verified evidence', async () => {
  const f = await adoptedVerificationFixture();
  assert.equal((await readAdaptiveStageWitness(f.read, f.task, f.candidate, f.requestSha256, f.node, undefined, true))?.execution.attemptId, 'attempt-0');
});

for (const failure of ['exit', 'digest', 'missing_completion'] as const) test(`a current verification conflict cannot fall back to a prior accepted proof: ${failure}`, async () => {
  const f = await adoptedVerificationFixture();
  const events: any[] = structuredClone(f.replay.streamMessages.slice(2, 4));
  const ref = `.mah/tasks/${f.task.task_id}/execution-evidence/tool-calls/attempt-adopt-current-validation.json`;
  for (const event of events) {
    event.attempt_id = f.adopted.attempt.attempt_id; event.revision_id = f.adopted.revision.revision_id;
    event.tool_call_id = 'current-validation'; event.tool_evidence_ref = ref;
  }
  events[0].sequence = 8; events[0].meta.timestamp = f.at(10);
  events[1].sequence = 9; events[1].meta.timestamp = f.at(11);
  f.adopted.outcome.verification_evidence.push({ evidence_ref: `sha256:${'f'.repeat(64)}:file:${f.projectRoot}/${ref}`, verdict: 'passed', freshness: 'current' });
  if (failure === 'exit') events[1].tool_exit_code = 1;
  if (failure === 'digest') { const output = JSON.parse(events[1].delta); output.artifactSha256 = 'e'.repeat(64); events[1].delta = JSON.stringify(output); }
  if (failure === 'missing_completion') events.pop();
  f.replay.streamMessages.push(...events);
  assert.equal(await readAdaptiveStageWitness(f.read, f.task, f.candidate, f.requestSha256, f.node, undefined, true), undefined);
});

for (const failure of ['failed', 'drift', 'matching_output'] as const) test(`an orphan current native completion cannot adopt prior verification: ${failure}`, async () => {
  const f = await adoptedVerificationFixture();
  const event: any = structuredClone(f.replay.streamMessages[3]);
  event.attempt_id = f.adopted.attempt.attempt_id; event.revision_id = f.adopted.revision.revision_id;
  event.tool_call_id = 'orphan-current-validation';
  event.tool_evidence_ref = `.mah/tasks/${f.task.task_id}/execution-evidence/tool-calls/attempt-adopt-orphan.json`;
  event.sequence = 9; event.meta.timestamp = f.at(11);
  if (failure === 'failed') event.tool_exit_code = 1;
  if (failure === 'drift') { const output = JSON.parse(event.delta); output.artifactSha256 = 'e'.repeat(64); event.delta = JSON.stringify(output); }
  f.adopted.outcome.verification_evidence.push({ evidence_ref: `sha256:${'f'.repeat(64)}:file:${f.projectRoot}/${event.tool_evidence_ref}`, verdict: 'passed', freshness: 'current' });
  f.replay.streamMessages.push(event);
  assert.equal(await readAdaptiveStageWitness(f.read, f.task, f.candidate, f.requestSha256, f.node, undefined, true), undefined);
});

test('complete current native commands without a canonical validator keep explicit adoption available', async () => {
  const f = await adoptedVerificationFixture();
  const events: any[] = structuredClone(f.replay.streamMessages.slice(2, 4));
  for (const event of events) {
    event.attempt_id = f.adopted.attempt.attempt_id; event.revision_id = f.adopted.revision.revision_id;
    event.tool_call_id = 'current-read'; event.tool_evidence_ref = `.mah/tasks/${f.task.task_id}/execution-evidence/tool-calls/attempt-adopt-read.json`;
  }
  events[0].sequence = 8; events[0].meta.timestamp = f.at(10); events[0].delta = 'read prior native validation';
  events[1].sequence = 9; events[1].meta.timestamp = f.at(11); events[1].delta = '';
  f.replay.streamMessages.push(...events);
  assert.equal((await readAdaptiveStageWitness(f.read, f.task, f.candidate, f.requestSha256, f.node, undefined, true))?.execution.attemptId, 'attempt-0');
});

test('an adoption revision with no native commands retains the original request-reference semantics', async () => {
  const f = await adoptedVerificationFixture();
  delete (f.adopted.attempt as any).model_routing.observability_refs;
  assert.equal((await readAdaptiveStageWitness(f.read, f.task, f.candidate, f.requestSha256, f.node, undefined, true))?.execution.attemptId, 'attempt-0');
});
