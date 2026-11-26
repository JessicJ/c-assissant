import {exactPlanConfirmation} from "./travel-adjustment-application.js";
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { SqliteWorkspaceStore } from "@c-assistant/storage";
import { emailReplacementFixture } from "./email.fixture.test.js";
import { registerEmailReviewRoutes } from "./email-review-routes.js";
import { registerEmailExecutionRoutes } from "./email-execution-routes.js";
import { registerLocalWebRoutes } from "./local-web-routes.js";
import { issueReviewCapability } from "./email-review-capability.js";
import { createEmailReviewDelivery, enqueuePendingReview, pendingEmailReview } from "./email-plan-review.js";
import { createEmailExecutionWorker } from "./email-execution-worker.js";
import { activateReviewedPlan } from "./plan-activation.js";
const now = () => new Date("2026-11-10T08:40:00Z");
const configuration = { baseUrl: "https://review.example.test", signingKey: "0".repeat(64) };

test("retired review routes reject even a valid old capability without changing plans or history", async () => {
  const store = new SqliteWorkspaceStore(":memory:"), server = Fastify();
  try {
    emailReplacementFixture(store);
    const scope = pendingEmailReview(store)!;
    const token = issueReviewCapability(scope, configuration, now().getTime()+3600_000);
    const before = JSON.stringify({ workspace:store.getWorkspace(),emails:store.email.list() });
    registerEmailReviewRoutes(server,{store,getConfiguration:()=>{throw Error("must not read old configuration");},startActivePlanMonitoring:()=>{throw Error("must not activate");}});
    for(const [method,url] of [["GET","/email-review"],["POST","/api/email-review/view"],["POST","/api/email-review/confirm"]] as const){
      const result = await server.inject({method,url,headers:{authorization:`Bearer ${token}`},...(method==="POST"?{payload:{confirmed:true,expectedPlanId:scope.draftPlanId,expectedVersion:scope.draftVersion}}:{})});
      assert.equal(result.statusCode,410);assert.equal(result.json().code,"email_review_retired");
      assert.match(result.json().error,/Landi workspace/);assert.ok(!result.body.includes(token));
    }
    assert.equal(JSON.stringify({ workspace:store.getWorkspace(),emails:store.email.list() }),before);
  } finally { await server.close();store.close(); }
});

test("old public review origins no longer expose any local workspace or review route",async()=>{
  const store=new SqliteWorkspaceStore(":memory:"),server=Fastify();
  try{
    await registerLocalWebRoutes(server,{store,webAssetsPath:"/unused",webTripMapPath:"/unused",webIndexPath:"/unused",emailReviewOrigin:()=>configuration.baseUrl});
    registerEmailReviewRoutes(server,{store});
    for(const url of ["/email-review","/api/email-review/confirm","/api/workspace"]){
      const result=await server.inject({method:url.endsWith("confirm")?"POST":"GET",url,headers:{host:"review.example.test",origin:configuration.baseUrl}});
      assert.equal(result.statusCode,403);assert.notEqual(result.headers["access-control-allow-origin"],configuration.baseUrl);
    }
    assert.equal((await server.inject({method:"GET",url:"/api/workspace",headers:{host:"127.0.0.1"}})).statusCode,200);
  }finally{await server.close();store.close();}
});

test("retired review configuration does not overwrite existing settings or generate credentials",async()=>{
  const root=mkdtempSync(join(tmpdir(),"landi-review-retired-")),envPath=join(root,"fixture.env");
  const original="LANDI_EMAIL_REVIEW_BASE_URL=https://review.example.test\nLANDI_EMAIL_ACTION_SECRET=synthetic-old-value\n";
  writeFileSync(envPath,original);
  const store=new SqliteWorkspaceStore(":memory:"),server=Fastify();
  try{
    registerEmailExecutionRoutes(server,{store,envPath,getReviewConfiguration:()=>{throw Error("must not read retired configuration");}});
    const result=await server.inject({method:"PUT",url:"/api/email-execution/review",payload:{baseUrl:"https://other.example.test"}});
    assert.equal(result.statusCode,410);assert.equal(readFileSync(envPath,"utf8"),original);
  }finally{await server.close();store.close();rmSync(root,{recursive:true,force:true});}
});

test("pending changes use the unchanged Change template with workspace guidance and no signed entry",()=>{
  const store=new SqliteWorkspaceStore(":memory:");
  try{
    const {base}=emailReplacementFixture(store);
    enqueuePendingReview(store,undefined,now());enqueuePendingReview(store,configuration,now());
    const jobs=store.email.list();assert.equal(jobs.length,1);assert.equal(jobs[0]!.kind,"change");
    const content=jobs[0]!.content!;assert.equal(content.review,undefined);
    assert.match(content.text,/Landi workspace/);assert.doesNotMatch(content.html+content.text,/email-review|review\.landi\.invalid|#token=/);
    assert.equal(store.getExecutionPlan()!.id,base.id);
  }finally{store.close();}
});

test("old signed content is blocked before SMTP while its stored history remains intact",async()=>{
  const store=new SqliteWorkspaceStore(":memory:");let sends=0;
  try{
    const {base}=emailReplacementFixture(store);
    const content={subject:"Historical review",html:'<a href="https://review.example.test/email-review#token=synthetic">Review</a>',text:"Historical saved content"};
    store.email.enqueue({id:"retired-review-fixture",planId:base.id,planVersion:base.version,kind:"change",date:"2026-11-10",dueAt:now().toISOString(),expiresAt:"2026-11-10T10:40:00Z",recipientRevision:store.email.settings().revision,content});
    const prepare=createEmailReviewDelivery(store,()=>{throw Error("must not issue capabilities");});
    const worker=createEmailExecutionWorker({store,now,prepareDelivery:prepare,render:async()=>{throw Error("must reuse saved content");},getTransport:()=>({configured:()=>true,verify:async()=>({ready:true}),send:async()=>{sends++;throw Error("SMTP is forbidden in this test");}})});
    await worker.tick(new Map());assert.equal(sends,0);
    const job=store.email.list().find(job=>job.id==="retired-review-fixture")!;
    assert.equal(job.status,"cancelled");assert.equal(job.failureCode,"email_review_retired");assert.deepEqual(job.content,content);
    assert.equal(store.getExecutionPlan()!.id,base.id);
  }finally{store.close();}
});

test("explicit workspace activation retains version guards and confirmation receipts",()=>{
  const store=new SqliteWorkspaceStore(":memory:");
  try{
    const {base,draft}=emailReplacementFixture(store);
    assert.throws(()=>activateReviewedPlan(store,{planId:draft.id,expectedVersion:draft.version+1},now()));
    assert.equal(store.getExecutionPlan()!.id,base.id);
    store.recordTravelPhase({context:store.captureAdjustmentContext(),value:'pre_departure',basis:'traveler_statement',recordedAt:now().toISOString(),evidenceRefs:['虚构旅行者尚未出发']});
    activateReviewedPlan(store,{exactConfirmation:exactPlanConfirmation(store),planId:draft.id,expectedVersion:draft.version,expectedBase:{id:base.id,version:base.version}},now());
    assert.equal(store.getExecutionPlan()!.id,draft.id);assert.ok(store.email.planConfirmation(draft.id,draft.version));
    assert.ok(store.email.list().every(job=>!job.content?.review));
  }finally{store.close();}
});
