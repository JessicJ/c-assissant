import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPlanningConversationPrompt, type PlanningConversationRequest } from './index.js';

const request: PlanningConversationRequest = {
  message: 'Five days in Tokyo',
  session: { status: 'collecting', messages: [], facts: [], unresolved: [] },
  profile: { preferredLanguage: 'French', nationality: 'France', gender: 'woman', immigrationStatus: 'unknown', displayName: 'Alex', assistantPersonality: 'miles' }
};

test('planning prompts apply the selected voice, gender-aware occasional address and English only', () => {
  const prompt = buildPlanningConversationPrompt(request);
  assert.match(prompt, /Assistant personality: Miles/);
  assert.match(prompt, /sis or girl/);
  assert.match(prompt, /Never add a form of address mechanically/);
  assert.match(prompt, /Reply in English only/);
  assert.match(prompt, /at most one natural follow-up question/);
  const buddy = buildPlanningConversationPrompt({ ...request, profile: { ...request.profile, assistantPersonality: 'travel_buddy' } });
  assert.match(buddy, /cute female travel buddy/);
  assert.match(buddy, /kaomoji/);
  const neutral = buildPlanningConversationPrompt({ ...request, profile: { ...request.profile, gender: 'nonbinary' } });
  assert.match(neutral, /do not infer gender/);
  assert.doesNotMatch(neutral, /sis or girl/);
});
