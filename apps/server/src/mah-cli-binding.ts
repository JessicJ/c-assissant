import { isAbsolute } from 'node:path';
import { MahCarrierError } from './mah-generation-contract.js';

export const MAH_PUBLIC_MACOS_COMMAND = '/Applications/MAH.app/Contents/Resources/bin/mah';
/** Public wrapper owns runtime discovery. Legacy Task-provided pairs stay explicit. */
export function resolveMahCliBinding(environment: NodeJS.ProcessEnv): { command: string; environment: NodeJS.ProcessEnv } {
  const command = environment.MAH_TASK_CLI_COMMAND ?? environment.LANDI_MAH_CLI_COMMAND ?? MAH_PUBLIC_MACOS_COMMAND;
  const executable = environment.MAH_TASK_CLI_EXECUTABLE ?? environment.LANDI_MAH_CLI_EXECUTABLE;
  const main = environment.MAH_TASK_CLI_MAIN ?? environment.LANDI_MAH_CLI_MAIN;
  const valid = (value: string) => isAbsolute(value) && !value.includes('\0');
  if (!valid(command) || (executable !== undefined || main !== undefined)
    && (!executable || !main || !valid(executable) || !valid(main))) {
    throw new MahCarrierError('mah_not_configured', 'MAH 命令配置无效，已保留保存的需求。');
  }
  return { command, environment: { ...environment,
    ...(executable && main ? { MAH_TASK_CLI_EXECUTABLE: executable, MAH_TASK_CLI_MAIN: main } : {}) } };
}

/** Public immediate-queue receipt. A matching receipt permits readback only. */
export function inspectMahSubmitReceipt(response: { code: number; stdout: string; timedOut?: boolean; aborted?: boolean },
  expected: { taskId: string; projectRoot: string; title?: string }): Record<string, unknown> | undefined {
  if (response.code !== 0 || response.aborted || response.timedOut) return;
  let value: unknown;
  try { value = JSON.parse(response.stdout); } catch { return; }
  const record = (input: unknown): input is Record<string, unknown> => !!input && typeof input === 'object' && !Array.isArray(input);
  if (!record(value) || (value.ok !== undefined && value.ok !== true) || value.task_id !== expected.taskId
    || typeof value.title !== 'string' || !value.title.trim() || (expected.title !== undefined && value.title !== expected.title)
    || value.audit_ref !== `.mah/tasks/${expected.taskId}/audit/audit.ndjson`
    || value.events_ref !== `.mah/tasks/${expected.taskId}/stream.jsonl`
    || !record(value.result_ref) || value.result_ref.type !== 'none'
    || (value.project_root !== undefined && value.project_root !== expected.projectRoot)) return;
  return value;
}
