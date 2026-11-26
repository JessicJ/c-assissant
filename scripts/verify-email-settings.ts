import { chromium } from "@playwright/test";
import { createRequire } from "node:module";

import { SqliteWorkspaceStore } from "../packages/storage/src/index.js";
import { registerEmailExecutionRoutes } from "../apps/server/src/email-execution-routes.js";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// Isolated rendering of the actual settings component. No production .env, API,
// database, runtime CLI or external SMTP is loaded by this acceptance harness.
const projectRoot=new URL("../",import.meta.url).pathname;
const webRequire=createRequire(new URL("../apps/web/package.json",import.meta.url));
const serverRequire=createRequire(new URL("../apps/server/package.json",import.meta.url));
const {createServer}=await import(webRequire.resolve("vite"));
const {default:react}=await import(webRequire.resolve("@vitejs/plugin-react"));
const {default:Fastify}=await import(serverRequire.resolve("fastify"));
const output=resolve(projectRoot,process.argv[2] ?? "output/email-settings-verification");await mkdir(output,{recursive:true});
const testEnvPath=resolve(output,"sender-fixture.env");
process.env.LANDI_SMTP_HOST="smtp.example.test";process.env.LANDI_SMTP_PORT="587";process.env.LANDI_SMTP_USER="sender@example.test";process.env.LANDI_EMAIL_FROM="sender@example.test";process.env.LANDI_SMTP_PASSWORD="development-fixture-only";
const store=new SqliteWorkspaceStore(":memory:");const api=Fastify();let code="";let sends=0;let senderConfigured=true;let verificationFailure="";
registerEmailExecutionRoutes(api,{store,envPath:testEnvPath,getTransport:()=>({configured:()=>senderConfigured,verify:async()=>verificationFailure?{ready:false,code:verificationFailure}:{ready:true},send:async message=>{sends++;code=message.text.match(/\b\d{6}\b/)?.[0] ?? "";return {status:"accepted",messageId:message.messageId};}})});
const root=resolve(projectRoot,"apps/web");
const vite=await createServer({configFile:false,root,envDir:false,plugins:[react(),{
  name:"email-settings-fixture",
  resolveId(id){if(id==="/__email-settings-test.js")return "\0email-settings-test";},
  load(id){if(id==="\0email-settings-test")return `import React from 'react';import {createRoot} from 'react-dom/client';import {SettingsWorkspace} from '${root}/src/SettingsWorkspace.tsx';import '${root}/src/styles.css';createRoot(document.getElementById('root')).render(React.createElement(SettingsWorkspace,{workspace:${JSON.stringify(store.getWorkspace())},configuration:null,checks:[],onWorkspace:()=>{},onConfiguration:()=>{},onChecks:()=>{},onError:()=>{}}));`;},
  configureServer(server){server.middlewares.use((request,response,next)=>{void (async()=>{
    if(request.url==="/__email-settings") {response.setHeader("Content-Type","text/html");response.end(await server.transformIndexHtml(request.url,`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main id="root" style="max-width:720px;margin:auto;padding:16px"></main><script type="module" src="/__email-settings-test.js"></script></body></html>`));return;}
    if(!request.url?.startsWith("/api/email-execution")){next();return;}
    const chunks:Buffer[]=[];for await(const chunk of request)chunks.push(Buffer.from(chunk));
    const result=await api.inject({method:request.method as "GET"|"POST"|"PUT",url:request.url,headers:request.headers as Record<string,string>,...(chunks.length?{payload:Buffer.concat(chunks).toString()}: {})});
    response.writeHead(result.statusCode,result.headers);response.end(result.body);
  })().catch(()=>{response.statusCode=500;response.end('{"error":"Test request failed"}');});});}
}],server:{host:"127.0.0.1",port:0}});
await vite.listen();const origin=vite.resolvedUrls!.local[0]!.replace(/\/$/,"");
const browser=await chromium.launch();const checks:unknown[]=[];const startedAt=new Date().toISOString();
try {
  const context=await browser.newContext({viewport:{width:390,height:844}});
  await context.route("**/*",route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  const page=await context.newPage();const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));page.setDefaultTimeout(10000);
  await page.goto(`${origin}/__email-settings`);await page.getByRole("heading",{name:"Travel emails"}).waitFor();
  if(await page.locator(".settings-card").first().getAttribute("id")!=="travel-email-settings")throw new Error("Email configuration was not the first Settings card");
  await page.getByText("Sender configured. Your password is saved; leave it blank to keep it.",{exact:true}).waitFor();
  if(await page.getByLabel("Sender account",{exact:true}).inputValue()!=="sender@example.test")throw new Error("Saved sender account was not restored");
  if(await page.getByLabel("App password / SMTP credential",{exact:true}).inputValue()!=="")throw new Error("Saved password was exposed");
  if(await page.getByLabel("Morning handbook",{exact:true}).count() || await page.getByLabel("Transfer preparation lead (minutes)",{exact:true}).count())throw new Error("Manual schedule remains");
  await page.getByLabel("SMTP server",{exact:true}).fill("updated-smtp.example.test");await page.getByRole("button",{name:"Save sender",exact:true}).click();await page.getByRole("status").filter({hasText:"Sender saved. Password saved; no need to enter it again."}).waitFor();
  if(await page.getByLabel("SMTP server",{exact:true}).inputValue()!=="updated-smtp.example.test")throw new Error("Saving cleared public sender fields");
  await page.reload();await page.getByText("Sender configured. Your password is saved; leave it blank to keep it.",{exact:true}).waitFor();
  if(await page.getByLabel("SMTP server",{exact:true}).inputValue()!=="updated-smtp.example.test" || await page.getByLabel("App password / SMTP credential",{exact:true}).inputValue()!=="")throw new Error("Reload did not restore private sender state safely");
  checks.push({scenario:"sender-save-reload-and-no-manual-schedule",passed:true});
  await page.getByRole("button",{name:"Check sender connection",exact:true}).click();await page.getByRole("status").filter({hasText:"Sender connection verified. No email was sent."}).waitFor();
  if(sends!==0)throw new Error("Connection check sent an email");
  checks.push({scenario:"settings-entry-and-sender-status",passed:true});
  verificationFailure="smtp_connection_failed";await page.getByRole("button",{name:"Check sender connection",exact:true}).click();await page.getByRole("status").filter({hasText:"network or proxy"}).waitFor();
  if(sends!==0)throw new Error("Failed sender check sent mail");checks.push({scenario:"network-failure-does-not-claim-password-rejection",passed:true});verificationFailure="";
  await page.getByLabel("Receive at").fill("traveler@example.test");await page.getByRole("button",{name:"Save email settings",exact:true}).click();await page.getByRole("status").filter({hasText:"Recipient saved"}).waitFor();
  await page.getByText("Destination time zones (when automatic lookup is unavailable)",{exact:true}).click();
  await page.getByLabel("Destination city",{exact:true}).fill("Paris");await page.getByLabel("Destination time zone",{exact:true}).selectOption("Europe/Paris");await page.getByRole("button",{name:"Add destination time zone",exact:true}).click();
  await page.getByRole("button",{name:"Save email settings",exact:true}).click();await page.getByRole("status").filter({hasText:"Recipient saved"}).waitFor();
  if(store.email.settings().cityTimeZones.paris!=="Europe/Paris")throw new Error("Destination time zone was not persisted");checks.push({scenario:"destination-time-zone",passed:true});
  await page.getByRole("button",{name:"Send verification email",exact:true}).click();await page.getByRole("status").filter({hasText:"Mail server accepted"}).waitFor();
  if(sends!==1)throw new Error("Verification did not run once");
  await page.getByLabel("Verification code").fill(code);await page.getByRole("button",{name:"Verify recipient",exact:true}).click();await page.getByRole("status").filter({hasText:"Recipient verified"}).waitFor();
  await page.getByRole("button",{name:"Enable travel emails",exact:true}).click();await page.getByRole("button",{name:"Pause travel emails",exact:true}).waitFor();
  senderConfigured=false;await page.reload();await page.getByRole("button",{name:"Pause travel emails",exact:true}).click();await page.getByRole("button",{name:"Enable travel emails",exact:true}).waitFor();
  if(store.email.settings().enabled)throw new Error("Pause failed with missing sender");
  await page.getByText("Sender not configured. Enter your sending service below, then save and check the connection.",{exact:true}).waitFor();
  checks.push({scenario:"configure-verify-enable-pause",passed:true,fakeSMTPCalls:sends});
  for(const width of [375,390,430,1024]){await page.setViewportSize({width,height:844});const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);if(overflow)throw new Error(`Settings overflow at ${width}`);await page.screenshot({path:`${output}/settings-${width}.png`,fullPage:true});checks.push({scenario:"settings-layout",width,passed:true});}
  await page.getByLabel("Receive at").fill("changed@example.test");await page.getByRole("button",{name:"Save email settings",exact:true}).click();await page.getByRole("status").filter({hasText:"Recipient saved"}).waitFor();
  if(store.email.settings().verified)throw new Error("Changed address retained verification");if(errors.length)throw new Error(errors.join("\n"));checks.push({scenario:"address-change-revokes-verification",passed:true});
  await writeFile(`${output}/report.json`,JSON.stringify({startedAt,finishedAt:new Date().toISOString(),liveSending:false,checks},null,2));
  console.log(`Passed ${checks.length} isolated settings browser scenarios: ${output}`);
} finally {await (await import("node:fs/promises")).rm(testEnvPath,{force:true});await browser.close();await vite.close();await api.close();store.close();}
