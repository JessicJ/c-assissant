import type { Route } from '@playwright/test';

/** 新规划的成功夹具按收到的原身份返回回执；方案修订不使用此合同。 */
export function planningSaveReceipt(route: Route, session: { id: string; messages: { id: string; role: string; text: string; createdAt?: string }[] }) {
  const request = route.request().postDataJSON();
  if (request.mode !== 'new_plan' || typeof request.messageId !== 'string' || !Number.isSafeInteger(request.expectedRevision)) throw new Error('夹具只接受有原身份的新规划保存');
  if (!session.messages.some(message => message.id === request.messageId)) session.messages.push({ id: request.messageId, role: 'user', text: request.message.trim(), createdAt: new Date().toISOString() });
  return { planningRevision: request.expectedRevision + 1, requirementsSaved: true, saveReceipt: { sessionId: session.id, messageId: request.messageId,
    expectedRevision: request.expectedRevision, savedRevision: request.expectedRevision + 1 } };
}
