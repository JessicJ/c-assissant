import { execFile } from 'node:child_process';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const APP_CLI='/Applications/MAH.app/Contents/Resources/bin/mah';
const LIMIT=1024*1024;
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const advertised=(help,name)=>new RegExp(`^  ${name}(?:\\s|$)`,'m').test(help);
/** Public reads only. Never submit, resume, cancel or alter a schedule. */
export function inspectionCommands(root){
 if(!isAbsolute(root))throw new Error('project_root_invalid');
 return [
  {id:'version',args:['--version']},
  {id:'task_help',args:['task','--help'],usage:'Usage: mah task '},
  {id:'runtime_help',args:['project','runtime','--help'],usage:'Usage: mah project runtime '},
  {id:'submit_help',args:['task','submit','--help'],usage:'Usage: mah task submit '},
  {id:'setup',args:['setup','status','--format','json']},
  {id:'schedules',args:['task','schedule','list','--cwd',root,'--format','json']}
 ];
}
export function runPublicRead(cli,args){
 return new Promise(done=>execFile(cli,args,{timeout:30000,maxBuffer:LIMIT,encoding:'utf8',shell:false},(error,stdout,stderr)=>done({
  code:error?(Number.isInteger(error.code)?error.code:1):0,stdout,stderr,
  failure:error?.killed?'query_timeout':error?.code==='ENOENT'?'cli_unavailable':undefined
 })));
}
/** Human evidence only: successful queries do not grant production permission. */
export async function inspectMahIntegration({projectRoot,cli=APP_CLI,run=runPublicRead,now=()=>new Date()}){
 if(!isAbsolute(cli))throw new Error('cli_path_invalid');
 const checks=[];let version=null;
 for(const command of inspectionCommands(projectRoot)){
  const check={id:command.id,status:'unverified',code:'query_failed'};checks.push(check);
  try{
   const result=await run(cli,command.args);
   if(result.code!==0){
    check.code=['query_timeout','cli_unavailable'].includes(result.failure)?result.failure:
     String(result.stderr).includes('MAH Production release identity is not verified')?'release_identity_unverified':'query_failed';continue;
   }
   if(typeof result.stdout!=='string'||Buffer.byteLength(result.stdout)>LIMIT)throw new Error();
   if(command.id==='version'){
    const value=result.stdout.trim();if(!/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(value))throw new Error();
    version=value;Object.assign(check,{status:'observed',code:'version_read',version});
   }else if(command.usage){
    if(!result.stdout.startsWith(command.usage))throw new Error();
    Object.assign(check,{status:'observed',code:'help_read'});
    if(command.id==='task_help')check.advertised=Object.fromEntries(['submit','show','context','cancel','execution-carriers'].map(n=>[n,advertised(result.stdout,n)]));
    if(command.id==='runtime_help')check.advertised=Object.fromEntries(['register','list','start','stop','status','reconcile','service'].map(n=>[n,advertised(result.stdout,n)]));
    if(command.id==='submit_help')check.scheduleInputAdvertised=/^  --schedule-json\s/m.test(result.stdout);
   }else{
    const value=JSON.parse(result.stdout);if(!object(value))throw new Error();
    if(command.id==='setup'){
     if(value.schema_version!==1||value.projection_kind!=='setup_readiness'||typeof value.overall_status!=='string'||!object(value.git)||typeof value.git.state!=='string'||!Array.isArray(value.dependencies))throw new Error();
     const codex=value.dependencies.filter(v=>object(v)&&v.dependency_id==='codex');
     if(codex.length!==1||!['ready','missing','probe_failed'].includes(codex[0].probe_status)||!['authenticated','unauthenticated','unknown'].includes(codex[0].authentication_status))throw new Error();
     Object.assign(check,{status:'observed',code:'host_prerequisites_only',overallStatus:value.overall_status,gitState:value.git.state,codex:{probeStatus:codex[0].probe_status,authenticationStatus:codex[0].authentication_status}});
    }else{
     if(value.schema_version!==1||value.ok!==true||value.project_root!==projectRoot||!Number.isSafeInteger(value.count)||value.count<0||!Array.isArray(value.schedules)||value.count!==value.schedules.length||typeof value.generated_at!=='string')throw new Error();
     const age=now().getTime()-Date.parse(value.generated_at);if(!Number.isFinite(age)||age< -5000||age>60000)throw new Error();
     Object.assign(check,{status:'observed',code:value.count?'registrations_present_execution_unverified':'no_schedule_registrations',count:value.count});
    }
   }
  }catch{check.code='public_response_invalid';}
 }
 return {schemaVersion:1,observedAt:now().toISOString(),version,evidence:'public_readonly_cli',executionAuthorized:false,productionReadiness:'unverified',checks};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const report=await inspectMahIntegration({projectRoot:resolve(fileURLToPath(new URL('../../../',import.meta.url))),cli:process.env.MAH_TASK_CLI_COMMAND||APP_CLI});
  console.log(JSON.stringify(report,null,2));process.exitCode=report.checks.some(c=>c.status!=='observed')?1:0;
 }catch{console.error('MAH read-only inspection could not start: invalid project or CLI binding.');process.exitCode=1;}
}
