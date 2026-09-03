import assert from "node:assert/strict";
import test from "node:test";
import { shadowCss, tripMapShadowHtml } from "./trip-map-embed-shell.js";

test("trip map shell scopes root CSS to the shadow host", () => {
  assert.equal(shadowCss(":root { color: red; }\n.card { color: blue; }"), ":host { color: red; }\n.card { color: blue; }");
});

test("trip map shell includes the required mount points", () => {
  const html = tripMapShadowHtml({ leafletCss: ".leaflet{}", tripMapCss: ":root{}", tripMapThemeCss: ".b{}", tripMapEditorialCss: ".c{}" });
  assert.match(html, /<style>/);
  assert.match(html, /id="trip-app"/);
  assert.match(html, /id="map"/);
  assert.match(html, /id="day-list"/);
  assert.match(html, /id="replan-dialog"/);
  assert.match(html, /id="impact-dialog"/);
  assert.doesNotMatch(html, /id="impact-copy"/);
  assert.doesNotMatch(html, /This change has a larger impact/);
  assert.doesNotMatch(html, /Please review these effects/);
  assert.doesNotMatch(html, /:root\{\}/);
});
