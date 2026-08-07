import assert from "node:assert/strict";
import test from "node:test";

import { createOfficialSourceService, parseOfficialSourceRegistry } from "./official-sources.js";

const registryEntry = {
  id: "nia-english",
  authority: "National Immigration Administration",
  title: "National Immigration Administration — English",
  url: "https://en.nia.gov.cn/",
  allowedDomains: ["en.nia.gov.cn"],
  topics: ["immigration"],
  language: "en" as const
};

test("Official source service persists an explicit source refresh and preserves change metadata", async () => {
  let saved = 0;
  const service = createOfficialSourceService({
    discover: () => ({ status: "available", provider: "official_source", observedAt: "2026-08-07T00:00:00.000Z", data: [registryEntry] }),
    fetchSnapshot: async () => ({ status: "available", provider: "official_source", observedAt: "2026-08-07T00:00:00.000Z", data: { sourceId: "nia-english", authority: "National Immigration Administration", titleOriginal: "Guidelines", url: "https://en.nia.gov.cn/guide", retrievedAt: "2026-08-07T00:00:00.000Z", contentHash: "a".repeat(64), excerpt: "Official text." } })
  }, {
    saveSourceSnapshot: (input) => {
      saved += 1;
      return { snapshot: { id: "source-1", ...input }, duplicate: false, contentChanged: true };
    }
  });

  const refreshed = await service.refresh({ sourceId: "nia-english" });
  assert.equal(refreshed.status, "available");
  assert.equal(refreshed.data?.contentChanged, true);
  assert.equal(saved, 1);
});

test("Official source registry accepts only complete HTTPS allowlist entries", () => {
  assert.deepEqual(parseOfficialSourceRegistry([registryEntry]), [registryEntry]);
  assert.throws(() => parseOfficialSourceRegistry([{ ...registryEntry, url: "http://en.nia.gov.cn/" }]));
});
