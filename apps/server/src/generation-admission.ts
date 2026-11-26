import { AsyncLocalStorage } from 'node:async_hooks';
import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { isAbsolute, relative, sep } from 'node:path';
import type { SqliteWorkspaceStore } from '@c-assistant/storage';
import { resolveMahCliBinding } from './mah-cli-binding.js';
import { MahCarrierError } from './mah-generation-contract.js';
import { assertMahReadOnlySubmission } from './mah-readonly-submission.js';
import { missingGenerationQuestions, missingQuestions } from './planning-session-facts.js';

export type GenerationAdmissionIdentity = { sessionId: string; revision: number; proposalVersion: number };
export type GenerationAdmissionSnapshot = GenerationAdmissionIdentity & { ready: boolean; validUntil: number; code?: string };
export interface GenerationAdmission {
  check(identity: GenerationAdmissionIdentity): Promise<GenerationAdmissionSnapshot>;
  authorize(identity: GenerationAdmissionIdentity): Promise<void>;
}

/** This local acceptance entry selects an existing synthetic database explicitly.
 * It does not grant the normal production service any generation capability.
 */
export function assertIsolatedGenerationDatabase(databasePath: string, componentRoot: string, projectRoot: string): string {
  if (!isAbsolute(databasePath)) throw new Error('An absolute existing validation database is required.');
  const database = realpathSync(databasePath);
  for (const root of [realpathSync(componentRoot), realpathSync(projectRoot)]) {
    const path = relative(root, database);
    if (!path || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path))) {
      throw new Error('The validation database must be outside both source repositories.');
    }
  }
  return database;
}

export class IsolatedGenerationAdmission implements GenerationAdmission {
  private readonly execution = new AsyncLocalStorage<GenerationAdmissionIdentity>();
  private authorized?: GenerationAdmissionIdentity;
  private readonly proposalVersion: number;
  constructor(private readonly options: {
    store: SqliteWorkspaceStore; sessionId: string; projectRoot: string;
    preview?: () => Promise<void>;
  }) {
    const session = options.store.getPlanningSessionById(options.sessionId);
    if (!session?.proposal) throw new Error('The selected saved session must have a planning proposal.');
    this.proposalVersion = session.proposal.version;
  }

  async check(identity: GenerationAdmissionIdentity): Promise<GenerationAdmissionSnapshot> {
    const snapshot = { ...identity, ready: false, validUntil: Date.now() + 15000 };
    if (!this.matches(identity)) return { ...snapshot, code: 'generation_identity_changed' };
    const workspace = this.options.store.getWorkspace();
    const session = this.options.store.getPlanningSessionById(identity.sessionId)!;
    if (workspace.profile.status !== 'ready' || session.unresolved.some(item => item.status === 'open')
      || missingQuestions(session.facts).length || missingGenerationQuestions(session.facts, session.messages).length) {
      return { ...snapshot, code: 'generation_details_incomplete' };
    }
    try {
      if (this.options.preview) await this.options.preview();
      else {
        const binding = resolveMahCliBinding(process.env);
        await assertMahReadOnlySubmission(this.options.projectRoot, async args => new Promise((resolve, reject) => {
          execFile(binding.command, args, { cwd: this.options.projectRoot, env: binding.environment,
            encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
              if (error) reject(error); else resolve({ code: 0, stdout });
            });
        }));
      }
    } catch { return { ...snapshot, code: 'generation_submission_unverified' }; }
    if (!this.matches(identity)) return { ...snapshot, code: 'generation_identity_changed' };
    return { ...snapshot, ready: true, validUntil: Date.now() + 15000 };
  }

  async authorize(identity: GenerationAdmissionIdentity): Promise<void> {
    const result = await this.check(identity);
    if (!result.ready) throw new MahCarrierError(result.code ?? 'generation_submission_unverified', 'This saved proposal cannot be submitted for generation right now.');
    this.authorized = { ...identity };
  }

  run<T>(proposal: { sessionId: string; proposalVersion: number }, operation: () => Promise<T>): Promise<T> {
    if (!this.authorized || proposal.sessionId !== this.authorized.sessionId || proposal.proposalVersion !== this.authorized.proposalVersion) {
      throw new MahCarrierError('generation_scope_unverified', 'This proposal has no verified generation admission.');
    }
    return this.execution.run(this.authorized, operation);
  }

  assertExecution(): void {
    const current = this.execution.getStore();
    if (!current || current.sessionId !== this.options.sessionId || current.proposalVersion !== this.proposalVersion) {
      throw new MahCarrierError('generation_scope_unverified', 'Generation execution is outside the selected validation session.');
    }
  }

  owns(proposal: { sessionId: string; proposalVersion: number }): boolean {
    return proposal.sessionId === this.options.sessionId && proposal.proposalVersion === this.proposalVersion;
  }

  private matches(identity: GenerationAdmissionIdentity): boolean {
    const { store } = this.options;
    const session = store.getPlanningSessionById(identity.sessionId);
    return identity.sessionId === this.options.sessionId && store.getPlanningSession()?.id === identity.sessionId
      && Number.isSafeInteger(identity.revision) && identity.revision >= 0
      && store.getPlanningRevision(identity.sessionId) === identity.revision
      && identity.proposalVersion === this.proposalVersion && session?.proposal?.version === identity.proposalVersion
      && ['proposal_ready', 'proposal_confirmed', 'generating'].includes(session.status);
  }
}
