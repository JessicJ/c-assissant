import assert from "node:assert/strict";
import test from "node:test";
import { probeEmailPhoto } from "./email-photo.js";
test("email photos preserve only known synthetic-DNS uncertainty without claiming an image probe passed", async()=>{
 const url="https://cdn.example.org/photo.jpg";
 assert.equal(await probeEmailPhoto(url,undefined,{probe:async()=>undefined,resolveHost:async()=>[{address:"198.18.0.1"}]}),undefined);
 for(const address of ["127.0.0.1","10.1.2.3","192.168.1.2","::1","203.0.113.1"]) assert.equal(await probeEmailPhoto(url,undefined,{probe:async()=>undefined,resolveHost:async()=>[{address}]}),false);
 assert.equal(await probeEmailPhoto(url,undefined,{probe:async()=>false,resolveHost:async()=>{throw new Error("Must not resolve again");}}),false);
 assert.equal(await probeEmailPhoto(url,undefined,{probe:async()=>true,resolveHost:async()=>{throw new Error("Must not resolve again");}}),true);
 const controller=new AbortController();controller.abort();
 assert.equal(await probeEmailPhoto(url,controller.signal,{probe:async()=>undefined,resolveHost:async()=>{throw new Error("Cancelled probe must not resolve");}}),false);
});
