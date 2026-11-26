import assert from "node:assert/strict";
import test from "node:test";
import {writeFile,access} from "node:fs/promises";
import {CodexRuntimeAdapter,ClaudeCodeRuntimeAdapter,parseEmailTiming,type EmailTimingRequest,type RuntimeProcess} from "./index.js";
const input:EmailTimingRequest={opportunities:[{id:"museum",kind:"transfer",date:"2026-11-10",timeZone:"Europe/Paris",title:"Museum",plannedTime:"09:00",timeKind:"planned",earliestLocal:"2026-11-09T09:00",deadlineLocal:"2026-11-10T09:00"}],now:"2026-11-10T06:00:00Z"};
const result={decisions:[{id:"museum",sendAtLocal:"2026-11-10T08:23",rationale:"Prepare for the planned museum visit."}]};
test("email timing requires exact coverage, rationale and structured local times",()=>{
 assert.equal(parseEmailTiming(JSON.stringify(result),input).decisions.length,1);
 for(const invalid of [{decisions:[]},{decisions:[{...result.decisions[0],id:"other"}]},{decisions:[{...result.decisions[0],rationale:""}]},{decisions:[{...result.decisions[0],sendAtLocal:"soon"}]}])assert.throws(()=>parseEmailTiming(JSON.stringify(invalid),input));
 assert.equal(parseEmailTiming(JSON.stringify({decisions:[{id:"museum",sendAtLocal:null,rationale:"Insufficient travel evidence"}]}),input).decisions[0]!.sendAtLocal,null);
});
test("both selected runtimes arrange timing with isolated, scrubbed processes and structured output",async()=>{
 for(const kind of ["codex","claude"]){let directory="";
 const run:RuntimeProcess=async(command,args,options)=>{directory=options!.cwd!;assert.ok(directory.includes("landi-email-timing-"));assert.equal(options!.timeoutMs,60_000);assert.equal(options!.env?.LANDI_SMTP_PASSWORD,undefined);assert.match(args.at(-1)!,/not a fixed morning hour/);if(command==="codex"){assert.ok(args.includes("read-only"));assert.ok(!args.includes("--search"));await writeFile(args[args.indexOf("--output-last-message")+1]!,JSON.stringify(result));return{code:0,stdout:"",stderr:""};}assert.equal(args[args.indexOf("--tools")+1],"");return{code:0,stdout:JSON.stringify({structured_output:result}),stderr:""};};
 const Adapter=kind==="codex"?CodexRuntimeAdapter:ClaudeCodeRuntimeAdapter;assert.equal((await new Adapter({run,environment:{PATH:process.env.PATH,LANDI_SMTP_PASSWORD:"fixture-only"}}).generateEmailTiming(input)).decisions[0]!.sendAtLocal,"2026-11-10T08:23");await assert.rejects(access(directory));
 }
});
