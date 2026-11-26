import assert from "node:assert/strict";
import test from "node:test";
import { SmtpEmailConnector } from "./email.js";
const configuration = { host: "smtp.example.test", port: 587, user: "sender@example.test", password: "isolated-test-value", from: "sender@example.test" };
const message = { to: "traveler@example.test", subject: "Travel handbook", html: "<p>Plan</p>", text: "Plan", messageId: "<abc123@landi.local>" };

test("unconfigured mail never attempts transport; accepted means SMTP acceptance only", async () => {
  assert.equal((await new SmtpEmailConnector({}).send(message)).status, "not_configured");
  let calls = 0;
  const connector = new SmtpEmailConnector(configuration, { verify: async () => true, sendMail: async input => { calls++; assert.equal(input.disableFileAccess, true); assert.equal(input.disableUrlAccess, true); return { messageId: message.messageId, accepted: [message.to] }; } });
  assert.deepEqual(await connector.verify(), { ready: true });
  assert.equal((await connector.send(message)).status, "accepted");
  assert.equal(calls, 1);
  assert.equal((await connector.send({ ...message, subject: "Header\nBcc: outsider@example.test" })).status, "rejected");
  assert.equal(calls, 1);
});

test("unknown DATA outcome is not retryable; explicit negative replies and pre-send connection failures are distinct", async () => {
  for (const [failure, status, retryable] of [
    [{ command: "DATA", code: "ETIMEDOUT" }, "uncertain", false],
    [{ command: "CONN", code: "ECONNECTION" }, "rejected", true],
    [{ responseCode: 450 }, "rejected", true],
    [{ responseCode: 550 }, "rejected", false],
    [{ code: "EAUTH" }, "rejected", false]
  ] as const) {
    const connector = new SmtpEmailConnector(configuration, { verify: async () => true, sendMail: async () => { throw Object.assign(new Error("Private response is not projected"), failure); } });
    const result = await connector.send(message);
    assert.equal(result.status, status);
    assert.equal("retryable" in result && result.retryable, retryable);
    assert.doesNotMatch(JSON.stringify(result), /Private response|isolated-test-value/);
  }
});

test("sender verification distinguishes connection failures from explicit authorization rejection without exposing responses",async()=>{
 for(const [failure,expected] of [[{command:"CONN",code:"ECONNECTION"},"smtp_connection_failed"],[{code:"ETIMEDOUT"},"smtp_connection_failed"],[{code:"EAUTH"},"smtp_authorization_failed"],[{},"smtp_verification_failed"]] as const){
  const connector=new SmtpEmailConnector(configuration,{verify:async()=>{throw Object.assign(new Error("Private server response"),failure);},sendMail:async()=>{throw new Error("Verification cannot send");}});
  const result=await connector.verify();assert.deepEqual(result,{ready:false,code:expected});assert.ok(!JSON.stringify(result).includes("Private server response"));
 }
});

test("CID PNG bytes enter a real multipart related MIME message without file or URL reads", async () => {
  const {readFile}=await import("node:fs/promises");
  const nodemailer=(await import("nodemailer")).default;
  const content=await readFile(new URL("../../../apps/server/src/email-templates/design-kit/png/car.png",import.meta.url));
  const asset={cid:"landi-kit-v1-car@landi.assets",filename:"car.png",contentType:"image/png" as const,contentBase64:content.toString("base64")};
  const stream=nodemailer.createTransport({streamTransport:true,buffer:true,newline:"unix"});
  let mime="";let calls=0;
  const connector=new SmtpEmailConnector(configuration,{verify:async()=>true,sendMail:async input=>{
    calls++;assert.deepEqual((input.attachments![0] as {content:Buffer}).content,content);
    assert.equal(input.disableFileAccess,true);assert.equal(input.disableUrlAccess,true);
    const result=await stream.sendMail(input);mime=result.message.toString();return {messageId:message.messageId,accepted:[message.to]};
  }});
  assert.equal((await connector.send({...message,html:`<img src="cid:${asset.cid}" alt="Transport">`,attachments:[asset]})).status,"accepted");
  assert.match(mime,/multipart\/related/);assert.match(mime,/Content-ID: <landi-kit-v1-car@landi\.assets>/);assert.match(mime,/Content-Disposition: inline/);assert.match(mime,/Content-Type: image\/png/);
  const encoded=mime.match(/Content-Type: image\/png[^]*?\r?\n\r?\n([A-Za-z0-9+/=\r\n]+)\r?\n--/);assert.ok(encoded,"PNG MIME body exists");assert.deepEqual(Buffer.from(encoded[1]!.replace(/\s/g,""),"base64"),content);
  for(const attachment of [{...asset,filename:"../car.png"},{...asset,contentBase64:"not png"},{...asset,cid:"other@outside.example"}])assert.equal((await connector.send({...message,html:`<img src="cid:${asset.cid}">`,attachments:[attachment]})).status,"rejected");
  assert.equal((await connector.send({...message,html:`<img src="cid:${asset.cid}">`})).status,"rejected");
  assert.equal((await connector.send({...message,html:`<img src="cid:${asset.cid}">`,attachments:[asset,asset]})).status,"rejected");
  assert.equal(calls,1);
});

test('generated JPEG and original PNG inline assets share bounded real MIME delivery',async()=>{
 const {readFile}=await import('node:fs/promises');const nodemailer=(await import('nodemailer')).default;
 const bytes=await readFile(new URL('./test-fixtures/email-hero.jpg',import.meta.url));const image={cid:'landi-event-hero-test@landi.assets',filename:'event-hero.jpg',contentType:'image/jpeg' as const,contentBase64:bytes.toString('base64')};
 const stream=nodemailer.createTransport({streamTransport:true,buffer:true,newline:'unix'});let mime='';const connector=new SmtpEmailConnector(configuration,{verify:async()=>true,sendMail:async input=>{mime=String((await stream.sendMail(input)).message);return {messageId:message.messageId,accepted:[message.to]};}});
 const email={...message,html:`<img alt="AI-generated travel image" src="cid:${image.cid}">`,attachments:[image]};assert.equal((await connector.send(email)).status,'accepted');assert.match(mime,/Content-Type: image\/jpeg/);assert.match(mime,/Content-ID: <landi-event-hero-test@landi.assets>/);
 for(const bad of [{...image,contentType:'image/png' as const},{...image,filename:'event-hero.png'},{...image,contentBase64:Buffer.from('not an image').toString('base64')}])assert.equal((await connector.send({...email,attachments:[bad]})).status,'rejected');
});
