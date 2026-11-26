import { AsyncLocalStorage } from 'node:async_hooks';
import {
  buildPlanningConversationPrompt, planningConversationSchema, parsePlanningConversationTurn,
  emailResearchPrompt, emailResearchSchema, parseEmailResearch,
  emailTimingPrompt, emailTimingSchema, parseEmailTiming,
  type PlanningConversationRequest, type EmailResearchRequest, type EmailTimingRequest,
  type PlanningRuntime, type EmailRuntime
} from '@c-assistant/agent-adapters';
import {
  assertMahBusinessRequest, businessContracts, validateMahBusinessResult,
  MahBusinessContractError, type MahBusinessRequest, type MahBusinessReceipt, type BusinessScope
} from './mah-business-contract.js';
import { canonicalJson, sha256 } from './mah-generation-contract.js';
import { blockedBusinessOperation } from './agent-work-contract.js';

type Operation = 'planning_conversation' | 'email_research' | 'email_timing';
export interface MahBusinessWorkContext {
  requestId: string; operation: Operation; scope: BusinessScope; businessTime: string;
}
/** Trusted integration boundary. No live implementation is connected here. */
export interface MahBusinessGateway {
  assertPublicContract(request: MahBusinessRequest): Promise<void>;
  execute(request: MahBusinessRequest, signal?: AbortSignal): Promise<{ raw: string; receipt: MahBusinessReceipt }>;
}

/** Bounded reasoning only. Storage/version application, sending and scheduling stay outside. */
export class MahBusinessRuntimeAdapter implements PlanningRuntime, EmailRuntime {
  private readonly contexts = new AsyncLocalStorage<MahBusinessWorkContext>();
  constructor(private readonly gateway?: MahBusinessGateway) {}

  runWithWorkContext<T>(context: MahBusinessWorkContext, operation: () => Promise<T>): Promise<T> {
    return this.contexts.run(structuredClone(context), operation);
  }

  async continuePlanningConversation(input: PlanningConversationRequest) {
    this.inputKeys(input, ['message', 'session', 'profile']);
    const frozen = structuredClone(input);
    return this.execute('planning_conversation', frozen as unknown as Record<string, unknown>,
      buildPlanningConversationPrompt(frozen), planningConversationSchema,
      frozen.profile.preferredLanguage, 120,
      payload => parsePlanningConversationTurn(JSON.stringify(payload)));
  }

  async generateEmailResearch(input: EmailResearchRequest) {
    this.inputKeys(input, ['kind','date','city','plannedOrigin','places','schedule','constraints','language','now','signal']);
    const { signal, ...data } = input; const frozen = structuredClone(data);
    this.emailTime('email_research', frozen.now, frozen.date);
    return this.execute('email_research', frozen as unknown as Record<string, unknown>,
      emailResearchPrompt(frozen), emailResearchSchema, frozen.language, 60,
      payload => parseEmailResearch(JSON.stringify(payload), frozen), signal);
  }

  async generateEmailTiming(input: EmailTimingRequest) {
    this.inputKeys(input, ['itinerary','opportunities','now','signal']);
    const { signal, ...data } = input; const frozen = structuredClone(data);
    this.emailTime('email_timing', frozen.now);
    return this.execute('email_timing', frozen as unknown as Record<string, unknown>,
      emailTimingPrompt(frozen), emailTimingSchema, 'en', 60,
      payload => parseEmailTiming(JSON.stringify(payload), frozen), signal);
  }

  private inputKeys(input: object, allowed: string[]) {
    if (!input || typeof input !== 'object' || Object.keys(input).some(key => !allowed.includes(key))) {
      throw new MahBusinessContractError('mah_business_input_fields_invalid');
    }
  }

  private emailTime(operation: Operation, now: string, date?: string) {
    const context = this.contexts.getStore();
    if (!context || context.operation !== operation || context.scope.kind !== 'email'
      || context.businessTime !== now || date !== undefined && date !== context.scope.businessDate) {
      throw new MahBusinessContractError('mah_business_work_context_mismatch');
    }
  }

  private async execute<T>(operation: Operation, data: Record<string, unknown>, prompt: string,
    outputSchema: Record<string, unknown>, language: string, maxRuntimeSeconds: number,
    parse: (payload: Record<string, unknown>) => T, signal?: AbortSignal): Promise<T> {
    const context = this.contexts.getStore();
    if (!context || context.operation !== operation) throw new MahBusinessContractError('mah_business_work_context_mismatch');
    const input = { data, prompt, outputSchema };
    const contracts = businessContracts(operation);
    const request: MahBusinessRequest = {
      schemaVersion: 1, kind: 'landi_business_request', requestId: context.requestId,
      operation, scope: structuredClone(context.scope), businessTime: context.businessTime,
      input: { contract: contracts.input, sha256: sha256(canonicalJson(input)), payload: input },
      output: { contract: contracts.output }, execution: {
        selectionOwner: 'mah', preferredLanguage: language, authority: 'artifact_only',
        capabilities: operation === 'email_research' ? ['structured_output','external_current_research'] : ['structured_output'],
        maxRuntimeSeconds
      }
    };
    assertMahBusinessRequest(request);
    if (!this.gateway) return blockedBusinessOperation();
    signal?.throwIfAborted();
    // Give the gateway copies; it cannot alter the accepted request or parser input.
    await this.gateway.assertPublicContract(structuredClone(request));
    signal?.throwIfAborted();
    const result = await this.gateway.execute(structuredClone(request), signal);
    signal?.throwIfAborted();
    return validateMahBusinessResult(result.raw, request, result.receipt, parse);
  }
}
