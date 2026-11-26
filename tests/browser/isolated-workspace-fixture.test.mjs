import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initializeWorkspaceFixture } from './isolated-workspace-fixture.mjs';
import { blueprintBookingConstraintsFromTravelBookings } from '../../packages/core/lib/index.js';
import { SqliteWorkspaceStore } from '../../packages/storage/lib/index.js';

for (const scenario of ['booking-relationships', 'legacy-booking-sources', 'empty-source-snapshot', 'missing-source-snapshot']) {
  test(`虚构隔离夹具 ${scenario} 使用真源且不预制审阅，重开不重置`, () => {
    const directory = mkdtempSync(join(tmpdir(), 'landi-booking-fixture-'));
    const databasePath = join(directory, 'workspace.sqlite');
    let store;
    try {
      const initial = initializeWorkspaceFixture(databasePath, { scenario });
      const historical = scenario.endsWith('source-snapshot');
      const blueprint = initial.activeBlueprint;
      assert.equal(blueprint.bookingRelationshipAssessment, undefined);
      assert.equal(blueprint.days[0].blocks.filter(block => block.placeId === 'fixture-place-2').length, 2);
      assert.equal(blueprint.days[1].blocks.filter(block => block.placeId === 'fixture-place-2').length, 1);
      assert.equal(blueprint.movements.length, 5);
      assert.equal(blueprint.places.find(place => place.id === 'fixture-place-1').priority, 'must');
      assert.equal(blueprint.places.find(place => place.id === 'fixture-place-4').priority, 'booked');
      assert.ok(blueprint.actionRequirements.some(item => item.kind === 'reservation' && item.placeId === 'fixture-place-5'));
      store = new SqliteWorkspaceStore(databasePath);
      const context = store.getBookingRelationshipReviewContext(initial.activePlan.id);
      const sessionRecords = store.listTravelBookingsForPlanningSession(blueprint.proposalRef.sessionId);
      const records = historical ? store.listCurrentTravelBookingSourcesForPlan(initial.activePlan.id, { includePending: true }) : sessionRecords;
      assert.equal(records.length, scenario === 'legacy-booking-sources' ? 3 : 2);
      for (const record of records) {
        assert.equal(record.segments.length, 2);
        assert.equal(store.countProtectedBookingAttachments(record.id), 1);
        assert.equal(historical ? record.planId : record.planningSessionId, historical ? initial.activePlan.id : blueprint.proposalRef.sessionId);
      }
      if (scenario === 'booking-relationships') {
        assert.deepEqual(blueprint.bookingConstraints, blueprintBookingConstraintsFromTravelBookings([...records].reverse()));
        assert.equal(context.sourceIssues.length, 0);
        assert.equal(context.units.length, 4);
      } else if (scenario === 'legacy-booking-sources') {
        assert.equal(context.sourceCandidates.length, 3);
        assert.equal(blueprint.bookingConstraints.length, 2);
        for (const [index, sourceId] of ['fixture-source-fixed', 'fixture-source-legacy-second'].entries()) {
          const projected = blueprintBookingConstraintsFromTravelBookings([records.find(record => record.id === sourceId)])[0];
          const legacy = structuredClone(blueprint.bookingConstraints[index]);
          assert.equal('sourceBookingId' in legacy, false);
          legacy.id = projected.id;
          legacy.sourceBookingId = sourceId;
          legacy.segments.forEach((segment, segmentIndex) => {
            assert.equal('status' in segment, false);
            assert.equal('sourceSegmentId' in segment, false);
            segment.id = projected.segments[segmentIndex].id;
            segment.sourceSegmentId = projected.segments[segmentIndex].sourceSegmentId;
            segment.status = legacy.status;
          });
          assert.deepEqual(legacy, projected);
        }
      } else {
        assert.equal(Object.hasOwn(blueprint, 'bookingConstraints'), scenario === 'empty-source-snapshot');
        assert.deepEqual(blueprint.bookingConstraints ?? [], []);
        assert.equal(store.listCurrentTravelBookingSourcesForPlan(initial.activePlan.id).length, 0);
        assert.deepEqual([...context.pendingSourceBookingIds].sort(), ['fixture-source-fixed', 'fixture-source-soft']);
        assert.ok(context.sourceIssues.length > 0, '已有直接归属真源的空快照必须有待核对义务');
        assert.equal(sessionRecords.length, 0);
      }
      store.updateProfile({ ...initial.profile, displayName: '夹具重启保留标记', preferredLanguage: 'zh-CN', nationality: '中国', gender: 'prefer_not_to_say', immigrationStatus: 'unknown', travelPreferences: '虚构验收' });
      store.close(); store = undefined;
      const reopened = initializeWorkspaceFixture(databasePath, { scenario });
      assert.equal(reopened.profile.displayName, '夹具重启保留标记');
      assert.equal(reopened.activePlan.id, initial.activePlan.id);
      assert.deepEqual(reopened.activeBlueprint, blueprint);
      if (historical) {
        store = new SqliteWorkspaceStore(databasePath);
        assert.deepEqual(store.getBookingRelationshipReviewContext(initial.activePlan.id).pendingSourceBookingIds, context.pendingSourceBookingIds);
        for (const record of store.listCurrentTravelBookingSourcesForPlan(initial.activePlan.id, { includePending: true })) {
          assert.equal(record.planId, initial.activePlan.id);
          assert.equal(store.countProtectedBookingAttachments(record.id), 1);
        }
      }
    } finally {
      store?.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

test('默认工作区夹具保持原始日程且重开不覆盖', () => {
  const directory = mkdtempSync(join(tmpdir(), 'landi-default-fixture-'));
  try {
    const databasePath = join(directory, 'workspace.sqlite');
    const initial = initializeWorkspaceFixture(databasePath);
    assert.equal(initial.activeBlueprint.places[0].name, '海湾市场');
    assert.equal(initial.activeBlueprint.days[0].blocks.length, 2);
    assert.deepEqual(initializeWorkspaceFixture(databasePath), initial);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('优先级场景仅有真实软来源且保留重复出现与未排程候选', () => {
  const directory = mkdtempSync(join(tmpdir(), 'landi-priority-fixture-'));
  let store;
  try {
    const file = join(directory, 'workspace.sqlite');
    const workspace = initializeWorkspaceFixture(file, {scenario:'booking-priority'});
    const blueprint = workspace.activeBlueprint;
    store = new SqliteWorkspaceStore(file);
    const sources = store.listCurrentTravelBookingSourcesForPlan(workspace.activePlan.id);
    assert.deepEqual(sources.map(source=>source.id), ['fixture-source-soft']);
    assert.equal(sources[0].segments.length, 2);
    assert.ok(sources[0].segments.every(segment=>segment.constraintStrength==='soft' && !segment.fixedCommitment));
    assert.deepEqual(blueprint.bookingConstraints, blueprintBookingConstraintsFromTravelBookings(sources));
    assert.equal(blueprint.bookingRelationshipAssessment, undefined);
    assert.deepEqual(blueprint.days.map(day=>day.blocks.filter(block=>block.placeId==='fixture-place-2').length), [2,1]);
    assert.ok(blueprint.places.some(place=>place.id==='fixture-place-7' && place.name==='无关软候选'));
    assert.ok(blueprint.days.every(day=>!day.stops.some(stop=>stop.placeId==='fixture-place-7') && !day.blocks.some(block=>block.placeId==='fixture-place-7')));
    assert.equal(store.getBookingRelationshipReviewContext(workspace.activePlan.id).units.length, 2);
  } finally { store?.close(); rmSync(directory, {recursive:true,force:true}); }
});
