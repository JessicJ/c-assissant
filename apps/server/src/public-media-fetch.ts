import { lookup } from 'node:dns/promises';
import https from 'node:https';
import { isIP } from 'node:net';
import type { TLSSocket } from 'node:tls';

export type PublicMediaExchange = (url: URL, address: string, options: {
  signal: AbortSignal; headers: Record<string, string>; maxBytes: number; prefixBytes?: number;
}) => Promise<Response>;
export type PublicMediaOptions = {
  kind: 'image' | 'page';
  signal?: AbortSignal;
  timeoutMs?: number;
  maxBytes?: number;
  prefixBytes?: number;
  sameHostRedirects?: boolean;
  resolveHost?: (host: string) => Promise<Array<{ address: string }>>;
  /** Trusted dependency port. The normal runtime always uses the pinned TLS exchange. */
  exchange?: PublicMediaExchange;
  /** Existing explicit fetch test/provider port, never selected from network input. */
  fetcher?: typeof fetch;
};
export class PublicMediaReadError extends Error {
  constructor(readonly code: string) { super(code); }
}
const refuse = (code: string): never => { throw new PublicMediaReadError(code); };
const syntheticAddress = (address: string) => isIP(address) === 4 && /^198\.(?:18|19)\./u.test(address);

/** Global unicast only; reject special-purpose, mapped and transition ranges. */
export function isPublicMediaAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [first, second, third] = address.split('.').map(Number);
    return first! > 0 && first! < 224 && first !== 10 && first !== 127
      && !(first === 100 && second! >= 64 && second! <= 127)
      && !(first === 169 && second === 254) && !(first === 172 && second! >= 16 && second! <= 31)
      && !(first === 192 && (second === 168 || second === 0 && [0, 2].includes(third!)
        || second === 31 && third === 196 || second === 52 && third === 193
        || second === 88 && third === 99 || second === 175 && third === 48))
      && !(first === 198 && ([18, 19].includes(second!) || second === 51 && third === 100))
      && !(first === 203 && second === 0 && third === 113);
  }
  if (isIP(address) !== 6 || address.includes('.') || address.includes('%')) return false;
  const words = ipv6Words(address);
  return words[0]! >= 0x2000 && words[0]! <= 0x3fff
    && !(words[0] === 0x2001 && (words[1]! < 0x0200 || words[1] === 0x0db8))
    && words[0] !== 0x2002 && words[0] !== 0x3ffe
    && !(words[0] === 0x3fff && words[1]! <= 0x0fff)
    && !(words[0] === 0x2620 && words[1] === 0x004f && words[2] === 0x8000);
}
function ipv6Words(address: string): number[] {
  const [left, right] = address.toLowerCase().split('::');
  const before = left ? left.split(':').map(word => Number.parseInt(word, 16)) : [];
  const after = right ? right.split(':').map(word => Number.parseInt(word, 16)) : [];
  return right === undefined ? before : [...before, ...Array(8 - before.length - after.length).fill(0), ...after];
}
function sameAddress(left: string | undefined, right: string): boolean {
  if (!left || isIP(left) !== isIP(right)) return false;
  return isIP(left) === 6 ? ipv6Words(left).join(':') === ipv6Words(right).join(':') : left === right;
}
function validOrigin(url: URL): boolean {
  return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443')
    && !isIP(url.hostname.replace(/^\[|\]$/gu, '')) && url.hostname.includes('.')
    && !/(^|\.)(?:localhost|local|internal|test|invalid)$/iu.test(url.hostname);
}
function abortable<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const cancel = () => { signal.removeEventListener('abort', cancel); reject(new PublicMediaReadError('public_media_aborted')); };
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) { cancel(); return; }
    Promise.resolve().then(() => { signal.throwIfAborted(); return operation(); }).then(value => {
      signal.removeEventListener('abort', cancel);
      if (signal.aborted) cancel(); else resolve(value);
    }, error => { signal.removeEventListener('abort', cancel); reject(error); });
  });
}

/** The socket lookup returns only the already-validated peer; TLS uses the original hostname. */
export const pinnedPublicMediaExchange: PublicMediaExchange = (url, address, options) => new Promise((resolve, reject) => {
  if (!validOrigin(url) || !isPublicMediaAddress(address)) { reject(new PublicMediaReadError('public_media_unsafe_target')); return; }
  const request = https.request(url, { method: 'GET', agent: false, signal: options.signal,
    servername: url.hostname, rejectUnauthorized: true, headers: options.headers,
    lookup: (hostname, lookupOptions, callback) => {
      if (hostname !== url.hostname) { callback(new Error('public_media_hostname_changed'), '', 4); return; }
      const family = isIP(address) as 4 | 6;
      if (lookupOptions.all) callback(null, [{ address, family }]);
      else callback(null, address, family);
    }
  }, response => {
    const socket = response.socket as TLSSocket;
    if (!socket.authorized || !sameAddress(socket.remoteAddress, address)) {
      response.destroy(); reject(new PublicMediaReadError('public_media_peer_unverified')); return;
    }
    const status = response.statusCode ?? 0;
    const headers = new Headers();
    for (const [name, value] of Object.entries(response.headers)) {
      if (typeof value === 'string') headers.set(name, value);
      else if (Array.isArray(value)) for (const item of value) headers.append(name, item);
    }
    if ([301, 302, 303, 307, 308].includes(status)) { response.destroy(); resolve(new Response(null, { status, headers })); return; }
    if (headers.has('content-encoding') && headers.get('content-encoding') !== 'identity') {
      response.destroy(); reject(new PublicMediaReadError('public_media_encoding_unverified')); return;
    }
    const declared = Number(headers.get('content-length'));
    if (!options.prefixBytes && declared > options.maxBytes) { response.destroy(); reject(new PublicMediaReadError('public_media_body_too_large')); return; }
    const chunks: Buffer[] = []; let size = 0; let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      // Header checks and decoding consume the bounded bytes, not the remote declared length.
      headers.delete('content-length'); headers.delete('content-encoding');
      resolve(new Response([204, 205, 304].includes(status) ? null : new Uint8Array(Buffer.concat(chunks)), { status, headers }));
    };
    response.on('data', (chunk: Buffer) => {
      if (finished) return;
      const part = options.prefixBytes ? chunk.subarray(0, options.prefixBytes - size) : chunk;
      size += part.byteLength;
      if (size > options.maxBytes) { response.destroy(); reject(new PublicMediaReadError('public_media_body_too_large')); return; }
      chunks.push(part);
      if (options.prefixBytes && size >= options.prefixBytes) { finish(); response.destroy(); }
    });
    response.once('end', finish);
    response.once('error', error => { if (!finished) reject(error); });
  });
  request.once('error', reject);
  request.end();
});

async function boundedBytes(response: Response, maxBytes: number, signal: AbortSignal, prefixBytes?: number): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const declared = Number(response.headers.get('content-length'));
  if (!prefixBytes && declared > maxBytes) { void response.body.cancel().catch(() => {}); return refuse('public_media_body_too_large'); }
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const part = await abortable(() => reader.read(), signal);
      if (part.done) return Buffer.concat(chunks);
      const piece = prefixBytes ? part.value.subarray(0, prefixBytes - size) : part.value;
      size += piece.byteLength;
      if (size > maxBytes) return refuse('public_media_body_too_large');
      chunks.push(piece);
      if (prefixBytes && size >= prefixBytes) return Buffer.concat(chunks);
    }
  } finally { void reader.cancel().catch(() => {}); }
}

/** The DoH endpoint is fixed. No user URL can turn it into an outbound proxy. */
async function publicAddressFromSynthetic(hostname: string, exchange: PublicMediaExchange, signal: AbortSignal): Promise<string> {
  const url = new URL('https://dns.google/resolve');
  url.search = new URLSearchParams({ name: hostname, type: 'A', edns_client_subnet: '0.0.0.0/0' }).toString();
  const response = await abortable(() => exchange(url, '8.8.8.8', { signal, maxBytes: 65536, headers: { Accept: 'application/dns-json' } }), signal);
  if (response.status !== 200 || !/^application\/(?:dns-)?json\b/iu.test(response.headers.get('content-type') ?? '')) return refuse('public_media_dns_unavailable');
  const answer = JSON.parse(Buffer.from(await boundedBytes(response, 65536, signal)).toString('utf8')) as Record<string, unknown>;
  const questions = Array.isArray(answer.Question) ? answer.Question : [];
  if (answer.Status !== 0 || answer.TC === true || questions.length !== 1 || !questions.some(question => question && typeof question === 'object'
    && 'name' in question && 'type' in question && typeof question.name === 'string'
    && question.name.replace(/\.$/u, '').toLowerCase() === hostname.toLowerCase() && question.type === 1)) return refuse('public_media_dns_unavailable');
  const records = Array.isArray(answer.Answer) ? answer.Answer : [];
  let owner = hostname.toLowerCase(); const visited = new Set<string>();
  for (let hop = 0; hop < 8; hop++) {
    if (visited.has(owner)) return refuse('public_media_dns_unavailable');
    visited.add(owner);
    const scoped = records.filter(record => record && typeof record === 'object' && 'name' in record && typeof record.name === 'string'
      && record.name.replace(/\.$/u, '').toLowerCase() === owner) as Array<{ type?: unknown; data?: unknown }>;
    const aliases = scoped.filter(record => record.type === 5);
    const targets = scoped.filter(record => record.type === 1);
    if (aliases.length) {
      if (aliases.length !== 1 || targets.length || typeof aliases[0]!.data !== 'string') return refuse('public_media_dns_unavailable');
      const alias = aliases[0]!.data.replace(/\.$/u, '').toLowerCase();
      if (alias.length > 253 || !alias.includes('.') || isIP(alias) || !alias.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label))) return refuse('public_media_dns_unavailable');
      owner = alias; continue;
    }
    const addresses = targets.map(record => record.data);
    if (!addresses.length || addresses.some(address => typeof address !== 'string' || isIP(address) !== 4 || !isPublicMediaAddress(address))) return refuse('public_media_unsafe_address');
    return addresses[0] as string;
  }
  return refuse('public_media_dns_unavailable');
}

/** Only known all-synthetic DNS answers use the fixed public resolver. Every actual connection stays public and pinned. */
export async function readPublicMedia(urlText: string, options: PublicMediaOptions): Promise<{ url: string; response: Response }> {
  const timeoutMs = options.timeoutMs ?? 8000;
  const maximum = options.kind === 'page' ? 2 * 1024 * 1024 : 3 * 1024 * 1024;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000
    || options.maxBytes !== undefined && (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1 || options.maxBytes > maximum)
    || options.prefixBytes !== undefined && (!Number.isSafeInteger(options.prefixBytes) || options.prefixBytes < 32 || options.prefixBytes > 1024)) return refuse('public_media_invalid_limit');
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
  const maxBytes = options.maxBytes ?? (options.kind === 'page' ? 2 * 1024 * 1024 : 3 * 1024 * 1024);
  let url = new URL(urlText); const initialHost = url.hostname;
  const exchange = options.exchange ?? (options.fetcher ? async (target: URL, _address: string, request: Parameters<PublicMediaExchange>[2]) => options.fetcher!(target, {
    method: 'GET', redirect: 'manual', signal: request.signal, headers: request.headers
  }) : pinnedPublicMediaExchange);
  for (let hop = 0; hop < 4; hop++) {
    signal.throwIfAborted();
    if (!validOrigin(url) || options.sameHostRedirects && url.hostname !== initialHost) return refuse('public_media_unsafe_target');
    const addresses = await abortable(() => options.resolveHost ? options.resolveHost(url.hostname) : lookup(url.hostname, { all: true }), signal);
    if (!addresses.length) return refuse('public_media_dns_unavailable');
    const allPublic = addresses.every(record => isPublicMediaAddress(record.address));
    const allSynthetic = addresses.every(record => syntheticAddress(record.address));
    const address = allPublic ? addresses.find(record => isIP(record.address) === 4)?.address ?? addresses[0]!.address
      : allSynthetic ? await publicAddressFromSynthetic(url.hostname, exchange, signal) : refuse('public_media_unsafe_address');
    signal.throwIfAborted();
    const headers: Record<string, string> = { 'User-Agent': 'Landi/0.1 (travel planning; public place-photo verification)', 'Accept-Encoding': 'identity', Accept: options.kind === 'page' ? 'text/html,application/xhtml+xml' : 'image/*' };
    if (options.prefixBytes) headers.Range = `bytes=0-${1023}`;
    const response = await abortable(() => exchange(url, address, { signal, headers, maxBytes, ...(options.prefixBytes ? { prefixBytes: options.prefixBytes } : {}) }), signal);
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location'); void response.body?.cancel().catch(() => {});
      if (!location) return refuse('public_media_redirect_invalid');
      url = new URL(location, url); continue;
    }
    const body = await boundedBytes(response, maxBytes, signal, options.prefixBytes);
    const headersOut = new Headers(response.headers); headersOut.delete('content-length');
    return { url: url.toString(), response: new Response([204, 205, 304].includes(response.status) ? null : new Uint8Array(body), { status: response.status, headers: headersOut }) };
  }
  return refuse('public_media_redirect_limit');
}
