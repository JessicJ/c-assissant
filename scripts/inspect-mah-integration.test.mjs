import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectMahIntegration,inspectionCommands} from './inspect-mah-integration.mjs';
const root='/fictional/project',at=new Date('2026-10-26T00:00:00Z');
const responses=['0.1.2029\n',
 'Usage: mah task [options] [command]\n  submit [options]\n  show [options]\n  context [options]\n  cancel [options]\n',
 'Usage: mah project runtime [options] [command]\n  register [options]\n  list [options]\n',
 'Usage: mah task submit [options]\n  --schedule-json <json> Schedule\n',
 JSON.stringify({schema_version:1,projection_kind:'setup_readiness',overall_status:'ready',git:{state:'ready'},dependencies:[{dependency_id:'codex',probe_status:'ready',authentication_status:'authenticated',secret:'PRIVATE'}]}),
 JSON.stringify({schema_version:1,ok:true,project_root:root,generated_at:at.toISOString(),count:0,schedules:[]})];
async function inspect(change=()=>{}){let i=0;return inspectMahIntegration({projectRoot:root,now:()=>at,run:async()=>{const r={code:0,stdout:responses[i++],stderr:''};change(r,i-1);return r;}});}
test('readiness facts never authorize production or expose raw payloads',async()=>{
 const r=await inspect();assert.equal(r.version,'0.1.2029');assert.equal(r.executionAuthorized,false);assert.equal(r.productionReadiness,'unverified');assert.ok(r.checks.every(c=>c.status==='observed'));
 assert.equal(r.checks[1].advertised['execution-carriers'],false);assert.equal(r.checks[2].advertised.start,false);assert.equal(r.checks[3].scheduleInputAdvertised,true);assert.equal(r.checks[5].code,'no_schedule_registrations');assert.ok(!JSON.stringify(r).includes('PRIVATE'));assert.ok(!JSON.stringify(r).includes(root));
});
test('query failures and sandbox identity rejection are explicit and sanitized',async()=>{
 for(const sample of [{code:1,stdout:'PRIVATE',stderr:'PRIVATE'},{code:1,stdout:'',stderr:'MAH Production release identity is not verified'},{code:1,stdout:'',stderr:'',failure:'query_timeout'}]){
  const r=await inspect(v=>Object.assign(v,sample));assert.ok(r.checks.every(c=>c.status==='unverified'));assert.ok(!JSON.stringify(r).includes('PRIVATE'));assert.equal(r.checks[0].code,sample.failure??(sample.stderr.includes('identity')?'release_identity_unverified':'query_failed'));
 }
});
test('parent help, wrong schema/project, stale and malformed evidence fail closed',async()=>{
 for(const [index,stdout] of [[1,'Usage: mah [options]'],[4,'{}'],[5,responses[5].replace(root,'/other')],[5,responses[5].replace('2026-10-26','2026-10-20')],[0,'PRIVATE']]){
  const r=await inspect((v,i)=>{if(i===index)v.stdout=stdout;});assert.equal(r.checks[index].status,'unverified');assert.equal(r.checks[index].code,'public_response_invalid');
 }
});
test('command list contains only fixed read operations',()=>{
 assert.throws(()=>inspectionCommands('relative'),/project_root_invalid/);
 assert.deepEqual(inspectionCommands(root).map(c=>c.args),[['--version'],['task','--help'],['project','runtime','--help'],['task','submit','--help'],['setup','status','--format','json'],['task','schedule','list','--cwd',root,'--format','json']]);
});
