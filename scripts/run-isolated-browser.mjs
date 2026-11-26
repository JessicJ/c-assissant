import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { assertPreviousStopped, waitForOwner } from './isolated-browser-owner.mjs';

// 此 runner 只管理自己创建的进程和目录，绝不认领已有服务或重置数据。
const component = process.cwd();
const base = process.env.LANDI_ISOLATED_BROWSER_ARTIFACTS ?? path.join(component, 'test-results', 'isolated-browser');
if (!path.isAbsolute(base)) throw new Error('LANDI_ISOLATED_BROWSER_ARTIFACTS 必须是绝对路径。');
mkdirSync(base, { recursive: true });
const runDirectory = mkdtempSync(path.join(base, 'run-'));
const cli = path.join(component, 'node_modules', '@playwright', 'test', 'cli.js');
if (!existsSync(cli)) throw new Error('缺少现有 Playwright CLI；本 runner 不安装依赖。');
const allCases = [
  { name: 'workspace', scenario: 'workspace', config: 'tests/browser/isolated-workspace.config.ts', expected: 10 },
  { name: 'relationships', scenario: 'booking-relationships', config: 'tests/browser/booking-impact-isolated.config.ts', grep: '真实界面从未知', expected: 1 },
  { name: 'legacy', scenario: 'legacy-booking-sources', config: 'tests/browser/booking-impact-isolated.config.ts', grep: '旧固定来源逐预订', expected: 1 },
  { name: 'priority', scenario: 'booking-priority', config: 'tests/browser/booking-impact-isolated.config.ts', grep: '优先级未知与未排程地点', expected: 1 },
  { name: 'lost-response', scenario: 'booking-relationships', config: 'tests/browser/booking-impact-isolated.config.ts', grep: '关系保存响应丢失', expected: 1 },
  { name: 'empty-snapshot', scenario: 'empty-source-snapshot', config: 'tests/browser/booking-impact-isolated.config.ts', grep: '空快照来源义务', expected: 1 },
  { name: 'missing-snapshot', scenario: 'missing-source-snapshot', config: 'tests/browser/booking-impact-isolated.config.ts', grep: '缺失快照来源义务', expected: 1 }
];
const caseFilter = process.env.LANDI_ISOLATED_CASE;
if (caseFilter && !allCases.some(item => item.name === caseFilter)) throw new Error('未知隔离专项名称。');
const cases = caseFilter ? allCases.filter(item => item.name === caseFilter) : allCases;
async function freePort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
  const port = probe.address().port;
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  return port;
}
function launch(args, env, dir, label) {
  const startedAt = new Date().toISOString();
  const child = spawn(process.execPath, args, { cwd: component, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const stdout = createWriteStream(path.join(dir, `${label}.stdout`));
  const stderr = createWriteStream(path.join(dir, `${label}.stderr`));
  child.stdout.on('data', data => { stdout.write(data); process.stdout.write(data); });
  child.stderr.on('data', data => { stderr.write(data); process.stderr.write(data); });
  const done = new Promise(resolve => {
    let errorMessage;
    child.once('error', error => { errorMessage = error.message; });
    child.once('close', async (code, signal) => { await Promise.all([new Promise(done => stdout.end(done)), new Promise(done => stderr.end(done))]); const record = { executable: process.execPath, args, cwd: component, startedAt, finishedAt: new Date().toISOString(), pid: child.pid, exit: code, signal, ...(errorMessage ? { error: errorMessage } : {}) }; writeFileSync(path.join(dir, `${label}.command.json`), JSON.stringify(record, null, 2)); resolve(record); });
  });
  return { child, done };
}
async function waitReady(server, directory, port, previousOwner) {
  const deadline = Date.now() + 30000;
  const ownerFile = path.join(directory, 'owner.json');
  const owner = await waitForOwner({
    readOwner: () => existsSync(ownerFile) ? JSON.parse(readFileSync(ownerFile, 'utf8')) : undefined,
    expectedPid: server.child.pid, port, previousOwner, expectedEntry: pathToFileURL(path.join(component, 'tests/browser/isolated-workspace-server.mjs')).href,
    checkAlive: () => { if (server.child.exitCode !== null || server.child.signalCode !== null) throw new Error('自有隔离服务提前退出。'); }
  });
  while (Date.now() < deadline) {
    if (server.child.exitCode !== null || server.child.signalCode !== null) throw new Error('自有隔离服务提前退出。');
    if (existsSync(ownerFile)) {
      if (JSON.stringify(JSON.parse(readFileSync(ownerFile, 'utf8'))) !== JSON.stringify(owner)) throw new Error('隔离实例所有权不匹配。');
      try {
        const response = await fetch(`http://127.0.0.1:${port}/__fixture/`, { signal: AbortSignal.timeout(1000) });
        if (response.ok && (await response.text()).includes('虚构')) return owner;
      } catch { /* 自有服务尚未就绪。 */ }
    }
    await delay(100);
  }
  throw new Error('隔离服务未在限时内就绪。');
}
async function stopServer(server) {
  if (server.child.exitCode === null && server.child.signalCode === null) server.child.kill('SIGTERM');
  const forceStop = setTimeout(() => { if (server.child.exitCode === null && server.child.signalCode === null) server.child.kill('SIGKILL'); }, 5000);
  const result = await server.done;
  clearTimeout(forceStop);
  if (result.exit !== 0 && result.signal !== 'SIGTERM') throw new Error(`自有服务退出异常: ${JSON.stringify(result)}`);
  return result;
}
function browserOwners(rootPid) {
  const lines = execFileSync('/bin/ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8' }).split('\n');
  const entries = lines.map(line => /^\s*(\d+)\s+(\d+)\s*$/.exec(line)).filter(Boolean).map(match => ({ pid: Number(match[1]), ppid: Number(match[2]) }));
  const descendants = new Set([rootPid]);
  for (let changed = true; changed;) {
    changed = false;
    for (const entry of entries) if (descendants.has(entry.ppid) && !descendants.has(entry.pid)) { descendants.add(entry.pid); changed = true; }
  }
  const selected = [...descendants].join(',');
  const ownedLines = execFileSync('/bin/ps', ['-p', selected, '-o', 'pid=,ppid=,command='], { encoding: 'utf8' }).split('\n');
  const owned = ownedLines.map(line => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)).filter(Boolean).map(match => ({ pid: Number(match[1]), ppid: Number(match[2]), command: match[3] }));
  return owned.filter(entry => !entry.command.includes('--type=')).flatMap(entry => {
    const executable = /^(.*?\.app\/Contents\/MacOS\/Google Chrome for Testing)(?:\s|$)/.exec(entry.command)?.[1];
    if (!executable) return [];
    const profile = /--user-data-dir=(?:"([^"]+)"|'([^']+)'|(\S+))/.exec(entry.command);
    const profilePath = profile?.[1] ?? profile?.[2] ?? profile?.[3];
    return [{ pid: entry.pid, ppid: entry.ppid, executable, headlessArgument: /(?:^|\s)--headless(?:=|\s|$)/.test(entry.command), profilePresent: Boolean(profilePath), ...(profilePath ? { profileDigest: createHash('sha256').update(profilePath).digest('hex') } : {}) }];
  });
}
const results = [];
let activeServer, activeTest, interrupted = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  interrupted = true;
  for (const child of [activeTest, activeServer]) if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
});
for (const item of cases) {
  if (interrupted) break;
  const directory = path.join(runDirectory, item.name);
  mkdirSync(directory);
  const dataDir = path.join(directory, 'data');
  const port = await freePort();
  const serverArgs = ['tests/browser/isolated-workspace-server.mjs', '--data-dir', dataDir, '--port', String(port), '--scenario', item.scenario];
  let server = launch(serverArgs, process.env, directory, 'server');
  activeServer = server.child;
  const result = { name: item.name, scenario: item.scenario, port, dataDir, serverPid: server.child.pid, servers: [], status: 'failed' };
  try {
    let currentOwner = await waitReady(server, dataDir, port);
    const outputDir = path.join(directory, 'playwright-output');
    const reportPath = path.join(directory, 'playwright-report.json');
    const nativeDirectory = path.join(directory, 'native-observe');
    const restartDirectory = path.join(directory, 'restart-control');
    mkdirSync(restartDirectory);
    if (process.env.LANDI_NATIVE_OBSERVE === '1') mkdirSync(nativeDirectory);
    const envOverrides = { LANDI_WORKSPACE_BASE_URL: `http://127.0.0.1:${port}`, LANDI_BROWSER_OUTPUT_DIR: outputDir, LANDI_PAGE_EVIDENCE_DIR: path.join(directory, 'page-evidence'), LANDI_BOOKING_IMPACT_E2E: '1', LANDI_BOOKING_SCENARIO: item.scenario, LANDI_TEST_SQLITE_PATH: path.join(dataDir, 'workspace.sqlite'), LANDI_RESTART_CONTROL_DIR: restartDirectory, LANDI_BROWSER_HEADFUL: process.env.LANDI_BROWSER_HEADFUL === '1' ? '1' : '0', ...(process.env.LANDI_NATIVE_OBSERVE === '1' ? { LANDI_NATIVE_OBSERVE_DIR: nativeDirectory } : {}), PLAYWRIGHT_JSON_OUTPUT_NAME: reportPath };
    const args = [cli, 'test', '--config', item.config, '--reporter=list,json', ...(item.grep ? ['--grep', item.grep] : [])];
    writeFileSync(path.join(directory, 'test-environment.json'), JSON.stringify(envOverrides, null, 2));
    const testRun = launch(args, { ...process.env, ...envOverrides }, directory, 'playwright');
    activeTest = testRun.child;
    let testFinished = false, restartError;
    const capturedCheckpoints = new Set();
    const restartWatch = (async () => {
      while (!testFinished && !interrupted) {
        if (process.env.LANDI_NATIVE_OBSERVE === '1') for (const file of readdirSync(nativeDirectory).filter(name => name.endsWith('.ready') && !capturedCheckpoints.has(name))) {
          capturedCheckpoints.add(file);
          const checkpoint = JSON.parse(readFileSync(path.join(nativeDirectory, file), 'utf8'));
          let owners, ownerError;
          try { owners = browserOwners(testRun.child.pid); } catch (error) { ownerError = String(error); }
          writeFileSync(path.join(nativeDirectory, `${file}.owner.json`), JSON.stringify({ capturedAt: new Date().toISOString(), playwrightPid: testRun.child.pid, checkpoint, ...(owners ? { browserOwners: owners } : { ownerError }) }, null, 2));
        }
        if (existsSync(path.join(restartDirectory, 'restart.ready'))) {
          try {
            const stopped = await stopServer(server);
            result.servers.push(stopped);
            assertPreviousStopped(stopped);
            server = launch(serverArgs, process.env, directory, 'server-restart');
            activeServer = server.child;
            currentOwner = await waitReady(server, dataDir, port, currentOwner);
            writeFileSync(path.join(restartDirectory, 'restart.completed'), '本次自有服务已使用原目录和端口重启');
          } catch (error) { restartError = String(error); testRun.child.kill('SIGTERM'); }
          return;
        }
        await delay(100);
      }
    })();
    const testExit = await testRun.done;
    testFinished = true;
    await restartWatch;
    activeTest = undefined;
    result.testExit = testExit.exit;
    result.testSignal = testExit.signal;
    result.reportProduced = existsSync(reportPath);
    if (restartError) throw new Error(restartError);
    if (!result.reportProduced) throw new Error('未生成 Playwright 结构化报告。');
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    result.stats = report.stats;
    if (testExit.exit !== 0 || report.stats?.expected !== item.expected || report.stats?.skipped !== 0 || report.stats?.unexpected !== 0 || report.stats?.flaky !== 0) throw new Error('专项未完整通过或存在跳过。');
    result.status = 'passed';
  } catch (error) { result.error = String(error); process.stderr.write(`${item.name}: ${result.error}\n`); }
  finally {
    try { result.servers.push(await stopServer(server)); }
    catch (error) { result.status = 'failed'; result.error = `${result.error ?? ''} ${String(error)}`; }
    activeServer = undefined;
    writeFileSync(path.join(directory, 'result.json'), JSON.stringify(result, null, 2));
    results.push(result);
  }
}
writeFileSync(path.join(runDirectory, 'summary.json'), JSON.stringify(results, null, 2));
process.stdout.write(`隔离浏览器证据：${runDirectory}\n`);
if (interrupted || results.length !== cases.length || results.some(result => result.status !== 'passed')) process.exitCode = 1;
