import { isDeepStrictEqual } from 'node:util';
import type { TravelAdjustmentInput, TravelAdjustmentContext } from '@c-assistant/core';
import { WorkspaceMutationError } from '@c-assistant/core';
import type { SqliteWorkspaceStore } from '@c-assistant/storage';

export interface ExactPlanConfirmation { proposalDigest: string; context: TravelAdjustmentContext }
export function exactPlanConfirmation(store: SqliteWorkspaceStore): ExactPlanConfirmation {
  return {proposalDigest:store.travelAdjustmentProposalDigest(),context:store.captureAdjustmentContext()};
}
export function requireExactPlanConfirmation(store: SqliteWorkspaceStore, value: ExactPlanConfirmation|undefined): void {
  const current=exactPlanConfirmation(store);
  if(!value || !isDeepStrictEqual(value,current))throw new WorkspaceMutationError('方案或来源、授权已变化，请重新审阅完整安排。','version_conflict');
}

/** 候选只经现有事务导入；生产未注入公开合同验证器时保持待处理。 */
export function createTravelAdjustmentApplication(dependencies: {
  store: SqliteWorkspaceStore;
  verifyExecution?: (decision: NonNullable<TravelAdjustmentInput['decision']>, input: TravelAdjustmentInput)=>boolean;
  now?: ()=>Date;
}) {
  const {store}=dependencies;
  return {
    async run(requestId: string, collect: (context:TravelAdjustmentContext)=>Promise<Pick<TravelAdjustmentInput,'observations'|'decision'|'replacement'>>) {
      const previous=store.getTravelAdjustmentReceipt(requestId);
      if(previous)return previous;
      const context=store.captureAdjustmentContext();
      const candidate=await collect(structuredClone(context));
      return store.commitTravelAdjustment({...candidate,requestId,context,now:(dependencies.now?.()??new Date()).toISOString()},dependencies.verifyExecution?{verifyExecution:dependencies.verifyExecution}:{});
    },
    readReceipt: (requestId:string)=>store.getTravelAdjustmentReceipt(requestId)
  };
}
