import assert from 'node:assert/strict';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {isDeepStrictEqual} from 'node:util';
import {SqliteWorkspaceStore} from '../packages/storage/src/index.js';
import {compileExecutionItinerary} from '../apps/server/src/execution-itinerary.js';
const root=resolve(import.meta.dirname,'..');
if(existsSync(resolve(root,'.env')))process.loadEnvFile(resolve(root,'.env'));
const input=JSON.parse(readFileSync(resolve(root,'data/plan-copy-edits.json'),'utf8')) as {id:string;version:number;edits:Array<{path:string;before:string;after:string}>};
const pathArg=process.argv.slice(2).find(a=>!a.startsWith('--'));
const path=pathArg ? resolve(root,pathArg) : process.env.C_ASSISTANT_DATA_PATH||resolve(root,'data/c-assistant.sqlite');
const store=new SqliteWorkspaceStore(path);
const keys=new Set(['title','summary','description','body','items','whyWorthIt','plan','tip','rationale','knownInformation','assumptions','nextAction','sequenceRationale','detail','note']);
const excluded=new Set(['sources','sourceCatalog','evidence','evidenceSources','sourceRefs','fieldEvidence','images','configuration','operationalFacts']);
function structure(value:unknown,selected=false):unknown {
 if(typeof value==='string')return selected?'[copy]':value;
 if(Array.isArray(value))return value.map(v=>structure(v,selected));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,excluded.has(k)?v:structure(v,keys.has(k))]));
 return value;
}
try {
 const plan=structuredClone(store.getExecutionPlan()!);assert.equal(plan.id,input.id);assert.equal(plan.version,input.version);
 if(process.argv.includes('--resume'))for(const edit of input.edits){
  const parts=edit.path.split('/').slice(1);let target:any=plan;for(const part of parts.slice(0,-1))target=target[part];
  const current=target[parts.at(-1)!];
  assert.ok(current===edit.before||current===edit.after||current===edit.after.replace('you choose','you chooses'),`Unexpected text change at ${edit.path}`);
  target[parts.at(-1)!]=edit.before;
 }
 const edited=structuredClone(plan);
 for(const edit of input.edits){
  const parts=edit.path.split('/').slice(1);assert.ok(!parts.some(p=>excluded.has(p)||['__proto__','constructor','prototype'].includes(p)));
  assert.ok(keys.has(parts.at(-1)!)||/^\d+$/.test(parts.at(-1)!)&&keys.has(parts.at(-2)!));
  let target:any=edited;for(const part of parts.slice(0,-1))target=target[part];
  assert.equal(target[parts.at(-1)!],edit.before,`Copy changed before edit: ${edit.path}`);
  assert.ok(edit.after.trim());target[parts.at(-1)!]=edit.after;
 }
 assert.ok(isDeepStrictEqual(structure(edited),structure(plan)),'Only descriptive text may change');
 const execution=(p:typeof plan)=>{const c=compileExecutionItinerary(p);return {...c,activities:c.activities.map(({title,...a})=>a)};};
 assert.ok(isDeepStrictEqual(execution(edited),execution(plan)),'Dates, movement, preparation and execution controls must stay unchanged');
 const stateBefore=JSON.stringify(store.getExecutionAssistantState(plan.id,plan.version));
 const backup=store.createBackup();
 const db=new DatabaseSync(path);
 let blueprintChanges=0;
 try{
  db.exec('BEGIN IMMEDIATE');
  const row=db.prepare('SELECT presentation_json FROM plans WHERE id=? AND version=? AND is_current=1 AND is_execution=1').get(plan.id,plan.version) as {presentation_json:string}|undefined;
  assert.ok(row);
  assert.ok(isDeepStrictEqual(structure(JSON.parse(row.presentation_json)),structure(plan.presentation)),'Plan changed during copy review');
  const changed=db.prepare('UPDATE plans SET title=?,known_information_json=?,assumptions_json=?,next_action=?,presentation_json=? WHERE id=? AND version=? AND is_current=1 AND is_execution=1').run(edited.title,JSON.stringify(edited.knownInformation),JSON.stringify(edited.assumptions),edited.nextAction,JSON.stringify(edited.presentation),plan.id,plan.version);
  assert.equal(changed.changes,1);
  for(const stage of edited.stages){
   db.prepare('UPDATE stages SET title=?,description=? WHERE id=? AND plan_id=?').run(stage.title,stage.description,stage.id,plan.id);
   for(const task of stage.tasks)db.prepare('UPDATE tasks SET title=?,description=? WHERE id=? AND stage_id=?').run(task.title,task.description??null,task.id,stage.id);
  }
  const lineage=db.prepare('SELECT blueprint_id,blueprint_version FROM plan_blueprint_lineage WHERE plan_id=? AND plan_version=?').get(plan.id,plan.version) as {blueprint_id:string;blueprint_version:number}|undefined;
  if(lineage){
   const bpRow=db.prepare('SELECT content_json FROM trip_blueprints WHERE id=? AND version=?').get(lineage.blueprint_id,lineage.blueprint_version) as {content_json:string};
   const blueprint=JSON.parse(bpRow.content_json);const before=structure(blueprint);
   const replacements=new Map(input.edits.map(e=>[e.before,e.after]));
   function rewrite(v:any,selected=false):any{
    if(typeof v==='string'){const next=selected?(replacements.get(v)??v.replace('you chooses','you choose')):undefined;if(next&&next!==v){blueprintChanges++;return next;}return v;}
    if(Array.isArray(v))return v.map(x=>rewrite(x,selected));
    if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,excluded.has(k)?x:rewrite(x,keys.has(k))]));
    return v;
   }
   const updated=rewrite(blueprint);assert.ok(isDeepStrictEqual(structure(updated),before));
   db.prepare('UPDATE trip_blueprints SET content_json=? WHERE id=? AND version=? AND content_json=?').run(JSON.stringify(updated),lineage.blueprint_id,lineage.blueprint_version,bpRow.content_json);
  }
  db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error;}finally{db.close();}
 const after=store.getExecutionPlan()!;
 assert.ok(isDeepStrictEqual(structure(after),structure(edited)),'Saved plan structure changed');
 assert.ok(isDeepStrictEqual(execution(after),execution(edited)),'Saved execution changed');
 assert.equal(stateBefore,JSON.stringify(store.getExecutionAssistantState(plan.id,plan.version)));
 const report={planId:plan.id,version:plan.version,changedTextFields:input.edits.length,blueprintChanges,backupCreated:Boolean(backup.path),executionUnchanged:true};
 writeFileSync(resolve(root,'data/plan-copy-polish-result.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));
}finally{store.close();}
