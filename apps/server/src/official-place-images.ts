import { readPublicMedia } from './public-media-fetch.js';
import type { BlueprintPlace, BlueprintSource } from '@c-assistant/core';
import { isPublicHttpsImageUrl } from './planned-place-image-pipeline.js';

export type PlacePhotoCandidate = { imageUrl: string; sourceUrl: string; authority: string; official: boolean };
export type PlaceImageSourceOptions = {
  fetcher?: typeof fetch;
  signal?: AbortSignal;
  sources?: BlueprintSource[];
  /** Hints from an already verified business artifact; rechecked against this place's source page. */
  priorImages?: Array<{ placeId: string; url: string; sourceUrl: string; alt: string; caption?: string }>;
  resolveHost?: (host: string) => Promise<Array<{ address: string }>>;
  probeImageUrl?: (url: string, signal: AbortSignal) => Promise<boolean | undefined>;
};
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const decoration = /(?:logo|icon|banner|menu|map|access[-_]?map|sprite|arrow|button|bnr|spacer|\.svg(?:\?|$)|ロゴ|メニュー|地図|案内図)/iu;
const scene = /(?:exterior|interior|facade|building|garden|grounds|entrance|store|shop|gallery|photo|mainvisual|main_visual|外観|店内|店舗|境内|庭園|本堂|客席)/iu;
function normalize(value: string): string { return value.normalize('NFKC').toLocaleLowerCase().replace(/[\s・／/（()）「」『』：:‐–—-]/gu, ''); }
function text(html: string): string { return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, ' ').replace(/<[^>]+>/gu, ' '); }
function attribute(tag: string, name: string): string {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'iu').exec(tag);
  return (match?.[1] ?? match?.[2] ?? '').replaceAll('&amp;', '&').replaceAll('&#39;', "'").replaceAll('&quot;', '"');
}
function matchesPlace(value: string, place: BlueprintPlace): boolean {
  const normalized = normalize(value);
  return [place.name, place.localizedName].filter((name): name is string => Boolean(name?.trim()))
    .some(name => normalized.includes(normalize(name)) || name.split(/\s+/u).filter(Boolean).every(part => part.length > 1 && normalized.includes(normalize(part))));
}
function normalizeAddress(value: string): string {
  return normalize(value).replace(/[东東]/gu, '東').replace(/[桥橋]/gu, '橋').replace(/[区區]/gu, '區')
    .replace(/[条條]/gu, '條').replace(/[号號]/gu, '號').replace(/([上下入])ル/gu, '$1');
}
function exactSourceAddress(html: string, sourceUrl: string, place: BlueprintPlace, options: PlaceImageSourceOptions): boolean {
  const sourceIds = new Set((options.sources ?? []).filter(source => source.url === sourceUrl && place.evidence.some(ref => ref.sourceId === source.id)).map(source => source.id));
  const linkedIdentity = place.fieldEvidence?.some(field => field.path === 'name' && field.status === 'verified'
    && field.evidence.some(ref => sourceIds.has(ref.sourceId)));
  if (!linkedIdentity) return false;
  const addresses = [...html.matchAll(/<tr\b[^>]*>\s*<th\b[^>]*>([\s\S]*?)<\/th>\s*<td\b[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/giu)]
    .filter(row => /^(?:所在地|住所|address)$/iu.test(text(row[1]!).trim())).map(row => text(row[2]!));
  if (addresses.length !== 1) return false;
  // Address normalization preserves the complete street and building number.
  const expected = normalizeAddress(place.locationLabel ?? '');
  const actualAddress = normalizeAddress(addresses[0]!);
  const offset = actualAddress.indexOf(expected);
  if (expected.length < 10 || !/\d/u.test(expected) || offset < 0 || /\d/u.test(actualAddress[offset + expected.length] ?? '')) return false;
  const title = normalize(text(/<title\b[^>]*>([\s\S]*?)<\/title>/iu.exec(html)?.[1] ?? ''));
  return [place.name, place.localizedName ?? ''].flatMap(name => name.split(/\s+/u))
    .filter(part => part.length >= 2 && !/^(?:本店|支店|分店|main|branch|restaurant|store|shop|the)$/iu.test(part))
    .some(part => title.includes(normalize(part)));
}
/** Extract only visible place-scoped photographs. Generic metadata images never establish branch identity. */
export function officialPlacePhotoCandidates(html: string, sourceUrl: string, place: BlueprintPlace, options: PlaceImageSourceOptions = {}): string[] {
  // Navigation and cross-selling regions do not establish the photographed place.
  const content = html.replace(/<(aside|nav|footer|header|template|script|style)\b[^>]*>[\s\S]*?<\/\1>/giu, ' ');
  const heading = [...content.matchAll(/<(?:title|h[1-6])\b[^>]*>([\s\S]*?)<\/(?:title|h[1-6])>/giu)].map(match => `${text(match[1]!)} ${[...match[1]!.matchAll(/<img\b[^>]*>/giu)].map(image => attribute(image[0], 'alt')).join(' ')}`).join(' ');
  const addressedVenue = exactSourceAddress(content, sourceUrl, place, options);
  if (!matchesPlace(heading, place) && !addressedVenue) return [];
  const pageTitle = text(/<title\b[^>]*>([\s\S]*?)<\/title>/iu.exec(content)?.[1] ?? '');
  const identifiedGallery = matchesPlace(pageTitle, place) && /gallery|photographs?|店舗ギャラリー|店内写真|店舗写真/iu.test(pageTitle);
  const images: Array<{ url: string; priority: number }> = [];
  const headings = [...content.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/giu)];
  let nextHeading = 0;
  let nearestHeading: string | undefined;
  for (const match of content.matchAll(/<img\b[^>]*>/giu)) {
    while (nextHeading < headings.length && headings[nextHeading]!.index < match.index) {
      const headingHtml = headings[nextHeading]![1]!;
      nearestHeading = `${text(headingHtml)} ${[...headingHtml.matchAll(/<img\b[^>]*>/giu)].map(image => attribute(image[0], 'alt')).join(' ')}`;
      nextHeading++;
    }
    const tag = match[0];
    const src = attribute(tag, 'data-src') || attribute(tag, 'src');
    const alt = attribute(tag, 'alt');
    const evidence = `${src} ${alt} ${attribute(tag, 'class')}`;
    const prefix = content.slice(0, match.index);
    const section = /<section\b[^>]*>[\s\S]*$/iu.exec(prefix.slice(prefix.lastIndexOf('<section')))?.[0];
    const gallerySection = section && !section.includes('</section>') && /\bclass\s*=\s*["'][^"']*gallery[^"']*["']/iu.test(section);
    const namedSceneHeading = /^(?:外観|店内|内観|客室|カウンター|interior|exterior|dining room|guest room)$/iu.test((nearestHeading ?? '').trim());
    const scopedGalleryPhoto = identifiedGallery && gallerySection && namedSceneHeading && !alt.trim();
    const firstPlaceHeading = headings.find(heading => /<h1\b/iu.test(heading[0]) && matchesPlace(text(heading[1]!), place));
    const mainStart = /<main\b[^>]*>/iu.exec(content)?.index;
    const sourcePath = new URL(sourceUrl).pathname.replace(/\/$/u, '');
    let imagePath = '';
    try { imagePath = new URL(src || '.', sourceUrl).pathname; } catch { /* A malformed image stays ineligible. */ }
    const heroPhoto = !alt.trim() && sourceUrl === place.officialUrl && matchesPlace(pageTitle, place)
      && mainStart !== undefined && match.index > mainStart && firstPlaceHeading !== undefined && match.index < firstPlaceHeading.index
      && sourcePath.split('/').filter(Boolean).length >= 2 && imagePath.includes(`${sourcePath}/`);
    const nextImage = content.indexOf('<img', match.index + tag.length);
    const sectionEnd = content.indexOf('</section>', match.index + tag.length);
    const captionEnd = Math.min(nextImage < 0 ? content.length : nextImage, sectionEnd < 0 ? content.length : sectionEnd, match.index + tag.length + 2000);
    const localCaption = text(content.slice(match.index + tag.length, captionEnd));
    const branchMarker = /本店|支店|分店|main branch/iu.exec(place.name)?.[0];
    const street = normalizeAddress(place.locationLabel ?? '').split(/[市區郡]/u).at(-1) ?? '';
    const localStreet = Array.from({ length: Math.max(0, street.length - 3) }, (_, index) => street.slice(index, index + 4))
      .some(fragment => !/\d/u.test(fragment) && normalizeAddress(localCaption).includes(fragment));
    const identifiedInterior = !alt.trim() && addressedVenue && localStreet
      && /interior|dining room|店内|内観|客室|階席/iu.test(localCaption)
      && (branchMarker ? normalize(localCaption).includes(normalize(branchMarker)) : matchesPlace(localCaption, place));
    const scopedPhoto = scopedGalleryPhoto || heroPhoto || identifiedInterior;
    if (!src || decoration.test(evidence) || (!matchesPlace(alt, place) && !scene.test(evidence) && !scopedPhoto)) continue;
    // An exact page title cannot make an unrelated branch photograph applicable.
    // Generic labels require the nearest visible heading to identify this place.
    if (!matchesPlace(alt, place) && !scopedPhoto) {
      const genericPhotoLabel = /^(?:(?:店舗|店内|店外|建物|建築|境内|本堂|庭園|外観|内観|入口|入り口|客席|写真|全景|風景|実景|外景|内景|正面|景観|の|・|\s)+|(?:(?:exterior|interior|facade|building|garden|grounds|entrance|store|shop|photograph|photo|view|of|the|front)\s*)+)$/iu;
      if (!genericPhotoLabel.test(alt.trim()) || !nearestHeading || !matchesPlace(nearestHeading, place)) continue;
    }
    const width = Number(attribute(tag, 'width')), height = Number(attribute(tag, 'height'));
    if ((width > 0 && width < 200) || (height > 0 && height < 120)) continue;
    try {
      const url = new URL(src, sourceUrl);
      if (isPublicHttpsImageUrl(url) && (!url.port || url.port === '443') && /\.(?:jpe?g|png|webp|avif)(?:\?|$)/iu.test(url.pathname + url.search)) images.push({ url: url.toString(), priority: identifiedInterior || scopedGalleryPhoto && /客室|interior|dining room/iu.test(nearestHeading ?? '') ? 2 : scopedPhoto ? 1 : 0 });
    } catch { /* An invalid source image is not evidence. */ }
  }
  return [...new Set(images.sort((left, right) => right.priority - left.priority).map(image => image.url))].slice(0, 3);
}
/** Follow only explicitly labelled photo galleries on the already identified official venue's host. */
export function officialPlaceGalleryLinks(html: string, sourceUrl: string, place: BlueprintPlace): string[] {
  const title = text(/<title\b[^>]*>([\s\S]*?)<\/title>/iu.exec(html)?.[1] ?? '');
  if (!matchesPlace(title, place)) return [];
  const source = new URL(sourceUrl);
  const links: string[] = [];
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/giu)) {
    const label = text(match[2]!).trim();
    if (!/^(?:店内写真|店舗写真|店舗ギャラリー|店内ギャラリー|photo gallery|venue photos|interior photos|store gallery)$/iu.test(label)) continue;
    try {
      const url = new URL(attribute(`<a ${match[1]}>`, 'href'), source);
      url.hash = '';
      if (url.hostname === source.hostname && url.toString() !== source.toString() && isPublicHttpsImageUrl(url)
        && (!url.port || url.port === '443')) links.push(url.toString());
    } catch { /* A bad link never becomes a requested page. */ }
  }
  return [...new Set(links)].slice(0, 1);
}
async function readPage(url: string, options: PlaceImageSourceOptions): Promise<{ html: string; url: string } | undefined> {
  try {
    const read = await readPublicMedia(url, { kind: 'page', maxBytes: MAX_PAGE_BYTES, timeoutMs: 8000, sameHostRedirects: true,
      ...(options.signal ? { signal: options.signal } : {}), ...(options.resolveHost ? { resolveHost: options.resolveHost } : {}),
      ...(options.fetcher ? { fetcher: options.fetcher } : {}) });
    if (!read.response.ok || !/^(?:text\/html|application\/xhtml\+xml)\b/iu.test(read.response.headers.get('content-type') ?? '')) return undefined;
    return { html: await read.response.text(), url: read.url };
  } catch { return undefined; }
}
export async function searchOfficialPlacePhoto(place: BlueprintPlace, options: PlaceImageSourceOptions): Promise<PlacePhotoCandidate | undefined> {
  const ids = new Set(place.evidence.map(ref => ref.sourceId));
  let officialHost: string | undefined;
  try { officialHost = place.officialUrl ? new URL(place.officialUrl).hostname : undefined; } catch { /* Invalid URL stays absent. */ }
  const pages = [place.officialUrl, ...(options.sources ?? []).filter(source => ids.has(source.id) && source.official === true).map(source => source.url)]
    .filter((url): url is string => Boolean(url));
  const priorSources = (options.priorImages ?? []).filter(image => image.placeId === place.id && pages.includes(image.sourceUrl)).map(image => image.sourceUrl);
  const queue = [...new Set([...priorSources, ...pages])].slice(0, 3);
  const visited = new Set<string>();
  for (let index = 0; index < queue.length && visited.size < 3; index++) {
    const url = queue[index]!;
    if (visited.has(url)) continue;
    visited.add(url);
    const page = await readPage(url, options); if (!page) continue;
    queue.splice(index + 1, 0, ...officialPlaceGalleryLinks(page.html, page.url, place).filter(link => !visited.has(link)));
    const priorUrls = new Set((options.priorImages ?? []).filter(image => image.placeId === place.id && image.sourceUrl === page.url).map(image => image.url));
    const candidates = officialPlacePhotoCandidates(page.html, page.url, place, options).sort((left, right) => Number(priorUrls.has(right)) - Number(priorUrls.has(left)));
    for (const imageUrl of candidates) {
      if (await options.probeImageUrl?.(imageUrl, options.signal ?? AbortSignal.timeout(8000)) !== true) continue;
      return { imageUrl, sourceUrl: page.url, authority: new URL(page.url).hostname, official: new URL(page.url).hostname === officialHost };
    }
  }
  return undefined;
}
