import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { SqliteWorkspaceStore } from './index.js';
import { GENERATION_CARRIER_SCHEMA_SQL, GenerationCarrierStore } from './generation-carrier-store.js';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(',')}}`;
  return JSON.stringify(value);
}
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'landi-carrier-cas-')), path = join(dir, 'isolated.sqlite');
  const first = new DatabaseSync(path);
  first.exec(`PRAGMA foreign_keys=ON; CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT,applied_at TEXT);
  CREATE TABLE planning_sessions(id TEXT PRIMARY KEY,proposal_json TEXT,confirmed_proposal_version INTEGER,status TEXT);
  CREATE TABLE blueprint_generations(generation_key TEXT PRIMARY KEY,session_id TEXT,proposal_version INTEGER,skill_id TEXT,skill_version TEXT,status TEXT,blueprint_version INTEGER,research_set_id TEXT,blueprint_id TEXT);
  INSERT INTO planning_sessions VALUES('session','{"version":1}',1,'generating');
  INSERT INTO blueprint_generations VALUES('generation','session',1,'skill','1','running',NULL,NULL,NULL); ${GENERATION_CARRIER_SCHEMA_SQL}`);
  const a = new GenerationCarrierStore(first,path), second = new DatabaseSync(path), b = new GenerationCarrierStore(second,path);
  const prepare = (store: GenerationCarrierStore, language = 'zh-CN') => store.prepare({generationKey:'generation',operation:'itinerary_draft',inputSha256:hash(canonical({text:'虚构测试'})),expectedSubpath:'artifacts/landi-stage-result.json',projectRoot:'/tmp/fictional',protocol:'mah_task_queue_v1',preparedStatus:'prepared',retryableTerminalStatuses:[],serializeRequest:canonical,hashRequest:hash,createRequest: identity => ({schemaVersion:3,protocol:'mah_task_queue_v1',projectRoot:'/tmp/fictional',kind:'landi_generation_stage_request',...identity,generationKey:'generation',proposalRef:{sessionId:'session',proposalVersion:1},skillLineage:{skillId:'skill',skillVersion:'1'},operation:'itinerary_draft',parentCheckpoint:store.getGenerationCarrierCheckpoint('generation'),input:{businessContract:'landi.skill-itinerary-input.v1',sha256:hash(canonical({text:'虚构测试'})),businessInput:{text:'虚构测试'}},output:{subpath:'artifacts/landi-stage-result.json',envelopeContract:'landi.mah-generation-stage-result.v2'},execution:{preferredLanguage:language,webSearch:false,maxRuntimeSeconds:60,capabilityRequirements:['structured_output']},createdAt:new Date().toISOString()})});
  return {first,second,a,b,prepare,path,close(){first.close();second.close();rmSync(dir,{recursive:true,force:true});}};
}
test('两个 SQLite 连接冻结同一身份，只有耐久 CAS 获得一次发送权，重启不重置运行时钟', () => {
  const x=setup(); try {
    const one=x.prepare(x.a), two=x.prepare(x.b);
    assert.equal(one.carrierTaskId,two.carrierTaskId);
    assert.equal(one.requestByteLength,Buffer.byteLength(one.requestJson));
    assert.equal(one.slotClass,undefined);
    assert.throws(()=>x.prepare(x.b,'en'),/冻结请求/);
    assert.equal(x.a.claimSubmission(one.carrierTaskId,one.requestSha256),true);
    assert.equal(x.b.claimSubmission(one.carrierTaskId,one.requestSha256),false);
    x.a.recordRunningAt(one.carrierTaskId,'2026-11-09T00:00:00Z');
    assert.throws(()=>x.b.recordRunningAt(one.carrierTaskId,'2026-11-09T00:01:00Z'),/运行起点/);
    new GenerationCarrierStore(x.first,x.path);
    assert.equal(x.b.getByTaskId(one.carrierTaskId)?.runningAt,'2026-11-09T00:00:00Z');
    assert.equal(x.b.getByTaskId(one.carrierTaskId)?.slotClass,undefined);
  } finally { x.close(); }
});
test('取消闩锁跨连接阻断轮询、验证与导入；事务回滚不泄漏取消', () => {
  const x=setup(); try {
    const row=x.prepare(x.a);
    x.first.exec('BEGIN IMMEDIATE');x.a.markGenerationCancelRequested('generation','cancel_requested');x.first.exec('ROLLBACK');
    assert.equal(x.b.getByTaskId(row.carrierTaskId)?.cancelRequestedAt,undefined);
    const result='{"payload":"虚构结果"}';
    x.a.recordValidated({carrierTaskId:row.carrierTaskId,resultJson:result,resultSha256:hash(result),validatedStatus:'validated',importedStatus:'imported',changedStatus:'artifact_changed',cancelledStatuses:['cancel_requested','cancelled']});
    assert.throws(()=>x.a.markCarriersImported({generationKey:'generation',carrierTaskIds:[row.carrierTaskId],validatedStatus:'validated',importedStatus:'imported'}),/精确请求/);
    x.b.markGenerationCancelRequested('generation','cancel_requested');
    assert.equal(x.a.updateStatus(row.carrierTaskId,'completed').status,'cancel_requested');
    assert.throws(()=>x.a.recordValidated({carrierTaskId:row.carrierTaskId,resultJson:result,resultSha256:hash(result),validatedStatus:'validated',importedStatus:'imported',changedStatus:'artifact_changed',cancelledStatuses:[]}),/取消/);
    assert.throws(()=>x.a.markCarriersImported({generationKey:'generation',carrierTaskIds:[row.carrierTaskId],validatedStatus:'validated',importedStatus:'imported',expectedCarriers:[{carrierTaskId:row.carrierTaskId,resultSha256:hash(result),requestSha256:row.requestSha256}]}),/待导入/);
  } finally {x.close();}
});
test('发送权拒绝外层事务与不可靠持久模式',()=>{
  const x=setup();try{ const row=x.prepare(x.a);x.first.exec('BEGIN IMMEDIATE');assert.throws(()=>x.a.claimSubmission(row.carrierTaskId,row.requestSha256),/独立耐久/);x.first.exec('ROLLBACK');x.first.exec('PRAGMA synchronous=OFF');assert.throws(()=>x.a.claimSubmission(row.carrierTaskId,row.requestSha256),/持久化模式/);assert.equal(x.b.getByTaskId(row.carrierTaskId)?.status,'prepared');}finally{x.close();}
});

const CHILD_READY = "LANDI-CARRIER-READY";

// 子进程从创建起收集证据；所有失败只回收本测试拥有的句柄。
function carrierTestChild(args: string[], readyTimeoutMs = 5000, completionTimeoutMs = 10000) {
  const child = spawn(process.execPath, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '', stderr = '', closed = false;
  let failure: Error | undefined;
  let readySettled = false;
  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  let resolveClosed!: (result: { code: number | null; signal: NodeJS.Signals | null }) => void;
  const finished = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => { resolveClosed = resolve; });
  const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  // 在调用者等待另一个子进程时也保留失败，不产生未处理拒绝。
  void ready.catch(() => {});
  const diagnostic = (message: string) => new Error(`${message}\n标准输出：${stdout}\n标准错误：${stderr}`, failure ? { cause: failure } : undefined);
  const failReady = (message: string) => {
    if (readySettled) return;
    readySettled = true; clearTimeout(readyTimer); rejectReady(diagnostic(message));
  };
  const readyTimer = setTimeout(() => failReady('子进程就绪超时。'), readyTimeoutMs);
  child.stdout.on('data', bytes => {
    stdout += bytes;
    if (!readySettled && stdout.split('\n').slice(0, -1).some(line => line === CHILD_READY)) {
      readySettled = true; clearTimeout(readyTimer); resolveReady();
    }
  });
  child.stderr.on('data', bytes => { stderr += bytes; });
  child.once('error', error => { failure = error; failReady('子进程启动失败。'); });
  child.stdin.on('error', error => { failure = error; failReady('子进程输入通道失败。'); });
  child.once('close', (code, signal) => {
    closed = true; clearTimeout(readyTimer);
    failReady(`子进程在就绪前退出：${code ?? signal}。`);
    resolveClosed({ code, signal });
  });
  const waitClosed = async (timeoutMs: number) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([finished, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(diagnostic('子进程完成超时。')), timeoutMs);
      })]);
    } finally { if (timer) clearTimeout(timer); }
  };
  return {
    ready,
    claim() { child.stdin.end('claim'); },
    async result() {
      const result = await waitClosed(completionTimeoutMs);
      if (result.code !== 0 || failure) throw diagnostic(`子进程执行失败：${result.code ?? result.signal}。`);
      return stdout.split('\n').filter(line => line !== CHILD_READY).join('\n');
    },
    async stop() {
      if (closed) return;
      child.kill('SIGTERM');
      try { await waitClosed(1000); }
      catch { child.kill('SIGKILL'); await waitClosed(1000); }
    },
    evidence() { return { stdout, stderr, closed }; }
  };
}

test('双进程同时竞争耐久发送权，仅一个进程获准', async () => {
  const x = setup();
  const children: Array<ReturnType<typeof carrierTestChild>> = [];
  try {
    const row = x.prepare(x.a);
    x.first.exec('DELETE FROM mah_generation_carriers');
    const script = `import { createHash } from 'node:crypto'; const canonical=${canonical.toString()}; import { DatabaseSync } from 'node:sqlite'; import { GenerationCarrierStore } from ${JSON.stringify(new URL('./generation-carrier-store.ts', import.meta.url).href)}; const db=new DatabaseSync(process.argv[1]); db.exec('PRAGMA busy_timeout=5000'); const store=new GenerationCarrierStore(db,process.argv[1]); process.stdout.write(${JSON.stringify(CHILD_READY + "\n")}); process.stdin.once('data',()=>{ const template=JSON.parse(process.argv[4]); const mapping=store.prepare({generationKey:template.generationKey,operation:template.operation,inputSha256:template.input.sha256,expectedSubpath:template.output.subpath,projectRoot:template.projectRoot,protocol:'mah_task_queue_v1',preparedStatus:'prepared',retryableTerminalStatuses:[],serializeRequest:request=>canonical(request),hashRequest:value=>createHash('sha256').update(value).digest('hex'),createRequest:identity=>({...template,...identity,createdAt:new Date().toISOString()})}); process.stdout.write(JSON.stringify({id:mapping.carrierTaskId,claimed:store.claimSubmission(mapping.carrierTaskId,mapping.requestSha256)})); db.close(); });`;
    const loader = new URL('../node_modules/tsx/dist/loader.mjs', import.meta.url).href;
    for (const _ of [0, 1]) children.push(carrierTestChild(['--import', loader, '--input-type=module', '--eval', script, x.path, row.carrierTaskId, row.requestSha256, JSON.stringify(row.request)]));
    await Promise.all(children.map(child => child.ready));
    for (const child of children) child.claim();
    const outcomes = (await Promise.all(children.map(child => child.result()))).map(value => JSON.parse(value) as { id: string; claimed: boolean });
    assert.equal(outcomes[0]!.id, outcomes[1]!.id);
    assert.deepEqual(outcomes.map(value => value.claimed).sort(), [false, true]);
  } finally {
    await Promise.all(children.map(child => child.stop()));
    x.close();
  }
});

test('受控子进程启动失败或缺少精确就绪标记时有界失败并完成回收', async () => {
  for (const exits of [true, false]) {
    const script = exits
      ? "process.stdout.write('其它输出\\n'); process.stderr.write('受控启动失败'); process.exit(7);"
      : "process.stdout.write('其它输出\\n'); setInterval(() => {}, 1000);";
    const child = carrierTestChild(['--input-type=module', '--eval', script], exits ? 1000 : 50, 1000);
    try {
      await assert.rejects(child.ready, exits ? /就绪前退出/ : /就绪超时/);
      if (exits) {
        await assert.rejects(child.result(), /受控启动失败/);
        assert.ok(child.evidence().stdout.includes('其它输出'));
      }
    } finally { await child.stop(); }
    assert.equal(child.evidence().closed, true);
  }
});

for (const injectFailure of [false,true]) test(injectFailure ? 'Schema 29 标记失败时列与分类全部回滚' : '独立 Schema 28 原子升级到29并可重开',()=>{
  const dir=mkdtempSync(join(tmpdir(),'landi-schema29-')),path=join(dir,'isolated.sqlite');
  try {
    const initial=new SqliteWorkspaceStore(path);const planId=initial.getWorkspace().activePlan.id;initial.close();
    const db=new DatabaseSync(path);
    for(const name of ['protocol','request_byte_length','serializer_version','cancel_requested_at','running_at']) db.exec(`ALTER TABLE mah_generation_carriers DROP COLUMN ${name}`);
    db.exec('ALTER TABLE blueprint_generations DROP COLUMN carrier_cancel_requested_at');
    db.exec('DROP TABLE travel_adjustment_drafts; DROP TABLE travel_adjustment_handoffs; DROP TABLE travel_adjustment_receipts; DROP TABLE travel_episodes; DROP TABLE travel_observations; DROP TABLE travel_phases; DROP TABLE booking_mutation_receipts; DELETE FROM schema_migrations WHERE version>=29');
    if(injectFailure) db.exec("CREATE TRIGGER isolated_fail_29 BEFORE INSERT ON schema_migrations WHEN NEW.version=29 BEGIN SELECT RAISE(ABORT,'isolated_migration_failure'); END");
    db.close();
    if(injectFailure){
      assert.throws(()=>new SqliteWorkspaceStore(path),/isolated_migration_failure/);
      const failed=new DatabaseSync(path);
      assert.equal(failed.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()?.version,28);
      assert.equal(failed.prepare('PRAGMA table_info(mah_generation_carriers)').all().some(column=>column.name==='protocol'),false);
      assert.equal(failed.prepare('PRAGMA table_info(blueprint_generations)').all().some(column=>column.name==='carrier_cancel_requested_at'),false);
      failed.exec('DROP TRIGGER isolated_fail_29');failed.close();
    }
    const migrated=new SqliteWorkspaceStore(path);
    assert.equal(migrated.getDatabaseMaintenanceStatus().schemaVersion,32);
    assert.equal(migrated.getWorkspace().activePlan.id,planId);migrated.close();
    const reopened=new SqliteWorkspaceStore(path);assert.equal(reopened.getDatabaseMaintenanceStatus().schemaVersion,32);reopened.close();
  }finally{rmSync(dir,{recursive:true,force:true});}
});

for (const invalid of [false,true]) test(invalid ? '旧 sidecar 任一行无效则全部回滚并保留原文件' : '旧 sidecar 全量核验后原子迁移并清理',()=>{
  const x=setup();const sidecarPath=`${x.path}.mah-carriers.sqlite`;
  try {
    const prepared=x.prepare(x.a),request=structuredClone(prepared.request) as Record<string,unknown>;
    request.schemaVersion=1;delete request.protocol;delete request.projectRoot;
    (request.execution as Record<string,unknown>).agentPreference='mah-routing';
    (request.output as Record<string,unknown>).envelopeContract='landi.mah-generation-stage-result.v1';
    x.first.exec('DELETE FROM mah_generation_carriers; DELETE FROM schema_migrations');
    const legacy=new DatabaseSync(sidecarPath);
    legacy.exec(`CREATE TABLE mah_generation_carriers(generation_key TEXT,operation TEXT,batch_key TEXT,batch_id TEXT,attempt INTEGER,carrier_task_id TEXT,request_id TEXT,input_sha256 TEXT,request_sha256 TEXT,request_json TEXT,expected_subpath TEXT,status TEXT,result_sha256 TEXT,result_json TEXT,error_code TEXT,error_message TEXT,created_at TEXT,updated_at TEXT)`);
    const insert=legacy.prepare('INSERT INTO mah_generation_carriers VALUES(?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,NULL,NULL,?,?)');
    const raw=canonical(request);
    insert.run('generation','itinerary_draft','',null,1,prepared.carrierTaskId,prepared.requestId,prepared.inputSha256,hash(raw),raw,'artifacts/landi-stage-result.json','queued',prepared.createdAt,prepared.updatedAt);
    if(invalid) insert.run('generation','itinerary_draft','',null,2,'invalid-task-id','second-request',prepared.inputSha256,hash(raw),raw,'artifacts/other.json','queued',prepared.createdAt,prepared.updatedAt);
    legacy.close();
    if(invalid){
      assert.throws(()=>new GenerationCarrierStore(x.first,x.path),/旧 MAH/);
      assert.equal(x.first.prepare('SELECT COUNT(*) AS count FROM mah_generation_carriers').get()?.count,0);
      assert.equal(x.first.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get()?.count,0);
      assert.equal(existsSync(sidecarPath),true);
    }else{
      const migrated=new GenerationCarrierStore(x.first,x.path).getByTaskId(prepared.carrierTaskId)!;
      assert.equal(migrated.protocol,'mah_slot_v1');assert.equal(migrated.status,'queued');assert.equal(migrated.slotClass,'background');assert.equal(migrated.requestJson,raw);
      assert.equal(existsSync(sidecarPath),false);
      assert.equal(x.first.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()?.version,29);
      new GenerationCarrierStore(x.first,x.path);
    }
  }finally{x.close();}
});

test('Schema 1 与2的历史活动状态按请求完整分类，保留原身份和字节',()=>{
  for(const version of [1,2]) for(const status of ['prepared','submitting','submission_unknown','queued','running','completed','cancel_requested','cancelled','failed','scheduler_unavailable','carrier_missing','provider_route_unverified','artifact_missing','artifact_invalid']) {
    const x=setup();try{
      const mapping=x.prepare(x.a),request=structuredClone(mapping.request) as Record<string,unknown>;
      request.schemaVersion=version;delete request.protocol;delete request.projectRoot;
      const execution=request.execution as Record<string,unknown>;execution.agentPreference='mah-routing';if(version===2) execution.personalOsSlotClass='interactive';
      (request.output as Record<string,unknown>).envelopeContract='landi.mah-generation-stage-result.v1';
      const raw=canonical(request);
      x.first.prepare('UPDATE mah_generation_carriers SET protocol=?,request_json=?,request_sha256=?,request_byte_length=?,slot_class=?,status=? WHERE carrier_task_id=?').run(version===1?'mah_slot_v1':'mah_slot_v2',raw,hash(raw),Buffer.byteLength(raw),version===1?'background':'interactive',status,mapping.carrierTaskId);
      const recovered=new GenerationCarrierStore(x.first,x.path).getByTaskId(mapping.carrierTaskId)!;
      assert.equal(recovered.protocol,version===1?'mah_slot_v1':'mah_slot_v2');assert.equal(recovered.requestJson,raw);assert.equal(recovered.status,status);assert.equal(recovered.carrierTaskId,mapping.carrierTaskId);
      assert.equal(x.a.claimSubmission(mapping.carrierTaskId,hash(raw)),false);
    }finally{x.close();}
  }
});

test('双连接晚到观察及验证不能复活已拒绝或已终止候选',()=>{
  for(const terminal of ['artifact_invalid','artifact_changed','failed','cancelled']) {
    const x=setup();try {
      const mapping=x.prepare(x.a),result='{"candidate":true}';
      x.a.updateStatus(mapping.carrierTaskId,'completed');
      x.a.recordValidated({carrierTaskId:mapping.carrierTaskId,resultJson:result,resultSha256:hash(result),validatedStatus:'validated',importedStatus:'imported',changedStatus:'artifact_changed',cancelledStatuses:[]});
      x.a.updateStatus(mapping.carrierTaskId,terminal);
      for(const observed of ['queued','running','completed','validated']) assert.equal(x.b.updateStatus(mapping.carrierTaskId,observed).status,terminal);
      assert.throws(()=>x.b.recordValidated({carrierTaskId:mapping.carrierTaskId,resultJson:result,resultSha256:hash(result),validatedStatus:'validated',importedStatus:'imported',changedStatus:'artifact_changed',cancelledStatuses:[]}),/不能重新验证/);
      assert.equal(x.b.getByTaskId(mapping.carrierTaskId)?.status,terminal);
      assert.equal(x.prepare(x.b).carrierTaskId,mapping.carrierTaskId);
    }finally{x.close();}
  }
});

function prepareImageStage(store: GenerationCarrierStore, phase: string, round = 1,
  predecessors?: Array<{ carrierTaskId: string; requestSha256: string }>, placeIds = ['place']) {
  const stageIdentity = { version: 2, phase, scope: 'image-batch', round };
  const batchId = `阶段2-${hash(canonical(stageIdentity)).slice(0, 32)}`;
  const businessInput = { stageIdentity, parserContext: { placeIds }, prompt: 'real place photographs', outputSchema: { type: 'object' }, outputBusinessContract: 'landi.planned-place-image-enrichment.v1',
    ...(predecessors ? { failedImageRetry: { version: 1, targetPhase: phase, targetRound: round, predecessors } } : {}) };
  return store.prepare({ generationKey: 'generation', operation: 'planned_place_image_enrichment', batchId, inputSha256: hash(canonical(businessInput)),
    expectedSubpath: 'artifacts/landi-stage-result.json', projectRoot: '/tmp/fictional', protocol: 'mah_task_queue_v1', preparedStatus: 'prepared', retryableTerminalStatuses: [], serializeRequest: canonical, hashRequest: hash,
    createRequest: identity => ({ schemaVersion: 3, protocol: 'mah_task_queue_v1', projectRoot: '/tmp/fictional', kind: 'landi_generation_stage_request', ...identity,
      generationKey: 'generation', proposalRef: { sessionId: 'session', proposalVersion: 1 }, skillLineage: { skillId: 'skill', skillVersion: '1' }, operation: 'planned_place_image_enrichment', batchId,
      parentCheckpoint: store.getGenerationCarrierCheckpoint('generation'), input: { businessContract: 'landi.planned-place-image-enrichment-input.v1', sha256: hash(canonical(businessInput)), businessInput },
      output: { subpath: 'artifacts/landi-stage-result.json', envelopeContract: 'landi.mah-generation-stage-result.v2' }, execution: { preferredLanguage: 'en', webSearch: true, maxRuntimeSeconds: 480, capabilityRequirements: ['structured_output'] }, createdAt: '2026-11-10T00:00:00Z' }) });
}
function publicImageFailure(store: GenerationCarrierStore, mapping: ReturnType<typeof prepareImageStage>) {
  return store.updateStatus(mapping.carrierTaskId, 'failed', { code: 'mah_public_task_failed', message: canonical({ version: 1, carrierTaskId: mapping.carrierTaskId,
    projectRoot: mapping.projectRoot, requestSha256: mapping.requestSha256, taskLifecycleRevision: 5, failedAt: '2026-11-10T00:01:00Z' }) });
}

test('an explicit new image stage binds public failed predecessors and allocates only one durable task', () => {
  const x = setup(); try {
    const old = prepareImageStage(x.a, 'initial'); publicImageFailure(x.a, old);
    const predecessors = [{ carrierTaskId: old.carrierTaskId, requestSha256: old.requestSha256 }];
    const next = prepareImageStage(x.a, 'explicit-retry', 1, predecessors);
    assert.notEqual(next.carrierTaskId, old.carrierTaskId);
    assert.equal(prepareImageStage(x.b, 'explicit-retry', 1, predecessors).carrierTaskId, next.carrierTaskId);
    assert.equal(x.a.claimSubmission(next.carrierTaskId, next.requestSha256), true);
    assert.equal(x.b.claimSubmission(next.carrierTaskId, next.requestSha256), false);
    assert.equal(x.a.getByTaskId(old.carrierTaskId)?.requestJson, old.requestJson);
    assert.equal(x.a.listForGeneration('generation').length, 2);
  } finally { x.close(); }
});

for (const phase of ['automatic-background', 'initial']) test(`public image failure alone cannot authorize ${phase} round two`, () => {
  const x = setup(); try {
    const old = prepareImageStage(x.a, 'initial'); publicImageFailure(x.a, old);
    assert.throws(() => prepareImageStage(x.a, phase, 2), { code: 'mah_stage_predecessor_pending' });
    assert.equal(prepareImageStage(x.a, 'initial').carrierTaskId, old.carrierTaskId);
    assert.equal(x.a.listForGeneration('generation').length, 1);
  } finally { x.close(); }
});

for (const fault of ['ordinary-failure', 'wrong-sha', 'cancelled', 'unresolved', 'changed-proof', 'unbound-sibling'] as const) test(`explicit image retry rejects ${fault}`, () => {
  const x = setup(); try {
    const old = prepareImageStage(x.a, 'initial');
    if (fault !== 'unresolved') publicImageFailure(x.a, old);
    if (fault === 'ordinary-failure') x.a.updateStatus(old.carrierTaskId, 'failed', { code: 'process_failed', message: 'no authoritative task status' });
    if (fault === 'cancelled') x.a.updateStatus(old.carrierTaskId, 'cancel_requested');
    if (fault === 'changed-proof') x.a.updateStatus(old.carrierTaskId, 'failed', { code: 'mah_public_task_failed', message: canonical({ version: 1, carrierTaskId: old.carrierTaskId, projectRoot: '/tmp/other', requestSha256: old.requestSha256, taskLifecycleRevision: 5, failedAt: '2026-11-10T00:01:00Z' }) });
    if (fault === 'unbound-sibling') {
      const sibling = prepareImageStage(x.a, 'sibling', 1, undefined, ['other-place']); publicImageFailure(x.a, sibling);
    }
    const bindings = [{ carrierTaskId: old.carrierTaskId, requestSha256: fault === 'wrong-sha' ? '0'.repeat(64) : old.requestSha256 }];
    assert.throws(() => prepareImageStage(x.a, 'explicit-retry', 1, bindings, fault === 'unbound-sibling' ? ['place', 'other-place'] : ['place']),
      { code: fault === 'unbound-sibling' ? 'mah_stage_predecessor_pending' : 'mah_image_retry_invalid' });
  } finally { x.close(); }
});


test('explicit retry cannot replace the same frozen image stage or change its failure history', () => {
  const x = setup(); try {
    const old = prepareImageStage(x.a, 'initial'); publicImageFailure(x.a, old);
    assert.throws(() => prepareImageStage(x.a, 'initial', 1, [{ carrierTaskId: old.carrierTaskId, requestSha256: old.requestSha256 }]), { code: 'mah_request_conflict' });
    assert.equal(x.a.listForGeneration('generation').length, 1);
    assert.equal(x.a.getByTaskId(old.carrierTaskId)?.requestJson, old.requestJson);
  } finally { x.close(); }
});
