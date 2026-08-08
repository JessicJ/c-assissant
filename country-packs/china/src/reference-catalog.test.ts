import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { SourceSnapshot } from "@c-assistant/core";

import { createChinaReferenceCatalog, listChinaDigitalLifeSourceIds, listChinaLocalFoodSourceIds, parseDigitalLifeCatalog, parseLocalFoodCatalog } from "./reference-catalog.js";

const snapshot = (sourceId: string, retrievedAt: string, suffix: string): SourceSnapshot => ({
  id: `snapshot-${sourceId}-${suffix}`,
  sourceId,
  authority: sourceId === "china-mobile-foreign-sim" ? "China Mobile" : sourceId === "amap-mobile-official" ? "Amap" : sourceId === "wechat-official" ? "WeChat" : sourceId === "shanghai-official-iconic-foods-2026" ? "Shanghai Municipal People's Government" : "The State Council of the People's Republic of China",
  titleOriginal: `Official ${sourceId}`,
  url: sourceId === "china-mobile-foreign-sim" ? "https://www.10086.cn/support/service/foreign/" : sourceId === "amap-mobile-official" ? "https://mobile.amap.com/cn/Index.aspx" : sourceId === "wechat-official" ? "https://www.wechat.com/en" : sourceId === "shanghai-official-iconic-foods-2026" ? "https://english.shanghai.gov.cn/en-SpecialtyFood/20260511/594d417a429d426e8442a47336c47574.html" : "https://english.www.gov.cn/2025special/bizexpatsinchina2025",
  retrievedAt,
  contentHash: suffix.repeat(64),
  excerpt: `Sensitive retained page text ${suffix}`
});

test("China reference catalog covers the four initial digital-life capabilities", () => {
  const result = createChinaReferenceCatalog({
    snapshots: [snapshot("china-mobile-foreign-sim", "2026-08-07T00:00:00.000Z", "a"), snapshot("amap-mobile-official", "2026-08-07T00:00:00.000Z", "b"), snapshot("china-working-living-guide-2025", "2026-08-07T00:00:00.000Z", "c"), snapshot("wechat-official", "2026-08-07T00:00:00.000Z", "d")]
  });
  assert.deepEqual(new Set(result.digitalLife.items.map((item) => item.category)), new Set(["mobile_connectivity", "communication", "map_navigation", "local_payments"]));
  assert.deepEqual(result.digitalLife.items.map((item) => item.nameOriginal), ["中国移动 SIM 卡", "微信", "高德地图", "支付宝"]);
});

test("China reference catalog uses only the latest approved snapshots and never passes excerpts", () => {
  const result = createChinaReferenceCatalog({
    snapshots: [snapshot("amap-mobile-official", "2026-08-06T00:00:00.000Z", "a"), snapshot("amap-mobile-official", "2026-08-07T00:00:00.000Z", "b"), snapshot("unapproved", "2026-08-07T00:00:00.000Z", "c")],
    requiredCapabilities: ["map_navigation"],
    completedItemIds: ["amap", "amap"]
  });
  assert.equal(result.digitalLife.sources.length, 1);
  assert.equal(result.digitalLife.sources[0]?.contentHash, "b".repeat(64));
  assert.deepEqual(result.digitalLife.completedItemIds, ["amap"]);
  assert.deepEqual(result.digitalLife.items.map((item) => item.id), ["amap"]);
  assert.doesNotMatch(JSON.stringify(result), /Sensitive retained page text|excerpt/);
});

test("China reference catalog exposes Shanghai food facts only with a matching city and approved snapshot", () => {
  const sourceId = "shanghai-official-iconic-foods-2026";
  const shanghai = createChinaReferenceCatalog({ snapshots: [snapshot(sourceId, "2026-08-07T00:00:00.000Z", "e")], locationName: "Shanghai, China" });
  assert.deepEqual(shanghai.localFood.facts.map((fact) => fact.nameOriginal), ["南翔小笼包", "腌笃鲜", "八宝鸭", "水晶虾仁", "葱油拌面"]);
  assert.deepEqual(shanghai.localFood.approvedSourceIds, [sourceId]);
  assert.equal(shanghai.localFood.sources[0]?.authority, "Shanghai Municipal People's Government");
  assert.doesNotMatch(JSON.stringify(shanghai.localFood), /Sensitive retained page text|excerpt/);

  assert.deepEqual(createChinaReferenceCatalog({ snapshots: [snapshot(sourceId, "2026-08-07T00:00:00.000Z", "e")], locationName: "Beijing, China" }).localFood.facts, []);
  assert.deepEqual(createChinaReferenceCatalog({ snapshots: [], locationName: "上海市" }).localFood.facts, []);
  assert.deepEqual(listChinaLocalFoodSourceIds("上海市"), [sourceId]);
  assert.deepEqual(listChinaLocalFoodSourceIds("Shanghaishire"), []);
});

test("China reference catalog rejects unapproved or duplicate item definitions", () => {
  const item = { id: "x", nameOriginal: "原文", nameEnglish: "Name", category: "communication", reasonEnglish: "Reason", stepsEnglish: ["Step"], sourceId: "approved" };
  assert.throws(() => parseDigitalLifeCatalog({ version: "0.1.0", approvedSourceIds: ["approved"], items: [item, item] }), /invalid item/i);
  assert.throws(() => parseDigitalLifeCatalog({ version: "0.1.0", approvedSourceIds: ["approved"], items: [{ ...item, sourceId: "other" }] }), /invalid item/i);
});

test("China local-food catalog rejects duplicate aliases and facts without approved sources", () => {
  const fact = { id: "dish", nameOriginal: "菜", nameEnglish: "Dish", descriptionEnglish: "Description", sourceId: "approved" };
  assert.throws(() => parseLocalFoodCatalog({ version: "0.1.0", cities: [{ id: "a", aliases: ["City"], approvedSourceIds: ["approved"], facts: [fact] }, { id: "b", aliases: ["city"], approvedSourceIds: ["approved"], facts: [fact] }] }), /duplicate city alias/i);
  assert.throws(() => parseLocalFoodCatalog({ version: "0.1.0", cities: [{ id: "a", aliases: ["City"], approvedSourceIds: ["other"], facts: [fact] }] }), /invalid fact/i);
});

test("every approved digital-life source is present in the official source registry", () => {
  const catalog = JSON.parse(readFileSync(new URL("../sources/digital-life-catalog.json", import.meta.url), "utf8")) as { approvedSourceIds: string[] };
  const registry = JSON.parse(readFileSync(new URL("../sources/official-source-registry.json", import.meta.url), "utf8")) as Array<{ id: string; url: string; allowedDomains: string[] }>;
  const registryById = new Map(registry.map((source) => [source.id, source]));
  for (const sourceId of catalog.approvedSourceIds) {
    const source = registryById.get(sourceId);
    assert.ok(source, `${sourceId} must be allowlisted`);
    const url = new URL(source.url);
    assert.equal(url.protocol, "https:");
    assert.ok(source.allowedDomains.some((domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`)));
  }
  assert.deepEqual(listChinaDigitalLifeSourceIds(), catalog.approvedSourceIds);
});

test("every approved local-food source is present in the official source registry", () => {
  const catalog = JSON.parse(readFileSync(new URL("../sources/local-food-catalog.json", import.meta.url), "utf8")) as { cities: Array<{ approvedSourceIds: string[] }> };
  const registry = JSON.parse(readFileSync(new URL("../sources/official-source-registry.json", import.meta.url), "utf8")) as Array<{ id: string; url: string; allowedDomains: string[] }>;
  const registryById = new Map(registry.map((source) => [source.id, source]));
  for (const sourceId of catalog.cities.flatMap((city) => city.approvedSourceIds)) {
    const source = registryById.get(sourceId);
    assert.ok(source, `${sourceId} must be allowlisted`);
    const url = new URL(source.url);
    assert.equal(url.protocol, "https:");
    assert.ok(source.allowedDomains.some((domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`)));
  }
});
