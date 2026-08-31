import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { OfficialSourceConnector } from "@c-assistant/connectors";
import { resolveCountryPack } from "./country-pack-resolver.js";
import { chinaSkillRegistry } from "@c-assistant/china-country-pack/registry";
import { japanSkillRegistry } from "@c-assistant/japan-country-pack/registry";
import { parseOfficialSourceRegistry } from "./official-sources.js";

test("normalized Japan and China country facts select their own packs", () => {
  assert.deepEqual(resolveCountryPack("Japan"), { status: "resolved", countryPackId: "japan", normalizedCountry: "JP" });
  assert.deepEqual(resolveCountryPack("CN"), { status: "resolved", countryPackId: "china", normalizedCountry: "CN" });
});

test("city text and ambiguous or unsupported countries fail closed", () => {
  assert.equal(resolveCountryPack("Tokyo").status, "needs_confirmation");
  assert.equal(resolveCountryPack("Japan, China").status, "needs_confirmation");
  assert.equal(resolveCountryPack(undefined).status, "needs_confirmation");
});

test("simultaneously registered Country Packs expose no duplicate Skill identity", () => {
  const ids = [...chinaSkillRegistry.list(), ...japanSkillRegistry.list()].map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("Country Pack source allowlists reject cross-pack IDs without a network request", async () => {
  const china = new OfficialSourceConnector({ sources: parseOfficialSourceRegistry(JSON.parse(readFileSync(new URL("../../../country-packs/china/sources/official-source-registry.json", import.meta.url), "utf8"))) });
  const japan = new OfficialSourceConnector({ sources: parseOfficialSourceRegistry(JSON.parse(readFileSync(new URL("../../../country-packs/japan/sources/official-source-registry.json", import.meta.url), "utf8"))) });
  assert.equal((await china.fetchSnapshot({ sourceId: "jp-mofa-visa-exemption" })).failure?.code, "unknown_source");
  assert.equal((await japan.fetchSnapshot({ sourceId: "nia-english" })).failure?.code, "unknown_source");
  assert.equal((await japan.fetchSnapshot({ sourceId: "jp-mofa-visa-exemption", url: "https://example.com/not-allowed" })).failure?.code, "unapproved_source_url");
});
