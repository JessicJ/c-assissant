import type { AgentWork } from '@c-assistant/storage';
import { MahBusinessRuntimeAdapter } from './mah-business-runtime.js';
import { MahCliBusinessGateway } from './mah-business-gateway.js';
import type { SqliteMahBusinessSubmissionJournal } from './mah-business-journal.js';
import { MahBusinessContractError } from './mah-business-contract.js';
import { createMahBusinessPublicReceiptVerifier } from './mah-business-public-receipt.js';
import { createMahBusinessPublicRead } from './mah-business-public-result.js';

/** Creates no runtime work until called. Default public assertion stays closed.
 * Production supplies no journal/receipt provider yet; fixtures inject these ports.
 */
export function createMahPlanningRuntimeFactory(options:
  Omit<ConstructorParameters<typeof MahCliBusinessGateway>[0], 'journal' | 'verifyReceipt'> & {
    journal: SqliteMahBusinessSubmissionJournal;
    verifyReceipt?: ConstructorParameters<typeof MahCliBusinessGateway>[0]['verifyReceipt'];
  }) {
  return (work: AgentWork, readOnly = false): MahBusinessRuntimeAdapter => {
    if (work.scope.kind !== 'conversation') throw new MahBusinessContractError('mah_planning_work_identity_invalid');
    const journal = options.journal;
    const assertTask = (taskId: string) => {
      if (taskId !== work.carrierTaskId) throw new MahBusinessContractError('mah_planning_work_identity_invalid');
    };
    return new MahBusinessRuntimeAdapter(new MahCliBusinessGateway({ ...options,
      verifyReceipt: options.verifyReceipt ?? createMahBusinessPublicReceiptVerifier(options.projectRoot,
        options.run ?? createMahBusinessPublicRead(options.projectRoot, options.environment ?? process.env)), journal: {
      reserve: (request, root) => {
        if (request.requestId !== work.requestId || request.operation !== 'planning_conversation'
          || request.scope.kind !== 'conversation' || work.scope.kind !== 'conversation'
          || request.scope.sessionId !== work.scope.sessionId || request.scope.requirementsVersion !== work.scope.revision) {
          throw new MahBusinessContractError('mah_planning_work_identity_invalid');
        }
        if (readOnly) {
          const existing = journal.findByTaskId(work.carrierTaskId);
          if (!existing || existing.state === 'prepared') throw new MahBusinessContractError('mah_business_task_not_submitted');
        }
        return journal.reserve(request, root, work.carrierTaskId);
      },
      claimSubmission: taskId => { assertTask(taskId); return journal.claimSubmission(taskId); },
      mark: (taskId, state) => { assertTask(taskId); return journal.mark(taskId, state); }
    } }));
  };
}
