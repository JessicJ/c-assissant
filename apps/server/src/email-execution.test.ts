import { emailTimingFixture } from "./email.fixture.test.js";
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SqliteWorkspaceStore } from "@c-assistant/storage";
import type { EmailMessage, EmailTransport } from "@c-assistant/connectors";
import { emailPlanFixture, verifiedEmailFixture } from "./email.fixture.test.js";
import { createEmailExecutionWorker as runtimeEmailWorker } from "./email-execution-worker.js";
import { scheduledEmailJobs as runtimeEmailJobs, emailTimingOpportunities } from "./email-schedule.js";
import { createEmailContentBuilder } from "./email-content.js";
import type { ConnectorBundle } from "./connector-bundle.js";
import type { EmailResearchRequest } from "@c-assistant/agent-adapters";

const zones = new Map([["paris", "UTC"]]);
function captureTransport(captures: EmailMessage[]): EmailTransport { return { configured: () => true, verify: async () => ({ ready: true }), send: async message => { captures.push(message); return { status: "accepted", messageId: message.messageId }; } }; }
const render = async () => ({ subject: "Plan", html: "<p>Planned route</p>", text: "Planned route" });

const scheduledEmailJobs=(plan:Parameters<typeof runtimeEmailJobs>[0],settings:Parameters<typeof runtimeEmailJobs>[1],zones:Map<string,string>,now:Date)=>runtimeEmailJobs(plan,settings,zones,now,emailTimingFixture({opportunities:emailTimingOpportunities(plan,zones),now:now.toISOString()}));
const createEmailExecutionWorker=(dependencies:Parameters<typeof runtimeEmailWorker>[0])=>runtimeEmailWorker({...dependencies,schedule:async(plan,zones,now)=>scheduledEmailJobs(plan,dependencies.store.email.settings(),zones,now)});

test("a full day advances without pairing, location or completion; untimed activities create no invented reminders", async () => {
  const store = new SqliteWorkspaceStore(":memory:");
  try {
    const plan = emailPlanFixture(store); verifiedEmailFixture(store);
    let now = new Date("2026-11-10T07:30:00Z"); const captures: EmailMessage[] = [];
    const worker = createEmailExecutionWorker({ store, getTransport: () => captureTransport(captures), render, now: () => now });
    await worker.tick(zones); await worker.tick(zones); assert.equal(captures.length, 1);
    now = new Date("2026-11-10T08:40:00Z"); await worker.tick(zones);
    now = new Date("2026-11-10T12:00:00Z"); await worker.tick(zones);
    now = new Date("2026-11-10T14:40:00Z"); await worker.tick(zones);
    assert.equal(captures.length, 4);
    assert.deepEqual(store.email.list().map(job => job.kind).sort(), ["dining", "morning", "transfer", "transfer"]);
    assert.equal(store.getExecutionAssistantState(plan.id, plan.version), undefined);
    assert.equal("getTelegramPairingStatus" in store, false);
    assert.equal(store.getExecutionPlan()?.status, "active");
    assert.equal(scheduledEmailJobs(plan, store.email.settings(), zones, new Date("2026-11-11T07:30:00Z")).length, 0);
  } finally { store.close(); }
});

test("AI research receives the scheduled day; templates keep times and safe retries reuse saved content", async () => {
  const store=new SqliteWorkspaceStore(":memory:");
  try {
    emailPlanFixture(store);verifiedEmailFixture(store);let now=new Date("2026-11-10T07:30:00Z");let researched=0;let sent=0;
    const requests:EmailResearchRequest[]=[];
    const builder=createEmailContentBuilder({store,now:()=>now,getConnectors:()=>({googleWeather:{weather:async()=>({status:"unavailable"})},maps:{}} as unknown as ConnectorBundle),research:async request=>{
      researched++;requests.push(request);return {introduction:"A fresh museum guide.",notes:[{targetId:"museum",text:"An introduction from the museum visitor guide.",sourceUrls:["https://museum.example.org/visit"],rationale:"The visitor guide applies to the scheduled museum."}],sources:[{title:"Visitor guide",url:"https://museum.example.org/visit",checkedAt:now.toISOString()}]};
    }});
    const messages:EmailMessage[]=[];
    const transport:EmailTransport={configured:()=>true,verify:async()=>({ready:true}),send:async message=>{sent++;messages.push(message);return sent===1?{status:"rejected",code:"smtp_temporary_failure",retryable:true}:{status:"accepted",messageId:message.messageId};}};
    const worker=createEmailExecutionWorker({store,getTransport:()=>transport,render:builder,now:()=>now});
    await worker.tick(zones);assert.equal(researched,1);assert.equal(sent,1);
    assert.equal(requests[0]?.schedule?.find(item=>item.title==="Museum")?.time,"09:00");
    assert.equal(requests[0]?.plannedOrigin,"Hotel");assert.ok(!JSON.stringify(requests).includes("traveler@example.test"));
    assert.match(messages[0]!.html,/fresh museum guide/);assert.match(messages[0]!.html,/09:00/);assert.match(messages[0]!.html,/museum.example.org/);
    assert.equal(store.email.list().find(job=>job.kind==="morning")?.content?.research?.status,"generated");
    now=new Date("2026-11-10T07:33:00Z");await worker.tick(zones);assert.equal(researched,1);assert.equal(sent,2);assert.equal(messages[0]!.html,messages[1]!.html);assert.deepEqual(messages[0]!.attachments,messages[1]!.attachments);assert.ok(messages[1]!.attachments?.length);assert.deepEqual(store.email.list().find(job=>job.kind==="morning")?.content?.attachments,messages[1]!.attachments);
    assert.equal(store.getExecutionPlan()?.status,"active");
  } finally {store.close();}
});

test("lost leases stop slow renderers; generation failure is safe to retry before SMTP", async () => {
  const store=new SqliteWorkspaceStore(":memory:");
  try {
    const plan=emailPlanFixture(store);verifiedEmailFixture(store);let now=new Date("2026-11-10T07:30:00Z");const captures:EmailMessage[]=[];
    await createEmailExecutionWorker({store,getTransport:()=>captureTransport(captures),now:()=>now,render:async()=>{now=new Date("2026-11-10T07:33:00Z");store.email.cancelObsolete(plan.id,plan.version,now.toISOString());return render();}}).tick(zones);
    assert.equal(captures.length,0);assert.equal(store.email.list().find(job=>job.kind==="morning")?.status,"uncertain");
    now=new Date("2026-11-10T08:40:00Z");let calls=0;
    const worker=createEmailExecutionWorker({store,getTransport:()=>captureTransport(captures),now:()=>now,render:async()=>{if(++calls===1)throw new Error("Research unavailable");return render();}});
    await worker.tick(zones);assert.equal(captures.length,0);assert.ok(store.email.list().some(job=>job.kind==="transfer" && job.status==="retry"));
    now=new Date("2026-11-10T08:41:00Z");await worker.tick(zones);assert.equal(captures.length,1);
  } finally {store.close();}
});

test("parallel workers claim once and unavailable AI falls back to saved facts", async () => {
  const store=new SqliteWorkspaceStore(":memory:");
  try {
    const plan=emailPlanFixture(store);verifiedEmailFixture(store);const captures:EmailMessage[]=[];const now=()=>new Date("2026-11-10T07:30:00Z");
    const builder=createEmailContentBuilder({store,now,getConnectors:()=>({googleWeather:{weather:async()=>({status:"unavailable"})},maps:{}} as unknown as ConnectorBundle),research:async()=>{throw new Error("Unavailable");}});
    await Promise.all([1,2].map(()=>createEmailExecutionWorker({store,getTransport:()=>captureTransport(captures),render:builder,now}).tick(zones)));
    assert.equal(captures.length,1);assert.match(captures[0]!.html,/Saved place introduction/);
    assert.equal(store.email.list().find(job=>job.kind==="morning")?.content?.research?.status,"saved_facts");
    assert.equal(store.getExecutionAssistantState(plan.id,plan.version),undefined);
  } finally {store.close();}
});

test("time zones and midnight preparation preserve planned dates without guessing missing zones",()=>{
  const store=new SqliteWorkspaceStore(":memory:");
  try{
    const plan=emailPlanFixture(store);verifiedEmailFixture(store);
    assert.equal(scheduledEmailJobs(plan,store.email.settings(),new Map(),new Date("2026-11-10T07:30:00Z")).length,0);
    const copy=structuredClone(plan);copy.presentation!.days[0]!.blocks![0]!.startTime="00:10";
    const jobs=scheduledEmailJobs(copy,store.email.settings(),zones,new Date("2026-11-09T23:55:00Z"));
    assert.ok(jobs.some(job=>job.kind==="transfer" && job.date==="2026-11-10" && job.dueAt==="2026-11-09T23:50:00.000Z"));
    assert.ok(jobs.filter(job=>job.kind==="morning").every(job=>job.dueAt>"2026-11-09T23:55:00.000Z"));
    assert.ok(scheduledEmailJobs(plan,store.email.settings(),new Map([["paris","Europe/Paris"]]),new Date("2026-11-10T06:30:00Z")).some(job=>job.kind==="morning" && job.dueAt==="2026-11-10T06:30:00.000Z"));
  }finally{store.close();}
});

test("transfer refreshes route estimates for the exact planned origin without changing the arrival time",async()=>{
  const store=new SqliteWorkspaceStore(":memory:");
  try{
    const plan=emailPlanFixture(store);verifiedEmailFixture(store);const now=()=>new Date("2026-11-10T08:40:00Z");let origin="";
    const connectors={googleWeather:{},maps:{walkingRoute:async(input:{origin:string;destination:string})=>{origin=input.origin;return {status:"available",observedAt:now().toISOString(),data:{...input,mode:"walking",durationSeconds:660,distanceMeters:800}};}}} as unknown as ConnectorBundle;
    const builder=createEmailContentBuilder({store,getConnectors:()=>connectors,now});
    const scheduled=scheduledEmailJobs(plan,store.email.settings(),zones,now()).find(job=>job.kind==="transfer")!;
    const content=await builder(plan,{...scheduled,status:"pending",attempts:0,retryAt:scheduled.dueAt});
    assert.equal(origin,"2.34,48.85");assert.match(content.text,/11 min/);assert.match(content.text,/Arrival unverified/);assert.match(content.text,/09:00/);assert.match(content.text,/Your location is not tracked/);
  }finally{store.close();}
});

test("schema migration binds only the existing active Telegram plan and enabling email permanently ends that continuity",()=>{
  const dir=mkdtempSync(join(tmpdir(),"landi-email-migration-"));const path=join(dir,"workspace.sqlite");let store=new SqliteWorkspaceStore(path);
  try{
    const plan=emailPlanFixture(store);store.close();
    const previous=new DatabaseSync(path);previous.exec("DROP TABLE email_attention_state; DROP TABLE email_outbox; DROP TABLE email_settings; DELETE FROM schema_migrations WHERE version>=23;");previous.close();
    store=new SqliteWorkspaceStore(path);
    assert.equal(store.email.usesEmail(plan.id,plan.version,new Date("2026-11-10T07:30:00Z")),false);
    assert.equal(store.email.usesEmail(plan.id,plan.version+1,new Date("2026-11-10T07:30:00Z")),true);
    assert.equal(store.email.usesEmail(plan.id,plan.version,new Date("2026-11-12T07:30:00Z")),true);
    verifiedEmailFixture(store);store.email.setEnabled(false);
    assert.equal(store.email.usesEmail(plan.id,plan.version,new Date("2026-11-10T07:30:00Z")),true);
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test("restart preserves acceptance; expired work and replaced versions never send", async () => {
  const dir = mkdtempSync(join(tmpdir(), "landi-email-")); const file = join(dir, "workspace.sqlite"); const captures: EmailMessage[] = [];
  let store = new SqliteWorkspaceStore(file);
  try {
    emailPlanFixture(store); verifiedEmailFixture(store);
    const now = () => new Date("2026-11-10T07:30:00Z");
    await createEmailExecutionWorker({ store, getTransport: () => captureTransport(captures), render, now }).tick(zones);
    store.close(); store = new SqliteWorkspaceStore(file);
    await createEmailExecutionWorker({ store, getTransport: () => captureTransport(captures), render, now }).tick(zones);
    assert.equal(captures.length, 1);
    await createEmailExecutionWorker({ store, getTransport: () => captureTransport(captures), render, now: () => new Date("2026-11-10T16:00:00Z") }).tick(zones);
    assert.equal(captures.length, 1);
    const old = store.getExecutionPlan()!;
    emailPlanFixture(store, "Replacement");
    await createEmailExecutionWorker({ store, getTransport: () => captureTransport(captures), render, now }).tick(zones);
    assert.equal(captures.length, 2);
    assert.ok(store.email.list().filter(job => job.planId === old.id && job.kind !== "morning").every(job => job.status === "cancelled"));
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("a crash or unknown SMTP outcome never causes automatic duplicate send", async () => {
  const store = new SqliteWorkspaceStore(":memory:");
  try {
    const plan = emailPlanFixture(store); verifiedEmailFixture(store);
    let calls = 0; let now = new Date("2026-11-10T07:30:00Z");
    const transport: EmailTransport = { configured: () => true, verify: async () => ({ ready: true }), send: async () => { calls++; return { status: "uncertain", code: "smtp_delivery_unknown", retryable: false }; } };
    const worker = createEmailExecutionWorker({ store, getTransport: () => transport, render, now: () => now });
    await worker.tick(zones); await worker.tick(zones); now = new Date("2026-11-10T07:40:00Z"); await worker.tick(zones);
    assert.equal(calls, 1); assert.equal(store.email.list().find(job => job.kind === "morning")?.status, "uncertain");
    const transfer = scheduledEmailJobs(plan, store.email.settings(), zones, new Date("2026-11-10T08:40:00Z")).find(job => job.kind === "transfer")!;
    store.email.enqueue(transfer); const claimed = store.email.claim(plan.id, plan.version, "2026-11-10T08:40:00.000Z"); assert.ok(claimed);
    store.email.cancelObsolete(plan.id, plan.version, "2026-11-10T08:43:00.000Z");
    assert.equal(store.email.list().find(job => job.id === transfer.id)?.status, "uncertain");
  } finally { store.close(); }
});

test("address changes revoke verification; preferences and pause/resume do not replay accepted handbook", async () => {
  const store = new SqliteWorkspaceStore(":memory:"); const captures: EmailMessage[] = [];
  try {
    emailPlanFixture(store); verifiedEmailFixture(store);
    const worker = createEmailExecutionWorker({ store, getTransport: () => captureTransport(captures), render, now: () => new Date("2026-11-10T07:30:00Z") });
    await worker.tick(zones); store.email.setEnabled(false); store.email.setEnabled(true); await worker.tick(zones);
    const settings = store.email.settings();
    store.email.updateSettings({ ...settings, cityTimeZones: {paris:"UTC"} }); await worker.tick(zones);
    assert.equal(captures.length, 1);
    store.email.updateSettings({ ...settings, recipient: "changed@example.test" });
    assert.equal(store.email.settings().verified, false); assert.equal(store.email.settings().enabled, false);
    assert.throws(() => store.email.setEnabled(true));
  } finally { store.close(); }
});

test("scope is rechecked after slow content assembly; optional facts degrade without fake weather or images", async () => {
  const store = new SqliteWorkspaceStore(":memory:"); const captures: EmailMessage[] = [];
  try {
    const plan = emailPlanFixture(store); verifiedEmailFixture(store);
    const connectors = { maps: {}, googleWeather: { weather: async () => ({ status: "unavailable" }) } } as unknown as ConnectorBundle;
    const builder = createEmailContentBuilder({ store, getConnectors: () => connectors });
    const morning = scheduledEmailJobs(plan, store.email.settings(), zones, new Date("2026-11-10T07:30:00Z")).find(job => job.kind === "morning")!;
    const content = await builder(plan, { ...morning, status: "pending", attempts: 0, retryAt: morning.dueAt });
    assert.match(content.text, /forecast.*(not yet been published|could not be verified|closer to your travel date)/); assert.doesNotMatch(content.html, /src="https:|preview\.landi\.invalid/);
    const worker = createEmailExecutionWorker({ store, getTransport: () => captureTransport(captures), render: async () => { store.email.setEnabled(false); return content; }, now: () => new Date("2026-11-10T07:30:00Z") });
    await worker.tick(zones); assert.equal(captures.length, 0);
  } finally { store.close(); }
});

test("reopening the outbox reuses frozen CID PNG bytes with the original assembled handbook", async () => {
  const directory=mkdtempSync(join(tmpdir(),"landi-cid-outbox-"));
  const path=join(directory,"test.sqlite");let store=new SqliteWorkspaceStore(path);
  try {
    emailPlanFixture(store);verifiedEmailFixture(store);const messages:EmailMessage[]=[];
    const builder=createEmailContentBuilder({store,getConnectors:()=>({googleWeather:{weather:async()=>({status:"unavailable"})},maps:{}} as unknown as ConnectorBundle)});
    const first:EmailTransport={configured:()=>true,verify:async()=>({ready:true}),send:async message=>{messages.push(message);return {status:"rejected",code:"smtp_temporary_failure",retryable:true};}};
    await createEmailExecutionWorker({store,getTransport:()=>first,render:builder,now:()=>new Date("2026-11-10T07:30:00Z")}).tick(zones);
    assert.ok(messages[0]?.attachments?.length);store.close();store=new SqliteWorkspaceStore(path);
    await createEmailExecutionWorker({store,getTransport:()=>captureTransport(messages),render:async()=>{throw new Error("Persisted content must not be regenerated");},now:()=>new Date("2026-11-10T07:33:00Z")}).tick(zones);
    assert.equal(messages.length,2);assert.equal(messages[0]!.html,messages[1]!.html);assert.deepEqual(messages[0]!.attachments,messages[1]!.attachments);
    assert.equal(store.email.list().find(j=>j.kind==="morning")?.status,"accepted");
  } finally {store.close();rmSync(directory,{recursive:true,force:true});}
});

test("dining photo research reaches cards only after image probes and preserves per-restaurant fallbacks", async () => {
  const store=new SqliteWorkspaceStore(":memory:");
  try {
    const plan=structuredClone(emailPlanFixture(store));
    delete plan.presentation!.days[0]!.blocks![1]!.placeId;
    const now=new Date("2026-11-10T10:00:00Z");
    const checks:string[]=[];
    const builder=createEmailContentBuilder({store,now:()=>now,probeImage:async url=>{checks.push(url);return url.includes("one.jpg")?true:url.includes("two.jpg")?false:undefined;},getConnectors:()=>({googleWeather:{},maps:{nearbyRestaurants:async()=>({status:"available",data:["One","Two","Three"].map((name,index)=>({name,id:String(index),distanceMeters:100+index,type:"Restaurant"}))})}} as unknown as ConnectorBundle),research:async request=>({introduction:"Three options near your planned stop.",notes:[],sources:[{title:"Restaurant operator",url:"https://restaurants.example.org/",checkedAt:now.toISOString()}],images:request.places.map((p,index)=>({targetId:p.id,url:`https://cdn.example.org/${["one","two","three"][index]}.jpg`,alt:p.name+" dining room",sourceUrl:"https://restaurants.example.org/",rationale:"The operator page identifies this restaurant photograph."}))})});
    const {compileExecutionItinerary}=await import("./execution-itinerary.js");
    const activity=compileExecutionItinerary(plan).activities.find(a=>a.title==="Lunch")!;
    const email=await builder(plan,{id:"photo-test",planId:plan.id,planVersion:plan.version,kind:"dining",date:"2026-11-10",activityId:activity.id,recipientRevision:1} as import("@c-assistant/storage").EmailJob);
    assert.equal(checks.length,3);
    assert.match(email.html,/src="https:\/\/cdn.example.org\/one.jpg"/);
    assert.doesNotMatch(email.html,/src="https:\/\/cdn.example.org\/two.jpg"/);
    assert.match(email.html,/src="https:\/\/cdn.example.org\/three.jpg"/);
    for(const name of ["One","Two","Three"])assert.ok(email.text.includes(name));
    assert.equal(email.research?.images?.length,2);
    assert.equal(email.research?.images?.[0]?.status,"available");
    assert.equal(email.research?.images?.[1]?.status,"recheck");
    assert.equal(email.research?.images?.[0]?.targetId,"restaurant-0");
    assert.match(email.html,/alt="One dining room"/);
  }finally{store.close();}
});

test("scheduled morning, transfer and dining emails get destination-specific ride links only after the shared gate",async()=>{
 const store=new SqliteWorkspaceStore(":memory:");
 try{
  const plan=structuredClone(emailPlanFixture(store));
  for(const place of plan.presentation!.places){place.coordinates=[-38.13,176.25];place.city="Rotorua";place.locationLabel="Rotorua";}
  const {compileExecutionItinerary}=await import("./execution-itinerary.js");
  const items=compileExecutionItinerary(plan).activities;
  const builder=createEmailContentBuilder({store,rideClientId:()=>"public-test-client",now:()=>new Date("2026-10-15T08:00:00Z"),getConnectors:()=>({maps:{reverseGeocode:async()=>({status:"available",data:{country:"New Zealand",city:"Rotorua",district:""}})},googleWeather:{}} as unknown as ConnectorBundle)});
  for(const kind of ["morning","transfer","dining"] as const){
   const item=kind==="dining"?items.find(a=>a.title==="Lunch"):items.find(a=>a.title==="Museum");
   const email=await builder(plan,{id:"ride-test",planId:plan.id,planVersion:plan.version,kind,date:"2026-11-10",activityId:item!.id,recipientRevision:1} as import("@c-assistant/storage").EmailJob);
   assert.match(email.html,/class="ride-action"/);assert.match(email.text,/Open Uber/);assert.ok(email.html.includes("pickup=my_location"));
  }
 }finally{store.close();}
});

test('transfer resolves missing planned coordinates without changing Plan and separates overnight ETA from schedule',async()=>{
 const store=new SqliteWorkspaceStore(':memory:');
 try{
  const plan=emailPlanFixture(store);verifiedEmailFixture(store);const now=()=>new Date('2026-11-10T08:40:00Z');
  const scheduled=scheduledEmailJobs(plan,store.email.settings(),zones,now()).find(j=>j.kind==='transfer')!;
  const day=plan.presentation!.days.find(d=>d.date===scheduled.date)!;
  const origin=plan.presentation!.places.find(p=>p.id===day.startContext?.placeId)!;
  delete origin.coordinates;
  const transfer=day.blocks!.find(b=>b.startTime==='09:00')!;transfer.startTime='23:55';transfer.kind='transfer';
  let geocoded=false;
  const connectors={googleWeather:{},maps:{geocodeAddress:async()=>{geocoded=true;return {status:'available',observedAt:now().toISOString(),data:{location:'2.34,48.85'}};},walkingRoute:async(input:{origin:string;destination:string})=>({status:'available',observedAt:now().toISOString(),data:{...input,mode:'walking',durationSeconds:660,distanceMeters:800}})}} as unknown as ConnectorBundle;
  const rendered=await createEmailContentBuilder({store,getConnectors:()=>connectors,now,timeZoneForCity:()=>"UTC",rideClientId:()=>''})(plan,{...scheduled,status:'pending',attempts:0,retryAt:scheduled.dueAt});
  assert.equal(geocoded,true);assert.equal(origin.coordinates,undefined);
  assert.match(rendered.text,/00:06\s*\(\+1 day\)/);assert.doesNotMatch(rendered.text,/Ride unavailable|Connect Uber/);
  assert.doesNotMatch(rendered.html,/m\.uber\.com/);
 }finally{store.close();}
});

test('route-local timing computes 25 minutes late and suppresses early, unknown-zone and unavailable-route warnings',async()=>{
 const {transferTiming}=await import('./email-transfer-timing.js');
 const base={date:'2026-11-06',departure:'08:30',durationMinutes:55,departureZone:'Pacific/Auckland',destinationZone:'Pacific/Auckland',scheduledStart:'09:00'};
 assert.deepEqual(transferTiming(base),{estimatedArrival:'09:25',lateMinutes:25});
 assert.deepEqual(transferTiming({...base,durationMinutes:25}),{estimatedArrival:'08:55'});
 assert.deepEqual(transferTiming({...base,departureZone:undefined}),{});
 assert.deepEqual(transferTiming({...base,destinationZone:'Invalid/Zone'}),{});
 assert.deepEqual(transferTiming({...base,durationMinutes:0}),{});
 assert.deepEqual(transferTiming({...base,date:'2026-09-27',departure:'02:30'}),{});
 const crossing=transferTiming({...base,date:'2026-11-06',departure:'23:55',durationMinutes:11,scheduledStart:undefined});
 assert.equal(crossing.estimatedArrival,'00:06 (+1 day)');
});

test("安排失败前先投递变化通知，安排挂起期间新增变化仍可投递", async () => {
  for (const failure of [false, true]) {
    const store = new SqliteWorkspaceStore(":memory:");
    let finish!: () => void;
    try {
      const plan = emailPlanFixture(store); verifiedEmailFixture(store);
      const captures: EmailMessage[] = []; let calls = 0;
      const enqueue = (id: string) => store.email.enqueue({ id, planId: plan.id, planVersion: plan.version, kind: "change", date: "2026-11-10", dueAt: "2026-11-10T07:00:00Z", expiresAt: "2026-11-10T23:59:00Z", recipientRevision: store.email.settings().revision, content: { subject: id, html: "<p>行程变化</p>", text: "行程变化" } });
      enqueue("first-change");
      const worker = runtimeEmailWorker({ store, getTransport: () => captureTransport(captures), render, now: () => new Date("2026-11-10T07:30:00Z"), schedule: async () => { calls++; if (failure) throw new Error("模拟安排服务不可用"); await new Promise<void>(resolve => { finish = resolve; }); return []; } });
      const first = worker.tick(zones);
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(captures.length, 1);
      enqueue("second-change");
      await worker.tick(zones);
      assert.equal(captures.length, 2);
      if (!failure) { assert.equal(calls, 1); finish(); }
      await first;
    } finally { store.close(); }
  }
});

test("收件修订不变的时区更正及投递准备中的授权变化阻止发送", async () => {
  for (const stage of ["render", "prepare-zone", "prepare-plan", "prepare-lease"]) {
    const store = new SqliteWorkspaceStore(":memory:");
    try {
      const plan = emailPlanFixture(store); verifiedEmailFixture(store); const captures: EmailMessage[] = [];
      const revision = store.email.settings().revision;
      const revoke = () => store.email.updateSettings({ ...store.email.settings(), cityTimeZones: { paris: "Europe/Paris" } });
      const job = scheduledEmailJobs(plan, store.email.settings(), zones, new Date("2026-11-10T07:30:00Z"))[0]!;
      store.email.enqueue(job);
      await runtimeEmailWorker({ store, getTransport: () => captureTransport(captures), now: () => new Date("2026-11-10T07:30:00Z"), render: async () => { if (stage === "render") revoke(); return render(); }, prepareDelivery: (claimed, content) => { if (stage === "prepare-zone") revoke(); if (stage === "prepare-plan") emailPlanFixture(store, "替代行程"); if (stage === "prepare-lease") store.email.settle(claimed.id, claimed.lease!, "cancelled", "2026-11-10T07:30:00Z", "lease_revoked"); return content; } }).tick(zones);
      assert.equal(captures.length, 0, stage);
      if (stage !== "prepare-plan") assert.equal(store.email.settings().revision, revision);
    } finally { store.close(); }
  }
});

test("前次时区查询挂起时，监控仍投递新持久化的变化通知", async context => {
  context.mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-10T07:30:00Z") });
  const { createEmailPlanMonitoringService } = await import("./email-plan-monitoring.js");
  const store = new SqliteWorkspaceStore(":memory:");
  let release!: () => void;
  try {
    const plan = emailPlanFixture(store); verifiedEmailFixture(store); const captures: EmailMessage[] = [];
    let queried = false;
    const service = createEmailPlanMonitoringService({ store, getConnectors: () => ({ maps: { geocodeAddress: async () => { queried = true; await new Promise<void>(resolve => { release = resolve; }); return { status: "unavailable" }; } }, googleWeather: {} }) as unknown as ConnectorBundle, getEmailTransport: () => captureTransport(captures), logWarning: () => {} });
    const first = service.runItineraryDepartureReminders();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(queried, true);
    const now = Date.now();
    store.email.enqueue({ id: "change-during-geocode", planId: plan.id, planVersion: plan.version, kind: "change", date: "2026-11-10", dueAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now + 60_000).toISOString(), recipientRevision: store.email.settings().revision, content: { subject: "行程变化", html: "<p>行程变化</p>", text: "行程变化" } });
    await service.runItineraryDepartureReminders();
    assert.equal(captures.length, 1);
    assert.equal(store.email.list().find(job => job.id === "change-during-geocode")?.status, "accepted");
    release(); await first;
  } finally { store.close(); }
});

test("持久授权摘要拒绝领取前发生的同修订时区更正", async () => {
  const { bookingRelationshipDigest } = await import("@c-assistant/core");
  const store = new SqliteWorkspaceStore(":memory:");
  try {
    const plan = emailPlanFixture(store); verifiedEmailFixture(store); const captures: EmailMessage[] = [];
    const original = store.email.settings();
    store.email.updateSettings({ ...original, cityTimeZones: { paris: "Europe/Paris" } });
    store.email.enqueue({ id: "stale-authorization", planId: plan.id, planVersion: plan.version, kind: "change", date: "2026-11-10", dueAt: "2026-11-10T07:00:00Z", expiresAt: "2026-11-10T23:59:00Z", recipientRevision: original.revision, content: { subject: "行程变化", html: "<p>行程变化</p>", text: "行程变化", authorizationDigest: bookingRelationshipDigest(original) } });
    await runtimeEmailWorker({ store, getTransport: () => captureTransport(captures), render, now: () => new Date("2026-11-10T07:30:00Z") }).tick(zones);
    assert.equal(captures.length, 0);
    assert.equal(store.email.list().find(job => job.id === "stale-authorization")?.failureCode, "delivery_scope_changed");
  } finally { store.close(); }
});

test("重要变化通知优先于多条到期更早的常规邮件投递", async () => {
  const store = new SqliteWorkspaceStore(":memory:");
  try {
    const plan = emailPlanFixture(store); verifiedEmailFixture(store);
    const captures: EmailMessage[] = [];
    for (const [index, kind] of (["morning", "transfer", "dining", "transfer", "dining"] as const).entries()) {
      store.email.enqueue({ id: `earlier-routine-${index}`, planId: plan.id, planVersion: plan.version, kind, date: "2026-11-10", dueAt: `2026-11-10T06:0${index}:00Z`, expiresAt: "2026-11-10T23:59:00Z", recipientRevision: store.email.settings().revision, content: { subject: `常规提醒${index}`, html: "<p>常规提醒</p>", text: "常规提醒" } });
    }
    store.email.enqueue({ id: "priority-change", planId: plan.id, planVersion: plan.version, kind: "change", date: "2026-11-10", dueAt: "2026-11-10T07:00:00Z", expiresAt: "2026-11-10T23:59:00Z", recipientRevision: store.email.settings().revision, content: { subject: "重要行程变化", html: "<p>重要行程变化</p>", text: "重要行程变化" } });
    await runtimeEmailWorker({ store, getTransport: () => captureTransport(captures), render, now: () => new Date("2026-11-10T07:30:00Z") }).drain();
    assert.equal(captures.length, 4);
    assert.equal(captures[0]?.messageId, "<priority-change@landi.local>");
    assert.deepEqual(captures.slice(1).map(message => message.messageId), [0, 1, 2].map(index => `<earlier-routine-${index}@landi.local>`));
    assert.equal(store.email.list().find(job => job.id === "priority-change")?.status, "accepted");
    assert.equal(store.email.list().filter(job => job.status === "pending").length, 2);
  } finally { store.close(); }
});
