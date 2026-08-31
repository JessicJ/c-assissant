import assert from "node:assert/strict";
import test from "node:test";

import { resolveServiceCapabilities } from "./execution-service-catalog.js";

test("resolves Bali manual ride services without recommending configured Uber", () => {
  const services = resolveServiceCapabilities({ destination: { country: "Indonesia", city: "Bali", area: "Ubud" }, option: "ride_hail_car" });
  assert.deepEqual(services.map((service) => service.serviceName), ["Google Maps", "Grab", "Gojek", "Bluebird"]);
  assert.equal(services.some((service) => service.serviceName === "Uber"), false);
  assert.equal(services.find((service) => service.serviceName === "Grab")?.handoff, "manual");
  assert.match(services.find((service) => service.serviceName === "Grab")?.instructions ?? "", /choose Car/);
  assert.match(services.find((service) => service.serviceName === "Bluebird")?.instructions ?? "", /taxi booking/);
});

test("keeps private driver as a Bali manual handoff", () => {
  const services = resolveServiceCapabilities({ destination: { country: "Indonesia", city: "Bali", area: "Seminyak" }, option: "private_driver" });
  assert.deepEqual(services.map((service) => service.serviceName), ["Google Maps", "Private driver"]);
});
