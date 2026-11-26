import assert from "node:assert/strict";
import test from "node:test";
import { SqliteWorkspaceStore } from "@c-assistant/storage";
import { emailPlanFixture, verifiedEmailFixture } from "./email.fixture.test.js";
import { planDraftForRevision } from "./plan-revision.js";
import { executionToken } from "./execution-itinerary.js";
import { createEmailAttentionMonitor } from "./email-attention-monitor.js";
import type { ConnectorBundle } from "./connector-bundle.js";

test("逐活动来源候选持久未决，不发送确定警告或凭正常状态恢复",async()=>{
  const store=new SqliteWorkspaceStore(":memory:");
  try {
    const plan=emailPlanFixture(store);verifiedEmailFixture(store);
    const now=new Date("2026-11-10T08:30:00Z");let calls=0;
    const connectors={maps:{searchPlaces:async({query}:{query:string})=>{calls++;return {status:"available",provider:"google_maps",observedAt:now.toISOString(),data:[{id:query,name:query,city:"Paris",location:"2.34,48.851",businessStatus:"temporarily_closed"}]};}},googleWeather:{}} as unknown as ConnectorBundle;
    const monitor=createEmailAttentionMonitor({store,getConnectors:()=>connectors,now:()=>now});
    await monitor.run("venue",new Map([["paris","UTC"]]));
    assert.equal(calls,3);
    const observations=store.listTravelAdjustmentObservations(plan.id,plan.version);
    assert.equal(observations.length,4);
    assert.equal(observations.filter(item=>item.observation.status==="uncovered").length,1);
    assert.ok(observations.every(item=>item.lastReliable===null));
    assert.ok(observations.every(item=>item.observation.factObservedAt===null));
    assert.equal(store.email.list().length,0);assert.equal(store.getExecutionPlan()?.version,plan.version);
  } finally {store.close();}
});

test("当前天气不替代远期预报，所有活动均保留覆盖",async()=>{
  const store=new SqliteWorkspaceStore(":memory:");
  try {
    const plan=emailPlanFixture(store);verifiedEmailFixture(store);let calls=0;
    const now=new Date("2026-11-10T08:30:00Z");
    const connectors={maps:{},googleWeather:{weather:async()=>{calls++;return {status:"available",provider:"google_weather",observedAt:now.toISOString(),data:{current:{observedAt:now.toISOString(),condition:"Storm",conditionCode:"storm"},daily:[],retrievedAt:now.toISOString()}};}}} as unknown as ConnectorBundle;
    await createEmailAttentionMonitor({store,getConnectors:()=>connectors,now:()=>now}).run("journey",new Map([["paris","UTC"]]));
    assert.equal(calls,3);
    const observations=store.listTravelAdjustmentObservations(plan.id,plan.version).map(item=>item.observation);
    assert.equal(observations.length,4);
    assert.equal(observations.filter(item=>item.sourceKind==="weather_forecast"&&item.status==="uncovered").length,2);
    assert.equal(observations.find(item=>item.sourceKind==="weather_current"&&item.status==="unknown")?.factObservedAt,now.toISOString());
    assert.equal(store.email.list().length,0);
  } finally {store.close();}
});

test("来源失败不丢覆盖，await中授权更改拒绝全部陈旧观察",async()=>{
  const store=new SqliteWorkspaceStore(":memory:");
  try {
    const plan=emailPlanFixture(store);verifiedEmailFixture(store);
    let changed=false;
    const connectors={maps:{searchPlaces:async()=>{if(!changed){store.email.setEnabled(false);changed=true;}throw new Error("不可公开的来源原文");}},googleWeather:{}} as unknown as ConnectorBundle;
    await createEmailAttentionMonitor({store,getConnectors:()=>connectors,now:()=>new Date("2026-11-10T08:30:00Z")}).run("venue",new Map([["paris","UTC"]]));
    assert.deepEqual(store.listTravelAdjustmentObservations(plan.id,plan.version),[]);
    assert.equal(store.email.list().length,0);
  } finally {store.close();}
});


test("慢查询返回及整批提交前重新校验天气与活动有效期",async()=>{
  const store=new SqliteWorkspaceStore(":memory:");
  try {
    const plan=emailPlanFixture(store);verifiedEmailFixture(store);
    let clock=new Date("2026-11-10T08:30:00Z");let calls=0;
    const connectors={maps:{},googleWeather:{weather:async()=>{
      calls++; if(calls===2) clock=new Date("2026-11-10T10:00:01Z");
      return {status:"available",provider:"google_weather",observedAt:"2026-11-10T08:30:00Z",data:{current:{observedAt:"2026-11-10T08:30:00Z",condition:"雷雨",conditionCode:"STORM",temperatureC:18,rawDebug:"不应保存的来源自由文本"},daily:[],retrievedAt:"2026-11-10T08:30:00Z"}};
    }}} as unknown as ConnectorBundle;
    await createEmailAttentionMonitor({store,getConnectors:()=>connectors,now:()=>clock}).run("journey",new Map([["paris","UTC"]]));
    const observations=store.listTravelAdjustmentObservations(plan.id,plan.version).map(item=>item.observation);
    assert.equal(observations.find(item=>item.candidate?.kind==="weather_current")?.status,"expired");
    assert.equal(JSON.stringify(observations).includes("不应保存的来源自由文本"),false);
    assert.equal(store.email.list().length,0);
    assert.ok(observations.some(item=>item.candidate?.kind==="weather_current"&&item.candidate.condition==="雷雨"));
  } finally {store.close();}
});

test("同地点多次到访分别保存候选，歧义集合可恢复",async()=>{
  const store=new SqliteWorkspaceStore(":memory:");
  try {
    const plan=emailPlanFixture(store);verifiedEmailFixture(store);
    const original=store.getExecutionPlan.bind(store);
    const repeated=structuredClone(plan);repeated.presentation!.days[0]!.blocks!.push({id:"repeat",kind:"stop",order:5,title:"再次到访",placeId:"museum",startTime:"17:00",evidence:[]});
    store.getExecutionPlan=()=>repeated;
    let calls=0; const now=new Date("2026-11-10T08:30:00Z");
    const connectors={maps:{searchPlaces:async({query}:{query:string})=>{calls++;return {status:"available",provider:"google_maps",observedAt:now.toISOString(),data:[1,2].map(id=>({id:String(id),name:query,city:"Paris",location:"2.34,48.851",businessStatus:"temporarily_closed"}))};}},googleWeather:{}} as unknown as ConnectorBundle;
    await createEmailAttentionMonitor({store,getConnectors:()=>connectors,now:()=>now}).run("venue",new Map([["paris","UTC"]]));
    assert.equal(calls,4);
    const observations=store.listTravelAdjustmentObservations(plan.id,plan.version).map(item=>item.observation);
    assert.equal(observations.filter(item=>item.candidate?.kind==="venue"&&item.candidate.name==="Museum").length,2);
    assert.equal(observations.filter(item=>item.status==="ambiguous").length,4);
    assert.ok(observations.filter(item=>item.candidate?.kind==="venue"&&item.candidate.name==="Museum").every(item=>item.objectRef==="place:museum"));
    assert.ok(observations.filter(item=>item.candidate?.kind==="venue").every(item=>item.candidate?.kind==="venue"&&item.candidate.matches.length===2));
    store.getExecutionPlan=original;
  } finally {store.close();}
});

test("保存预订逐分段观察且不持久化保护内容或地点原文",async()=>{
  const store=new SqliteWorkspaceStore(":memory:");
  try {
    const draft=store.getWorkspace().activePlan;
    store.saveTravelBooking({id:"synthetic-booking",planId:draft.id,type:"train",status:"cancelled",title:"不应复制的预订标题",source:"user",sourceHash:"synthetic",sourceLabel:"隔离资料",importedAt:"2026-11-10T07:00:00Z",updatedAt:"2026-11-10T08:00:00Z",constraintStrength:"soft",segments:["future","past","ignored","invalid-zone"].map((id,index)=>({id,segmentType:"train_leg",title:"不应复制的分段标题",status:"cancelled",startAtLocal:index===1?"2026-11-09T10:00":"2026-11-10T12:00",startTimeZone:index===3?"Invalid/Zone":"UTC",origin:"不应复制的地点",constraintStrength:index===2?"ignored":"soft",fixedCommitment:false,needsReviewReasons:[]}))});
    store.confirmPlan(draft.id);verifiedEmailFixture(store);const plan=store.getExecutionPlan()!;
    await createEmailAttentionMonitor({store,getConnectors:()=>({maps:{},googleWeather:{}} as unknown as ConnectorBundle),now:()=>new Date("2026-11-10T08:30:00Z")}).run("journey",new Map());
    const observations=store.listTravelAdjustmentObservations(plan.id,plan.version).map(item=>item.observation).filter(item=>item.sourceKind==="saved_booking");
    assert.equal(observations.length,4);assert.equal(observations.filter(item=>item.status==="uncovered").length,3);
    const future=observations.find(item=>item.candidate?.kind==="saved_booking"&&item.candidate.segmentId==="future")!.candidate;
    assert.ok(future?.kind==="saved_booking");assert.equal(future.bookingConstraintStrength,"soft");assert.equal(future.segmentConstraintStrength,"soft");assert.equal(future.fixedCommitment,false);
    assert.match(observations.find(item=>item.candidate?.kind==="saved_booking"&&item.candidate.segmentId==="invalid-zone")?.reason??"",/无效/);
    assert.equal(observations.find(item=>item.candidate?.kind==="saved_booking"&&item.candidate.segmentId==="future")?.status,"unknown");
    assert.equal(JSON.stringify(observations).includes("不应复制"),false);
    assert.ok(observations.every(item=>item.sourceRevision));
    assert.ok(observations.every(item=>item.candidate?.kind==="saved_booking"&&item.candidate.bookingConstraintStrength==="soft"&&item.candidate.fixedCommitment===false));
    assert.equal(observations.find(item=>item.candidate?.kind==="saved_booking"&&item.candidate.segmentId==="ignored")?.candidate?.kind,"saved_booking");
    assert.match(observations.find(item=>item.candidate?.kind==="saved_booking"&&item.candidate.segmentId==="invalid-zone")?.reason??"",/无效/);
    assert.equal(store.email.list().length,0);
  } finally {store.close();}
});

test("来源初始化失败逐活动持久且同一monitor可立即再次运行",async()=>{
  const store=new SqliteWorkspaceStore(":memory:");
  try {
    const plan=emailPlanFixture(store);verifiedEmailFixture(store);let attempts=0;let calls=0;
    const now=new Date("2026-11-10T08:30:00Z");
    const connectors={maps:{searchPlaces:async()=>{calls++;return {status:"unavailable"};}},googleWeather:{}} as unknown as ConnectorBundle;
    const monitor=createEmailAttentionMonitor({store,getConnectors:()=>{if(++attempts===1)throw new Error("private provider failure");return connectors;},now:()=>now});
    await monitor.run("venue",new Map([["paris","UTC"]]));
    const failed=store.listTravelAdjustmentObservations(plan.id,plan.version).map(item=>item.observation);
    assert.equal(failed.filter(item=>item.status==="failed").length,3);
    assert.equal(JSON.stringify(failed).includes("private provider failure"),false);
    await monitor.run("venue",new Map([["paris","UTC"]]));
    assert.equal(attempts,2);assert.equal(calls,3);assert.equal(store.email.list().length,0);
  } finally {store.close();}
});

test("跨城跨日逐当地日期选择预报，无效时区不丢其他活动",async()=>{
  const store=new SqliteWorkspaceStore(":memory:");
  try {
    const plan=emailPlanFixture(store);verifiedEmailFixture(store);
    const changed=structuredClone(plan);const day=changed.presentation!.days[0]!;
    changed.presentation!.places.push({...structuredClone(changed.presentation!.places[1]!),id:"tokyo-museum",city:"Tokyo"},{...structuredClone(changed.presentation!.places[3]!),id:"tokyo-garden",city:"Tokyo"},{...structuredClone(changed.presentation!.places[1]!),id:"invalid-place",city:"Invalid"});
    changed.presentation!.days.push({...structuredClone(day),id:"tokyo-day",date:"2026-11-11",city:"Tokyo",blocks:[{id:"tokyo-stop",kind:"stop",order:1,title:"Visit",placeId:"tokyo-museum",startTime:"09:00",evidence:[]},{id:"tokyo-later",kind:"stop",order:2,title:"Later",placeId:"tokyo-garden",startTime:"12:00",evidence:[]}],stops:[]});
    changed.presentation!.days.push({...structuredClone(day),id:"invalid-day",city:"Invalid",blocks:[{id:"invalid-stop",kind:"stop",order:1,title:"Visit",placeId:"invalid-place",startTime:"09:00",evidence:[]}],stops:[]});
    store.getExecutionPlan=()=>changed;
    const now=new Date("2026-11-10T23:30:00Z");let calls=0;
    const connectors={maps:{},googleWeather:{weather:async()=>{calls++;return {status:"available",data:{retrievedAt:now.toISOString(),current:{observedAt:now.toISOString(),conditionCode:"CLEAR"},daily:[{date:"2026-11-10",conditionDay:"RAIN"},{date:"2026-11-11",conditionDay:"CLEAR"}]}};}}} as unknown as ConnectorBundle;
    await createEmailAttentionMonitor({store,getConnectors:()=>connectors,now:()=>now}).run("journey",new Map([["paris","UTC"],["tokyo","Asia/Tokyo"],["invalid","Invalid/Zone"]]));
    const observations=store.listTravelAdjustmentObservations(plan.id,plan.version).map(item=>item.observation);
    const tokyo=observations.find(item=>item.key===`journey:${executionToken("tokyo-day:tokyo-stop")}`);
    assert.equal(calls,2);assert.equal(tokyo?.targetDate,"2026-11-11");assert.equal(tokyo?.timeZone,"Asia/Tokyo");assert.equal(tokyo?.candidate?.kind,"weather_current");
    const forecast=observations.find(item=>item.key===`journey:${executionToken("tokyo-day:tokyo-later")}`)?.candidate;
    assert.ok(forecast?.kind==="weather_forecast");assert.equal(forecast.date,"2026-11-11");assert.equal(forecast.conditionDay,"CLEAR");
    assert.equal(observations.find(item=>item.key===`journey:${executionToken("invalid-day:invalid-stop")}`)?.status,"uncovered");
    assert.match(observations.find(item=>item.key===`journey:${executionToken("invalid-day:invalid-stop")}`)?.reason??"",/无效/);
    assert.equal(observations.filter(item=>item.targetDate==="2026-11-10"&&item.timeZone==="UTC").every(item=>item.status==="uncovered"),true);
    assert.equal(store.email.list().length,0);
  } finally {store.close();}
});

test("未来来源时间保持未知，场馆候选在整批提交前过期",async()=>{
  const store=new SqliteWorkspaceStore(":memory:");
  try {
    const plan=emailPlanFixture(store);verifiedEmailFixture(store);let clock=new Date("2026-11-10T08:30:00Z");let calls=0;
    const connectors={maps:{searchPlaces:async({query}:{query:string})=>{calls++;if(calls===3)clock=new Date("2026-11-11T08:30:01Z");return {status:"available",observedAt:calls===2?"2026-11-12T08:30:00Z":"2026-11-10T08:30:00Z",data:[{name:query,city:"Paris",location:"2.34,48.851",businessStatus:"operational"}]};}},googleWeather:{}} as unknown as ConnectorBundle;
    await createEmailAttentionMonitor({store,getConnectors:()=>connectors,now:()=>clock}).run("venue",new Map([["paris","UTC"]]));
    const observations=store.listTravelAdjustmentObservations(plan.id,plan.version).map(item=>item.observation);
    assert.equal(observations.filter(item=>item.candidate?.kind==="venue"&&item.status==="expired").length,3);
    assert.ok(observations.every(item=>item.status!=="changed"&&item.status!=="unchanged"));
    assert.equal(store.email.list().length,0);
  } finally {store.close();}
});

test("未来天气事实不会变成可靠观察",async()=>{
  const store=new SqliteWorkspaceStore(":memory:");
  try {
    const plan=emailPlanFixture(store);verifiedEmailFixture(store);const now=new Date("2026-11-10T08:30:00Z");
    const connectors={maps:{},googleWeather:{weather:async()=>({status:"available",data:{current:{observedAt:"2026-11-10T09:00:00Z",conditionCode:"CLEAR"},daily:[]}})}} as unknown as ConnectorBundle;
    await createEmailAttentionMonitor({store,getConnectors:()=>connectors,now:()=>now}).run("journey",new Map([["paris","UTC"]]));
    const current=store.listTravelAdjustmentObservations(plan.id,plan.version).find(item=>item.observation.candidate?.kind==="weather_current");
    assert.equal(current?.observation.status,"unknown");assert.match(current?.observation.reason??"",/超前/);assert.equal(current?.lastReliable,null);
  } finally {store.close();}
});


test("缺失时区后的即时补全不被旧范围节流，相同范围成功采集仍去重",async()=>{
  const store=new SqliteWorkspaceStore(":memory:");
  try {
    const plan=emailPlanFixture(store);verifiedEmailFixture(store);
    const now=new Date("2026-11-10T08:30:00Z");let calls=0;
    const connectors={maps:{},googleWeather:{weather:async()=>{calls++;return {status:"available",provider:"google_weather",observedAt:now.toISOString(),data:{current:{observedAt:now.toISOString(),conditionCode:"CLEAR"},daily:[]}};}}} as unknown as ConnectorBundle;
    const monitor=createEmailAttentionMonitor({store,getConnectors:()=>connectors,now:()=>now});
    await monitor.run("journey",new Map());assert.equal(calls,0);
    assert.ok(store.listTravelAdjustmentObservations(plan.id,plan.version).every(item=>item.observation.status==="uncovered"));
    const zones=new Map([["paris","UTC"]]);await monitor.run("journey",zones);
    const saved=store.listTravelAdjustmentObservations(plan.id,plan.version);
    assert.ok(calls>0);assert.ok(saved.some(item=>item.observation.candidate?.kind==="weather_current"&&item.observation.status==="unknown"));
    const before=calls;await monitor.run("journey",zones);assert.equal(calls,before);
    assert.deepEqual(store.listTravelAdjustmentObservations(plan.id,plan.version),saved);
    store.email.updateSettings({recipient:store.email.settings().recipient,cityTimeZones:{paris:"UTC"}});
    await monitor.run("journey",zones);assert.ok(calls>before);
    assert.equal(store.email.list().length,0);assert.deepEqual(store.getExecutionPlan(),plan);
  } finally {store.close();}
});


test("正规保存重排后逐到访key可变，稳定地点事件对象与日期保持",async()=>{
  const store=new SqliteWorkspaceStore(":memory:");
  try {
    const original=emailPlanFixture(store);verifiedEmailFixture(store);
    const draft=planDraftForRevision(original);draft.presentation!.days[0]!.blocks=[];
    const created=store.createGeneratedPlan(draft);store.confirmPlan(created.activePlan.id,created.activePlan.version);
    const base=store.getExecutionPlan()!;const now=new Date("2026-11-10T08:30:00Z");
    const connectors={maps:{searchPlaces:async({query}:{query:string})=>({status:"available",provider:"google_maps",observedAt:now.toISOString(),data:[{id:query,name:query,city:"Paris",location:"2.34,48.851",businessStatus:"temporarily_closed"}]})},googleWeather:{}} as unknown as ConnectorBundle;
    await createEmailAttentionMonitor({store,getConnectors:()=>connectors,now:()=>now}).run("venue",new Map([["paris","UTC"]]));
    const before=store.listTravelAdjustmentObservations(base.id,base.version).map(row=>row.observation).find(o=>o.objectRef==="place:museum")!;
    const day=base.presentation!.days[0]!;
    store.savePlanPresentationEdits({planId:base.id,expectedVersion:base.version,assignments:Object.fromEntries(day.placeIds.map(id=>[id,day.id])),priorities:{},orders:{[day.id]:["garden","restaurant","museum"]}});
    const revised=store.getExecutionPlan()!;
    await createEmailAttentionMonitor({store,getConnectors:()=>connectors,now:()=>now}).run("venue",new Map([["paris","UTC"]]));
    const after=store.listTravelAdjustmentObservations(revised.id,revised.version).map(row=>row.observation).find(o=>o.objectRef==="place:museum")!;
    assert.ok(before&&after);assert.equal(after.objectRef,before.objectRef);assert.equal(after.targetDate,before.targetDate);assert.notEqual(after.key,before.key);
    assert.equal(store.email.list().length,0);
  }finally{store.close();}
});
