import assert from "node:assert/strict";
import test from "node:test";
import {copyFileSync,mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {randomUUID} from "node:crypto";
import {DatabaseSync} from "node:sqlite";
import {SqliteWorkspaceStore} from "./index.js";

const historical=new URL("../../../tests/browser/fixtures/empty-source-snapshot.sqlite",import.meta.url);
const createdAt="2026-11-01T00:00:00Z";
function tip(store:SqliteWorkspaceStore) {
  const before=store.getWorkspace();
  return store.applyDirectBlueprintRevisionBatch({expectedPlanId:before.activePlan.id,expectedVersion:before.activePlan.version,expectedBlueprintVersion:before.activeBlueprint!.version,requestId:randomUUID(),revisions:[{kind:"set_tip_state",tipId:before.activeBlueprint!.travelTips![0]!.id,pinned:true,createdAt}]});
}
function refresh(store:SqliteWorkspaceStore,batch:boolean) {
  const before=store.getWorkspace(),segment=before.activePlan.presentation!.routeSegments[0]!;
  const route={segmentId:segment.id,observedAt:createdAt,distanceMeters:1200,durationSeconds:600,originCoordinates:[139.76,35.68] as [number,number],destinationCoordinates:[139.77,35.69] as [number,number]};
  if(batch)store.saveGeneratedPlanRouteRefresh({planId:before.activePlan.id,expectedVersion:before.activePlan.version,provider:"google_maps",routes:[route]});
  else store.savePlanRouteRefresh({planId:before.activePlan.id,expectedVersion:before.activePlan.version,provider:"google_maps",...route});
  assert.equal(store.getWorkspace().activePlan.id,before.activePlan.id);
}

test("真实旧空快照来源经内容编辑、两种路线刷新、任务推进和部分选择后重启仍保留义务",()=>{
  const directory=mkdtempSync(join(tmpdir(),"landi-source-origin-")),file=join(directory,"isolated.sqlite");copyFileSync(historical,file);
  let store=new SqliteWorkspaceStore(file);
  try{
    const root=store.getWorkspace();
    assert.equal(store.getPlanBlueprintLineage(root.activePlan.id)!.compilerVersion,"2.0.0");
    refresh(store,false);
    assert.equal(store.getPlanBlueprintLineage(root.activePlan.id)!.compilerVersion,"2.0.0");
    assert.equal(store.getPlanBlueprintLineage(root.activePlan.id)!.blueprintVersion,2);
    const first=tip(store);
    assert.deepEqual(first.beforeIdentity,{planId:root.activePlan.id,planVersion:root.activePlan.version+1,blueprintId:root.activeBlueprint!.id,blueprintVersion:2});
    refresh(store,true);
    const beforeTask=store.getWorkspace(),task=beforeTask.activePlan.stages.flatMap(stage=>stage.tasks)[0];
    if(task)store.setPlanTaskChecked(beforeTask.activePlan.id,task.id,true);
    const second=tip(store);
    let context=store.getBookingRelationshipReviewContext(second.workspace.activePlan.id);
    assert.equal(context.sourceIssues.some(issue=>issue.includes("继承记录")),false);
    assert.deepEqual([...context.pendingSourceBookingIds].sort(),["fixture-source-fixed","fixture-source-soft"]);
    const selected=store.applyDirectBlueprintRevisionBatch({expectedPlanId:context.expectedPlanId,expectedVersion:context.expectedVersion,expectedBlueprintVersion:context.blueprintVersion,requestId:randomUUID(),revisions:[{kind:"select_booking_sources",sourceBookingIds:["fixture-source-soft"],expectedSourceSetDigest:context.sourceSetDigest,createdAt}]}).workspace;
    context=store.getBookingRelationshipReviewContext(selected.activePlan.id);
    assert.deepEqual(context.pendingSourceBookingIds,["fixture-source-fixed"]);
    const sources=store.listCurrentTravelBookingSourcesForPlan(selected.activePlan.id,{includePending:true});
    for(const source of sources){assert.equal(source.planId,root.activePlan.id);assert.equal(store.countProtectedBookingAttachments(source.id),1);}
    store.close();store=new SqliteWorkspaceStore(file);
    assert.deepEqual(store.getBookingRelationshipReviewContext(selected.activePlan.id).pendingSourceBookingIds,["fixture-source-fixed"]);
    assert.equal(store.getBookingRelationshipReviewContext(selected.activePlan.id).sourceIssues.some(issue=>issue.includes("继承记录")),false);
  }finally{store.close();rmSync(directory,{recursive:true,force:true});}
});

test("同Plan执行修复和纯内容撤销保留精确祖先来源与旧执行连续",()=>{
  const directory=mkdtempSync(join(tmpdir(),"landi-source-repair-")),file=join(directory,"isolated.sqlite");copyFileSync(historical,file);const store=new SqliteWorkspaceStore(file);
  try{
    const edited=tip(store).workspace;store.confirmPlan(edited.activePlan.id);const approved=store.getWorkspace();
    const repaired={...structuredClone(approved.activeBlueprint!),version:approved.activeBlueprint!.version+1,summary:"虚构执行修复核对"};store.saveTripBlueprint(repaired);
    store.saveExecutionBlueprintRepair({planId:approved.activePlan.id,expectedVersion:approved.activePlan.version,expectedBlueprintVersion:approved.activeBlueprint!.version,blueprint:repaired});
    let context=store.getBookingRelationshipReviewContext(approved.activePlan.id);assert.equal(context.sourceIssues.some(issue=>issue.includes("继承记录")),false);assert.equal(context.pendingSourceBookingIds.length,2);
    const saved=tip(store);const beforeUndo=saved.workspace;
    const restored=store.undoDirectBlueprintRevision({expectedPlanId:beforeUndo.activePlan.id,expectedVersion:beforeUndo.activePlan.version,expectedBlueprintVersion:beforeUndo.activeBlueprint!.version,revisionId:saved.revision.id,requestId:randomUUID()});
    context=store.getBookingRelationshipReviewContext(restored.activePlan.id);assert.equal(context.sourceIssues.some(issue=>issue.includes("继承记录")),false);assert.equal(context.pendingSourceBookingIds.length,2);assert.equal(restored.executionPlan!.id,approved.activePlan.id);
    const db=new DatabaseSync(file);try{const row=db.prepare("SELECT result_json FROM direct_blueprint_undos WHERE revision_id=?").get(saved.revision.id) as {result_json:string};assert.deepEqual(JSON.parse(row.result_json).beforeIdentity,{planId:beforeUndo.activePlan.id,planVersion:beforeUndo.activePlan.version,blueprintId:beforeUndo.activeBlueprint!.id,blueprintVersion:beforeUndo.activeBlueprint!.version});}finally{db.close();}
  }finally{store.close();rmSync(directory,{recursive:true,force:true});}
});

test("来源祖先损坏回执失败关闭，旧完整字段缺失按历史合同兼容",()=>{
  const directory=mkdtempSync(join(tmpdir(),"landi-source-corrupt-")),baseline=join(directory,"baseline.sqlite");copyFileSync(historical,baseline);
  let seed=new SqliteWorkspaceStore(baseline);const saved=tip(seed);seed.close();
  const cases:Array<{label:string;change:(row:Record<string,string|number>)=>void}>= [
    {label:"零父版本",change:row=>{const value=JSON.parse(String(row.fingerprint));value.expectedVersion=0;row.fingerprint=JSON.stringify(value);}},
    {label:"超持久父版本",change:row=>{const value=JSON.parse(String(row.fingerprint));value.expectedVersion=999;row.fingerprint=JSON.stringify(value);}},
    {label:"错误基准蓝图",change:row=>{const value=JSON.parse(String(row.fingerprint));value.expectedBlueprintVersion=2;row.fingerprint=JSON.stringify(value);}},
    {label:"部分新基准身份",change:row=>{const value=JSON.parse(String(row.result_json));value.beforeIdentity={planId:value.beforeIdentity.planId};row.result_json=JSON.stringify(value);}},
    {label:"错新基准身份",change:row=>{const value=JSON.parse(String(row.result_json));value.beforeIdentity.planVersion++;row.result_json=JSON.stringify(value);}},
    {label:"结果和原工作区不同",change:row=>{const value=JSON.parse(String(row.result_json));value.workspace.activePlan.version++;row.result_json=JSON.stringify(value);}},
    {label:"结果与审计行不同",change:row=>{row.plan_version=2;}},
    {label:"父边自环",change:row=>{const value=JSON.parse(String(row.fingerprint));value.expectedPlanId=saved.workspace.activePlan.id;row.fingerprint=JSON.stringify(value);}},
    {label:"父快照跨会话",change:row=>{const value=JSON.parse(String(row.before_json));value.proposalRef.sessionId="虚构另一会话";row.before_json=JSON.stringify(value);}}
  ];
  try{
    for(const entry of cases){
      const file=join(directory,`${randomUUID()}.sqlite`);copyFileSync(baseline,file);const db=new DatabaseSync(file);
      const row=db.prepare("SELECT * FROM direct_blueprint_edits WHERE id=?").get(saved.revision.id) as Record<string,string|number>;entry.change(row);
      assert.ok(typeof row.fingerprint==="string"&&typeof row.result_json==="string"&&typeof row.plan_version==="number"&&typeof row.before_json==="string");
      db.prepare("UPDATE direct_blueprint_edits SET fingerprint=?,result_json=?,plan_version=?,before_json=? WHERE id=?").run(row.fingerprint,row.result_json,row.plan_version,row.before_json,saved.revision.id);db.close();
      const store=new SqliteWorkspaceStore(file);try{const context=store.getBookingRelationshipReviewContext(saved.workspace.activePlan.id);assert.ok(context.sourceIssues.some(issue=>issue.includes("继承记录")),entry.label);}finally{store.close();}
    }
    const db=new DatabaseSync(baseline),row=db.prepare("SELECT result_json FROM direct_blueprint_edits WHERE id=?").get(saved.revision.id) as {result_json:string};const old=JSON.parse(row.result_json);delete old.beforeIdentity;db.prepare("UPDATE direct_blueprint_edits SET result_json=? WHERE id=?").run(JSON.stringify(old),saved.revision.id);db.close();
    seed=new SqliteWorkspaceStore(baseline);assert.equal(seed.getBookingRelationshipReviewContext(saved.workspace.activePlan.id).sourceIssues.some(issue=>issue.includes("继承记录")),false);seed.close();
  }finally{rmSync(directory,{recursive:true,force:true});}
});
