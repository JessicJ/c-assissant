import assert from "node:assert/strict";
import test from "node:test";

import { createPlanFromRequest } from "@c-assistant/core";
import { arrivalRouteDestination, formatArrivalRoute, selectArrivalTransport } from "./arrival-route.js";

test("an arrival route only uses a concrete Plan accommodation", () => {
  const plan = createPlanFromRequest({ request: "I will arrive in Shanghai." });
  assert.equal(arrivalRouteDestination(plan), undefined);
  plan.configuration.accommodation = { status: "confirmed", name: "Riverside Hotel", address: "1 River Road", location: "121.456,31.250", source: "user" };
  assert.equal(arrivalRouteDestination(plan)?.name, "Riverside Hotel");
});

test("arrival route selection keeps an explicit Plan preference", () => {
  const plan = createPlanFromRequest({ request: "I will arrive in Shanghai." });
  plan.configuration.transport.preference = "walking";
  assert.equal(selectArrivalTransport(plan, [{ mode: "driving", origin: "121.455,31.249", destination: "121.456,31.250", distanceMeters: 1_600, durationSeconds: 300, strategy: "amap_recommended" }, { mode: "walking", origin: "121.455,31.249", destination: "121.456,31.250", distanceMeters: 1_100, durationSeconds: 900, strategy: "amap_recommended" }]), "walking");
});

test("a one-route override wins without changing the saved Plan preference", () => {
  const plan = createPlanFromRequest({ request: "I will arrive in Shanghai." });
  plan.configuration.transport.preference = "plan_recommended";
  assert.equal(selectArrivalTransport(plan, [{ mode: "driving", origin: "121.455,31.249", destination: "121.456,31.250", distanceMeters: 1_600, durationSeconds: 300, strategy: "amap_recommended" }], "taxi"), "driving");
  assert.equal(plan.configuration.transport.preference, "plan_recommended");
});

test("arrival route copy makes the Google Maps handoff and its boundary explicit", () => {
  const origin = { id: "", name: "Shared current location", address: "", location: "121.455,31.249", type: "Temporary location", city: "", district: "" };
  const destination = { id: "stay-1", name: "Riverside Hotel", address: "1 River Road", location: "121.456,31.250", type: "Accommodation", city: "Shanghai", district: "Jing'an" };
  const result = formatArrivalRoute({ origin, destination, transport: "driving", route: { mode: "driving", origin: origin.location, destination: destination.location, distanceMeters: 2_400, durationSeconds: 720, taxiCostYuan: 18, strategy: "amap_recommended" } });
  assert.match(result.text, /2\.4 km/);
  assert.match(result.text, /not hailed a ride/i);
  assert.equal(result.handoffLabel, "Open route in Google Maps");
  assert.match(result.handoffUrl, /^https:\/\/www\.google\.com\/maps\/dir/);
});

test("a taxi request hands off to Uber while keeping Amap route facts separate", () => {
  const origin = { id: "", name: "Shared current location", address: "", location: "121.455,31.249", type: "Temporary location", city: "", district: "" };
  const destination = { id: "stay-1", name: "Riverside Hotel", address: "1 River Road", location: "121.456,31.250", type: "Accommodation", city: "Shanghai", district: "Jing'an" };
  const result = formatArrivalRoute({ origin, destination, transport: "driving", taxiRequested: true, uberPickup: { latitude: 31.249, longitude: 121.455 }, route: { mode: "driving", origin: origin.location, destination: destination.location, distanceMeters: 2_400, durationSeconds: 720, taxiCostYuan: 18, strategy: "amap_recommended" } });
  assert.match(result.text, /Continue in Uber/i);
  assert.match(result.text, /live fare/i);
  assert.match(result.text, /Confirm the ride in Uber/i);
  assert.match(result.text, /only when you are ready/i);
  assert.match(result.text, /do not need to confirm boarding or arrival/i);
  assert.match(result.text, /I haven't arrived/i);
  assert.equal(result.handoffLabel, "Open Uber");
  assert.match(result.handoffUrl, /^https:\/\/m\.uber\.com\/looking/);
  assert.doesNotMatch(result.handoffUrl, /uri\.amap\.com/);
});

test("arrival route copy includes a public-transit fare when Amap provides one", () => {
  const origin = { id: "", name: "Shared current location", address: "", location: "121.455,31.249", type: "Temporary location", city: "", district: "" };
  const destination = { id: "stay-1", name: "Riverside Hotel", address: "1 River Road", location: "121.456,31.250", type: "Accommodation", city: "Shanghai", district: "Jing'an" };
  const result = formatArrivalRoute({ origin, destination, transport: "transit", route: { mode: "transit", origin: origin.location, destination: destination.location, distanceMeters: 2_400, durationSeconds: 1_020, transitCostYuan: 4, strategy: "public_transit_recommended" } });
  assert.match(result.text, /estimated transit fare ¥4/);
});
