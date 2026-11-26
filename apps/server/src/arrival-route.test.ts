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
  assert.doesNotMatch(result.text, /Route fact|Chosen route mode/);
  assert.equal(result.handoffLabel, "Open route in Google Maps");
  assert.match(result.handoffUrl, /^https:\/\/www\.google\.com\/maps\/dir/);
});

test("a taxi request hands off to Uber while keeping Amap route facts separate", () => {
  const origin = { id: "", name: "Shared current location", address: "", location: "121.455,31.249", type: "Temporary location", city: "", district: "" };
  const destination = { id: "stay-1", name: "Riverside Hotel", address: "1 River Road", location: "121.456,31.250", type: "Accommodation", city: "Shanghai", district: "Jing'an" };
  const result = formatArrivalRoute({ origin, destination, transport: "driving", taxiRequested: true, destinationContext: { country: "United States", city: "Los Angeles" }, uberPickup: { latitude: 31.249, longitude: 121.455 }, route: { mode: "driving", origin: origin.location, destination: destination.location, distanceMeters: 2_400, durationSeconds: 720, taxiCostYuan: 18, strategy: "amap_recommended" } });
  assert.match(result.text, /Open Uber below/i);
  assert.match(result.text, /live fare/i);
  assert.match(result.text, /Confirm the ride/i);
  assert.match(result.text, /only when you're ready/i);
  assert.match(result.text, /check in around your expected arrival/i);
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

test("arrival transport retains an app check when coverage data is missing", () => {
  const origin = { id: "", name: "Pickup", address: "", location: "121.455,31.249", type: "Temporary location", city: "Shanghai", district: "" };
  const result = formatArrivalRoute({ origin, destination: { ...origin, name: "Hotel" }, transport: "driving", taxiRequested: true, uberPickup: { latitude: 31.249, longitude: 121.455 }, destinationContext: { country: "China", city: "Shanghai" } });
  assert.equal(result.handoffLabel, "Open Uber");
  assert.match(result.text, /Open Uber/);
  assert.doesNotMatch(result.text, /not confirm|unavailable/);
});


test("arrival ride app follows pickup country, including Grab's regional handoff", () => {
  const origin = { id: "", name: "Bali pickup", address: "", location: "115.2,-8.7", type: "Temporary location", city: "Bali", country: "Indonesia", district: "Ubud" };
  const result = formatArrivalRoute({ origin, destination: { ...origin, name: "Hotel" }, transport: "driving", taxiRequested: true, uberPickup: { latitude: -8.7, longitude: 115.2 }, destinationContext: { country: "New Zealand", city: "Auckland" } });
  assert.equal(result.handoffLabel, "Open Grab");
  assert.match(result.handoffUrl, /grab.com/);
  assert.doesNotMatch(result.text, /Open Uber/);
});
