import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import type { TravelBooking } from "@c-assistant/core";
import { bookingRelationshipDigest } from "@c-assistant/core";
import { randomUUID } from "node:crypto";
import { SqliteWorkspaceStore } from "@c-assistant/storage";
import { registerBookingRoutes } from "./booking-routes.js";
import { planningResearchScopes } from "./planning-session-generation.js";

const now = "2026-09-18T00:00:00.000Z";

test("booking route preserves a user-confirmed destination across repeated hotel imports", async () => {
  const store = new SqliteWorkspaceStore(":memory:");
  const server = Fastify({ logger: false });
  registerBookingRoutes(server, { store });
  const created = store.createPlanningSession("travel");
  store.savePlanningSession({
    ...created,
    status: "proposal_ready",
    facts: [
      { key: "destination", value: "Porto, Portugal", source: "user", confirmed: true, updatedAt: now },
      { key: "travel_dates", value: "2026-11-10 to 2026-11-12", source: "user", confirmed: true, updatedAt: now },
      { key: "purpose", value: "Leisure", source: "user", confirmed: true, updatedAt: now }
    ],
    proposal: { version: 1, title: "Porto, Portugal", objective: "Leisure in Porto, Portugal", theme: "Architecture", segments: ["Porto"], skeleton: ["Porto"], tradeoffs: [], assumptions: [], decisionPoints: [] },
    updatedAt: now
  });
  const booking = hotelBooking(created.id, "Praca da Batalha, Porto, Portugal");

  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const existing=store.listTravelBookingsForPlanningSession(created.id).find(value=>value.id===booking.id);
      const response = await server.inject({ method: "POST", url: `/api/planning-sessions/${created.id}/bookings/import-confirm`, payload: { booking,requestId:randomUUID(),expectedRevision:store.getPlanningRevision(created.id),...(existing?{expectedRecordDigest:bookingRelationshipDigest(existing)}:{}) } });
      assert.equal(response.statusCode, 200, response.body);
      const session = store.getPlanningSessionById(created.id)!;
      assert.equal(session.facts.find((fact) => fact.key === "destination")?.value, "Porto, Portugal");
      assert.equal(session.facts.find((fact) => fact.key === "destination")?.source, "user");
      assert.equal(session.facts.find((fact) => fact.key === "accommodation_location")?.value, "Praca da Batalha, Porto, Portugal");
      assert.deepEqual(planningResearchScopes(session), ["Porto, Portugal"]);
      assert.equal(session.deferred.some((item) => item.key === "accommodation_destination_conflict"), false);
    }
  } finally {
    await server.close();
    store.close();
  }
});

test("booking route retains a mismatched hotel and exposes a destination conflict", async () => {
  const store = new SqliteWorkspaceStore(":memory:");
  const server = Fastify({ logger: false });
  registerBookingRoutes(server, { store });
  const created = store.createPlanningSession("travel");
  store.savePlanningSession({
    ...created,
    status: "proposal_ready",
    facts: [
      { key: "destination", value: "Porto, Portugal", source: "user", confirmed: true, updatedAt: now },
      { key: "travel_dates", value: "2026-11-10 to 2026-11-12", source: "user", confirmed: true, updatedAt: now },
      { key: "purpose", value: "Leisure", source: "user", confirmed: true, updatedAt: now }
    ],
    proposal: { version: 1, title: "Porto, Portugal", objective: "Leisure in Porto, Portugal", theme: "Architecture", segments: ["Porto"], skeleton: ["Porto"], tradeoffs: [], assumptions: [], decisionPoints: [] },
    updatedAt: now
  });

  try {
    const response = await server.inject({ method: "POST", url: `/api/planning-sessions/${created.id}/bookings/import-confirm`, payload: { booking: hotelBooking(created.id, "Calle Example, Madrid, Spain"),requestId:randomUUID(),expectedRevision:store.getPlanningRevision(created.id) } });
    assert.equal(response.statusCode, 200, response.body);
    const session = store.getPlanningSessionById(created.id)!;
    assert.equal(session.facts.find((fact) => fact.key === "destination")?.value, "Porto, Portugal");
    assert.equal(store.listTravelBookingsForPlanningSession(created.id).length, 1);
    assert.match(session.deferred.find((item) => item.key === "accommodation_destination_conflict")?.question ?? "", /Madrid/);
  } finally {
    await server.close();
    store.close();
  }
});

function hotelBooking(planningSessionId: string, location: string): TravelBooking {
  return {
    id: "porto-hotel",
    planningSessionId,
    type: "accommodation",
    status: "confirmed",
    title: "Confirmed hotel",
    source: "user",
    sourceHash: `hotel-${location}`,
    sourceLabel: "Controlled fixture",
    importedAt: now,
    updatedAt: now,
    constraintStrength: "hard",
    segments: [{
      id: "hotel-stay",
      segmentType: "hotel_stay",
      title: "Confirmed hotel",
      status: "confirmed",
      startAtLocal: "2026-11-10T15:00",
      endAtLocal: "2026-11-12T11:00",
      location,
      constraintStrength: "hard",
      fixedCommitment: true,
      needsReviewReasons: []
    }]
  };
}

test("默认预订导入绑定会话存在性，失败不留新会话，回执重放不重新选择会话",async()=>{
  const store=new SqliteWorkspaceStore(":memory:");const server=Fastify({logger:false});registerBookingRoutes(server,{store});
  try{
    const context=(await server.inject({method:"GET",url:"/api/planning-sessions/bookings/context"})).json();assert.equal(context.expectedSessionId,null);
    const payload={requestId:randomUUID(),expectedSessionId:context.expectedSessionId,expectedRevision:context.revision,booking:{type:"accommodation",status:"needs_review",title:"虚构住宿资料",source:"user",sourceHash:"虚构来源摘要",sourceLabel:"旅行者测试声明",constraintStrength:"soft",segments:[]},sourceContent:"虚构保护材料"};
    const invalid=await server.inject({method:"POST",url:"/api/planning-sessions/bookings/import-confirm",payload:{...payload,requestId:randomUUID(),booking:{...payload.booking,title:17}}});assert.equal(invalid.statusCode,400,invalid.body);assert.equal(store.getPlanningSession(),undefined);
    const originalSave=store.saveProtectedBookingAttachment.bind(store);store.saveProtectedBookingAttachment=()=>{throw new Error("隔离附件保存失败");};
    const failed=await server.inject({method:"POST",url:"/api/planning-sessions/bookings/import-confirm",payload});assert.equal(failed.statusCode,500);assert.equal(store.getPlanningSession(),undefined);
    store.saveProtectedBookingAttachment=originalSave;
    const saved=await server.inject({method:"POST",url:"/api/planning-sessions/bookings/import-confirm",payload});assert.equal(saved.statusCode,200,saved.body);
    const session=store.getPlanningSession()!;const source=store.listTravelBookingsForPlanningSession(session.id)[0]!;assert.equal(source.segments.length,1);
    const replay=await server.inject({method:"POST",url:"/api/planning-sessions/bookings/import-confirm",payload});assert.equal(replay.statusCode,200,replay.body);assert.equal(replay.json().booking.id,source.id);assert.equal(replay.json().booking.id,saved.json().booking.id);assert.equal(store.listTravelBookingsForPlanningSession(session.id)[0]!.segments[0]!.id,source.segments[0]!.id);assert.equal(store.countProtectedBookingAttachments(source.id),1);
    const stale=await server.inject({method:"POST",url:"/api/planning-sessions/bookings/import-confirm",payload:{...payload,requestId:randomUUID()}});assert.equal(stale.statusCode,409);assert.equal(store.listTravelBookingsForPlanningSession(session.id).length,1);
  }finally{await server.close();store.close();}
});

test("旧无蓝图执行行程拒绝结构变化，非结构 CAS 不改变批准内容且底层无旁路",async()=>{
  const store=new SqliteWorkspaceStore(":memory:");const server=Fastify({logger:false});registerBookingRoutes(server,{store});
  try{
    const draft=store.getWorkspace().activePlan;
    const booking={...hotelBooking("","虚构旧住宿"),planId:draft.id,constraintStrength:"soft" as const};delete (booking as {planningSessionId?:string}).planningSessionId;
    store.saveTravelBooking(booking);store.confirmPlan(draft.id);const approved=store.getExecutionPlan()!;
    const source=store.listCurrentTravelBookingSourcesForPlan(approved.id)[0]!;
    const payload={requestId:randomUUID(),expectedVersion:approved.version,expectedSourceSetDigest:store.getCurrentTravelBookingSourceSetDigest(approved.id),expectedRecordDigest:bookingRelationshipDigest(source),booking:{...source,notes:"虚构非结构执行资料"}};
    const nonstructural=await server.inject({method:"POST",url:`/api/plans/${approved.id}/bookings/import-confirm`,payload});assert.equal(nonstructural.statusCode,200,nonstructural.body);assert.deepEqual(store.getExecutionPlan(),approved);
    const current=store.listCurrentTravelBookingSourcesForPlan(approved.id)[0]!;
    const structural=await server.inject({method:"POST",url:`/api/plans/${approved.id}/bookings/import-confirm`,payload:{...payload,requestId:randomUUID(),expectedRecordDigest:bookingRelationshipDigest(current),booking:{...current,status:"cancelled"}}});assert.equal(structural.statusCode,409,structural.body);assert.equal(structural.json().code,"blueprint_required");assert.deepEqual(store.getExecutionPlan(),approved);assert.deepEqual(store.listCurrentTravelBookingSourcesForPlan(approved.id)[0],current);
    const added=await server.inject({method:"POST",url:`/api/plans/${approved.id}/bookings/import-confirm`,payload:{requestId:randomUUID(),expectedVersion:approved.version,expectedSourceSetDigest:store.getCurrentTravelBookingSourceSetDigest(approved.id),booking:{...current,id:"虚构新增预订"}}});assert.equal(added.statusCode,409);assert.equal(store.listCurrentTravelBookingSourcesForPlan(approved.id).length,1);
    assert.throws(()=>store.saveTravelBooking({...current,status:"cancelled"}),/旧版执行行程/);assert.throws(()=>store.applyTravelBookingToCurrentPlan(current,approved.version),/执行行程预订/);
  }finally{await server.close();store.close();}
});
