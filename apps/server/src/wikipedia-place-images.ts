import type { SkillImageEnrichmentArtifact } from '@c-assistant/agent-adapters';
import type { BlueprintPlace } from '@c-assistant/core';
import { probeRemoteImageUrl } from './planned-place-image-pipeline.js';
import { searchOfficialPlacePhoto, type PlaceImageSourceOptions, type PlacePhotoCandidate } from './official-place-images.js';

type WikiPage = { title?: string; missing?: boolean; extract?: string; pageprops?: Record<string, unknown>; coordinates?: Array<{ lat: number; lon: number }>; thumbnail?: { source?: string } };
const nonPhotograph = /(?:\.svg(?:\?|$)|logo|locator|(?:^|[/_ -])map(?:[/_. -]|$)|coat_of_arms|flag_of|seal_of|route_diagram|menu|ロゴ|案内図|地図|メニュー)/iu;
function wikipediaLanguages(place: BlueprintPlace): string[] {
  const name = `${place.name} ${place.localizedName ?? ''}`;
  const japanese = /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(name) || /\.jp(?:[/:?]|$)/iu.test(place.officialUrl ?? '');
  return japanese ? ['ja', 'zh', 'en'] : /\p{Script=Han}/u.test(name) ? ['zh', 'ja', 'en'] : ['en'];
}
function locationMatches(page: WikiPage, place: BlueprintPlace): boolean {
  const coordinate = page.coordinates?.[0];
  if (place.coordinates && coordinate) {
    const radians = Math.PI / 180;
    const lat = (coordinate.lat - place.coordinates[0]) * radians;
    const lon = (coordinate.lon - place.coordinates[1]) * radians;
    const distance = Math.hypot(lat, lon * Math.cos(place.coordinates[0] * radians)) * 6371000;
    return Number.isFinite(distance) && distance <= 2000;
  }
  const cities = (place.city ?? '').split(/\s*[/／]\s*/u).map(city => city.replace(/\s+Village$/iu, '').trim()).filter(Boolean);
  const context = `${page.title} ${page.extract ?? ''}`.toLocaleLowerCase();
  return cities.length > 0 && cities.some(city => context.includes(city.toLocaleLowerCase()));
}
async function wikipediaPhoto(place: BlueprintPlace, options: PlaceImageSourceOptions): Promise<PlacePhotoCandidate | undefined> {
  // A chain's article is not a branch photograph. Full branch identities can only use their own official pages.
  if (/[（(][^）)]+[）)]/u.test(place.name) || /(?:本店|支店|分店|旗舰店|旗艦店|\bbranch\b)/iu.test(place.name)) return undefined;
  const titles = [...new Set([place.localizedName, place.name].filter((name): name is string => Boolean(name?.trim())))].slice(0, 2);
  for (const language of wikipediaLanguages(place)) {
    const endpoint = new URL(`https://${language}.wikipedia.org/w/api.php`);
    endpoint.search = new URLSearchParams({ action: 'query', titles: titles.join('|'), redirects: '1',
      prop: 'extracts|pageimages|coordinates|pageprops', exintro: '1', explaintext: '1', piprop: 'thumbnail', pilicense: 'free',
      pithumbsize: '960', ppprop: 'disambiguation', format: 'json', formatversion: '2' }).toString();
    try {
      const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000);
      const response = await (options.fetcher ?? fetch)(endpoint, { headers: { Accept: 'application/json' }, signal, redirect: 'error' });
      if (!response.ok || !/^application\/json\b/iu.test(response.headers.get('content-type') ?? '') || !response.body) { await response.body?.cancel(); continue; }
      const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
      try {
        for (;;) {
          const part = await reader.read(); if (part.done) break;
          length += part.value.byteLength; if (length > 2 * 1024 * 1024) throw Error('oversized_wikipedia_response'); chunks.push(part.value);
        }
      } finally { await reader.cancel().catch(() => {}); }
      const data = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { query?: { pages?: WikiPage[]; normalized?: Array<{ from: string; to: string }>; redirects?: Array<{ from: string; to: string }> } };
      const canonical = titles.map(title => {
        const normalized = data.query?.normalized?.find(row => row.from === title)?.to ?? title;
        return data.query?.redirects?.find(row => row.from === normalized)?.to ?? normalized;
      });
      const page = data.query?.pages?.find(page => page.title && canonical.includes(page.title) && !page.missing && !Object.hasOwn(page.pageprops ?? {}, 'disambiguation') && locationMatches(page, place));
      const imageUrl = page?.thumbnail?.source;
      if (!page?.title || !imageUrl || !/^https:\/\/(?:upload|thumb)\.wikimedia\.org\//iu.test(imageUrl) || nonPhotograph.test(imageUrl)) continue;
      if (await options.probeImageUrl?.(imageUrl, signal) !== true) continue;
      return { imageUrl, sourceUrl: `https://${language}.wikipedia.org/wiki/${encodeURIComponent(page.title.replaceAll(' ', '_'))}`, authority: 'Wikipedia / Wikimedia Commons', official: false };
    } catch { if (options.signal?.aborted) return undefined; }
  }
  return undefined;
}

/** Public photographs with place identity and an affirmative image response. Unknown access stays unresolved. */
export async function searchWikipediaPlaceImages(places: BlueprintPlace[], options: PlaceImageSourceOptions & { retrievedAt?: string } = {}): Promise<SkillImageEnrichmentArtifact> {
  const retrievedAt = options.retrievedAt ?? new Date().toISOString().slice(0, 10);
  const probeImageUrl = options.probeImageUrl ?? ((url: string, signal: AbortSignal) => probeRemoteImageUrl(url, { signal, ...(options.fetcher ? { fetcher: options.fetcher } : {}), ...(options.resolveHost ? { resolveHost: options.resolveHost } : {}) }));
  const lookupOptions = { ...options, probeImageUrl };
  const matches = await Promise.all(places.map(async place => {
    const candidate = await searchOfficialPlacePhoto(place, lookupOptions) ?? await wikipediaPhoto(place, lookupOptions);
    return candidate ? { place, ...candidate } : undefined;
  }));
  const accepted = matches.filter((item): item is NonNullable<typeof item> => Boolean(item));
  return {
    sources: accepted.map(({ place, sourceUrl, authority, official }) => ({ id: `place-photo-${place.id}`, title: `${place.name} — place photograph`, authority, url: sourceUrl, retrievedAt, status: 'recheck' as const, official })),
    images: accepted.map(({ place, imageUrl, sourceUrl }) => ({ placeId: place.id, url: imageUrl, alt: `${place.name} — place photograph`, sourceUrl, usage: ['card', 'detail'] as ['card', 'detail'], status: 'recheck' as const })),
    omitted: []
  };
}
