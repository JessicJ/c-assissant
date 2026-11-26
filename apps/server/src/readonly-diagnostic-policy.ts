import { isAbsolute } from 'node:path';

/** No defaults, .env loading, storage construction or execution capability. */
export function readonlyDiagnosticConfig(environment: NodeJS.ProcessEnv) {
  const databasePath = environment.LANDI_DIAGNOSTIC_DATABASE_PATH;
  const rawPort = environment.LANDI_DIAGNOSTIC_PORT;
  const admissionPath = environment.LANDI_DIAGNOSTIC_ADMISSION_PATH;
  const admissionSha256 = environment.LANDI_DIAGNOSTIC_ADMISSION_SHA256;
  const token = environment.LANDI_DIAGNOSTIC_TOKEN;
  if (!databasePath || !isAbsolute(databasePath)) throw new Error('Explicit absolute diagnostic snapshot path required.');
  if (!rawPort || !/^[1-9]\d*$/.test(rawPort) || !Number.isInteger(Number(rawPort)) || Number(rawPort) < 1024 || Number(rawPort) > 65535 || Number(rawPort) === 8787) throw new Error('Explicit separate diagnostic port required; 8787 is reserved.');
  if (!admissionPath || !isAbsolute(admissionPath) || !admissionSha256 || !/^[a-f0-9]{64}$/.test(admissionSha256)) throw new Error('Pinned readonly admission required.');
  if (!token || token.length < 32) throw new Error('Diagnostic credential required.');
  return Object.freeze({ databasePath, admissionPath, admissionSha256, token, port: Number(rawPort), host: '127.0.0.1' as const });
}
