import assert from "node:assert/strict";
import test from "node:test";
import type { BlueprintPlace } from "@c-assistant/core";
import { searchWikipediaPlaceImages } from "./wikipedia-place-images.js";

const place = (name: string, city = "杭州") => ({ id: name, name, city, locationLabel: city, category: "attraction", priority: "preferred", whyWorthIt: "Visit", plan: "Explore", evidence: [] }) as BlueprintPlace;

test("exact Wikipedia place with matching city yields a sourced photo", async () => {
  const seen: string[] = [];
  const artifact = await searchWikipediaPlaceImages([place("郭庄")], {
    retrievedAt: "2026-10-08",
    probeImageUrl: async () => true,
    fetcher: async (input) => {
      seen.push(new URL(String(input)).searchParams.get("titles")!);
      return new Response(JSON.stringify({ query: { pages: [{ title: "郭庄", extract: "位于杭州市西湖区", thumbnail: { source: "https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a1/Guozhuang.jpg/960px-Guozhuang.jpg" } }] } }), { headers: { "content-type": "application/json" } });
    }
  });
  assert.deepEqual(seen, ["郭庄"]);
  assert.equal(artifact.images.length, 1);
  assert.equal(artifact.images[0]?.sourceUrl, artifact.sources[0]?.url);
  assert.equal(artifact.images[0]?.status, "recheck");
});

test("a different city's namesake and a branch-specific venue are not assigned generic images", async () => {
  let calls = 0;
  const artifact = await searchWikipediaPlaceImages([place("郭庄"), place("知味观（湖滨总店）")], {
    probeImageUrl: async () => true,
    fetcher: async () => {
      calls += 1;
      return new Response(JSON.stringify({ query: { pages: [{ title: "郭庄", extract: "位于上海", thumbnail: { source: "https://thumb.wikimedia.org/example.jpg" } }] } }), { headers: { "content-type": "application/json" } });
    }
  });
  assert.equal(calls, 3);
  assert.deepEqual(artifact.images, []);
});


test("English names use English Wikipedia and accept the exact redirect's upload thumbnail", async () => {
  const artifact = await searchWikipediaPlaceImages([place("Auckland Airport", "Auckland")], {
    probeImageUrl: async () => true,
    fetcher: async (input) => {
      assert.equal(new URL(String(input)).hostname, "en.wikipedia.org");
      assert.equal(new URL(String(input)).searchParams.get("redirects"), "1");
      return new Response(JSON.stringify({ query: { redirects: [{ from: "Auckland Airport", to: "Auckland International Airport" }], pages: [{ title: "Auckland International Airport", extract: "An airport in Auckland, New Zealand", thumbnail: { source: "https://upload.wikimedia.org/wikipedia/commons/airport.jpg" } }] } }), { headers: { "content-type": "application/json" } });
    }
  });
  assert.equal(artifact.images.length, 1);
  assert.equal(artifact.images[0]?.sourceUrl, "https://en.wikipedia.org/wiki/Auckland_International_Airport");
});


test('native Japanese identity and exact coordinates disambiguate a Chinese-script place', async () => {
  const target = { ...place('Example Temple', 'Example City'), localizedName: '例寺', officialUrl: 'https://temple.example.jp/visit/', coordinates: [35, 135] as [number, number] };
  const langs: string[] = [];
  const artifact = await searchWikipediaPlaceImages([target], {
    resolveHost: async () => [{ address: '10.0.0.1' }], probeImageUrl: async () => true,
    fetcher: async input => {
      const url = new URL(String(input)); langs.push(url.hostname);
      return Response.json({ query: { pages: [{ title: '例寺', extract: 'An unrelated transliteration of Example City', coordinates: [{ lat: 35.0001, lon: 135.0001 }],
        thumbnail: { source: 'https://upload.wikimedia.org/wikipedia/commons/a/aa/Temple_garden.jpg' } }] } });
    }
  });
  assert.deepEqual(langs, ['ja.wikipedia.org']);
  assert.equal(artifact.images.length, 1);
});

test('logos, disambiguation articles, wrong coordinates and uncertain image availability never become photographs', async () => {
  for (const invalid of ['logo', 'disambiguation', 'coordinates', 'unknown'] as const) {
    const artifact = await searchWikipediaPlaceImages([{ ...place('Exact Temple', 'Exact City'), coordinates: [35, 135] }], {
      probeImageUrl: async () => invalid === 'unknown' ? undefined : true,
      fetcher: async () => Response.json({ query: { pages: [{ title: 'Exact Temple', extract: 'Exact City',
        coordinates: [{ lat: invalid === 'coordinates' ? 40 : 35, lon: 135 }],
        ...(invalid === 'disambiguation' ? { pageprops: { disambiguation: '' } } : {}),
        thumbnail: { source: `https://upload.wikimedia.org/wikipedia/commons/a/aa/${invalid === 'logo' ? 'Logo.svg' : 'Temple.jpg'}` } }] } })
    });
    assert.equal(artifact.images.length, 0, invalid);
  }
});
