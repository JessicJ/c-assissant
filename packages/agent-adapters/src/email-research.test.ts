import assert from "node:assert/strict";
import test from "node:test";
import { writeFile, access } from "node:fs/promises";
import { CodexRuntimeAdapter, ClaudeCodeRuntimeAdapter, parseEmailResearch, type EmailResearchRequest, type RuntimeProcess } from "./index.js";

const input: EmailResearchRequest = {kind:"transfer",date:"2026-11-10",city:"Paris",plannedOrigin:"Hotel",places:[{id:"museum",name:"Museum",city:"Paris",savedDescription:"Art"}],constraints:[],language:"en",now:"2026-11-10T08:40:00.000Z"};
const result = {introduction:"A visit to the museum.",notes:[{targetId:"museum",text:"Explore the collections.",sourceUrls:["https://museum.example.org/visit"],rationale:"The museum's visitor page describes its collections."}],sources:[{title:"Museum visitor guide",url:"https://museum.example.org/visit",checkedAt:input.now}]};
test("date-specific weather needs the exact date and verified short-horizon sources", () => {
  const weather = {date:input.date,status:"forecast",summary:"Cloudy, with light rain later.",sourceUrls:[result.sources[0]!.url]};
  assert.equal(parseEmailResearch(JSON.stringify({...result,weather}),input).weather?.status,"forecast");
  for (const changed of [{...weather,date:"2026-11-11"},{...weather,sourceUrls:[]},{...weather,sourceUrls:["https://unlisted.example.org/"]}]) assert.throws(()=>parseEmailResearch(JSON.stringify({...result,weather:changed}),input));
  const future={...input,date:"2026-12-10"};
  assert.throws(()=>parseEmailResearch(JSON.stringify({...result,weather:{...weather,date:future.date}}),future));
  assert.equal(parseEmailResearch(JSON.stringify({...result,weather:{...weather,date:future.date,status:"outside_forecast_window",summary:"The daily forecast is not yet published."}}),future).weather?.status,"outside_forecast_window");
});
test("English copy and exact activity-index coverage are checked without letting the Agent alter times", () => {
  const request={...input,schedule:[{title:"Museum",time:"09:00",kind:"planned" as const}]};
  const activities=[{index:0,title:"Museum",detail:"Explore the permanent collection."}];
  assert.equal(parseEmailResearch(JSON.stringify({...result,activities}),request).activities?.[0]?.index,0);
  assert.throws(()=>parseEmailResearch(JSON.stringify({...result,activities:[{...activities[0],index:1}]}),request));
  assert.throws(()=>parseEmailResearch(JSON.stringify({...result,introduction:"\u4e2d\u6587"}),request));
});
test("email research validates target, provenance, source age and drops ungrounded introductions", () => {
  assert.equal(parseEmailResearch(JSON.stringify(result),input).notes.length,1);
  for (const invalid of [ {...result,notes:[{...result.notes[0],targetId:"other"}]}, {...result,sources:[{...result.sources[0],url:"http://localhost/"}]}, {...result,sources:[{...result.sources[0],checkedAt:"2026-11-01T00:00:00Z"}]}, {...result,notes:[{...result.notes[0],sourceUrls:["https://unlisted.example.org/"]}]} ]) assert.throws(() => parseEmailResearch(JSON.stringify(invalid),input));
  assert.equal(parseEmailResearch(JSON.stringify({introduction:"unsupported claim",notes:[],sources:[]}),input).introduction,"");
});
test("both selected runtimes research in isolated directories with web tools and scrubbed sender environment", async () => {
  for (const kind of ["codex","claude-code"] as const) {
    let directory = "";
    const run: RuntimeProcess = async (command,args,options) => {
      directory=options!.cwd!; assert.ok(directory.includes("landi-email-research-"));
      assert.equal(options!.timeoutMs,60_000); assert.equal(options!.env?.LANDI_SMTP_PASSWORD,undefined);
      assert.equal(options!.env?.GOOGLE_MAPS_API_KEY,undefined);
      assert.match(args.at(-1)!,/never HTML/);
      if(command === "codex") { assert.ok(args.includes("--search")); assert.ok(args.includes("read-only")); await writeFile(args[args.indexOf("--output-last-message")+1]!,JSON.stringify(result)); return {code:0,stdout:"",stderr:""}; }
      assert.ok(args.includes("WebSearch,WebFetch"));
      return {code:0,stdout:JSON.stringify({structured_output:result}),stderr:""};
    };
    const Adapter = kind === "codex" ? CodexRuntimeAdapter : ClaudeCodeRuntimeAdapter;
    const adapter = new Adapter({run,environment:{PATH:process.env.PATH,LANDI_SMTP_PASSWORD:"test-placeholder",GOOGLE_MAPS_API_KEY:"test-placeholder"}});
    assert.equal((await adapter.generateEmailResearch(input)).notes.length,1);
    await assert.rejects(access(directory));
  }
});


test("morning poetic line and reminders are bounded, English and grounded in supplied context", () => {
  const request={...input,kind:"morning" as const,schedule:[{title:"Guided visit",time:"09:00",kind:"confirmed" as const,detail:"Bring the booking confirmation."}]};
  const output={...result,poeticLine:"Between the garden and the river, quiet moments unfold.",activities:[{index:0,title:"Guided visit",detail:"Explore the collection.",reminder:"Bring the booking confirmation."}]};
  assert.equal(parseEmailResearch(JSON.stringify(output),request).poeticLine,output.poeticLine);
  assert.equal(parseEmailResearch(JSON.stringify({...output,poeticLine:""}),request).poeticLine,undefined);
  assert.equal(parseEmailResearch(JSON.stringify({...output,notes:[],sources:[]}),request).poeticLine,undefined);
  assert.equal(parseEmailResearch(JSON.stringify(output),{...request,kind:"transfer"}).poeticLine,undefined);
  for(const poeticLine of ["x".repeat(121),"中文","Two\nlines"]) assert.throws(()=>parseEmailResearch(JSON.stringify({...output,poeticLine}),request));
  assert.throws(()=>parseEmailResearch(JSON.stringify(output),{...request,schedule:[{...request.schedule[0]!,detail:""}]}));
});

test("dining photographs must bind to a researched restaurant and a stable public HTTPS source", () => {
  const request={...input,kind:"dining" as const};
  const image={targetId:"museum",url:"https://cdn.example.org/restaurant.jpg",alt:"Restaurant interior",sourceUrl:result.sources[0]!.url,rationale:"The operator's page identifies this venue and its dining room."};
  const output={...result,images:[image]};
  assert.equal(parseEmailResearch(JSON.stringify(output),request).images?.[0]?.url,image.url);
  for(const changed of [{...image,targetId:"another-place"},{...image,sourceUrl:"https://unlisted.example.org/"},{...image,url:"http://cdn.example.org/photo.jpg"},{...image,url:"https://localhost/photo.jpg"},{...image,url:"https://127.0.0.1/photo.jpg"},{...image,url:"https://cdn.example.org/photo.jpg?key=secret"},{...image,url:"https://cdn.example.org/photo.jpg?X-Amz-Signature=temporary"},{...image,alt:"中文"},{...image,rationale:""}]) assert.throws(()=>parseEmailResearch(JSON.stringify({...output,images:[changed]}),request));
  assert.throws(()=>parseEmailResearch(JSON.stringify({...output,images:[image,image]}),request));
  assert.throws(()=>parseEmailResearch(JSON.stringify(output),input));
});
