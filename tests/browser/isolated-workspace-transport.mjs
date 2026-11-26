import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const fixturePrefix = '/__fixture';
export async function startFixtureTransport(transport, startUpstream) {
  try { await startUpstream(); await transport.listen(); }
  catch (error) { transport.close(); throw error; }
}
export function createFixtureTransport({ databasePath, port, upstreamPort }) {
  const origin = `http://127.0.0.1:${port}`;
  const connect = net.Socket.prototype.connect;
  const agent = new http.Agent({ keepAlive: false });
  agent.createConnection = () => connect.call(new net.Socket(), upstreamPort, '127.0.0.1');
  const sql = new DatabaseSync(databasePath);
  const trigger = 'isolated_transport_abort';
  let armed, next, captured, unavailableReceipt, rollbackOwner;
  const clearTrigger = owner => { if (owner && rollbackOwner !== owner) return; sql.exec(`DROP TRIGGER IF EXISTS ${trigger}`); rollbackOwner = undefined; };
  clearTrigger();
  const json = (response, code, value) => { response.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); response.end(JSON.stringify(value)); };
  const validWrite = request => request.headers.host === `127.0.0.1:${port}` && request.headers.origin === origin && request.headers['content-type']?.split(';')[0] === 'application/json';
  const receiptPath = (path, body) => path.replace(/\/direct$|\/[^/]+\/undo$/, `/receipts/${encodeURIComponent(body.requestId)}`);
  const server = http.createServer(async (request, response) => {
    let selected;
    const cleanupSelected = () => { if (selected?.mode === 'rollback') clearTrigger(selected); };
    try {
      if (request.headers.host !== `127.0.0.1:${port}` || (request.headers.origin && request.headers.origin !== origin) || request.headers['sec-fetch-site'] === 'cross-site') return json(response, 403, { error: '实例地址不匹配。' });
      if (!request.url.startsWith('/') || request.url.startsWith('//') || request.headers.upgrade) return json(response, 400, { error: '不支持代理目标。' });
      const url = new URL(request.url, origin);
      if (url.pathname.startsWith(fixturePrefix)) {
        if (request.method === 'GET' && url.pathname === '/__fixture/state') return json(response, 200, { armed, next, captured, unavailableReceipt });
        if (request.method === 'POST' && url.pathname === '/__fixture/control') {
          if (!validWrite(request)) return json(response, 403, { error: '控制操作必须来自同一隔离实例。' });
          const chunks = []; for await (const chunk of request) { chunks.push(chunk); if (Buffer.concat(chunks).length > 65536) throw Error('控制请求过大'); }
          const body = JSON.parse(Buffer.concat(chunks).toString());
          if (body.action === 'clear') { armed = next = captured = unavailableReceipt = undefined; clearTrigger(); }
          else if (body.action === 'capture') next = { mode: 'capture' };
          else if (body.action === 'next' && ['rollback', 'drop_response'].includes(body.mode)) next = { mode: body.mode, hideReceipt: body.hideReceipt === true };
          else if (body.action === 'arm' && ['rollback', 'drop_response'].includes(body.mode) && /^\/api\/plans\/[^/]+\/blueprint-revisions\/(direct|[^/]+\/undo)$/.test(body.path) && typeof body.requestId === 'string' && body.requestId.length > 0) armed = { path: body.path, requestId: body.requestId, mode: body.mode };
          else if (body.action === 'receipts' && /^\/api\/plans\/[^/]+\/blueprint-revisions\/receipts\/[^/]+$/.test(body.path)) unavailableReceipt = body.unavailable ? body.path : undefined;
          else return json(response, 400, { error: '无效夹具控制。' });
          return json(response, 200, { armed, next, captured, unavailableReceipt });
        }
        if (request.method !== 'GET') return json(response, 405, { error: '只读虚构材料。' });
        if (url.pathname === '/__fixture/image.png') { response.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' }); return response.end(fs.readFileSync(new URL('../../apps/web/src/assets/onboarding/tsukiji-outer-market.png', import.meta.url))); }
        if (url.pathname === '/__fixture/broken.png') return json(response, 404, { error: '故意失效的虚构验收图片。' });
        if (/^\/__fixture\/sources\/(fact|old|inspiration)$/.test(url.pathname)) {
          const kind = url.pathname.split('/').at(-1);
          response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
          return response.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>虚构验收来源</title><h1>虚构验收来源：${kind}</h1><p>全部地点、商家与旅行资料均为隔离开发材料，不提供真实旅行建议。</p><p>来源标题持续阅读至末尾用于验证侧栏换行与完整来源披露不得省略也不得被图框遮挡的全部文字</p><p>${kind === 'inspiration' ? '用途：灵感；状态：待核实。图片仅为界面素材，不是该虚构地点的照片。' : kind === 'old' ? '用途：事实证据；状态：过期；核实于2025年1月1日。' : '用途：事实证据；状态：虚构已核实；核实于2026年11月5日。'}</p></html>`);
        }
        if (url.pathname !== '/__fixture/' && url.pathname !== '/__fixture') return json(response, 404, { error: '虚构材料不存在。' });
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        return response.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>隔离验收控制</title><h1>隔离验收控制（仅虚构数据）</h1><p>真实Core / Storage事务；控制不表示界面验收通过。</p><button onclick="control({action:'next',mode:'rollback'})">下一次保存真实回滚</button><button onclick="control({action:'next',mode:'drop_response',hideReceipt:true})">下一次提交后丢失响应并暂不可读回执</button><button onclick="control({action:'receipts',path:state.unavailableReceipt,unavailable:false})">恢复原请求回执读取</button><button onclick="control({action:'clear'})">解除故障</button><button onclick="refresh()">读取控制状态</button><a href="/">返回工作区</a><pre id="result"></pre><script>let state={};async function refresh(){state=await(await fetch('/__fixture/state')).json();document.getElementById('result').textContent=JSON.stringify(state,null,2)}async function control(body){await fetch('/__fixture/control',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});await refresh()}refresh()</script></html>`);
      }
      if (request.method === 'GET' && url.pathname === unavailableReceipt) return json(response, 503, { code: 'fixture_receipt_unavailable', error: '原请求回执暂不可读。' });
      const chunks = []; for await (const chunk of request) { chunks.push(chunk); if (Buffer.concat(chunks).length > 1048576) throw Error('请求过大'); }
      const bytes = Buffer.concat(chunks);
      if (request.method === 'POST' && /^\/api\/plans\/[^/]+\/blueprint-revisions\/(direct|[^/]+\/undo)$/.test(url.pathname)) {
        const body = JSON.parse(bytes.toString());
        if (next) {
          captured = { path: url.pathname, body, rawBody: bytes.toString() };
          if (next.mode !== 'capture') armed = { path: url.pathname, requestId: body.requestId, mode: next.mode };
          if (next.hideReceipt) unavailableReceipt = receiptPath(url.pathname, body);
          next = undefined;
        }
        if (armed?.path === url.pathname && armed.requestId === body.requestId) { selected = armed; armed = undefined; captured = { path: url.pathname, body, rawBody: bytes.toString() }; }
        if (selected?.mode === 'rollback') {
          if (rollbackOwner) return json(response, 409, { error: '另一个受控事务仍在运行。' });
          const table = url.pathname.endsWith('/undo') ? 'direct_blueprint_undos' : 'direct_blueprint_edits';
          const id = body.requestId.replaceAll("'", "''");
          clearTrigger();
          rollbackOwner = selected;
          sql.exec(`CREATE TRIGGER ${trigger} BEFORE INSERT ON ${table} WHEN NEW.request_id='${id}' BEGIN SELECT RAISE(ABORT, '虚构隔离事务拒绝 /private/fixture-only'); END`);
        }
      }
      const upstream = http.request({ hostname: '127.0.0.1', port: upstreamPort, method: request.method, path: request.url, agent, headers: { ...request.headers, host: `127.0.0.1:${upstreamPort}`, 'accept-encoding': 'identity', connection: 'close', ...(request.headers.origin === origin ? { origin: `http://127.0.0.1:${upstreamPort}` } : {}) } }, incoming => {
        const output = []; let size = 0; incoming.on('data', chunk => { size += chunk.length; if (size > 16 * 1024 * 1024) incoming.destroy(); else output.push(chunk); });
        incoming.on('end', () => {
          try {
          cleanupSelected();
          if (selected?.mode === 'drop_response' && incoming.statusCode >= 200 && incoming.statusCode < 300) {
            // Give Chromium a response boundary before truncating the body so it cannot resend the POST transparently.
            response.writeHead(incoming.statusCode, { 'content-type': 'application/json', 'content-length': '2', 'connection': 'close', 'cache-control': 'no-store' });
            response.write('{', () => response.destroy());
            return;
          }
          let payload = Buffer.concat(output);
          const headers = { ...incoming.headers };
          if (headers['content-type']?.includes('application/json')) {
            const value = JSON.parse(payload.toString());
            for (const workspace of [value, value.workspace]) for (const place of workspace?.activeBlueprint?.places ?? []) for (const image of place.images ?? []) {
              if (image.url === 'https://fixture.invalid/image.png') image.url = origin + '/__fixture/image.png';
              if (image.url === 'https://fixture.invalid/broken.png') image.url = origin + '/__fixture/broken.png';
            }
            payload = Buffer.from(JSON.stringify(value));
          }
          for (const name of ['transfer-encoding', 'connection', 'keep-alive', 'etag']) delete headers[name]; headers['content-length'] = String(payload.length);
          response.writeHead(incoming.statusCode, headers); response.end(payload);
          } catch { cleanupSelected(); response.destroy(); }
        });
        incoming.on('error', () => { cleanupSelected(); response.destroy(); });
        incoming.on('aborted', () => { cleanupSelected(); response.destroy(); });
      });
      upstream.setTimeout(15000, () => upstream.destroy());
      response.once('close', () => { if (!response.writableEnded) upstream.destroy(); });
      upstream.on('error', () => { cleanupSelected(); if (!response.headersSent) json(response, 502, { error: '隔离实例尚未就绪。' }); else response.destroy(); });
      upstream.end(bytes);
    } catch { cleanupSelected(); if (!response.headersSent) json(response, 400, { error: '无效隔离请求。' }); else response.destroy(); }
  });
  server.on('connect', (_request, socket) => socket.destroy());
  server.on('upgrade', (_request, socket) => socket.destroy());
  return { origin, listen: () => new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); }), close() { clearTrigger(); agent.destroy(); server.close(); sql.close(); } };
}
