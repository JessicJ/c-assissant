import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import https from 'node:https';
import test from 'node:test';
import { isPublicMediaAddress, pinnedPublicMediaExchange, readPublicMedia, type PublicMediaExchange } from './public-media-fetch.js';
const target = 'https://venue.example.org/gallery/photo.jpg';
const address = '93.184.216.34';
const publicDns = async () => [{ address }];
const body = () => new Response('a bounded photo response', { headers: { 'content-type': 'image/jpeg' } });
function dnsAnswer(host = 'venue.example.org', records: unknown[] = [{ name: host, type: 1, data: address }]) {
  return new Response(JSON.stringify({ Status: 0, TC: false, Question: [{ name: host, type: 1 }], Answer: records }), { headers: { 'content-type': 'application/dns-json' } });
}
const syntheticDns = async () => [{ address: '198.18.0.1' }];

test('a public destination reaches the trusted exchange with its checked address and original origin', async () => {
  const calls: string[] = [];
  const result = await readPublicMedia(target, { kind: 'image', resolveHost: publicDns,
    exchange: async (url, peer, options) => { calls.push(url.hostname); assert.equal(peer, address); assert.equal(options.headers['Accept-Encoding'], 'identity'); assert.equal(options.headers.Authorization, undefined); return body(); } });
  assert.deepEqual(calls, ['venue.example.org']); assert.equal(result.url, target); assert.equal(await result.response.text(), 'a bounded photo response');
});

test('only all-synthetic answers use the fixed authenticated resolver and then a public pinned destination', async () => {
  const calls: Array<{ host: string; peer: string }> = [];
  await readPublicMedia(target, { kind: 'image', resolveHost: async () => [{ address: '198.18.0.1' }, { address: '198.19.255.254' }],
    exchange: async (url, peer) => { calls.push({ host: url.hostname, peer });
      if (url.hostname === 'dns.google') { assert.equal(url.searchParams.get('name'), 'venue.example.org'); assert.equal(url.searchParams.get('edns_client_subnet'), '0.0.0.0/0'); return dnsAnswer(); }
      return body(); } });
  assert.deepEqual(calls, [{ host: 'dns.google', peer: '8.8.8.8' }, { host: 'venue.example.org', peer: address }]);
});

for (const addresses of [['127.0.0.1'], ['10.0.0.1'], ['192.168.1.1'], ['169.254.169.254'], ['192.0.2.1'], ['2001:db8::1'], ['::ffff:127.0.0.1'], [address, '198.18.0.1'], ['198.18.0.1', '10.0.0.1'], [address, 'fc00::1']]) test(`unsafe/mixed DNS never obtains a second resolution or connection: ${addresses.join(',')}`, async () => {
  let calls = 0;
  await assert.rejects(readPublicMedia(target, { kind: 'image', resolveHost: async () => addresses.map(address => ({ address })), exchange: async () => { calls++; return body(); } }), { code: 'public_media_unsafe_address' });
  assert.equal(calls, 0);
});

for (const url of ['http://venue.example.org/a.jpg', 'https://127.0.0.1/a.jpg', 'https://93.184.216.34/a.jpg', 'https://user:pass@venue.example.org/a.jpg', 'https://venue.example.org:8443/a.jpg', 'https://host.internal/a.jpg']) test(`invalid origin is refused before DNS: ${new URL(url).hostname}`, async () => {
  let resolutions = 0;
  await assert.rejects(readPublicMedia(url, { kind: 'image', resolveHost: async () => { resolutions++; return publicDns(); } }), { code: 'public_media_unsafe_target' });
  assert.equal(resolutions, 0);
});

for (const fault of ['empty', 'failed'] as const) test(`unavailable local DNS does not activate public resolution: ${fault}`, async () => {
  let calls = 0;
  await assert.rejects(readPublicMedia(target, { kind: 'image', resolveHost: async () => { if (fault === 'failed') throw new Error('unavailable'); return []; }, exchange: async () => { calls++; return body(); } }));
  assert.equal(calls, 0);
});

test('public DNS A answers must belong to the original question or its unique CNAME chain', async () => {
  const calls: string[] = [];
  const records = [{ name: 'unrelated.example.org', type: 1, data: '10.0.0.1' }, { name: 'venue.example.org', type: 5, data: 'cdn.example.org.' }, { name: 'cdn.example.org.', type: 1, data: address }];
  await readPublicMedia(target, { kind: 'image', resolveHost: syntheticDns, exchange: async (url, peer) => { calls.push(peer); return url.hostname === 'dns.google' ? dnsAnswer('venue.example.org', records) : body(); } });
  assert.deepEqual(calls, ['8.8.8.8', address]);
});

for (const fault of ['unrelated-only', 'cname-loop', 'cname-and-a', 'private-a', 'mixed-a', 'wrong-question', 'truncated', 'ipv6-as-a'] as const) test(`public DNS cannot authorize an invalid answer: ${fault}`, async () => {
  let destinations = 0;
  const records = fault === 'unrelated-only' ? [{ name: 'other.example.org', type: 1, data: address }]
    : fault === 'cname-loop' ? [{ name: 'venue.example.org', type: 5, data: 'other.example.org' }, { name: 'other.example.org', type: 5, data: 'venue.example.org' }]
    : fault === 'cname-and-a' ? [{ name: 'venue.example.org', type: 5, data: 'other.example.org' }, { name: 'venue.example.org', type: 1, data: address }]
    : fault === 'private-a' ? [{ name: 'venue.example.org', type: 1, data: '127.0.0.1' }]
    : fault === 'mixed-a' ? [{ name: 'venue.example.org', type: 1, data: address }, { name: 'venue.example.org', type: 1, data: '198.18.0.1' }]
    : fault === 'ipv6-as-a' ? [{ name: 'venue.example.org', type: 1, data: '2001:4860:4860::8888' }]
    : [{ name: 'venue.example.org', type: 1, data: address }];
  await assert.rejects(readPublicMedia(target, { kind: 'image', resolveHost: syntheticDns, exchange: async url => {
    if (url.hostname !== 'dns.google') { destinations++; return body(); }
    if (fault === 'truncated') return new Response(JSON.stringify({ Status: 0, TC: true }), { headers: { 'content-type': 'application/dns-json' } });
    return dnsAnswer(fault === 'wrong-question' ? 'other.example.org' : 'venue.example.org', records);
  } }));
  assert.equal(destinations, 0);
});

test('each redirect is resolved again and a private redirect target never receives a request', async () => {
  const calls: string[] = [];
  await assert.rejects(readPublicMedia(target, { kind: 'image', resolveHost: async host => [{ address: host === 'venue.example.org' ? address : '127.0.0.1' }],
    exchange: async url => { calls.push(url.hostname); return new Response(null, { status: 302, headers: { location: 'https://other.example.org/photo.jpg' } }); } }), { code: 'public_media_unsafe_address' });
  assert.deepEqual(calls, ['venue.example.org']);
});

test('source pages refuse cross-host redirects and image reads stop at the redirect limit', async () => {
  let calls = 0;
  await assert.rejects(readPublicMedia(target, { kind: 'page', sameHostRedirects: true, resolveHost: publicDns,
    exchange: async () => { calls++; return new Response(null, { status: 302, headers: { location: 'https://other.example.org/gallery' } }); } }), { code: 'public_media_unsafe_target' });
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(readPublicMedia(target, { kind: 'image', resolveHost: publicDns,
    exchange: async () => { calls++; return new Response(null, { status: 302, headers: { location: '/next.jpg' } }); } }), { code: 'public_media_redirect_limit' });
  assert.equal(calls, 4);
});

test('body limits apply to actual streamed bytes and to declared page size', async () => {
  for (const declared of [false, true]) await assert.rejects(readPublicMedia(target, { kind: 'page', maxBytes: 32, resolveHost: publicDns,
    exchange: async () => new Response('a'.repeat(33), { headers: declared ? { 'content-length': '33' } : {} }) }), { code: 'public_media_body_too_large' });
});

test('a prefix image check cancels after its bounded bytes instead of buffering the full photo', async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(100)); }, cancel() { cancelled = true; } }), { headers: { 'content-length': '1000000' } });
  const result = await readPublicMedia(target, { kind: 'image', maxBytes: 1024, prefixBytes: 32, resolveHost: publicDns, exchange: async () => response });
  assert.equal((await result.response.arrayBuffer()).byteLength, 32); assert.equal(cancelled, true);
});

test('cancellation returns while DNS ignores its signal and late resolution never starts a request', async () => {
  const controller = new AbortController(); let release!: (addresses: Array<{ address: string }>) => void; let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; }); let calls = 0;
  const pending = readPublicMedia(target, { kind: 'image', signal: controller.signal,
    resolveHost: async () => { entered(); return new Promise(resolve => { release = resolve; }); }, exchange: async () => { calls++; return body(); } });
  await started; controller.abort(); await assert.rejects(pending);
  release([{ address }]); await Promise.resolve(); assert.equal(calls, 0);
});

test('a non-cooperative body reader cannot hold cancellation open', async () => {
  const controller = new AbortController(); let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; });
  const pending = readPublicMedia(target, { kind: 'page', signal: controller.signal, resolveHost: publicDns,
    exchange: async () => { entered(); return new Response(new ReadableStream({ pull: () => new Promise(() => {}), cancel: () => new Promise(() => {}) })); } });
  await started; controller.abort(); await assert.rejects(pending);
});

for (const value of ['0.0.0.0','192.0.2.1','198.51.100.1','203.0.113.1','240.0.0.1','::1','::ffff:7f00:1','64:ff9b::7f00:1','100::1','2001:2::1','2001:db8::1','2002:7f00:1::','2620:4f:8000::1','3fff:123::1','fc00::1','fe80::1','ff02::1']) test(`special-purpose address remains ineligible: ${value}`, () => assert.equal(isPublicMediaAddress(value), false));

test('ordinary public IPv4 and IPv6 addresses remain eligible', () => {
  assert.equal(isPublicMediaAddress('210.233.84.92'), true);
  assert.equal(isPublicMediaAddress('2001:4860:4860::8888'), true);
});

for (const fault of ['certificate', 'peer', 'none'] as const) test(`native HTTPS retains hostname, SNI, certificate validation and pinned peer: ${fault}`, async t => {
  let requestOptions: any;
  const fake = (_url: unknown, options: any, callback: (response: any) => void) => {
    requestOptions = options;
    const request = new EventEmitter() as any;
    request.end = () => {
      const response = new EventEmitter() as any;
      response.headers = { 'content-type': 'image/jpeg' }; response.statusCode = 200;
      response.socket = { authorized: fault !== 'certificate', remoteAddress: fault === 'peer' ? '127.0.0.1' : address };
      response.destroy = () => {};
      callback(response);
      queueMicrotask(() => { response.emit('data', Buffer.from('picture bytes')); response.emit('end'); });
    };
    return request;
  };
  t.mock.method(https, 'request', fake as typeof https.request);
  const operation = pinnedPublicMediaExchange(new URL(target), address, { signal: new AbortController().signal, headers: { Accept: 'image/*' }, maxBytes: 1024 });
  if (fault === 'none') assert.equal((await operation).status, 200);
  else await assert.rejects(operation, { code: 'public_media_peer_unverified' });
  assert.equal(requestOptions.servername, 'venue.example.org'); assert.equal(requestOptions.rejectUnauthorized, true); assert.equal(requestOptions.agent, false);
  requestOptions.lookup('venue.example.org', { all: true }, (error: unknown, records: unknown) => { assert.equal(error, null); assert.deepEqual(records, [{ address, family: 4 }]); });
  requestOptions.lookup('other.example.org', { all: true }, (error: unknown) => assert.ok(error));
});

test('the total timeout bounds a resolver that never answers', async () => {
  const started = Date.now(); let requests = 0;
  const keepAlive = setTimeout(() => {}, 1000);
  try { await assert.rejects(readPublicMedia(target, { kind: 'image', timeoutMs: 20,
    resolveHost: async () => new Promise(() => {}), exchange: async () => { requests++; return body(); } })); } finally { clearTimeout(keepAlive); }
  assert.equal(requests, 0); assert.ok(Date.now() - started < 1000);
});

test('media requests identify the real Landi client without impersonating a browser', async () => {
  await readPublicMedia(target, { kind: 'image', resolveHost: publicDns, exchange: async (_url, _address, request) => {
    assert.equal(request.headers['User-Agent'], 'Landi/0.1 (travel planning; public place-photo verification)');
    return body();
  } });
});
