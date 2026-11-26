import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {SqliteWorkspaceStore} from '@c-assistant/storage';

const serverDirectory=fileURLToPath(new URL('../',import.meta.url));
const cli=fileURLToPath(new URL('../../../tests/browser/travel-adjustment-development-fixture.ts',import.meta.url));
function run(directory:string,scenario?:string){
  return spawnSync(process.execPath,['--import','tsx',cli,directory,'18987',...(scenario===undefined?[]:[scenario])],{cwd:serverDirectory,encoding:'utf8',timeout:30_000,stdio:['ignore','pipe','pipe']});
}

test('开发 CLI 拒绝未知场景，写入目录前失败',()=>{
  const root=mkdtempSync(join(tmpdir(),'landi-adjustment-cli-invalid-'));
  try{
    const directory=join(root,'new-instance'),result=run(directory,'unknown-scenario');
    assert.ifError(result.error);
    assert.notEqual(result.status,0);
    assert.match(result.stderr,/未知隔离验收场景/);
    assert.equal(existsSync(directory),false);
  }finally{rmSync(root,{recursive:true,force:true});}
});

for(const scenario of ['workspace','booking-relationships']){
  test(`开发 CLI 为新目录保存真实 ${scenario} 绑定及可读取的旅行调整`,()=>{
    const root=mkdtempSync(join(tmpdir(),'landi-adjustment-cli-valid-'));
    try{
      const directory=join(root,'new-instance'),result=run(directory,scenario==='workspace'?undefined:scenario);
      assert.ifError(result.error);
      assert.equal(result.status,0,result.stdout+result.stderr);
      assert.deepEqual(JSON.parse(readFileSync(join(directory,'transport.json'),'utf8')),{origin:'http://127.0.0.1:18987',scenario});
      const store=new SqliteWorkspaceStore(join(directory,'workspace.sqlite'));
      try{
        assert.ok(store.getExecutionPlan());
        const observations=store.listTravelAdjustmentObservations(store.getExecutionPlan()!.id,store.getExecutionPlan()!.version).map(item=>item.observation);
        assert.deepEqual(observations.map(item=>item.status).sort(),['expired','unknown']);
        for(const fact of observations){assert.equal(fact.candidate?.kind,'venue');assert.ok(fact.targetDate);assert.ok(fact.objectRef);}
        const workspace=store.getWorkspace();
        assert.equal(workspace.activeBlueprint!.title,'虚构海湾调整后完整安排');
        if(scenario==='booking-relationships')assert.ok(workspace.activeBlueprint!.bookingConstraints!.length>0);
      }finally{store.close();}
      const repeated=run(directory,scenario);
      assert.notEqual(repeated.status,0);
      assert.match(repeated.stderr,/夹具目录必须为空/);
      assert.equal(JSON.parse(readFileSync(join(directory,'transport.json'),'utf8')).scenario,scenario);
    }finally{rmSync(root,{recursive:true,force:true});}
  });
}

// 使用真实本地 HTTP、普通路由和规范 Store，没有 SMTP/AI/外部 Connector。
for(const invalid of [false,true])test(`真实HTTP确认${invalid?'拒绝未完整审阅预订并保留旧执行':'保留未知交通并保存应用、交接及fake outbox'}`,async()=>{
 const root=mkdtempSync(join(tmpdir(),'landi-adjustment-http-'));
 const {default:Fastify}=await import('fastify');
 const {registerPlanManagementRoutes}=await import('./plan-management-routes.js');
 const {compileTripBlueprint,bookingRelationshipAssessmentIssues}=await import('@c-assistant/core');
 const directory=join(root,'instance'),created=run(directory,'booking-relationships');
 assert.equal(created.status,0,created.stdout+created.stderr);
 const store=new SqliteWorkspaceStore(join(directory,'workspace.sqlite')),server=Fastify();
 try{
  let w=store.getWorkspace();const base=store.getExecutionPlan()!;
  assert.ok(w.activeBlueprint!.movements.every(move=>move.status==='recheck'&&move.durationMinutes===undefined));
  assert.equal(w.activeBlueprint!.bookingRelationshipAssessment!.status,'reviewed');
  assert.deepEqual(bookingRelationshipAssessmentIssues(w.activeBlueprint!,undefined,true,{allowEquivalentReviewedVersion:true}),[]);
  if(invalid){
   const bp=structuredClone(w.activeBlueprint!);bp.version++;bp.bookingRelationshipAssessment!.status='invalidated';
   store.saveTripBlueprint(bp);store.createCompiledBlueprintPlan(compileTripBlueprint(bp,{createdAt:'2026-11-17T00:00:00Z'}));w=store.getWorkspace();
  }
  registerPlanManagementRoutes(server,{store,getMaps:()=>{throw new Error('禁止外部地图');},startActivePlanMonitoring:()=>{}});
  const origin=await server.listen({host:'127.0.0.1',port:0});
  const review=await (await fetch(`${origin}/api/plans/${w.activePlan.id}/confirmation-review`)).json() as any;
  const payload={expectedVersion:w.activePlan.version,expectedBlueprintVersion:w.activeBlueprint!.version,expectedBasePlanId:base.id,expectedBaseVersion:base.version,exactConfirmation:review.exactConfirmation};
  const response=await fetch(`${origin}/api/plans/${w.activePlan.id}/confirm`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
  const result=await response.json() as any;
  if(invalid){
   assert.equal(response.status,409);assert.equal(result.code,'activation_review_required');assert.match(result.error,/修正.*审阅/);
   assert.deepEqual(store.getExecutionPlan(),base);assert.equal(store.getWorkspace().activePlan.status,'draft');
   assert.equal(store.getTravelAdjustmentReceipt('manual:'+review.exactConfirmation.proposalDigest),undefined);
  }else{
   assert.equal(response.status,200,JSON.stringify(result));assert.equal(store.getExecutionPlan()!.id,w.activePlan.id);
   const receipt=store.getTravelAdjustmentReceipt('manual:'+review.exactConfirmation.proposalDigest)!;
   assert.equal(receipt.status,'applied');assert.equal(receipt.basis,'user_confirmation');
   assert.equal(receipt.handoff!.status,'acknowledged');assert.ok(receipt.handoff!.readbackRef?.startsWith('email-outbox:'));
   assert.ok(store.email.list().some(job=>job.planId===w.activePlan.id&&job.kind==='change'));
  }
 }finally{await server.close();store.close();rmSync(root,{recursive:true,force:true});}
});
