import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {SqliteWorkspaceStore} from '../packages/storage/lib/index.js';
import {compileExecutionItinerary} from '../apps/server/src/execution-itinerary.js';
const dir=resolve(process.argv[2]??'');
assert.ok(dir.startsWith('/private/tmp/'),'Use an isolated acceptance database only.');
const report=JSON.parse(readFileSync(resolve(dir,'report.json'),'utf8'));
const store=new SqliteWorkspaceStore(resolve(dir,'acceptance.sqlite'));
try {
 const plan=store.getWorkspace().activePlan;
 assert.equal(plan.id,report.planId);assert.equal(plan.status,'draft');
 const compiled=compileExecutionItinerary(plan);
 assert.deepEqual(compiled.gaps,[]);assert.ok(compiled.activities.length>0);
 assert.ok(!store.getExecutionAssistantState(plan.id,plan.version),'A draft must not acquire execution progress.');
 store.confirmPlan(plan.id);
 const active=store.getExecutionPlan()!;assert.equal(active.id,plan.id);assert.equal(active.status,'active');
 const after=compileExecutionItinerary(active);assert.deepEqual(after.gaps,[]);
 const result={planId:plan.id,status:active.status,activities:after.activities.length,dates:[...new Set(after.activities.map(a=>a.date))],gaps:after.gaps,confirmationInIsolatedDatabase:true,telegramMessagesSent:0};
 writeFileSync(resolve(dir,'execution-check.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
} finally {store.close();}
