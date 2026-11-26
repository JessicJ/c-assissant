import assert from "node:assert/strict";
import test from "node:test";
import { createEmailRideBuilder } from "./email-ride.js";
import { createGrabRideHandoff } from "@c-assistant/connectors";
import type { ConnectorBundle } from "./connector-bundle.js";
import type { PlanPlace } from "@c-assistant/core";
const origin={id:"origin",name:"Hotel",coordinates:[-38.1368,176.2497]} as PlanPlace;
const destination={name:"Te Puia",city:"Rotorua"};
const maps=(country:string,city:string,onCall=()=>{})=>({reverseGeocode:async()=>{onCall();return{status:"available",data:{country,city,district:""}};}} as unknown as ConnectorBundle["maps"]);
const now=new Date("2026-10-15T08:00:00Z");
test("email ride actions require configuration, exact local coverage and a known planned origin",async()=>{
 let calls=0;
 const off=createEmailRideBuilder({maps:maps("New Zealand","Rotorua",()=>{calls++;}),now});
 assert.equal(await off(origin,destination),undefined);assert.equal(calls,0);
 const ride=createEmailRideBuilder({maps:maps("New Zealand","Rotorua",()=>{calls++;}),clientId:"public-client",now});
 assert.equal(await ride(undefined,destination),undefined);
 const first=await ride(origin,destination),second=await ride(origin,{name:"Another stop"});
 assert.equal(first?.provider,"uber");assert.equal(second?.provider,"uber");assert.equal(calls,1);
 assert.equal(new URL(first!.link.url).searchParams.get("pickup"),"my_location");
 for(const [country,city] of [["New Zealand","Unknown town"],["China","Shanghai"],["","Rotorua"]])assert.equal(await createEmailRideBuilder({maps:maps(country!,city!),clientId:"public-client",now})(origin,destination),undefined);
 assert.equal(await createEmailRideBuilder({maps:maps("New Zealand","Rotorua"),clientId:"public-client",now:new Date("2027-02-01")})(origin,destination),undefined);
});
test("supported Southeast Asian origins open Grab booking without leaking Uber client configuration",async()=>{
 const ride=await createEmailRideBuilder({maps:maps("Indonesia","Ubud"),clientId:"public-uber-client",now})(origin,{name:"Museum Puri Lukisan",city:"Ubud"});
 assert.equal(ride?.provider,"grab");const url=new URL(ride!.link.url);
 assert.equal(url.origin,"https://grab.onelink.me");assert.equal(url.searchParams.get("af_dp"),"grab://open?screenType=BOOKING");
 assert.equal(url.searchParams.get("af_web_dp"),"https://www.grab.com/download/");assert.ok(!ride!.link.url.includes("public-uber-client"));
 assert.match(ride!.note,/Museum Puri Lukisan/);assert.equal(createGrabRideHandoff().requiresUserAction,true);
});
