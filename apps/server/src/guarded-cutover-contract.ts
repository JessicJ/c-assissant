/** Evidence consistency only. This module never stops, starts or restores anything. */
export interface GuardedReleaseBinding {
  mode: 'guarded-workbench'; artifactSha256: string; dependenciesSha256: string;
  schemaSha256: string; origin: string; databasePath: string; configPath: string;
  storageKeysSha256: string;
}
export interface GuardedCutoverEvidence {
  candidate: GuardedReleaseBinding; rollback: GuardedReleaseBinding;
  observedAt: string; ownerPid: number; ownerStartedAt: string; manager: string;
  managerPaused: boolean; stopVerified: boolean; writesDrained: boolean;
  activeGenerations: number; pendingDeliveries: number; uncertainOperations: number;
  backup: { verified: boolean; consistent: boolean; databasePath: string; sha256: string };
  restoreDatabase: boolean; automaticResume: boolean;
}
export function assessGuardedCutover(value: GuardedCutoverEvidence, now = Date.now()) {
  const issues: string[] = [];
  const sha = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
  if (!value || typeof value !== 'object') return { status: 'unverified' as const, executable: false as const, databaseAction: 'preserve' as const, issues: ['evidence_missing'] };
  const fresh = Date.parse(value.observedAt);
  if (!Number.isFinite(now) || !Number.isFinite(fresh) || fresh > now || now - fresh > 60_000) issues.push('quiescence_evidence_stale');
  for (const release of [value.candidate, value.rollback]) {
    if (!release || release.mode !== 'guarded-workbench' || ![release.artifactSha256, release.dependenciesSha256, release.schemaSha256, release.storageKeysSha256].every(sha) || !/^http:\/\/127\.0\.0\.1:\d+$/.test(release.origin) || !release.databasePath?.startsWith('/') || !release.configPath?.startsWith('/')) issues.push('release_binding_unverified');
  }
  if (value.candidate && value.rollback) {
    for (const key of ['schemaSha256', 'origin', 'databasePath', 'configPath', 'storageKeysSha256'] as const) if (value.candidate[key] !== value.rollback[key]) issues.push(`rollback_${key}_mismatch`);
  }
  if (!Number.isSafeInteger(value.ownerPid) || value.ownerPid <= 0 || !Number.isFinite(Date.parse(value.ownerStartedAt)) || Date.parse(value.ownerStartedAt) > fresh || !value.manager?.trim() || value.manager === 'unknown' || value.managerPaused !== true || value.stopVerified !== true) issues.push('process_ownership_or_stop_unverified');
  if (value.writesDrained !== true || value.activeGenerations !== 0 || value.pendingDeliveries !== 0 || value.uncertainOperations !== 0) issues.push('operations_not_drained');
  if (!value.backup || value.backup.verified !== true || value.backup.consistent !== true || !sha(value.backup.sha256) || value.backup.databasePath !== value.candidate?.databasePath) issues.push('backup_unverified');
  if (value.restoreDatabase !== false || value.automaticResume !== false) issues.push('unsafe_recovery_requested');
  return { status: issues.length ? 'unverified' as const : 'consistent_unverified' as const, executable: false as const, databaseAction: 'preserve' as const, issues };
}
