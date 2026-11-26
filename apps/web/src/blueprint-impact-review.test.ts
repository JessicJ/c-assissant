import assert from "node:assert/strict";
import test from "node:test";
import type { TripBlueprint } from "@c-assistant/core";
import { bookingRelationshipImpact } from "@c-assistant/core/booking-relationship";
import { checkedBlueprintImpact as parseImpact } from "./blueprint-impact-review.js";

const blueprint = { id: "blueprint", version: 3, days: [{ id: "day", date: "2026-12-01", stops: [{placeId:"place",order:1}] }], places: [{ id: "place", evidence: [{ sourceId: "source", status: "verified", supports: ["已核实的旅行事实"] }] }], movements: [{ id: "movement", dayId: "day" }], actionRequirements: [{ id: "requirement", placeId: "place" }], bookingConstraints: [] } as unknown as TripBlueprint;
const plan={id:"plan",version:1};
const sourceContext={planId:plan.id,planVersion:plan.version,blueprintId:blueprint.id,blueprintVersion:blueprint.version,sourceSetDigest:"b".repeat(64),adoptedUnits:[],pendingSources:[],resolutionIssues:[]};
const checkedBlueprintImpact = (value: unknown, current: TripBlueprint | undefined) => parseImpact(value,current,plan,[{kind:"remove_place_from_day",placeId:"place",dayId:"day"}]);
const preview = () => ({ id: "review-token", blueprintId: "blueprint", blueprintVersion: 3, sourceContext, dayIds: ["day"], dates: ["2026-12-01"], placeIds: ["place"], movementIds: ["movement"], reminderRequirementIds: ["requirement"], bookingConstraintIds: [], bookingImpact: bookingRelationshipImpact(blueprint,[{kind:"remove_place_from_day",placeId:"place",dayId:"day"}],sourceContext), evidence: [{ sourceId: "source", status: "verified", supports: ["已核实的旅行事实"] }], nextActions: ["confirm_removal", "cancel", "assisted_replanning"] });

test("影响预览保留精确当前蓝图的合法业务结构与来源", () => {
  const result = checkedBlueprintImpact(preview(), blueprint);
  assert.ok(result); assert.equal(result.evidence[0], blueprint.places[0]!.evidence[0]);
  assert.deepEqual(result.placeIds, ["place"]);
});

test("畸形预览、过期身份、错误日期、任意诊断与未知来源都不进入产品预览", () => {
  for (const patch of [
    { blueprintId: "other" }, { blueprintVersion: 2 }, { id: "" },
    { dates: ["2026-02-30"] }, { dates: ["内部诊断哨兵"] }, { dates: [{}] },
    { placeIds: ["内部诊断哨兵"] }, { dayIds: [{}] }, { movementIds: [42] },
    { reminderRequirementIds: ["unknown"] }, { bookingConstraintIds: [null] },
    { nextActions: ["内部诊断哨兵"] }, { evidence: [{}] },
    { evidence: [{ sourceId: "source", status: "verified", supports: ["内部诊断哨兵"] }] },
    { evidence: [{ sourceId: "source", status: "verified", supports: [{}] }] },
    { evidence: [{ sourceId: "unknown", status: "verified" }] }
  ]) assert.equal(checkedBlueprintImpact({ ...preview(), ...patch }, blueprint), null);
  assert.equal(checkedBlueprintImpact(preview(), undefined), null);
});

test("完整原批次精确核对跨日优先级与未排程全局影响", () => {
  const current = structuredClone(blueprint);
  current.days = [
    {id:"day",date:"2026-12-01",stops:[],blocks:[{id:"x",placeId:"place"},{id:"y",placeId:"place"}]},
    {id:"other",date:"2026-12-02",stops:[]},
    {id:"last",date:"2026-12-03",stops:[{placeId:"place"}]}
  ] as unknown as TripBlueprint["days"];
  const revisions = [{kind:"update_place_priority",placeId:"place"}];
  const value = {...preview(),dayIds:["day","last"],dates:["2026-12-01","2026-12-03"],bookingImpact:bookingRelationshipImpact(current,revisions,sourceContext)};
  assert.ok(parseImpact(value,current,plan,revisions));
  for(const patch of [
    {dayIds:[],dates:[]},{dayIds:["day"],dates:["2026-12-01"]},
    {dayIds:["day","day","last"],dates:["2026-12-01","2026-12-01","2026-12-03"]},
    {dayIds:["day","other","last"],dates:["2026-12-01","2026-12-02","2026-12-03"]},
    {dates:["2026-12-03","2026-12-01"]},{placeIds:["place","place"]}
  ]) assert.equal(parseImpact({...value,...patch},current,plan,revisions),null);
  const mixed = [...revisions,{kind:"remove_place_from_day",placeId:"place",dayId:"other"}];
  assert.equal(parseImpact(value,current,plan,mixed),null);
  current.days.forEach(day=>{day.stops=[];day.blocks=[];});
  const global = {...preview(),dayIds:[],dates:[],movementIds:[],bookingImpact:bookingRelationshipImpact(current,revisions,sourceContext)};
  assert.ok(parseImpact(global,current,plan,revisions));
  assert.equal(parseImpact({...global,dates:["2026-12-01"]},current,plan,revisions),null);
  assert.equal(parseImpact({...global,dayIds:["day"]},current,plan,revisions),null);
});
