const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
/** Landi-local evidence contract; not a claimed MAH public schema. No production reader is wired. */
export function assessMahConnection(evidence?: unknown, trust?: { publicContractVerified: boolean; expectedScope: string }, now = Date.now()) {
  const base = { selectionOwner: 'mah' as const, executable: false as const,
    evidence: { source: null as 'mah_public_configuration' | null, protocol: null as number | null, observedAt: null as string | null, scopeVerified: false, maxAgeMs: 60000 } };
  const unknown = (code: string) => ({ ...base, configuration: 'unverified' as const, code });
  if (!trust?.publicContractVerified) return unknown('public_configuration_contract_unverified');
  if (!record(evidence) || evidence.source !== 'mah_public_configuration' || evidence.protocol !== 1 || evidence.selectionOwner !== 'mah') return unknown('configuration_evidence_invalid');
  if (!trust.expectedScope || evidence.scope !== trust.expectedScope) return unknown('configuration_scope_unverified');
  const at = typeof evidence.observedAt === 'string' ? Date.parse(evidence.observedAt) : NaN;
  if (!Number.isFinite(at) || at > now || now - at > 60000) return unknown('configuration_evidence_stale');
  const configuration = evidence.configuration;
  if (!record(configuration) || ['installed','authenticated','agentConfigured'].some(k => typeof configuration[k] !== 'boolean')) return unknown('configuration_evidence_incomplete');
  const ready = ['installed','authenticated','agentConfigured'].every(k => configuration[k] === true);
  return { ...base, configuration: ready ? 'verified' as const : 'needs_setup' as const,
    code: ready ? 'configuration_verified_execution_blocked' : 'configuration_requires_setup',
    evidence: { source: 'mah_public_configuration' as const, protocol: 1, observedAt: new Date(at).toISOString(), scopeVerified: true, maxAgeMs: 60000 } };
}
