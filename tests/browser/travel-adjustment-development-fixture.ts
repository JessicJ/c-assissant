import {mkdirSync,readdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import { SqliteWorkspaceStore } from '../../packages/storage/lib/index.js';
import { bookingRelationshipReviewContext, compileTripBlueprint, type BookingRelationshipAssessment } from '../../packages/core/lib/index.js';
import {initializeWorkspaceFixture,workspaceFixtureScenarios} from './isolated-workspace-fixture.mjs';

/** 仅隔离开发使用，复用普通工作区夹具，不读取部署配置。 */
export async function prepareTravelAdjustmentDevelopmentFixture(file:string,scenario="workspace") {
  initializeWorkspaceFixture(file,{scenario});
  const store=new SqliteWorkspaceStore(file);
  try {
    if(store.getExecutionPlan())return store.getWorkspace();
    const original=store.getWorkspace();
    store.email.updateSettings({recipient:'traveler@example.test'});
    store.email.beginVerification('123456','2026-11-10T07:30:00.000Z');
    store.email.finishVerificationSend(store.email.settings().revision,'accepted');
    store.email.verifyRecipient('123456','2026-11-10T07:20:00.000Z');
    store.email.setEnabled(true);
    store.email.updateSettings({recipient:'traveler@example.test',cityTimeZones:Object.fromEntries(original.activeBlueprint!.days.map(day=>[day.city,'Asia/Tokyo']))});
    store.confirmPlan(original.activePlan.id,original.activePlan.version,{expectedBlueprintVersion:original.activeBlueprint!.version});
    const blueprint=structuredClone(original.activeBlueprint!);
    blueprint.version++;
    blueprint.title='虚构海湾调整后完整安排';
    blueprint.summary='虚构闭馆后调整顺序，原有旅行边界保持不变。';
    blueprint.days[0]!.title='调整后的第一天';
    blueprint.days[0]!.summary='根据虚构变化重新审阅当日安排。';
    // 整体复制可靠已发布安排，开发夹具只更改说明，避免伪造外部路线。
    store.saveTripBlueprint(blueprint);
    store.createCompiledBlueprintPlan(compileTripBlueprint(blueprint,{createdAt:'2026-11-17T00:00:00Z'}));
    if(blueprint.bookingConstraints?.length){
      // 合成旅人明确声明：各凭证分段依赖整份既有安排。通过正式审阅事务保存，
      // 不猜测名称/日期关系，不提供 Core 派生的目标证明，也不改变任何预订承诺。
      const current=store.getWorkspace(),review=bookingRelationshipReviewContext(current.activeBlueprint!);
      const evidenceRefs=['traveler-declaration:虚构旅人逐项确认凭证依赖完整既有旅行安排'];
      const assessment:BookingRelationshipAssessment={schemaVersion:1,blueprintId:review.blueprintId,blueprintVersion:review.blueprintVersion,universeDigest:review.universeDigest,status:'reviewed',
        units:review.units.map((unit,index)=>({...unit,coverage:'complete',relations:[{id:`fixture-explicit-dependency-${index}`,scope:'dependency',role:'direct_commitment',direction:'booking_depends_on_targets',targets:review.targets.filter(target=>target.kind!=='place_global'),operations:['remove','move','add','priority'],rationale:'虚构旅人明确声明该凭证分段依赖完整既有安排，全部目标及跨日交通均保留。',evidenceRefs}],rationale:'逐项核对全部直接、间接与跨日依赖。',evidenceRefs})),
        decision:{source:'traveler',actorId:'local-traveler',decidedAt:'2026-11-17T00:00:00Z',rationale:'虚构旅人已审阅所有预订分段及完整既有旅行安排，明确保留全部承诺。',evidenceRefs,obligations:['逐项核对全部直接、间接及跨日依赖；待核交通与时间仍明确未知。']}};
      store.applyDirectBlueprintRevisionBatch({expectedPlanId:current.activePlan.id,expectedVersion:current.activePlan.version,expectedBlueprintVersion:current.activeBlueprint!.version,requestId:'fixture-explicit-booking-review',revisions:[{kind:'review_booking_relationships',assessment,expectedSourceSetDigest:store.getCurrentTravelBookingSourceSetDigest(current.activePlan.id),createdAt:'2026-11-17T00:00:00Z'}]});
    }
    const context=store.captureAdjustmentContext();
    store.recordTravelPhase({context,value:'pre_departure',basis:'traveler_statement',recordedAt:'2026-11-17T00:00:00Z',evidenceRefs:['虚构旅人明确尚未出发']});
    const visit=(index:number)=>{const day=original.activeBlueprint!.days[index]??original.activeBlueprint!.days[0]!;const place=original.activeBlueprint!.places.find(place=>place.id===day.stops[0]?.placeId)!;return {objectRef:place.id,targetDate:day.date,candidate:{kind:'venue' as const,name:place.name,city:place.city,matches:[{name:place.name,city:place.city,status:'temporarily_closed' as const}],queryObservedAt:'2026-11-16T00:00:00Z'}};};
    store.commitTravelAdjustment({requestId:'虚构闭馆待审阅',context:store.captureAdjustmentContext(),now:'2026-11-17T00:00:00Z',observations:[{key:'虚构场馆到访',fingerprint:null,...visit(0),sourceKind:'venue',provider:'虚构来源替身',timeZone:'Asia/Tokyo',factObservedAt:null,retrievedAt:'2026-11-17T00:00:00Z',validUntil:null,status:'unknown',reason:'场馆资料尚未核实，出发前请复核是否开放。',evidenceRefs:['https://fixture.invalid/fact']}]});
    const first=store.listTravelAdjustmentObservations(store.getExecutionPlan()!.id,store.getExecutionPlan()!.version)[0]!.observation;
    store.commitTravelAdjustment({requestId:'虚构第二日来源过期待复核',context:store.captureAdjustmentContext(),now:'2026-11-17T00:00:00Z',observations:[{...first,key:'虚构第二日到访',...visit(1),status:'expired',factObservedAt:'2026-11-16T00:00:00Z',retrievedAt:'2026-11-16T00:00:00Z',validUntil:'2026-11-16T01:00:00Z',reason:'虚构旧资料，不能推断目标日仍适用。'}]});
    return store.getWorkspace();
  } finally {store.close();}
}

if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const [directoryArg,portArg,scenario="workspace"]=process.argv.slice(2),port=Number(portArg);
  if(!directoryArg || !Number.isSafeInteger(port) || port<1024 || port>65535)throw Error('请提供新的隔离目录和合法本地端口。');
  if(!workspaceFixtureScenarios.includes(scenario))throw Error('未知隔离验收场景。');
  const directory=resolve(directoryArg);mkdirSync(directory,{recursive:true,mode:0o700});
  if(readdirSync(directory).length)throw Error('夹具目录必须为空，拒绝覆盖已有数据。');
  writeFileSync(join(directory,'landi-development-fixture.json'),JSON.stringify({kind:'landi_isolated_development_fixture',version:1}));
  writeFileSync(join(directory,'transport.json'),JSON.stringify({origin:`http://127.0.0.1:${port}`,scenario}));
  await prepareTravelAdjustmentDevelopmentFixture(join(directory,'workspace.sqlite'),scenario);
  console.log('虚构旅行调整夹具已准备，可由既有隔离工作区服务读取。');
}
