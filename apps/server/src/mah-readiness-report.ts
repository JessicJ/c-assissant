import { assessMahConnection } from "./mah-connection-diagnostic.js";
import { parseMahScheduleList, parseMahScheduleRuns } from './mah-schedule-readback.js';
import { preflightMahSchedule } from './mah-schedule-contract-validation.js';
import { preflightMahService } from './mah-service-contract-validation.js';

/** Caller-supplied snapshots only. No collectors, persistence, or execution permissions. */
export interface MahDiagnosticInputs {
  scheduleList?: { raw: string; projectRoot: string };
  scheduleRuns?: { raw: string; projectRoot: string; scheduleId: string };
  schedulePreflight?: Parameters<typeof preflightMahSchedule>[0];
  servicePreflight?: Parameters<typeof preflightMahService>[0];
}
export interface MahDiagnosticItem {
  id: 'agent_selection' | 'schedule_readback' | 'schedule_runs' | 'schedule_contract' | 'service_contract';
  status: 'not_assessed' | 'invalid' | 'consistent_unverified';
  code: string;
  executable: false;
}
// Never return raw parser errors: JSON errors can contain business text or secrets.
const safeCodes = new Set([
  'invalid_object', 'invalid_fields', 'invalid_string', 'invalid_integer', 'invalid_time',
  'invalid_enum', 'identity_mismatch', 'invalid_timezone', 'readback_too_large',
  'invalid_array', 'duplicate_identity', 'missing_dependencies', 'unknown_trigger',
  'invalid_counts', 'invalid_time_order', 'stale_scope', 'schedule_not_enabled',
  'schedule_outside_validity', 'trigger_outside_validity', 'unsupported_policy',
  'authority_mismatch', 'stale_revision', 'retry_identity_changed', 'run_outside_validity',
  'trigger_identity_mismatch', 'invalid_digest', 'request_digest_mismatch',
  'result_digest_mismatch', 'stale_observation', 'ownership_conflict',
  'projection_digest_mismatch', 'stale_projection', 'invalid_port',
  'invalid_instance_time', 'invalid_transition_time'
]);
function assess<T>(id: MahDiagnosticItem['id'], input: T | undefined, evaluate: (value: T) => string): MahDiagnosticItem {
  if (input === undefined) return { id, status: 'not_assessed', code: 'evidence_not_provided', executable: false };
  try {
    return { id, status: 'consistent_unverified', code: evaluate(input), executable: false };
  } catch (error) {
    const code = error instanceof Error && safeCodes.has(error.message) ? error.message : 'diagnostic_input_invalid';
    return { id, status: 'invalid', code, executable: false };
  }
}
export function buildMahReadinessReport(inputs: MahDiagnosticInputs = {}) {
  const items: MahDiagnosticItem[] = [
    // Local login and advertised candidates cannot establish MAH's actual route.
    { id: 'agent_selection', status: 'not_assessed', code: 'public_agent_selection_unverified', executable: false },
    assess('schedule_readback', inputs.scheduleList, value => {
      const list = parseMahScheduleList(value.raw, value.projectRoot);
      return list.schedules.some(item => item.registrationState === "registered") ? "public_schedule_revision_unavailable" : "no_schedule_registrations";
    }),
    assess('schedule_runs', inputs.scheduleRuns, value => {
      parseMahScheduleRuns(value.raw, value.projectRoot, value.scheduleId);
      return 'public_execution_receipt_unverified';
    }),
    assess('schedule_contract', inputs.schedulePreflight, value => preflightMahSchedule(value).blocker),
    assess('service_contract', inputs.servicePreflight, value => preflightMahService(value).blocker)
  ];
  return {
    connection: assessMahConnection(),
    schemaVersion: 1 as const,
    selectionOwner: 'mah' as const,
    status: 'blocked' as const,
    executable: false as const,
    evidenceMode: 'supplied_snapshots_only' as const,
    items
  };
}
