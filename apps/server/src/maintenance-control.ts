import { randomUUID } from 'node:crypto';

export type WorkKind = 'http' | 'background' | 'delivery';
type CountEvidence = { status: 'observed' | 'unverified'; count: number | null; source: string };

/** Process-local evidence only. Never opens storage, cancels work, or controls a manager. */
export function createMaintenanceControl(options: { now?: () => number; instanceId?: string; initialMaintenance?: boolean; role?: 'service' | 'candidate_bootstrap' } = {}) {
  const now = options.now ?? Date.now;
  const instanceId = options.instanceId ?? randomUUID();
  const counts: Record<WorkKind, number> = { http: 0, background: 0, delivery: 0 };
  const covered = new Set<WorkKind>();
  const issues = new Set<string>();
  const pauseCallbacks = new Set<() => void>();
  let generation: (() => number) | undefined;
  let startedAt: number | undefined = options.initialMaintenance ? now() : undefined;
  let deadline = startedAt === undefined ? Infinity : startedAt + 30_000;
  const observingSince = new Date(now()).toISOString();
  function assertAccepting() {
    if (startedAt !== undefined) throw Object.assign(new Error('maintenance_admission_closed'), { code: 'maintenance_admission_closed', statusCode: 503 });
  }
  function begin(kind: WorkKind) {
    assertAccepting();
    counts[kind]++;
    let finished = false;
    return () => { if (!finished) { finished = true; counts[kind]--; } };
  }
  async function run<T>(kind: WorkKind, operation: () => Promise<T>): Promise<T> {
    const finish = begin(kind);
    try { return await operation(); }
    catch (error) { issues.add(`${kind}_work_failed`); throw error; }
    finally { finish(); }
  }
  function snapshot() {
    const evidence = (kind: WorkKind): CountEvidence => ({ status: covered.has(kind) ? 'observed' : 'unverified', count: covered.has(kind) ? counts[kind] : null, source: 'process_work_registry' });
    let generationCount: number | null = null;
    try { const value = generation?.(); if (Number.isSafeInteger(value) && value! >= 0) generationCount = value!; } catch { /* Missing/failed observers never imply zero. */ }
    const local = { http: evidence('http'), background: evidence('background'), delivery: evidence('delivery'), generation: { status: generationCount === null ? 'unverified' : 'observed', count: generationCount, source: 'generation_promises_and_image_continuations' } };
    const localClear = Object.values(local).every(item => item.status === 'observed' && item.count === 0) && issues.size === 0;
    // Derive freshness without mutating the controller from a GET/snapshot.
    const expired = startedAt !== undefined && now() >= deadline;
    return {
      instanceId, role: options.role ?? 'service', observingSince, observedAt: new Date(now()).toISOString(),
      phase: startedAt === undefined ? 'normal' : expired ? 'blocked' : localClear ? 'locally_drained' : 'draining',
      admissionClosed: startedAt !== undefined, local, issues: [...issues, ...(expired ? ['drain_evidence_expired'] : [])],
      // Runtime counters cannot establish persisted queue state or external Task state.
      persistedOperations: { status: 'unverified', count: null, source: 'not_collected' },
      preservedQueuedMail: { status: 'unverified', count: null, source: 'not_collected' },
      managerPaused: null, stopVerified: null, writesDrained: null,
      executable: false, readyToStop: false, automaticResume: false, databaseAction: 'preserve'
    };
  }
  function enterDrain(timeoutMs = 30_000) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) throw new Error('maintenance_timeout_invalid');
    if (startedAt === undefined) {
      startedAt = now(); deadline = startedAt + timeoutMs;
      for (const pause of pauseCallbacks) { try { pause(); } catch { issues.add('scheduler_pause_failed'); } }
    }
    return snapshot();
  }
  return {
    instanceId, begin, run, assertAccepting, snapshot, enterDrain,
    cover: (kind: WorkKind) => { covered.add(kind); },
    observeGeneration: (read: () => number) => { generation = read; },
    markUncertain: (reason: 'delivery_outcome_unknown' | 'request_aborted') => { issues.add(reason); },
    onPause: (pause: () => void) => { pauseCallbacks.add(pause); if (startedAt !== undefined) { try { pause(); } catch { issues.add('scheduler_pause_failed'); } } },
    accepting: () => startedAt === undefined
  };
}
export type MaintenanceControl = ReturnType<typeof createMaintenanceControl>;
