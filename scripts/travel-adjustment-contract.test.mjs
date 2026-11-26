import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../apps/server/package.json', import.meta.url));
const Ajv2020 = require('ajv/dist/2020.js').default;
const addFormats = require('ajv-formats');
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const schema = JSON.parse(readFileSync(new URL('../docs/contracts/landi-travel-adjustment.v1.schema.json', import.meta.url)));
const validate = ajv.compile(schema);
const instant = '2026-11-17T06:00:00Z';
const version = (id, n = 1) => ({ id, version: n });
function fixture() {
  return {
    schemaVersion: 1, eventId: 'synthetic-event', episode: 1, idempotencyKey: 'synthetic-event:1:1',
    base: { plan: version('synthetic-plan'), blueprint: version('synthetic-blueprint') },
    context: { draft: null, draftBlueprint: null, sourceSetDigest: 'a'.repeat(64), observationSetDigest: 'c'.repeat(64), recipientRevision: 1, authorizationDigest: 'd'.repeat(64) },
    phase: { value: 'on_trip', revision: 1, basis: 'traveler_statement', recordedAt: instant, evidenceRefs: ['synthetic:阶段陈述'] },
    observations: [{ objectRef: 'synthetic:visit-1', sourceKind: 'venue', provider: 'synthetic', targetDate: '2026-11-17', timeZone: 'Asia/Shanghai', factObservedAt: instant, retrievedAt: instant, validUntil: '2026-11-17T07:00:00Z', status: 'changed', reason: '虚构场馆在本次到访窗口关闭', evidenceRefs: ['synthetic:场馆证据'] }],
    decision: { verdict: 'eligible', changeKind: 'objective_disruption', agentId: 'synthetic-agent', modelId: 'synthetic-model', executionRef: 'synthetic:执行证据', rationale: '合成证据适用于本次到访，完整替代已校验', obligations: [], evidenceRefs: ['synthetic:判断证据'] },
    result: { status: 'applied', basis: 'objective_change', replacement: { plan: version('synthetic-replacement'), blueprint: version('synthetic-blueprint', 2) }, proposalDigest: 'b'.repeat(64), validationRef: 'synthetic:完整替代校验', appliedAt: instant, receiptRef: 'synthetic:应用回执', handoff: { intentId: 'synthetic-intent', status: 'pending', reason: '场馆关闭，采用完整替代', arrangementRef: 'synthetic:新版安排', invalidateOldPending: true, updateFutureWork: true, readbackRef: null } }
  };
}
function valid(value) { assert.equal(validate(value), true, JSON.stringify(validate.errors)); }
function invalid(value) { assert.equal(validate(value), false, '结构不完整的样本必须拒绝'); }

test('行中客观应用与出发前精确确认分别保留依据', () => {
  valid(fixture());
  const before = fixture(); before.phase.value = 'pre_departure'; before.result.basis = 'user_confirmation'; before.result.confirmationRef = 'synthetic:精确方案确认'; valid(before);
  const pending = fixture(); pending.phase.value = 'pre_departure'; pending.result = { status: 'pending_confirmation', reason: '等待桌面明确确认', unresolved: [], evidenceRefs: ['synthetic:完整草稿'] }; valid(pending);
});
test('阶段未知和来源失败可明确保留未决事实', () => {
  const value = fixture(); value.phase = { value: 'unknown', revision: 2, basis: 'unresolved', recordedAt: instant, evidenceRefs: [] };
  value.observations[0] = { ...value.observations[0], status: 'failed', factObservedAt: null, validUntil: null, reason: '合成来源不可用', evidenceRefs: [] };
  value.decision = { ...value.decision, verdict: 'unresolved', changeKind: 'unknown', agentId: null, modelId: null, executionRef: null, rationale: '无公共执行证据，保留原执行' };
  value.result = { status: 'unresolved', reason: '阶段及来源待核实', unresolved: ['待核实旅行阶段'], evidenceRefs: [] }; valid(value);
});
test('拒绝由时间或邮件直接充当阶段依据', () => {
  for (const basis of ['clock', 'map_handoff', 'email_delivered']) { const v = fixture(); v.phase.basis = basis; invalid(v); }
  const v = fixture(); v.phase.evidenceRefs = []; invalid(v);
});
test('阶段未知、行程结束及主观偏好不得自动应用', () => {
  for (const phase of ['unknown', 'ended']) { const v = fixture(); v.phase.value = phase; invalid(v); }
  const v = fixture(); v.decision.changeKind = 'subjective_preference'; invalid(v);
});
test('不伪造人工确认，不接受缺失判断或版本关联', () => {
  const cases = [v => { v.result.confirmationRef = 'synthetic:伪造确认'; }, v => { v.phase.value = 'pre_departure'; v.result.basis = 'user_confirmation'; }, v => { v.decision.executionRef = null; }, v => { delete v.base.blueprint; }, v => { delete v.result.validationRef; }, v => { delete v.context.sourceSetDigest; }];
  for (const mutate of cases) { const v = fixture(); mutate(v); invalid(v); }
});
test('已知事实须有适用时间与来源，保存预订须有修订', () => {
  for (const key of ['targetDate', 'timeZone', 'factObservedAt', 'validUntil']) { const v = fixture(); v.observations[0][key] = null; invalid(v); }
  const v = fixture(); v.observations[0].sourceKind = 'saved_booking'; invalid(v); v.observations[0].sourceRevision = 'synthetic:保存修订'; valid(v);
});
test('未应用不能声称新版，交接确认须真实读回', () => {
  const pending = fixture(); pending.result.status = 'unresolved'; invalid(pending);
  const v = fixture(); v.result.handoff.status = 'acknowledged'; invalid(v); v.result.handoff.readbackRef = 'synthetic:交接读回'; valid(v);
  v.result.handoff.invalidateOldPending = false; invalid(v);
});

test('无可靠变化不能自动应用，非关键未知仍由 Agent 判断', () => {
  for (const status of ['failed', 'unknown', 'expired', 'unchanged']) { const v = fixture(); v.observations[0].status = status; invalid(v); }
  const v = fixture(); v.observations.push({ ...v.observations[0], objectRef: 'synthetic:visit-2', status: 'unknown', factObservedAt: null, validUntil: null, reason: '不影响替代安排的其他活动待核实', evidenceRefs: [] }); valid(v);
});

test('安全候选保留可恢复事实并拒绝跨来源及敏感额外字段', () => {
  const v = fixture();
  v.observations[0].candidate = { kind: 'venue', name: '合成场馆', city: '合成城市', queryObservedAt: instant, matches: [{ placeId: 'synthetic-place', name: '合成场馆', city: '合成城市', status: 'temporarily_closed' }] };
  valid(v);
  for (const mutate of [
    value => { value.observations[0].candidate.confirmationCode = 'synthetic-forbidden'; },
    value => { value.observations[0].candidate.matches[0].rawResponse = 'synthetic-forbidden'; },
    value => { value.observations[0].candidate.matches = Array(9).fill(value.observations[0].candidate.matches[0]); },
    value => { value.observations[0].candidate.kind = 'weather_current'; }
  ]) { const bad = structuredClone(v); mutate(bad); invalid(bad); }
  const forecast = fixture();
  forecast.observations[0].sourceKind = 'weather_forecast';
  forecast.observations[0].candidate = { kind: 'weather_forecast', locationName: '合成城市', date: '2026-11-17', conditionDay: '晴', conditionNight: '多云', highC: 22, lowC: 12 };
  valid(forecast);
  forecast.observations[0].candidate.current = { condition: '晴' }; invalid(forecast);
});

// 显式验证目标子合同；不将通过称为实际 Storage API 或语义关联验证。
const consumeValidate = new Ajv2020({ allErrors: true, strict: false });
addFormats(consumeValidate);
consumeValidate.addSchema(schema);
const validateConsumption = consumeValidate.compile({ $ref: 'landi.travel-adjustment.v1#/$defs/emailConsumption' });
function consumption() {
  const v=fixture();
  return {schemaVersion:1,requestId:'synthetic-request',intentId:'synthetic-intent',receiptRef:'synthetic:回执',base:v.base,replacement:v.result.replacement,context:v.context,phase:v.phase,basis:'objective_change',reason:'合成客观变化',appliedAt:instant,proposalDigest:v.result.proposalDigest,arrangementRef:'synthetic:安排',arrangement:{planRef:v.result.replacement.plan,blueprintRef:v.result.replacement.blueprint,snapshotDigest:'e'.repeat(64)},events:[{eventId:v.eventId,episode:1,status:'open'}],observations:v.observations,decision:{...v.decision,obligations:['核实完整替代']},applicationKey:'f'.repeat(64),executionVerificationRef:'synthetic:已核验执行',effects:{notification:{status:'enqueued',ref:'synthetic:outbox'},oldPending:{status:'invalidated',ref:'synthetic:旧工作失效'},futureWork:{status:'pending',ref:'synthetic:持久安排待处理'}}};
}
test('目标消费投影分别校验客观应用和真实确认，不伪造 Agent 或事件',()=>{
  assert.equal(validateConsumption(consumption()),true,JSON.stringify(validateConsumption.errors));
  const v=consumption();v.basis='user_confirmation';v.phase.value='pre_departure';v.events=[];v.observations=[];v.decision=null;delete v.applicationKey;delete v.executionVerificationRef;v.confirmationRef='synthetic:真实确认';
  assert.equal(validateConsumption(v),true,JSON.stringify(validateConsumption.errors));
  delete v.confirmationRef;assert.equal(validateConsumption(v),false);
});
test('目标消费结构拒绝缺来源判断授权快照及不完整效果读回',()=>{
  for(const mutate of [v=>{delete v.context.authorizationDigest;},v=>{delete v.context.observationSetDigest;},v=>{delete v.base.blueprint;},v=>{delete v.arrangement;},v=>{v.events=[];},v=>{v.observations=[];},v=>{v.decision=null;},v=>{delete v.executionVerificationRef;},v=>{v.effects.oldPending.ref=null;},v=>{delete v.effects.futureWork;},v=>{v.observations[0].status='expired';}]) {
    const v=consumption();mutate(v);assert.equal(validateConsumption(v),false);
  }
});
