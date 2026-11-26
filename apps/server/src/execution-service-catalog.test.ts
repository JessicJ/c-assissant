import assert from "node:assert/strict";
import test from "node:test";

import { executionServiceCatalog, resolveServiceCapabilities } from "./execution-service-catalog.js";

const now = new Date("2026-10-08T08:00:00Z");

test("resolves Bali manual ride services without recommending configured Uber", () => {
  const services = resolveServiceCapabilities({ destination: { country: "Indonesia", city: "Bali", area: "Ubud" }, option: "ride_hail_car", now });
  assert.deepEqual(services.map((service) => service.serviceName), ["Google Maps", "Grab", "Gojek", "Bluebird"]);
  assert.equal(services.some((service) => service.serviceName === "Uber"), false);
  assert.equal(services.find((service) => service.serviceName === "Grab")?.handoff, "manual");
  assert.match(services.find((service) => service.serviceName === "Grab")?.instructions ?? "", /choose Car/);
  assert.match(services.find((service) => service.serviceName === "Bluebird")?.instructions ?? "", /taxi booking/);
});

test("missing cities keep app checks without claiming country-wide live service", () => {
  const names = (country: string, city?: string) => resolveServiceCapabilities({ destination: { country, ...(city ? { city } : {}), label: "Los Angeles" }, option: "ride_hail_car", now }).map(item => item.serviceName);
  assert.deepEqual(names("United States", "Los Angeles"), ["Google Maps", "Uber"]);
  assert.deepEqual(names("美国", "洛杉矶"), ["Google Maps", "Uber"]);
  assert.deepEqual(names("United States", "Unknown town"), ["Google Maps", "Uber"]);
  assert.deepEqual(names("United States"), ["Google Maps", "Uber"]);
  assert.deepEqual(names("Japan", "Tokyo"), ["Google Maps", "Uber", "Grab"]);
  assert.deepEqual(names("Thailand", "Bangkok"), ["Google Maps", "Grab"]);
  assert.deepEqual(names("Singapore", "Singapore"), ["Google Maps", "Grab"]);
  assert.deepEqual(names("China", "Shanghai"), ["Google Maps", "Uber", "Grab"]);
  assert.deepEqual(names("Not United Statesland", "Los Angeles"), ["Google Maps", "Uber", "Grab"]);
  assert.deepEqual(names("New Zealand", "Queenstown"), ["Google Maps", "Uber"]);
});

test("expired positive coverage keeps the app entry point without asserting verified coverage", () => {
  const services = resolveServiceCapabilities({ destination: { country: "United States", city: "Los Angeles" }, option: "ride_hail_car", now: new Date("2027-01-07T00:00:00Z") });
  assert.deepEqual(services.map(item => item.serviceName), ["Google Maps", "Uber"]);
  assert.equal(services.find(item => item.serviceName === "Uber")?.coverageStatus, "check_in_app");
  const record = executionServiceCatalog.find(item => item.id === "uber")!.coverage![0]!;
  assert.match(record.sourceUrl, /^https:\/\/www\.uber\.com\//);
  assert.ok(Date.parse(record.expiresAt) > Date.parse(record.checkedAt));
});

test("keeps private driver as a Bali manual handoff", () => {
  const services = resolveServiceCapabilities({ destination: { country: "Indonesia", city: "Bali", area: "Seminyak" }, option: "private_driver" });
  assert.deepEqual(services.map((service) => service.serviceName), ["Google Maps", "Private driver"]);
});


test("only fresh explicit official negative evidence suppresses a provider", () => {
  const uber = { ...executionServiceCatalog.find(entry => entry.id === "uber")!, countries: ["*"] };
  const context = { country: "Indonesia", city: "Unknown town" };
  const resolve = (entry = uber, date = new Date("2026-10-09T08:00:00Z")) => resolveServiceCapabilities({ destination: context, option: "ride_hail_car", catalog: [entry], now: date });
  assert.deepEqual(resolve(), []);
  assert.equal(resolve(uber, new Date("2027-01-08T00:00:00Z"))[0]?.coverageStatus, "check_in_app");
  assert.equal(resolve({ ...uber, exclusions: [] })[0]?.coverageStatus, "check_in_app");
  const exclusion = uber.exclusions![0]!;
  for (const sourceUrl of ["", "https://example.com/uber", "https://uber.com.example.com/", "http://www.uber.com/"]) {
    assert.equal(resolve({ ...uber, exclusions: [{ ...exclusion, sourceUrl }] })[0]?.coverageStatus, "check_in_app");
  }
  assert.equal(resolve({ ...uber, exclusions: [{ ...exclusion, cities: ["Jakarta"] }] })[0]?.coverageStatus, "check_in_app");
});

test("unknown pickup and unlisted New Zealand towns preserve useful app actions", () => {
  const nz = resolveServiceCapabilities({ destination: { country: "New Zealand", city: "Hinuera" }, option: "ride_hail_car", now });
  assert.equal(nz.find(entry => entry.serviceName === "Uber")?.coverageStatus, "check_in_app");
  const unknown = resolveServiceCapabilities({ destination: { country: "" }, option: "ride_hail_car", now });
  assert.deepEqual(unknown.map(entry => entry.serviceName), ["Google Maps", "Uber", "Grab"]);
  assert.ok(unknown.filter(entry => entry.serviceName !== "Google Maps").every(entry => entry.coverageStatus === "check_in_app"));
});
