import assert from 'node:assert/strict';
import test from 'node:test';
import type { BlueprintPlace } from '@c-assistant/core';
import { officialPlacePhotoCandidates, officialPlaceGalleryLinks, searchOfficialPlacePhoto } from './official-place-images.js';
const place = { id: 'venue', name: 'Example Tea Main Branch', localizedName: '例茶 本店', city: 'City', officialUrl: 'https://tea.example.org/main/', evidence: [] } as unknown as BlueprintPlace;
const html = '<title>例茶 本店</title><h1>例茶 本店</h1><img alt="店舗外観" src="/photo/exterior.jpg"><img alt="メニュー" src="/menu.jpg"><img alt="logo" src="/logo.png">';
test('place-specific official heading admits exterior photos and excludes logo, menu, maps and decoration', () => {
  assert.deepEqual(officialPlacePhotoCandidates(html, place.officialUrl!, place), ['https://tea.example.org/photo/exterior.jpg']);
  assert.deepEqual(officialPlacePhotoCandidates(html.replaceAll('例茶 本店', 'Other Branch'), place.officialUrl!, place), []);
});
test('a branch overview cannot assign one branch photo to another', () => {
  const target = { ...place, name: 'Brand Example 本店', localizedName: undefined } as unknown as BlueprintPlace;
  const page = '<title>Brand Example</title><h4>本店</h4><img alt="Other Branch 店舗" src="/shop/other.jpg"><img alt="Brand Example 本店 外観" src="/shop/main.jpg">';
  assert.deepEqual(officialPlacePhotoCandidates(page, place.officialUrl!, target), ['https://tea.example.org/shop/main.jpg']);
});
test('unsafe or unresolved addresses never reach fetch and unknown availability is rejected', async () => {
  let requests = 0;
  for (const address of ['127.0.0.1', '10.0.0.1', '172.16.1.1', '169.254.1.1']) {
    const result = await searchOfficialPlacePhoto(place, { resolveHost: async () => [{ address }], fetcher: async () => { requests++; return new Response(html); }, probeImageUrl: async () => true });
    assert.equal(result, undefined);
  }
  assert.equal(requests, 0);
  const result = await searchOfficialPlacePhoto(place, { resolveHost: async () => [{ address: '8.8.8.8' }], fetcher: async () => new Response(html, { headers: { 'content-type': 'text/html' } }), probeImageUrl: async () => undefined });
  assert.equal(result, undefined);
});
test('official fetch is bounded and refuses redirect targets outside the original host', async () => {
  let requests = 0;
  const result = await searchOfficialPlacePhoto(place, {
    resolveHost: async () => [{ address: '8.8.8.8' }], probeImageUrl: async () => true,
    fetcher: async (_url, init) => { requests++; assert.equal(init?.redirect, 'manual'); assert.ok(init?.signal); return new Response('', { status: 302, headers: { location: 'https://other.example.org/private' } }); }
  });
  assert.equal(result, undefined); assert.equal(requests, 1);
  assert.equal(await searchOfficialPlacePhoto(place, { resolveHost: async () => [{ address: '8.8.8.8' }], probeImageUrl: async () => true,
    fetcher: async () => new Response('oversized', { headers: { 'content-type': 'text/html', 'content-length': String(3 * 1024 * 1024) } }) }), undefined);
});
test('only affirmative photographic response yields the exact official source', async () => {
  const result = await searchOfficialPlacePhoto(place, { resolveHost: async () => [{ address: '8.8.8.8' }], probeImageUrl: async () => true,
    fetcher: async () => new Response(html, { headers: { 'content-type': 'text/html' } }) });
  assert.equal(result?.imageUrl, 'https://tea.example.org/photo/exterior.jpg'); assert.equal(result?.sourceUrl, place.officialUrl);
});


test('aborted DNS lookup completes without waiting for the resolver or sending an HTTP request', async () => {
  const controller = new AbortController(); let fetches = 0;
  const operation = searchOfficialPlacePhoto(place, { signal: controller.signal,
    resolveHost: async () => new Promise(() => {}), fetcher: async () => { fetches++; return new Response(html); } });
  controller.abort();
  assert.equal(await operation, undefined); assert.equal(fetches, 0);
});


test('an exact page title does not admit a labelled other branch exterior', () => {
  const page = '<title>例茶 本店</title><h1>例茶 本店</h1><img alt="Other Branch exterior" src="/photo/other.jpg"><img alt="例茶 本店 外観" src="/photo/main.jpg">';
  assert.deepEqual(officialPlacePhotoCandidates(page, place.officialUrl!, place), ['https://tea.example.org/photo/main.jpg']);
});

test('sidebar cross-selling photographs stay outside the place gallery', () => {
  const page = '<title>例茶 本店</title><main><h1>例茶 本店</h1><img alt="店舗外観" src="/photo/main.jpg"></main><aside><h2>Other Branch</h2><img alt="Other Branch exterior" src="/photo/other.jpg"><img alt="例茶 本店" src="/photo/aside.jpg"></aside>';
  assert.deepEqual(officialPlacePhotoCandidates(page, place.officialUrl!, place), ['https://tea.example.org/photo/main.jpg']);
});

test('a generic photograph under another branch heading cannot inherit the page title', () => {
  const page = '<title>例茶 本店</title><main><h1>例茶 本店</h1><img alt="店舗外観" src="/photo/main.jpg"><section><h2>例茶 別館</h2><img alt="店舗外観" src="/photo/annex.jpg"></section></main>';
  assert.deepEqual(officialPlacePhotoCandidates(page, place.officialUrl!, place), ['https://tea.example.org/photo/main.jpg']);
});

test('a generic photo needs a local place heading and cannot rely on metadata alone', () => {
  const page = '<title>例茶 本店</title><section><img alt="店舗外観" src="/photo/unknown.jpg"></section>';
  assert.deepEqual(officialPlacePhotoCandidates(page, place.officialUrl!, place), []);
});


test('an image heading can identify the local gallery without admitting decorative images', () => {
  const page = '<title>例茶 本店</title><main><h1><img src="/logo.png" alt="例茶 本店"></h1><img alt="店舗外観" src="/photo/main.jpg"></main>';
  assert.deepEqual(officialPlacePhotoCandidates(page, place.officialUrl!, place), ['https://tea.example.org/photo/main.jpg']);
});


test('an exact place gallery supports unlabelled room photos inside its explicit local gallery sections', () => {
  const page = '<title>店舗ギャラリー｜例茶 本店</title><main><h1>店舗ギャラリー</h1>'
    + '<section class="gallery_contents_area"><h2>外観</h2><img src="/img/gallery/outside.jpg"></section>'
    + '<section class="gallery_contents_area"><h2>客室</h2><img src="/img/gallery/room.jpg"></section>'
    + '<section class="gallery_contents_area"><h2>Other Branch</h2><img src="/img/gallery/other.jpg"></section></main>';
  assert.deepEqual(officialPlacePhotoCandidates(page, place.officialUrl!, place), [
    'https://tea.example.org/img/gallery/room.jpg', 'https://tea.example.org/img/gallery/outside.jpg'
  ]);
  assert.deepEqual(officialPlacePhotoCandidates(page.replace('例茶 本店', 'Other Branch'), place.officialUrl!, place), []);
});

test('gallery discovery stays within an identified venue host and follows only explicit photo-gallery links', () => {
  const page = '<title>アクセス｜例茶 本店</title><a href="../about/gallery.html">店内写真</a>'
    + '<a href="https://other.example.org/gallery">店舗ギャラリー</a><a href="/menu.html">メニュー</a>';
  assert.deepEqual(officialPlaceGalleryLinks(page, place.officialUrl!, place), ['https://tea.example.org/about/gallery.html']);
  assert.deepEqual(officialPlaceGalleryLinks(page.replace('例茶 本店', 'Another venue'), place.officialUrl!, place), []);
});

test('normal official lookup follows the discovered gallery and returns its verified interior source', async () => {
  const urls: string[] = [];
  const result = await searchOfficialPlacePhoto(place, { resolveHost: async () => [{ address: '8.8.8.8' }],
    probeImageUrl: async url => url.endsWith('/room.jpg'), fetcher: async input => {
      const url = String(input); urls.push(url);
      return new Response(url.endsWith('/main/') ? '<title>例茶 本店</title><a href="/gallery/">店内写真</a>'
        : '<title>店舗ギャラリー｜例茶 本店</title><main><section class="gallery_contents_area"><h2>客室</h2><img src="/img/room.jpg"></section></main>',
        { headers: { 'content-type': 'text/html' } });
    } });
  assert.deepEqual(urls, ['https://tea.example.org/main/', 'https://tea.example.org/gallery/']);
  assert.equal(result?.imageUrl, 'https://tea.example.org/img/room.jpg');
  assert.equal(result?.sourceUrl, 'https://tea.example.org/gallery/');
});

test('historical hints cannot bypass current exact-venue address and local photo-caption checks', async () => {
  const target = { ...place, name: 'Full Restaurant Main Branch', localizedName: '例餐厅 本店', locationLabel: 'City區BridgeRoad192',
    evidence: [{ sourceId: 'venue-source', status: 'verified' }],
    fieldEvidence: [{ path: 'name', status: 'verified', evidence: [{ sourceId: 'venue-source', status: 'verified' }] }] } as BlueprintPlace;
  const sourceUrl = 'https://association.example.org/venue/';
  const imageUrl = 'https://association.example.org/media/hash.jpg';
  for (const change of ['valid', 'wrong-place', 'unreferenced', 'decoration', 'unlinked-source', 'wrong-address', 'longer-address', 'other-branch-caption'] as const) {
    const result = await searchOfficialPlacePhoto(target, { resolveHost: async () => [{ address: '8.8.8.8' }], probeImageUrl: async () => true,
      sources: [{ id: change === 'unlinked-source' ? 'another' : 'venue-source', title: 'Venue', authority: 'Trade association', url: sourceUrl, retrievedAt: '2026-11-24', status: 'verified', official: true }],
      priorImages: [{ placeId: change === 'wrong-place' ? 'other' : target.id, sourceUrl,
        url: change === 'unreferenced' ? imageUrl + '?wrong=1' : imageUrl,
        alt: change === 'decoration' ? 'Venue logo' : 'The upstairs dining room interior at this exact branch.' }],
      fetcher: async input => new Response(String(input) === sourceUrl ? `<title>例餐厅 short name</title><main><section><img src="${imageUrl}"><p>${change === 'other-branch-caption' ? 'Other Branch dining room' : 'Main Branch dining room on BridgeRoad'}</p></section><table><tr><th>Address</th><td>City區BridgeRoad${change === 'wrong-address' ? 193 : change === 'longer-address' ? 1920 : 192}</td></tr></table></main>` : '<title>Unavailable</title>', { headers: { 'content-type': 'text/html' } })
    });
    assert.equal(result?.imageUrl, ['valid', 'wrong-place', 'unreferenced', 'decoration'].includes(change) ? imageUrl : undefined, change);
  }
});


test('a same-brand source at a different complete address cannot be authorized by a correct old caption', async () => {
  const target = { ...place, name: 'Example Tea Main Branch', localizedName: '例茶 本店', locationLabel: 'City區GardenRoad192',
    evidence: [{ sourceId: 'source', status: 'verified' }], fieldEvidence: [{ path: 'name', status: 'verified', evidence: [{ sourceId: 'source', status: 'verified' }] }] } as BlueprintPlace;
  const sourceUrl = 'https://association.example.org/shop/'; const imageUrl = 'https://association.example.org/photo/room.jpg';
  const result = await searchOfficialPlacePhoto(target, { resolveHost: async () => [{ address: '8.8.8.8' }], probeImageUrl: async () => true,
    sources: [{ id: 'source', title: 'Example Tea', authority: 'Association', url: sourceUrl, retrievedAt: '2026-11-24', status: 'verified', official: true }],
    priorImages: [{ placeId: target.id, sourceUrl, url: imageUrl, alt: 'The interior at Example Tea Main Branch' }],
    fetcher: async input => new Response(String(input) === sourceUrl
      ? `<title>Example Tea</title><main><img src="${imageUrl}"><p>Main Branch dining room on GardenRoad</p><table><tr><th>Address</th><td>City區OtherRoad192</td></tr></table></main>` : '<title>Unknown</title>', { headers: { 'content-type': 'text/html' } }) });
  assert.equal(result, undefined);
});

test('exact venue hero photographs work without historical hints and exclude another branch path', () => {
  const target = { ...place, officialUrl: 'https://tea.example.org/store/main-branch/' };
  const page = '<title>例茶 本店</title><main><div class="hero"><img src="/assets/store/main-branch/hero.jpg"><img src="/assets/store/other-branch/hero.jpg"><img src="/assets/store/main-branch-annex/hero.jpg"><img src="/assets/store/main-branch2/hero.jpg"></div><h1>例茶 本店</h1></main>';
  assert.deepEqual(officialPlacePhotoCandidates(page, target.officialUrl, target), ['https://tea.example.org/assets/store/main-branch/hero.jpg']);
});
