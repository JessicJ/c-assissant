import {existsSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {SqliteWorkspaceStore} from '../packages/storage/src/index.js';
const root=resolve(import.meta.dirname,'..');
if(existsSync(resolve(root,'.env')))process.loadEnvFile(resolve(root,'.env'));
const store=new SqliteWorkspaceStore(process.env.C_ASSISTANT_DATA_PATH||resolve(root,'data/c-assistant.sqlite'));
try {
 const plan=store.getExecutionPlan()!;
 const fields: Record<string,string>={};
 const keys=new Set(['title','summary','description','body','items','whyWorthIt','plan','tip','rationale','knownInformation','assumptions','nextAction','sequenceRationale','detail']);
 function visit(value:unknown,path:string,selected=false):void {
   if(typeof value==='string'){if(selected)fields[path]=value;return;}
   if(Array.isArray(value)){value.forEach((v,i)=>visit(v,`${path}/${i}`,selected));return;}
   if(value&&typeof value==='object')for(const [k,v]of Object.entries(value)){
    if(['sources','evidence','evidenceSources','sourceRefs','fieldEvidence','images','configuration'].includes(k))continue;
    visit(v,`${path}/${k}`,keys.has(k));
   }
 }
 visit(plan,'');
 writeFileSync(resolve(root,'data/plan-copy-audit.json'),JSON.stringify({id:plan.id,version:plan.version,fields},null,2));
 console.log(JSON.stringify({id:plan.id,version:plan.version,fields},null,2));
}finally{store.close();}
