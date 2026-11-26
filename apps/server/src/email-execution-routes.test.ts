import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { SqliteWorkspaceStore } from "@c-assistant/storage";
import type { EmailMessage, EmailTransport } from "@c-assistant/connectors";
import { registerEmailExecutionRoutes } from "./email-execution-routes.js";

test("recipient activation requires explicit verification; reads and cross-origin requests cannot send", async () => {
  const store = new SqliteWorkspaceStore(":memory:"); const server=Fastify(); const sent:EmailMessage[]=[];
  const transport:EmailTransport={configured:()=>true,verify:async()=>({ready:true}),send:async message=>{sent.push(message);return {status:"accepted",messageId:message.messageId};}};
  registerEmailExecutionRoutes(server,{store,envPath:"/unused-in-test",getTransport:()=>transport});
  try {
    assert.equal((await server.inject({method:"GET",url:"/api/email-execution"})).statusCode,200);assert.equal(sent.length,0);
    assert.equal((await server.inject({method:"POST",url:"/api/email-execution/verification",headers:{origin:"https://other.example.org"}})).statusCode,403);assert.equal(sent.length,0);
    await server.inject({method:"PUT",url:"/api/email-execution/settings",payload:{recipient:"traveler@example.test"}});
    assert.equal((await server.inject({method:"POST",url:"/api/email-execution/activation",payload:{enabled:true}})).statusCode,409);
    assert.equal((await server.inject({method:"POST",url:"/api/email-execution/verification"})).statusCode,200);assert.equal(sent.length,1);
    assert.equal((await server.inject({method:"POST",url:"/api/email-execution/verification"})).statusCode,429);
    const code=sent[0]!.text.match(/\b\d{6}\b/)![0];
    const snapshot=await server.inject({method:"GET",url:"/api/email-execution"});assert.ok(!snapshot.body.includes(code));assert.ok(!snapshot.body.includes("<p>"));
    assert.equal((await server.inject({method:"POST",url:"/api/email-execution/verify",payload:{code}})).statusCode,200);
    assert.equal((await server.inject({method:"POST",url:"/api/email-execution/activation",payload:{enabled:true}})).statusCode,200);
    await server.inject({method:"PUT",url:"/api/email-execution/settings",payload:{recipient:"other@example.test"}});
    assert.equal(store.email.settings().verified,false);assert.equal(store.email.settings().enabled,false);
    assert.equal((await server.inject({method:"POST",url:"/api/email-execution/verify",payload:{code}})).statusCode,400);
  } finally {await server.close();store.close();}
});

test("unknown verification delivery stops duplicate requests and cannot activate", async () => {
  const store=new SqliteWorkspaceStore(":memory:");const server=Fastify();let calls=0;
  const transport:EmailTransport={configured:()=>true,verify:async()=>({ready:true}),send:async()=>{calls++;return {status:"uncertain",code:"smtp_delivery_unknown",retryable:false};}};
  registerEmailExecutionRoutes(server,{store,envPath:"/unused-in-test",getTransport:()=>transport});
  try {
    store.email.updateSettings({recipient:"traveler@example.test"});
    assert.equal((await server.inject({method:"POST",url:"/api/email-execution/verification"})).statusCode,503);
    assert.equal((await server.inject({method:"POST",url:"/api/email-execution/verification"})).statusCode,429);assert.equal(calls,1);
    assert.equal((await server.inject({method:"POST",url:"/api/email-execution/activation",payload:{enabled:true}})).statusCode,409);
  } finally {await server.close();store.close();}
});

test("sender check explains network and authorization failures without sending or exposing private responses",async()=>{
 const store=new SqliteWorkspaceStore(":memory:");const server=Fastify();let code="smtp_connection_failed";
 registerEmailExecutionRoutes(server,{store,envPath:"/unused-in-test",getTransport:()=>({configured:()=>true,verify:async()=>({ready:false,code}),send:async()=>{throw new Error("Unexpected send");}})});
 try{
  const network=await server.inject({method:"POST",url:"/api/email-execution/sender/check",payload:{}});assert.equal(network.statusCode,503);assert.match(network.json().error,/network or proxy/);assert.match(network.json().error,/authorization has not been confirmed/);
  code="smtp_authorization_failed";const auth=await server.inject({method:"POST",url:"/api/email-execution/sender/check",payload:{}});assert.match(auth.json().error,/rejected account authorization/);
 }finally{await server.close();store.close();}
});
