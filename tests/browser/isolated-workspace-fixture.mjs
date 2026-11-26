import { TRIP_BLUEPRINT_SCHEMA_VERSION, assertTripBlueprintIntegrity, compileTripBlueprint, blueprintBookingConstraintsFromTravelBookings } from '../../packages/core/lib/index.js';
import { SqliteWorkspaceStore } from '../../packages/storage/lib/index.js';
import { constants, copyFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// 此夹具仅用于隔离开发验收，所有地点、证据和预订均为虚构内容。
export const workspaceFixtureScenarios = ['workspace', 'booking-priority', 'booking-relationships', 'legacy-booking-sources', 'empty-source-snapshot', 'missing-source-snapshot'];

export function initializeWorkspaceFixture(databasePath, { sourceOrigin, scenario = 'workspace' } = {}) {
  if (!workspaceFixtureScenarios.includes(scenario)) throw Error('未知隔离验收场景。');
  const historical = ['empty-source-snapshot', 'missing-source-snapshot'].includes(scenario);
  if (!existsSync(databasePath) && historical) {
    copyFileSync(fileURLToPath(new URL(`./fixtures/${scenario}.sqlite`, import.meta.url)), databasePath, constants.COPYFILE_EXCL);
  }
  const store = new SqliteWorkspaceStore(databasePath);
  try {
    if (store.getWorkspace().activeBlueprint) return store.getWorkspace();
    if (historical) throw Error('历史夹具缺少原始旅行草稿，拒绝重新初始化。');
    store.updateProfile({ displayName: '开发验收旅人', preferredLanguage: 'zh-CN', nationality: '中国', gender: 'prefer_not_to_say', immigrationStatus: 'unknown', travelPreferences: '虚构行程，仅供隔离开发验收' });
    const now = '2026-11-05T04:00:00.000Z';
    const session = store.createPlanningSession('travel', new Date(now));
    const proposal = { version: 1, title: '虚构海湾两日游', objective: '验证旅行工作区', theme: '文化与饮食', segments: ['虚构海湾'], skeleton: ['2026-12-01 至 2026-12-02'], tradeoffs: [], assumptions: ['全部内容均为虚构开发夹具'], decisionPoints: [] };
    store.savePlanningSession({ ...session, status: 'proposal_ready', proposal, updatedAt: now });
    store.confirmPlanningSession(session.id, 1);
    const generationKey = `${session.id}:1:landi-trip-blueprint@1.0.0`;
    const proposalRef = { sessionId: session.id, proposalVersion: 1 };
    const skillLineage = { skillId: 'landi-trip-blueprint', skillVersion: '1.0.0' };
    store.saveBlueprintGeneration({ generationKey, proposalRef, skillLineage, status: 'running', stage: 'research', createdAt: now, updatedAt: now });
    const source = (id, status, official = false) => ({ id, title: `${id === 'fact' ? '商家事实' : id === 'old' ? '历史事实' : '灵感'}（虚构验收）来源标题持续阅读至末尾用于验证侧栏换行与完整来源披露不得省略也不得被图框遮挡的全部文字`, authority: official ? '虚构官方' : '虚构资料', url: `https://fixture.invalid/${id}`, retrievedAt: id === 'old' ? '2025-01-01T00:00:00.000Z' : now, status, official, purpose: id === 'inspiration' ? 'inspiration' : 'evidence' });
    const sources = [source('fact', 'verified', true), source('old', 'stale'), source('inspiration', 'recheck')];
    if (sourceOrigin) for (const item of sources) item.url = `${sourceOrigin}/__fixture/sources/${item.id}`;
    const evidence = (id = 'fact') => [{ sourceId: id, status: id === 'old' ? 'stale' : id === 'fact' ? 'verified' : 'recheck', checkedAt: id === 'old' ? '2025-01-01T00:00:00.000Z' : now }];
    const places = Array.from({ length: 8 }, (_, index) => ({
      id: `fixture-place-${index + 1}`, name: ['海湾市场', '灯塔茶馆', '陶艺工坊', '河畔食堂', '北岸餐厅', '桥头茶铺', '庭院点心', '海边小馆'][index],
      locationLabel: '虚构海湾', city: '虚构海湾', area: index % 2 ? '北岸' : '旧城', category: index === 2 ? 'workshop' : 'market',
      priority: index === 0 ? 'must' : 'preferred', coordinates: [35 + index * 0.001, 139 + index * 0.001],
      display: { type: index === 2 ? 'experience' : 'dining' }, whyWorthIt: '此处为虚构地点，用于检查来源、关系与安全编辑。', plan: '自主浏览并核对来源。',
      guideDisplay: { cardSummary: '隔离开发用的具体选项。', comparisonRows: index === 1 ? [{ id: 'unresolved-option', name: '未核实对象', area: '未知', routeFit: '未知', timing: '未知', effort: '未知', sourceState: '未知', evidence: [] }] : [] },
      ...(index === 0 ? { images: [{ url: 'https://fixture.invalid/image.png', alt: '虚构市场的验收图', sourceId: 'inspiration', status: 'recheck', usage: ['card', 'detail'] }] } : {}),
      ...(index === 1 ? { images: [{ url: 'https://fixture.invalid/broken.png', alt: '故意失效的验收图片', sourceId: 'old', status: 'stale', usage: ['card', 'detail'] }] } : {}),
      bookingUrl: `https://fixture.invalid/booking/${index + 1}`, evidence: index === 7 ? [] : evidence(index === 1 ? 'old' : 'fact')
    }));
    // 未关联比较行放在无关系图边的地点，明确命中显式比较分支。
    places[5].guideDisplay.comparisonRows = places[1].guideDisplay.comparisonRows;
    places[1].guideDisplay.comparisonRows = [];
    places[0].guideDisplay.comparisonRows = places.filter((_, index) => index !== 2 && index !== 0).map((place, index) => ({ id: `fixture-comparison-${place.id}`, relatedPlaceId: place.id, name: place.name, area: place.area, routeFit: index % 2 ? '北岸日程附近（虚构）' : '旧城日程附近（虚构）', timing: index === 1 ? '营业与排队资料已过期，需复核' : '午餐营业 11:00–14:00；排队约二十分钟（虚构事实）', effort: index === 6 ? '价格未知' : '茶点约四十元（虚构事实）', sourceState: index === 1 ? '待复核' : '虚构事实证据', evidence: index === 6 ? [] : evidence(index === 1 ? 'old' : 'fact') }));
    places[2].guideDisplay.comparisonRows = [places[0]].map(place => ({ id: `fixture-craft-${place.id}`, relatedPlaceId: place.id, name: place.name, area: place.area, routeFit: '手作主题的明确关联对象', timing: '现场购买免预约；冬季体验须预约（虚构事实）', effort: '茶器约八十元；体验约一百二十元（虚构事实）', sourceState: '虚构事实证据', evidence: evidence() }));
    places[1].guideDisplay.comparisonRows.push({ ...places[2].guideDisplay.comparisonRows[0], id: 'fixture-craft-place-3', relatedPlaceId: places[2].id, name: places[2].name, area: places[2].area });
    const actionRequirements = [{ id: 'fixture-preparation-action', kind: 'preparation', title: '确认开发验收材料', description: '这是明确责任及完成条件的虚构准备要求。', accountableParty: 'traveler', completionCondition: '已检查验收材料。', placeId: places[0].id, evidence: evidence() }];
    if (scenario !== 'workspace') {
      ['软关联目标', '同日双次旅馆', '跨日无关目标', '已预订目标', '独立预约目标', '独立固定目标', '无关软候选', '额外无关目标'].forEach((name, index) => { places[index].name = name; });
      places[3].priority = 'booked';
      actionRequirements.push({ id: 'fixture-reservation-action', kind: 'reservation', title: '独立预约目标的预约要求', description: '虚构独立预约保护，不随关系更正解除。', accountableParty: 'traveler', completionCondition: '明确处理此虚构预约。', placeId: places[4].id, evidence: evidence() });
    }
    const research = { schemaVersion: TRIP_BLUEPRINT_SCHEMA_VERSION, id: 'fixture-research', generationKey, proposalRef, skillLineage, status: 'completed', batches: [{ id: 'fixture-batch', scopeLabel: '虚构海湾', status: 'completed', placeIds: places.map(p => p.id), eventIds: [], sourceIds: sources.map(s => s.id), completedAt: now }], places, events: [], sources, actionRequirements, createdAt: now, updatedAt: now, completedAt: now };
    store.saveResearchSet(research);
    const blueprint = {
      schemaVersion: TRIP_BLUEPRINT_SCHEMA_VERSION, id: 'fixture-blueprint', version: 1, generationKey, proposalRef, skillLineage, researchSetId: research.id,
      title: '虚构海湾两日游', summary: '此行程用于开发验证，不提供真实旅行建议。', language: 'zh-CN', destinations: ['虚构海湾'], startDate: '2026-12-01', endDate: '2026-12-02', places, sources,
      events: [{ id: 'fixture-event', title: '虚构冬季集市', startDate: '2026-12-01', endDate: '2026-12-01', placeId: places[0].id, description: '测试事件自身来源。', evidence: evidence('old') }],
      days: [
        { id: 'fixture-day-1', date: '2026-12-01', kind: 'scheduled', city: '虚构海湾', title: '旧城与北岸', summary: '具体块承载日程。', stops: [{ placeId: places[0].id, order: 1 }, { placeId: places[1].id, order: 2 }], candidatePlaceIds: places.slice(3).map(p => p.id), blocks: [{ id: 'fixture-block-1', kind: 'meal', order: 1, placeId: places[0].id, display: { timeLabel: '午餐前后', timingStatus: 'planned' }, evidence: evidence() }, { id: 'fixture-block-2', kind: 'stop', order: 2, placeId: places[1].id, evidence: evidence('old') }] },
        { id: 'fixture-day-2', date: '2026-12-02', kind: 'scheduled', city: '虚构海湾', title: '工艺体验', summary: '用于跨日返回验证。', stops: [{ placeId: places[2].id, order: 1 }], candidatePlaceIds: [], blocks: [{ id: 'fixture-block-3', kind: 'stop', order: 1, placeId: places[2].id, evidence: evidence() }] }
      ],
      movements: [{ id: 'fixture-movement', dayId: 'fixture-day-1', originPlaceId: places[0].id, destinationPlaceId: places[1].id, mode: 'walking', status: 'recheck', evidence: [] }],
      localFoods: [{ id: 'fixture-food', title: '海湾茶点', description: '同一主题包含七个具体地点。', context: '旧城与北岸', diningPlaceIds: places.filter((_, i) => i !== 2).map(p => p.id), evidence: evidence() }, { id: 'fixture-food-info', title: '无地点的节令饮食', description: '仅供阅读，不可排程。', context: '虚构地方饮食', diningPlaceIds: [], evidence: [] }],
      localProducts: [{ id: 'fixture-product', title: '手作茶器', description: '市场也是购买地点，保持唯一身份。', context: '旧城', purchasePlaceIds: [places[0].id, places[2].id], evidence: evidence('old') }],
      experienceThemes: [{ id: 'fixture-experience', title: '手艺与市集体验', description: '共享地点可从体验透镜进入。', context: '虚构海湾', offeringPlaceIds: [places[0].id, places[2].id], evidence: evidence('inspiration') }],
      guideRelationshipGraph: { relationships: [{ id: 'fixture-relation-1', fromPlaceId: places[0].id, toPlaceId: places[3].id, kind: 'meal_support', rationale: '同日市场的明确餐饮关联', evidence: evidence() }, { id: 'fixture-relation-2', fromPlaceId: places[1].id, toPlaceId: places[4].id, kind: 'same_area', rationale: '同日茶馆的明确邻近关联', evidence: evidence() }] },
      travelTips: [{ id: 'fixture-tip-block', title: '市场付款前核对', body: '这是虚构提示的完整解释，用于验证从块内提示访问原文及持久操作。', theme: 'payment', context: '市场', dayId: 'fixture-day-1', blockId: 'fixture-block-1', placeId: places[0].id, evidence: evidence('old') }, { id: 'fixture-tip-day', title: '工坊入场说明待核实', body: '无来源时应保留未知，不伪造可信事实。', theme: 'etiquette', context: '工坊', dayId: 'fixture-day-2', evidence: [] }, { id: 'fixture-tip-block-only', title: '仅关联茶馆块的提示', body: '这个 Canonical Tip 只有精确块关联，仍须可访问完整解释。', theme: 'etiquette', context: '茶馆', blockId: 'fixture-block-2', evidence: evidence() }],
      preparationChecklist: [{ id: 'fixture-preparation', title: '核对验收材料', description: '打开来源不会自动完成此项。', group: 'documents', completionCondition: '已检查验收材料。', requirementId: actionRequirements[0].id, placeId: places[0].id, evidence: evidence() }],
      actionRequirements, createdAt: now
    };
    if (scenario !== 'workspace') {
      // 相同 Place 的出现身份必须由日程块区分，不能靠名称或顺序猜测。
      blueprint.days[0].blocks.push({ id: 'fixture-block-hotel-return', kind: 'stop', order: 3, placeId: places[1].id, title: '同日双次旅馆取行李', evidence: evidence() });
      blueprint.days[1].stops.push({ placeId: places[1].id, order: 2 }, ...places.slice(3, 6).map((place, index) => ({ placeId: place.id, order: index + 3 })));
      blueprint.days[1].blocks.push({ id: 'fixture-block-hotel-next-day', kind: 'stop', order: 2, placeId: places[1].id, title: '跨日旅馆再次到访', evidence: evidence() }, ...places.slice(3, 6).map((place, index) => ({ id: `fixture-block-protected-${index + 1}`, kind: 'stop', order: index + 3, placeId: place.id, evidence: evidence() })));
      blueprint.movements.push({ id: 'fixture-movement-next-day', dayId: 'fixture-day-2', originPlaceId: places[2].id, destinationPlaceId: places[1].id, mode: 'walking', status: 'recheck', evidence: [] });
      for (const [index, originPlaceId] of [places[1].id, places[3].id, places[4].id].entries()) blueprint.movements.push({ id: `fixture-movement-protected-${index + 1}`, dayId: 'fixture-day-2', originPlaceId, destinationPlaceId: places[index + 3].id, mode: 'walking', status: 'recheck', evidence: [] });
      const segment = (id, title, date, hard = false) => ({ id, segmentType: 'event_window', title, status: hard ? 'confirmed' : 'pending', startAtLocal: `${date}T10:00`, startTimeZone: 'Asia/Shanghai', endAtLocal: `${date}T11:00`, endTimeZone: 'Asia/Shanghai', location: '虚构海湾', constraintStrength: hard ? 'hard' : 'soft', fixedCommitment: hard, needsReviewReasons: [] });
      const booking = (id, title, segments, hard = false) => ({ id, planningSessionId: session.id, type: 'ticket', status: hard ? 'confirmed' : 'pending', title, source: 'user', sourceHash: `fictional-${id}`, sourceLabel: '旅行者虚构验收声明', importedAt: now, updatedAt: now, constraintStrength: hard ? 'hard' : 'soft', segments });
      const soft = booking('fixture-source-soft', '虚构双分段凭证', [segment('fixture-source-soft-first', '虚构凭证首日场次', '2026-12-01'), segment('fixture-source-soft-second', '虚构凭证次日场次', '2026-12-02')]);
      const fixed = booking('fixture-source-fixed', '虚构固定双分段凭证', [segment('fixture-source-fixed-first', '固定凭证首日场次', '2026-12-01', true), segment('fixture-source-fixed-second', '固定凭证次日场次', '2026-12-02', true)], true);
      const legacySecond = booking('fixture-source-legacy-second', '虚构第二固定双分段凭证', [segment('fixture-source-legacy-second-first', '第二固定凭证首日场次', '2026-12-01', true), segment('fixture-source-legacy-second-second', '第二固定凭证次日场次', '2026-12-02', true)], true);
      const records = scenario === 'legacy-booking-sources' ? [fixed, legacySecond, soft] : scenario === 'booking-priority' ? [soft] : [soft, fixed];
      // 所有真源经过正式 Storage 保存，再使用唯一领域投影；绝不预写关系评估。
      for (const record of records) {
        store.saveTravelBooking(record);
        store.saveProtectedBookingAttachment({ bookingId: record.id, sourceHash: record.sourceHash, sourceLabel: record.sourceLabel, contentText: '完全虚构的隔离验收附件，无个人或确认资料。', createdAt: now });
      }
      blueprint.bookingConstraints = blueprintBookingConstraintsFromTravelBookings(scenario === 'legacy-booking-sources' ? [fixed, legacySecond] : records);
      if (scenario === 'legacy-booking-sources') {
        // 合成真实旧投影：保留全部语义，仅缺旧 Schema 未产生的身份与 segment.status。
        blueprint.bookingConstraints.forEach((constraint, index) => {
          constraint.id = `fixture-legacy-booking-${index + 1}`;
          delete constraint.sourceBookingId;
          constraint.segments.forEach((item, segmentIndex) => {
            item.id = `fixture-legacy-segment-${index + 1}-${segmentIndex + 1}`;
            delete item.sourceSegmentId;
            delete item.status;
          });
        });
      }
    }
    assertTripBlueprintIntegrity(blueprint);
    store.saveTripBlueprint(blueprint);
    store.createCompiledBlueprintPlan(compileTripBlueprint(blueprint, { createdAt: now }));
    return store.getWorkspace();
  } finally { store.close(); }
}
