/** Assertion consistency only: raw records must still be independently verified.
 * Never opens records, databases, CLI, services, or evaluates candidate runtime counts.
 */
type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue => !!value && typeof value === 'object' && !Array.isArray(value);
const sha = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const count = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;
const text = (value: unknown) => typeof value === 'string' && value.trim().length > 0;
const sameOwner = (a: RecordValue, b: RecordValue) => ['instanceId', 'pid', 'startedAt', 'origin', 'artifactSha256', 'databasePath'].every(key => a[key] === b[key]);
const factSources = {
  identity: 'os_identity_and_startup_record', admission: 'old_process_admission',
  drain: 'old_process_work_registry', persisted: 'consistent_storage_snapshot',
  manager: 'os_service_manager', exit: 'os_process_and_listener',
  backup: 'consistent_backup_verification', compatibility: 'backup_copy_readonly_inspection'
} as const;
type FactName = keyof typeof factSources;

export function assessFirstTakeover(input: unknown, now = Date.now()) {
  const value = record(input) ? input : {};
  const old = record(value.oldService) ? value.oldService : {};
  const issues: string[] = [];
  const facts: Partial<Record<FactName, { status: 'consistent_unverified' | 'unverified'; issues: string[] }>> = {};
  const identityValid = text(old.instanceId) && old.role === 'old_service' && Number.isSafeInteger(old.pid) && (old.pid as number) > 0 &&
    typeof old.startedAt === 'string' && Number.isFinite(Date.parse(old.startedAt)) && Date.parse(old.startedAt) <= now &&
    typeof old.origin === 'string' && /^http:\/\/127\.0\.0\.1:\d+$/.test(old.origin) &&
    Number(old.origin.split(':').at(-1)) >= 1 && Number(old.origin.split(':').at(-1)) <= 65535 &&
    typeof old.databasePath === 'string' && old.databasePath.startsWith('/') && sha(old.artifactSha256);
  if (value.version !== 1 || !identityValid || !Number.isFinite(now)) issues.push('old_service_identity_unverified');
  const supplied = record(value.facts) ? value.facts : {};
  const accepted: Partial<Record<FactName, RecordValue>> = {};
  for (const name of Object.keys(factSources) as FactName[]) {
    const errors: string[] = [];
    const fact = supplied[name];
    if (!record(fact)) errors.push('evidence_missing');
    else {
      const subject = record(fact.subject) ? fact.subject : {};
      if (!identityValid || subject.role !== 'old_service' || !sameOwner(subject, old)) errors.push('old_subject_mismatch');
      if (fact.status !== 'observed' || fact.source !== factSources[name]) errors.push('source_unverified');
      const time = typeof fact.observedAt === 'string' ? Date.parse(fact.observedAt) : NaN;
      if (!Number.isFinite(time) || !Number.isFinite(now) || time > now || now - time > 60_000 || time < Date.parse(String(old.startedAt))) errors.push('evidence_stale_or_invalid');
      if (!Array.isArray(fact.records) || !fact.records.length || !fact.records.every(r => record(r) && text(r.reference) && sha(r.sha256))) errors.push('raw_record_reference_missing');
      const data = record(fact.data) ? fact.data : {};
      if (name === 'identity' && (data.ownerMatched !== true || data.runtimeArtifactMatched !== true)) errors.push('identity_not_matched');
      if (name === 'admission' && (data.closed !== true || data.allEntrypointsCovered !== true)) errors.push('admission_not_closed');
      if (name === 'drain' && (data.schedulersPaused !== true || !['activeRequests', 'activeBackground', 'activeGenerations', 'activeDeliveries'].every(key => count(data[key]) && data[key] === 0))) errors.push('work_not_drained');
      if (name === 'persisted' && (!count(data.uncertainOperations) || data.uncertainOperations !== 0 || !count(data.preservedQueuedMail) || data.queueAction !== 'preserve' || !sha(data.snapshotSha256))) errors.push('persisted_outcomes_unverified');
      if (name === 'manager' && (data.autoRestartPrevented !== true || !text(data.manager))) errors.push('manager_not_paused');
      if (name === 'exit' && (data.ownerExited !== true || data.portReleased !== true || data.replacementAbsent !== true)) errors.push('old_exit_unverified');
      if (name === 'backup' && (data.consistent !== true || data.integrity !== 'ok' || !sha(data.sha256) || data.databasePath !== old.databasePath || !sha(data.schemaSha256) || !sha(data.quiescenceRecordSha256))) errors.push('backup_unverified');
      if (name === 'compatibility' && (data.schemaVersion !== 27 || !sha(data.backupSha256) || !sha(data.schemaSha256) || !sha(data.candidateSchemaSha256) || !sha(data.baselineSchemaSha256) || data.schemaSha256 !== data.candidateSchemaSha256 || data.schemaSha256 !== data.baselineSchemaSha256 || data.historyCompatible !== true || data.mutationsPerformed !== false || data.inspectedCopy !== true)) errors.push('database_compatibility_unverified');
      if (!errors.length) accepted[name] = data;
    }
    facts[name] = { status: errors.length ? 'unverified' : 'consistent_unverified', issues: errors };
    issues.push(...errors.map(error => `${name}:${error}`));
  }
  // One handoff must bind drain, persisted state and backup, not unrelated samples.
  if (accepted.backup && accepted.compatibility && accepted.backup.sha256 !== accepted.compatibility.backupSha256) issues.push('backup_copy_identity_mismatch');
  if (accepted.backup && accepted.compatibility && accepted.backup.schemaSha256 !== accepted.compatibility.schemaSha256) issues.push('backup_schema_identity_mismatch');
  if (accepted.backup && accepted.persisted && accepted.backup.sha256 !== accepted.persisted.snapshotSha256) issues.push('persisted_snapshot_identity_mismatch');
  const drainFact = record(supplied.drain) ? supplied.drain : {};
  const drainRecords = Array.isArray(drainFact.records) ? drainFact.records : [];
  if (accepted.backup && !drainRecords.some(r => record(r) && r.sha256 === accepted.backup!.quiescenceRecordSha256)) issues.push('backup_quiescence_binding_missing');
  for (const [before, after] of [['admission', 'drain'], ['drain', 'exit'], ['manager', 'exit'], ['exit', 'backup'], ['backup', 'compatibility'], ['backup', 'persisted']] as const) {
    const first = supplied[before]; const second = supplied[after];
    if (accepted[before] && accepted[after] && record(first) && record(second) && Date.parse(String(first.observedAt)) > Date.parse(String(second.observedAt))) issues.push(`${before}_${after}_order_invalid`);
  }
  if (value.restoreDatabase !== false || value.automaticResume !== false) issues.push('unsafe_recovery_requested');
  return { status: issues.length ? 'unverified' as const : 'consistent_unverified' as const,
    facts, issues, executable: false as const, readyToStop: false as const,
    oldServiceDrained: null, databaseAction: 'preserve' as const, automaticResume: false as const,
    rawRecordsIndependentlyVerified: false as const };
}
