import assert from 'node:assert/strict';
/** Fictional public reports for offline protocol mechanics, never execution authorization. */
export function fictionalMahSetup(args: string[]) {
  assert.deepEqual(args, ['setup', 'status', '--format', 'json']);
  return { schema_version: 1, projection_kind: 'setup_readiness', overall_status: 'ready', git: { state: 'ready' }, dependencies: [
    { dependency_id: 'codex', category: 'agent_cli', probe_status: 'ready', authentication_status: 'authenticated' }
  ] };
}
export function fictionalMahCapabilities(args: string[], projectRoot: string) {
  assert.deepEqual(args, ['capabilities', '--agent', 'codex', '--project-root', projectRoot, '--format', 'json']);
  return { protocol: 'mah/1', message_type: 'capability_report', agent: { agent_id: 'codex' }, constraints: { availability: 'available' }, capabilities: { models: [
    { model_id: 'fictional-model', enabled_state: 'configured_enabled', runtime_profile: 'codex-cli', capabilities: { output_channel: ['native_schema_constrained_generation'] } }
  ] } };
}
