import assert from "node:assert/strict";
import test from "node:test";
import { validLongitudeLatitude } from "./geo-coordinates.js";

test("longitude latitude validation accepts only lng,lat coordinate pairs", () => {
  assert.equal(validLongitudeLatitude("135.76894,34.9958"), true);
  assert.equal(validLongitudeLatitude("-180,-90"), true);
  assert.equal(validLongitudeLatitude("180,90"), true);
  assert.equal(validLongitudeLatitude("181,34.9958"), false);
  assert.equal(validLongitudeLatitude("135.76894,91"), false);
  assert.equal(validLongitudeLatitude("34.9958"), false);
  assert.equal(validLongitudeLatitude("135.76894,34.9958,extra"), false);
  assert.equal(validLongitudeLatitude("Kyoto"), false);
});
