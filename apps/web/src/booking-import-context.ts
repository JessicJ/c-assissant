import type { ChatMessage } from './conversation-state.js';

/** UI affordance only: a current assistant question, never a booking fact or permission. */
export function shouldOfferBookingImport(messages: readonly ChatMessage[]): boolean {
  const latest = messages.at(-1);
  if (latest?.role !== 'assistant') return false;
  const sentences = latest.text.match(/[^.!?。！？\n]+[.!?。！？]?/gu) ?? [];
  return sentences.some(sentence => {
    const topic = /\b(?:flights?|hotels?|accommodations?|train tickets?|rail tickets?|rental cars?|booking confirmations?|flight tickets?)\b|机票|航班|酒店|住宿|火车票|车票|租车|预订确认/u.test(sentence.toLowerCase());
    const request = /[?？]|\b(?:please (?:share|upload|provide|send|tell)|share your|upload your|provide your)\b|请.{0,12}(?:提供|上传|分享|告诉)|是否|住哪|订好|订了/u.test(sentence.toLowerCase());
    return topic && request;
  });
}
