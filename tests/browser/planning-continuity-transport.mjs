import http from 'node:http';
import net from 'node:net';
import { changePlanningContinuitySession, readPlanningContinuitySnapshot } from './planning-continuity-fixture.mjs';

// 仅测试入口代理：生产路由、存储事务与 Web 资产均由上游真实 Server 提供。
export function createPlanningContinuityTransport({ databasePath, port, upstreamPort }) {
  const connect = net.Socket.prototype.connect;
  const agent = new http.Agent({ keepAlive: false });
  agent.createConnection = () => connect.call(new net.Socket(), upstreamPort, '127.0.0.1');
  let configuration = 'unverified', nextSave = null, receiptUnavailable = false;
  let delays = {}, failures = {}, captured = null;
  const counts = {};
  const origin = `http://127.0.0.1:${port}`;
  const state = () => ({ configuration, executable: false, nextSave, receiptUnavailable, delays, failures, captured, counts: { ...counts } });
  const json = (response, status, body) => { response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); response.end(JSON.stringify(body)); };
  const server = http.createServer(async (request, response) => {
    try {
      if (request.headers.host !== `127.0.0.1:${port}` || (request.headers.origin && request.headers.origin !== origin) || request.headers['sec-fetch-site'] === 'cross-site') return json(response, 403, { error: '隔离实例来源不匹配。' });
      if (!request.url.startsWith('/') || request.url.startsWith('//') || request.headers.upgrade) return json(response, 400, { error: '无效目标。' });
      const url = new URL(request.url, origin);
      const chunks = []; let size = 0;
      for await (const chunk of request) { size += chunk.length; if (size > 1024 * 1024) throw Error('请求过大'); chunks.push(chunk); }
      const bytes = Buffer.concat(chunks);
      if (url.pathname.startsWith('/__fixture')) {
        if (request.method === 'GET' && url.pathname === '/__fixture/state') return json(response, 200, state());
        if (request.method === 'GET' && url.pathname === '/__fixture/snapshot') return json(response, 200, readPlanningContinuitySnapshot(databasePath));
        if (request.method !== 'POST' || url.pathname !== '/__fixture/control') return json(response, 404, { error: '测试入口不存在。' });
        if (request.headers.origin !== origin || request.headers['content-type']?.split(';')[0] !== 'application/json') return json(response, 403, { error: '控制必须来自本隔离实例。' });
        const body = JSON.parse(bytes);
        if (body.action === 'configuration' && ['verified', 'needs_setup', 'unverified'].includes(body.value)) configuration = body.value;
        else if (body.action === 'next-save' && ['normal', 'drop_response'].includes(body.mode)) { nextSave = body.mode; receiptUnavailable = body.hideReceipt === true; }
        else if (body.action === 'receipts' && typeof body.unavailable === 'boolean') receiptUnavailable = body.unavailable;
        else if (body.action === 'delay' && typeof body.path === 'string' && /^\/api\//.test(body.path) && Number.isInteger(body.ms) && body.ms >= 0 && body.ms <= 20000) delays[body.path] = body.ms;
        else if (body.action === 'read-failure' && typeof body.path === 'string' && /^\/api\//.test(body.path) && typeof body.failed === 'boolean') failures[body.path] = body.failed;
        else if (body.action === 'session') changePlanningContinuitySession(databasePath, body);
        else if (body.action === 'clear') { delays = {}; failures = {}; nextSave = null; receiptUnavailable = false; }
        else return json(response, 400, { error: '无效测试控制。' });
        return json(response, 200, state());
      }
      const key = `${request.method} ${url.pathname}`;
      counts[key] = (counts[key] ?? 0) + 1;
      if (request.method === 'GET' && failures[url.pathname]) return json(response, 503, { code: 'fixture_read_unavailable', executable: false });
      const selectedConfiguration = configuration, selectedDelay = delays[url.pathname] ?? 0;
      let mode;
      if (request.method === 'POST' && url.pathname === '/api/agent/chat') { mode = nextSave; nextSave = null; captured = { path: url.pathname, body: JSON.parse(bytes) }; }
      if (request.method === 'GET' && /\/messages\/[^/]+\/status$|^\/api\/planning-messages\/[^/]+\/status$/.test(url.pathname) && receiptUnavailable) return json(response, 503, { requirementsSaved: null, executable: false, code: 'fixture_receipt_unavailable' });
      const upstream = http.request({ hostname: '127.0.0.1', port: upstreamPort, path: request.url, method: request.method, agent, headers: { ...request.headers, host: `127.0.0.1:${upstreamPort}`, ...(request.headers.origin ? { origin: `http://127.0.0.1:${upstreamPort}` } : {}), 'accept-encoding': 'identity', connection: 'close' } }, incoming => {
        const output = []; incoming.on('data', chunk => output.push(chunk));
        incoming.on('end', async () => {
          if (selectedDelay) await new Promise(resolve => setTimeout(resolve, selectedDelay));
          if (response.destroyed) return;
          if (mode === 'drop_response' && incoming.statusCode >= 200 && incoming.statusCode < 300) { response.writeHead(200, { 'content-type': 'application/json', 'content-length': '2', connection: 'close' }); response.write('{', () => response.destroy()); return; }
          let payload = Buffer.concat(output);
          if (url.pathname === '/api/agent-readiness' && incoming.statusCode === 200) {
            const body = JSON.parse(payload);
            body.connection = { selectionOwner: 'mah', executable: false, configuration: selectedConfiguration, code: selectedConfiguration === 'verified' ? 'configuration_verified_execution_blocked' : selectedConfiguration === 'needs_setup' ? 'configuration_requires_setup' : 'public_configuration_contract_unverified', evidence: { source: selectedConfiguration === 'unverified' ? null : 'mah_public_configuration', protocol: selectedConfiguration === 'unverified' ? null : 1, observedAt: new Date().toISOString(), scopeVerified: selectedConfiguration !== 'unverified', maxAgeMs: 60000 } };
            payload = Buffer.from(JSON.stringify(body));
          }
          const headers = { ...incoming.headers, 'content-length': String(payload.length), 'cache-control': 'no-store' };
          for (const name of ['transfer-encoding', 'connection', 'keep-alive', 'etag']) delete headers[name];
          response.writeHead(incoming.statusCode, headers); response.end(payload);
        });
        incoming.on('error', () => response.destroy());
      });
      upstream.on('error', () => { if (!response.headersSent) json(response, 502, { error: '隔离上游未就绪。' }); else response.destroy(); });
      upstream.setTimeout(25000, () => upstream.destroy());
      response.once('close', () => { if (!response.writableEnded) upstream.destroy(); });
      upstream.end(bytes);
    } catch { if (!response.headersSent) json(response, 400, { error: '无效测试请求。' }); else response.destroy(); }
  });
  server.on('connect', (_request, socket) => socket.destroy()); server.on('upgrade', (_request, socket) => socket.destroy());
  return { origin, listen: () => new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); }), close() { agent.destroy(); server.close(); server.closeAllConnections(); } };
}
