import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { parseSkillResearchBatchArtifact, skillResearchBatchSchema } from './index.js';

const serverRequire = createRequire(new URL('../../../apps/server/package.json', import.meta.url));
const fastifyRequire = createRequire(serverRequire.resolve('fastify'));
const compilerRequire = createRequire(fastifyRequire.resolve('@fastify/ajv-compiler'));
const Ajv = compilerRequire('ajv');

test('研究合同保留无地点主题及显式来源用途', () => {
  const theme = { title: '虚构主题', description: '仅供阅读。', context: '虚构目的地', sourceUrls: [] };
  const artifact = { id: 'fixture', scopeLabel: '虚构目的地', completedAt: '2026-11-05T04:00:00.000Z', places: [], events: [], relationships: [], actionRequirements: [], travelTips: [],
    localFoods: [{ ...theme, diningPlaceIds: [] }], localProducts: [{ ...theme, purchasePlaceIds: [] }], experienceThemes: [{ ...theme, offeringPlaceIds: [] }],
    sources: [{ title: '虚构灵感', authority: '验收资料', url: 'https://fixture.invalid/inspiration', retrievedAt: '2026-11-05', purpose: 'inspiration' }] };
  const validate = new Ajv({ strict: false }).compile(skillResearchBatchSchema);
  assert.equal(validate(artifact), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...artifact, sources: [{ ...artifact.sources[0], purpose: 'verified' }] }), false);
  const result = parseSkillResearchBatchArtifact(JSON.stringify(artifact), { id: 'fixture', scopeLabel: '虚构目的地' }, artifact.completedAt);
  assert.deepEqual(result.localFoods?.[0]?.diningPlaceIds, []);
  assert.deepEqual(result.localProducts?.[0]?.purchasePlaceIds, []);
  assert.deepEqual(result.experienceThemes?.[0]?.offeringPlaceIds, []);
  assert.equal(result.sources[0]?.purpose, 'inspiration');
  assert.equal('minItems' in skillResearchBatchSchema.properties.localFoods.items.properties.diningPlaceIds, false);
  assert.equal('minItems' in skillResearchBatchSchema.properties.localProducts.items.properties.purchasePlaceIds, false);
  assert.equal('minItems' in skillResearchBatchSchema.properties.experienceThemes.items.properties.offeringPlaceIds, false);
  assert.throws(() => parseSkillResearchBatchArtifact(JSON.stringify({ ...artifact, sources: [{ ...artifact.sources[0], purpose: 'verified' }] }), { id: 'fixture', scopeLabel: '虚构目的地' }, artifact.completedAt));
});
