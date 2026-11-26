import { SqliteWorkspaceStore } from '../../packages/storage/lib/index.js';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';

// 全部数据仅供隔离开发，不代表真实旅行者或公共 MAH 就绪证据。
export function initializePlanningContinuityFixture(databasePath) {
  const store = new SqliteWorkspaceStore(databasePath);
  try {
    store.updateProfile({ displayName: '虚构验收旅人', preferredLanguage: 'en', nationality: '未知', gender: 'prefer_not_to_say', immigrationStatus: 'unknown', travelPreferences: '仅供隔离开发的虚构旅行偏好' });
    return store.getWorkspace();
  } finally { store.close(); }
}

export function changePlanningContinuitySession(databasePath, { sessionId, status, create = false, advanceProposalVersion = false }) {
  if (status === 'missing') return null; // 不创建、删除或复活任何会话；使用不存在的虚构ID查询。
  if (!['collecting', 'proposal_ready', 'proposal_confirmed', 'generating', 'draft_ready', 'abandoned'].includes(status)) throw Error('无效虚构会话状态。');
  const store = new SqliteWorkspaceStore(databasePath);
  try {
    const session = create ? store.createPlanningSession('travel') : store.getPlanningSessionById(sessionId);
    if (!session) throw Error('虚构会话不存在。');
    const proposal = { version: (session.proposal?.version ?? 0) + (advanceProposalVersion ? 1 : 0) || 1, title: '虚构规划提案', objective: '隔离开发验收', theme: '虚构旅行', segments: ['虚构海湾'], skeleton: [], tradeoffs: [], assumptions: ['仅供虚构验收'], decisionPoints: [] };
    const updatedAt = new Date().toISOString();
    const facts = Object.entries({ destination: '虚构海湾', purpose: '虚构文化与饮食体验，仅供开发验收', travel_dates: '2026-12-01 至 2026-12-02', arrival: '十二月一日上午十点到达虚构海湾车站', departure: '十二月二日下午六点从虚构海湾车站离开', party_size: '2人', transport_preference: '步行与公共交通' }).map(([key, value]) => session.facts.find(fact => fact.key === key && fact.value === value && fact.source === 'user' && fact.confirmed) ?? { key, value, source: 'user', confirmed: true, updatedAt });
    // 只关联既有虚构结果，不创建生成、导入或执行证明，不修改 Plan 本身。
    const outputPlanId = status === 'draft_ready' ? store.getWorkspace().activePlan?.id : undefined;
    if (status === 'draft_ready' && !outputPlanId) throw Error('隔离库没有可读取的虚构计划。');
    const { confirmedProposalVersion: _confirmation, outputPlanId: _output, ...base } = session;
    return store.savePlanningSession({ ...base, status, ...(status !== 'collecting' || advanceProposalVersion ? { proposal, facts, unresolved: [], deferred: [] } : {}), ...(['proposal_confirmed', 'generating', 'draft_ready'].includes(status) ? { confirmedProposalVersion: proposal.version } : {}), ...(outputPlanId ? { outputPlanId } : {}), updatedAt });
  } finally { store.close(); }
}

export function readPlanningContinuitySnapshot(databasePath) {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const tables = ['planning_sessions', 'planning_session_revisions', 'planning_message_receipts', 'agent_work', 'mah_generation_carriers', 'plans', 'trip_blueprints'];
    const present = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
    const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
    const tableDigests = Object.fromEntries([...present].sort().map(table => {
      const quoted = '"' + table.replaceAll('"', '""') + '"';
      const rows = database.prepare(`SELECT * FROM ${quoted}`).all().map(row => JSON.stringify(row)).sort();
      return [table, { rows: rows.length, sha256: digest(rows) }];
    }));
    return {
      tableDigests,
      schemaSha256: digest(database.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').all()),
      counts: Object.fromEntries(tables.filter(table => present.has(table)).map(table => [table, Number(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count)])),
      sessions: database.prepare('SELECT id,status,messages_json,proposal_json,confirmed_proposal_version,output_plan_id FROM planning_sessions ORDER BY id').all().map(({ messages_json, proposal_json, ...row }) => ({ ...row, messages: JSON.parse(messages_json), proposal: proposal_json ? JSON.parse(proposal_json) : null })),
      revisions: database.prepare('SELECT * FROM planning_session_revisions ORDER BY session_id').all().map(row => ({ ...row })),
      receipts: database.prepare('SELECT * FROM planning_message_receipts ORDER BY message_id').all().map(row => ({ ...row })),
    };
  } finally { database.close(); }
}
