import { useEffect, useRef, useState } from "react";
import type { RuntimeCheck } from "@c-assistant/agent-adapters";
import type { AgentRuntimeKind, Plan, Profile, ProfileGender, ImmigrationStatus, Task, WorkspaceSnapshot } from "@c-assistant/core";
import landiLogoUrl from "../../../assets/branding/landi-round-otter-earth-icon-final.png";
import "./styles.css";

type View = "plans" | "settings";
type PlanTab = "current" | "history";
type ComposerMode = "new_plan" | "revise_plan";
type ChatMessage = { id: string; role: "assistant" | "user"; text: string };
type LocalConfiguration = {
  amap: { configured: boolean };
  qweather: { configured: boolean; host: string };
  telegram: { configured: boolean };
};
type LocalConfigurationForm = { amapApiKey: string; qweatherApiKey: string; qweatherApiHost: string; telegramBotToken: string };
type TestState = { status: "idle" | "testing" | "success" | "error"; message: string };
type RecognitionResultEvent = { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> };
type RecognitionErrorEvent = { error: string };
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: RecognitionResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
type SpeechRecognitionWindow = Window & {
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
};

const idleTest = (): TestState => ({ status: "idle", message: "尚未测试" });

export default function App() {
  const [view, setView] = useState<View>("plans");
  const [planTab, setPlanTab] = useState<PlanTab>("current");
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot | null>(null);
  const [history, setHistory] = useState<Plan[]>([]);
  const [configuration, setConfiguration] = useState<LocalConfiguration | null>(null);
  const [runtimeChecks, setRuntimeChecks] = useState<RuntimeCheck[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [composerMode, setComposerMode] = useState<ComposerMode>("new_plan");
  const [composerOpen, setComposerOpen] = useState(false);
  const [confirmingPlan, setConfirmingPlan] = useState(false);

  async function loadWorkspace() {
    const response = await fetch("/api/workspace");
    if (!response.ok) throw new Error("核心服务没有返回工作台数据。");
    setWorkspace(await response.json() as WorkspaceSnapshot);
  }

  async function loadHistory() {
    const response = await fetch("/api/plans/history");
    if (response.ok) setHistory(await response.json() as Plan[]);
  }

  async function loadSettings() {
    const [configurationResponse, runtimeResponse] = await Promise.all([fetch("/api/configuration"), fetch("/api/runtimes")]);
    if (configurationResponse.ok) setConfiguration(await configurationResponse.json() as LocalConfiguration);
    if (runtimeResponse.ok) setRuntimeChecks(await runtimeResponse.json() as RuntimeCheck[]);
  }

  useEffect(() => {
    void Promise.all([loadWorkspace(), loadHistory(), loadSettings()])
      .catch((caught) => setError(caught instanceof Error ? caught.message : "工作台加载失败。"))
      .finally(() => setLoading(false));
  }, []);

  function openComposer(mode: ComposerMode) {
    setComposerMode(mode);
    setComposerOpen(true);
  }

  async function handlePlanCreated(next: WorkspaceSnapshot) {
    setWorkspace(next);
    await loadHistory();
    setView("plans");
    setPlanTab("current");
  }

  async function deleteHistoricalPlan(plan: Plan) {
    if (!window.confirm(`确定删除历史计划“${plan.title}”吗？删除后无法恢复。`)) return;
    try {
      const response = await fetch(`/api/plans/${encodeURIComponent(plan.id)}/history`, { method: "DELETE" });
      if (!response.ok) throw new Error((await response.json() as { error?: string }).error ?? "历史计划删除失败。");
      setHistory((current) => current.filter((item) => item.id !== plan.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "历史计划删除失败。");
    }
  }

  async function togglePlanTask(planId: string, taskId: string, checked: boolean) {
    try {
      const response = await fetch(`/api/plans/${encodeURIComponent(planId)}/tasks/${encodeURIComponent(taskId)}/check`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ checked }) });
      const payload = await response.json() as WorkspaceSnapshot & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "清单状态保存失败。");
      setWorkspace(payload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "清单状态保存失败。");
    }
  }

  async function confirmCurrentPlan(planId: string) {
    try {
      setConfirmingPlan(true);
      const response = await fetch(`/api/plans/${encodeURIComponent(planId)}/confirm`, { method: "POST" });
      const payload = await response.json() as WorkspaceSnapshot & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "计划确认失败。");
      setWorkspace(payload);
      await loadHistory();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "计划确认失败。");
    } finally {
      setConfirmingPlan(false);
    }
  }

  if (loading) return <main className="loading-screen"><span />正在加载 Landi…</main>;
  if (!workspace) return <main className="loading-screen error-screen">{error ?? "暂时无法打开工作台。"}</main>;

  const currentPlan = isStarterPlan(workspace.activePlan) ? null : workspace.activePlan;
  const visibleHistory = history.filter((plan) => !isStarterPlan(plan));

  return <main className="app-shell">
    <section className="main-stage">
      <header className="global-header">
        <button className="top-brand" onClick={() => setView("plans")} aria-label="返回当前计划"><img src={landiLogoUrl} alt="" /><strong>Landi</strong></button>
        <div className="header-actions">
          <button className="new-plan-button" onClick={() => openComposer("new_plan")}><span>＋</span>制定计划</button>
          <button className={view === "settings" ? "settings-button active" : "settings-button"} onClick={() => setView(view === "settings" ? "plans" : "settings")} aria-label={view === "settings" ? "返回当前计划" : "打开设置"} title={view === "settings" ? "返回当前计划" : "设置"}>⚙</button>
        </div>
      </header>
      {error ? <div className="inline-alert">{error}<button onClick={() => setError(null)}>关闭</button></div> : null}
      {view === "plans" ? <PlansWorkspace currentPlan={currentPlan} executionPlan={workspace.executionPlan ?? null} history={visibleHistory} tab={planTab} confirming={confirmingPlan} onTab={setPlanTab} onCreate={() => openComposer("new_plan")} onRevise={() => openComposer("revise_plan")} onDelete={deleteHistoricalPlan} onTaskToggle={togglePlanTask} onConfirm={confirmCurrentPlan} /> : null}
      {view === "settings" ? <SettingsWorkspace workspace={workspace} configuration={configuration} checks={runtimeChecks} onWorkspace={setWorkspace} onConfiguration={setConfiguration} onChecks={setRuntimeChecks} onError={setError} /> : null}
    </section>
    {composerOpen ? <ComposerDialog mode={composerMode} currentPlan={currentPlan} onClose={() => setComposerOpen(false)} onPlanCreated={async (next) => { await handlePlanCreated(next); setComposerOpen(false); }} onError={setError} /> : null}
  </main>;
}

function PlansWorkspace({ currentPlan, executionPlan, history, tab, confirming, onTab, onCreate, onRevise, onDelete, onTaskToggle, onConfirm }: { currentPlan: Plan | null; executionPlan: Plan | null; history: Plan[]; tab: PlanTab; confirming: boolean; onTab: (tab: PlanTab) => void; onCreate: () => void; onRevise: () => void; onDelete: (plan: Plan) => Promise<void>; onTaskToggle: (planId: string, taskId: string, checked: boolean) => Promise<void>; onConfirm: (planId: string) => Promise<void> }) {
  return <div className="page-stack">
    <div className="segmented-tabs" role="tablist" aria-label="计划类型"><button className={tab === "current" ? "active" : ""} onClick={() => onTab("current")}>当前计划</button><button className={tab === "history" ? "active" : ""} onClick={() => onTab("history")}>历史计划 <span>{history.length}</span></button></div>
    {tab === "current" && executionPlan ? <ExecutionPlanNotice plan={executionPlan} /> : null}
    {tab === "current" ? currentPlan ? <CurrentPlan plan={currentPlan} onRevise={onRevise} onTaskToggle={onTaskToggle} onConfirm={onConfirm} confirming={confirming} /> : <EmptyPlan onCreate={onCreate} /> : <HistoricalPlans plans={history} onDelete={onDelete} />}
  </div>;
}

function ExecutionPlanNotice({ plan }: { plan: Plan }) {
  return <section className="execution-plan-notice"><div><span>执行中的计划</span><strong>{plan.title}</strong><p>提醒和行程时间线仍按这份计划运行。只有确认下方完整替代草稿后，Landi 才会切换执行计划。</p></div><em>运行中</em></section>;
}

function EmptyPlan({ onCreate }: { onCreate: () => void }) {
  return <section className="empty-plan"><span>✦</span><h2>从一个想法开始你的中国计划</h2><p>告诉 Landi 目的地、日期、核心目标、优先级和预算，AI 会整理成一份完整方案。</p><button className="primary-action" onClick={onCreate}>制定计划</button></section>;
}

function CurrentPlan({ plan, onRevise, onTaskToggle, onConfirm, confirming }: { plan: Plan; onRevise: () => void; onTaskToggle: (planId: string, taskId: string, checked: boolean) => Promise<void>; onConfirm: (planId: string) => Promise<void>; confirming: boolean }) {
  return <article className="current-plan-card">
    <header className="plan-hero"><div><span className={`plan-status ${plan.status}`}>{plan.status === "draft" ? "待确认草稿" : "执行中"}</span><h2>{plan.title}</h2><div className="plan-meta"><span>⌖ {plan.location}</span><span>◷ {plan.dates}</span></div></div></header>
    <section className="plan-sections">{plan.stages.map((stage, index) => <PlanContentSection key={stage.id} plan={plan} stage={stage} index={index} onTaskToggle={onTaskToggle} />)}</section>
    <section className="plan-evidence"><div className="section-title"><p>官方证据</p><span>直接关联到计划内容</span></div>{plan.sources.length ? <div className="evidence-list">{plan.sources.map((source) => <a href={source.url} target="_blank" rel="noreferrer" key={`${source.url}-${source.retrievedAt}`}><span>官方</span><div><strong>{source.title}</strong><small>{source.authority} · {source.retrievedAt}</small></div><b>↗</b></a>)}</div> : <div className="evidence-empty">暂无官方证据</div>}</section>
    <footer className="plan-footer"><div><strong>{plan.status === "draft" ? "确认完整计划" : "需要调整吗？"}</strong><span>{plan.status === "draft" ? "确认后才会启用提醒和执行；若已有计划正在运行，它会在此时进入历史计划。" : "修改会先生成完整替代草稿；当前计划继续运行到你确认替代草稿。"}</span></div><div className="plan-footer-actions"><button className="secondary-action" onClick={onRevise}>修改当前计划</button>{plan.status === "draft" ? <button className="primary-action" disabled={confirming} onClick={() => void onConfirm(plan.id)}>{confirming ? "确认中…" : "确认并启用计划"}</button> : null}</div></footer>
  </article>;
}

function PlanContentSection({ plan, stage, index, onTaskToggle }: { plan: Plan; stage: Plan["stages"][number]; index: number; onTaskToggle: (planId: string, taskId: string, checked: boolean) => Promise<void> }) {
  const kind = sectionKind(stage.title);
  return <section className={`plan-content-section ${kind}`}><header><div><span>{String(index + 1).padStart(2, "0")}</span><h3>{stage.title}</h3></div><small>{stage.tasks.length} 项</small></header><p>{stage.description}</p>{kind === "itinerary" ? <ItineraryView tasks={stage.tasks} /> : kind === "reservations" ? <ReservationView stageTitle={stage.title} tasks={stage.tasks} onToggle={(task, checked) => onTaskToggle(plan.id, task.id, checked)} /> : kind === "budget" ? <BudgetView tasks={stage.tasks} /> : kind === "transport" ? <TransportView tasks={stage.tasks} /> : kind === "overview" ? <OverviewView tasks={stage.tasks} /> : <ChecklistView plan={plan} stageTitle={stage.title} tasks={stage.tasks} onToggle={(task, checked) => onTaskToggle(plan.id, task.id, checked)} />}</section>;
}

function OverviewView({ tasks }: { tasks: Task[] }) {
  return <div className="overview-grid">{tasks.map((task) => <article key={task.id}><span>{task.dueLabel}</span><strong>{task.title}</strong>{task.description ? <p>{task.description}</p> : null}</article>)}</div>;
}

function ItineraryView({ tasks }: { tasks: Task[] }) {
  return <div className="journey-timeline">{tasks.map((task, index) => <article key={task.id}><div className="journey-marker"><span>{index + 1}</span></div><div><time>{task.dueLabel}</time><strong>{task.title}</strong>{task.description ? <p>{task.description}</p> : null}{task.reminder ? <em>已设置提醒</em> : null}</div></article>)}</div>;
}

function ReservationView({ stageTitle, tasks, onToggle }: { stageTitle: string; tasks: Task[]; onToggle: (task: Task, checked: boolean) => Promise<void> }) {
  return <div className="reservation-table">{tasks.map((task) => { const checkable = isPreDepartureChecklistTask(task, stageTitle); return <div key={task.id}>{checkable ? <input type="checkbox" checked={task.status === "completed"} onChange={(event) => void onToggle(task, event.target.checked)} aria-label={`完成 ${task.title}`} /> : <span className={`task-state ${task.status}`} />}<div><strong>{task.title}</strong><small>{task.description ?? "记录订单号、当地时间、地址和退改规则"}</small></div><span>{task.dueLabel}</span></div>; })}</div>;
}

function BudgetView({ tasks }: { tasks: Task[] }) {
  return <div className="budget-grid">{tasks.map((task) => <article key={task.id}><span>预算项目</span><strong>{task.title}</strong><small>{task.dueLabel}</small></article>)}</div>;
}

function TransportView({ tasks }: { tasks: Task[] }) {
  return <div className="transport-grid">{tasks.map((task) => <article key={task.id}><span>⇢</span><div><strong>{task.title}</strong><small>{task.description ?? task.dueLabel}</small>{task.description ? <em>{task.dueLabel}</em> : null}</div></article>)}</div>;
}

function ChecklistView({ plan, stageTitle, tasks, onToggle }: { plan: Plan; stageTitle: string; tasks: Task[]; onToggle: (task: Task, checked: boolean) => Promise<void> }) {
  return <div className="preparation-checklist">{tasks.map((task) => { const download = appDownload(task, plan.sources); const checkable = isPreDepartureChecklistTask(task, stageTitle); const checked = checkable && task.status === "completed"; return <div className={checked ? "checked" : ""} key={task.id}>{checkable ? <input type="checkbox" checked={checked} onChange={(event) => void onToggle(task, event.target.checked)} aria-label={`完成 ${task.title}`} /> : <span className={`task-state ${task.status}`} />}<div><strong>{task.title}</strong>{task.description ? <small>{task.description}</small> : null}<small>{task.dueLabel}</small></div>{download ? <a className="download-action" href={download.url} target="_blank" rel="noreferrer">{download.label} ↗</a> : null}</div>; })}</div>;
}

function sectionKind(title: string): "overview" | "itinerary" | "reservations" | "budget" | "transport" | "checklist" {
  const value = title.toLocaleLowerCase();
  if (/每日行程|daily itinerary|day.by.day/.test(value)) return "itinerary";
  if (/总行程|trip overview|journey overview/.test(value)) return "overview";
  if (/预订|reservation|booking/.test(value)) return "reservations";
  if (/预算|budget|cost/.test(value)) return "budget";
  if (/交通方案|transport plan|transportation plan/.test(value)) return "transport";
  return "checklist";
}

function isPreDepartureChecklistTask(task: Pick<Task, "title" | "description" | "owner" | "dueLabel">, stageTitle = ""): boolean {
  if (task.owner !== "user") return false;
  const titleAndDetail = `${task.title} ${task.description ?? ""}`.toLocaleLowerCase();
  const due = task.dueLabel.trim().toLocaleLowerCase();
  const stage = stageTitle.toLocaleLowerCase();
  if (/\b(pack|packing|bring|carry|luggage|baggage|clothing|medicine|medication|charger|adapter)\b|携带|打包|行李|物品清单|衣物|药品|充电器|转换插头/.test(titleAndDetail)) return true;
  if (/before (departure|departing|arrival|travel|the trip|leaving home)|prior to (departure|travel|the trip)|出发前|行前|出行前|启程前|抵达前|到达前/.test(due)) return true;
  if (!/^(before|prior to)\b|^(在)?.+(前|之前)$/.test(due)) return false;
  if (/每日行程|daily itinerary|itinerary|arriv|arrival|exhibition|展会|抵达|到达/.test(stage) || /airport|hotel check-in|first exhibition|final exhibition|leaving the airport|机场|入住|展会/.test(due)) return false;
  return /准备|行前|清单|预订|应急资料|prepar|essential|checklist|reservation|booking|document/.test(stage);
}

function appDownload(task: Task, sources: Plan["sources"]): { label: string; url: string } | null {
  const title = `${task.title} ${task.description ?? ""}`.toLocaleLowerCase();
  const definitions = [
    { pattern: /wechat|微信/, source: /wechat|微信/i, label: "下载 WeChat", fallback: "https://www.wechat.com/" },
    { pattern: /amap|高德/, source: /amap|高德/i, label: "下载高德地图", fallback: "https://mobile.amap.com/" },
    { pattern: /alipay|支付宝/, source: /alipay|支付宝/i, label: "下载支付宝", fallback: "https://www.alipay.com/" },
    { pattern: /china mobile|中国移动/, source: /china mobile|中国移动/i, label: "查看中国移动", fallback: "https://www.10086.cn/" }
  ];
  const matched = definitions.find((item) => item.pattern.test(title));
  if (!matched) return null;
  const officialSource = sources.find((source) => matched.source.test(`${source.title} ${source.authority}`));
  return { label: matched.label, url: officialSource?.url ?? matched.fallback };
}

function HistoricalPlans({ plans, onDelete }: { plans: Plan[]; onDelete: (plan: Plan) => Promise<void> }) {
  if (!plans.length) return <section className="history-empty"><span>◴</span><h2>还没有历史计划</h2><p>完整替代草稿确认后，之前执行的计划会显示在这里。</p></section>;
  return <section className="history-grid">{plans.map((plan) => <details className="history-card" key={plan.id}><summary><div><h2>{plan.title}</h2><p>{plan.location} · {plan.dates}</p></div><div className="history-card-actions"><time>{formatDate(plan.createdAt)}</time><button type="button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); void onDelete(plan); }}>删除</button></div></summary><div className="history-details"><p>{plan.nextAction}</p><div>{plan.stages.map((stage, index) => <span key={stage.id}>{index + 1}. {stage.title}</span>)}</div></div></details>)}</section>;
}

function ComposerDialog({ mode, currentPlan, onClose, onPlanCreated, onError }: { mode: ComposerMode; currentPlan: Plan | null; onClose: () => void; onPlanCreated: (workspace: WorkspaceSnapshot) => Promise<void>; onError: (message: string) => void }) {
  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); }; window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close); }, [onClose]);
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="composer-dialog" role="dialog" aria-modal="true" aria-labelledby="composer-title"><header><h2 id="composer-title">{mode === "new_plan" ? "告诉 Landi 你的新目标" : `想怎样调整“${currentPlan?.title ?? "当前计划"}”？`}</h2><button className="close-button" onClick={onClose} aria-label="关闭">×</button></header><p>{mode === "new_plan" ? "新计划会先成为待确认草稿；当前计划继续运行，直到你确认完整新计划。" : "修改会生成完整替代草稿；确认前不会中断当前计划。"}</p><PlanComposer mode={mode} onPlanCreated={onPlanCreated} onError={onError} /></section></div>;
}

function PlanComposer({ mode, onPlanCreated, onError }: { mode: ComposerMode; onPlanCreated: (workspace: WorkspaceSnapshot) => Promise<void>; onError: (message: string) => void }) {
  const welcome = mode === "new_plan" ? "你好。请告诉我目的地和日期、旅行的核心目标、事项优先级、预算与固定活动；信息不确定也可以，我会先标出需要确认的部分。" : "告诉我当前计划哪里需要修改，我会保留有效信息并重新整理完整计划。";
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([{ id: "welcome", role: "assistant", text: welcome }]);
  const [permissionOpen, setPermissionOpen] = useState(false);
  const [permissionBusy, setPermissionBusy] = useState(false);
  const [permissionMessage, setPermissionMessage] = useState("");
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const voiceBaseRef = useRef("");
  const voiceEnabled = localStorage.getItem("landi.voice") !== "off";

  function cancelVoice() { const recognition = recognitionRef.current; if (!recognition) return; recognition.onresult = null; recognition.onend = null; recognition.onerror = null; recognition.abort(); recognitionRef.current = null; }
  useEffect(() => { cancelVoice(); setListening(false); setInput(""); setMessages([{ id: crypto.randomUUID(), role: "assistant", text: welcome }]); }, [mode]);
  useEffect(() => () => cancelVoice(), []);

  function startVoice() {
    const speechWindow = window as SpeechRecognitionWindow;
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Recognition) { onError("当前浏览器不支持语音转文字，请使用文字输入。"); return; }
    const recognition = new Recognition();
    recognition.lang = "zh-CN"; recognition.interimResults = true; recognition.continuous = true; voiceBaseRef.current = input;
    recognition.onresult = (event) => { let transcript = ""; for (let index = 0; index < event.results.length; index += 1) transcript += event.results[index]?.[0]?.transcript ?? ""; const base = voiceBaseRef.current; setInput(`${base}${base && transcript && !/[\s\n]$/.test(base) ? " " : ""}${transcript}`.slice(0, 1500)); };
    recognition.onend = () => { if (recognitionRef.current === recognition) recognitionRef.current = null; setListening(false); };
    recognition.onerror = (event) => { if (recognitionRef.current === recognition) recognitionRef.current = null; setListening(false); if (event.error === "aborted") return; if (event.error === "not-allowed" || event.error === "service-not-allowed") { setPermissionMessage(""); setPermissionOpen(true); return; } onError(event.error === "audio-capture" ? "没有检测到可用的麦克风。" : event.error === "no-speech" ? "没有检测到语音，请重试。" : "语音识别失败，请重试或使用文字输入。"); };
    recognitionRef.current = recognition;
    try { recognition.start(); setListening(true); } catch { recognitionRef.current = null; setPermissionOpen(true); }
  }

  async function toggleVoice() {
    if (listening) { recognitionRef.current?.stop(); setListening(false); return; }
    try { if (navigator.permissions && (await navigator.permissions.query({ name: "microphone" as PermissionName })).state === "denied") { setPermissionOpen(true); return; } } catch { /* Unsupported permission query; recognition will request access. */ }
    startVoice();
  }

  async function requestPermission() {
    setPermissionBusy(true); setPermissionMessage("");
    try { if (!navigator.mediaDevices?.getUserMedia) throw new Error("unsupported"); const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); stream.getTracks().forEach((track) => track.stop()); setPermissionOpen(false); startVoice(); }
    catch { setPermissionMessage("浏览器没有授予权限。请点击地址栏左侧的网站权限图标，将麦克风改为“允许”后再试。"); }
    finally { setPermissionBusy(false); }
  }

  async function send() {
    const message = input.trim(); if (!message || busy) return;
    if (listening) { recognitionRef.current?.stop(); setListening(false); }
    setMessages((current) => [...current, { id: crypto.randomUUID(), role: "user", text: message }]); setInput(""); setBusy(true);
    try { const response = await fetch("/api/agent/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode, message }) }); const payload = await response.json() as { reply?: string; workspace?: WorkspaceSnapshot; error?: string }; if (!response.ok || !payload.workspace) throw new Error(payload.error ?? "Landi 暂时无法生成计划。"); setMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", text: payload.reply ?? "计划已经准备好了。" }]); await onPlanCreated(payload.workspace); }
    catch (caught) { const messageText = caught instanceof Error ? caught.message : "Landi 暂时无法响应。"; setMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", text: messageText }]); onError(messageText); }
    finally { setBusy(false); }
  }

  return <div className="plan-composer"><div className="conversation" aria-live="polite">{messages.map((message) => <div className={`chat-bubble ${message.role}`} key={message.id}><span>{message.role === "assistant" ? "Landi" : "你"}</span><p>{message.text}</p></div>)}{busy ? <div className="chat-bubble assistant thinking"><span>Landi</span><p><i /><i /><i /></p></div> : null}</div><div className={`chat-input ${listening ? "listening" : ""}`}><textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder={listening ? "正在聆听…" : mode === "new_plan" ? "描述你的新计划…" : "告诉 Landi 需要修改什么…"} rows={2} maxLength={1500} disabled={busy} /><div className="composer-actions"><span>{input.length}/1500</span>{voiceEnabled ? <button className={listening ? "voice-button active" : "voice-button"} onClick={() => void toggleVoice()} type="button"><b>●</b>{listening ? "停止" : "语音"}</button> : null}<button className="send-button" onClick={() => void send()} disabled={busy || !input.trim()} aria-label="发送">↑</button></div></div>{permissionOpen ? <div className="permission-backdrop"><section className="permission-dialog" role="alertdialog" aria-modal="true" aria-labelledby="permission-title"><span>●</span><h3 id="permission-title">麦克风权限未开启</h3><p>开启后即可使用语音输入。点击下方按钮，浏览器会显示麦克风授权窗口。</p>{permissionMessage ? <small>{permissionMessage}</small> : null}<div><button className="permission-cancel" onClick={() => setPermissionOpen(false)}>稍后</button><button className="permission-primary" onClick={() => void requestPermission()} disabled={permissionBusy}>{permissionBusy ? "正在打开…" : "开启麦克风权限"}</button></div></section></div> : null}</div>;
}

function SettingsWorkspace({ workspace, configuration, checks, onWorkspace, onConfiguration, onChecks, onError }: { workspace: WorkspaceSnapshot; configuration: LocalConfiguration | null; checks: RuntimeCheck[]; onWorkspace: (workspace: WorkspaceSnapshot) => void; onConfiguration: (configuration: LocalConfiguration) => void; onChecks: (checks: RuntimeCheck[]) => void; onError: (message: string) => void }) {
  return <div className="settings-stack"><ProfileSettings profile={workspace.profile} onSaved={onWorkspace} onError={onError} /><ApiSettings configuration={configuration} onSaved={onConfiguration} onError={onError} /><RuntimeSettings selected={workspace.runtime.selectedKind} checks={checks} onSaved={onWorkspace} onChecks={onChecks} onError={onError} /><PreferenceSettings /></div>;
}

function ProfileSettings({ profile: initial, onSaved, onError }: { profile: Profile; onSaved: (workspace: WorkspaceSnapshot) => void; onError: (message: string) => void }) {
  const [profile, setProfile] = useState(initial); const [saving, setSaving] = useState(false);
  async function save() { setSaving(true); try { const response = await fetch("/api/profile", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(profile) }); const payload = await response.json() as WorkspaceSnapshot & { error?: string }; if (!response.ok) throw new Error(payload.error ?? "基础信息保存失败。"); onSaved(payload); } catch (caught) { onError(caught instanceof Error ? caught.message : "基础信息保存失败。"); } finally { setSaving(false); } }
  return <section className="settings-card"><header><span>01</span><div><p>基础信息</p><h2>个人资料</h2></div></header><div className="settings-form"><label>称呼<input value={profile.displayName} onChange={(event) => setProfile({ ...profile, displayName: event.target.value })} /></label><label>偏好语言<input value={profile.preferredLanguage} onChange={(event) => setProfile({ ...profile, preferredLanguage: event.target.value })} /></label><label>国籍<input value={profile.nationality} onChange={(event) => setProfile({ ...profile, nationality: event.target.value })} /></label><label>性别<select value={profile.gender} onChange={(event) => setProfile({ ...profile, gender: event.target.value as ProfileGender })}><option value="not_specified">暂不填写</option><option value="woman">女性</option><option value="man">男性</option><option value="nonbinary">非二元</option><option value="prefer_not_to_say">不愿透露</option></select></label><label>入境或居留身份<select value={profile.immigrationStatus} onChange={(event) => setProfile({ ...profile, immigrationStatus: event.target.value as ImmigrationStatus })}><option value="unknown">待确认</option><option value="short_term_visitor">短期访客</option><option value="tourist_visa">旅游签证</option><option value="student_visa">学生签证</option><option value="work_visa">工作签证</option><option value="residence_permit">居留许可</option><option value="other">其他</option></select></label><button className="save-button" onClick={() => void save()} disabled={saving}>{saving ? "保存中…" : "保存基础信息"}</button></div></section>;
}

function ApiSettings({ configuration, onSaved, onError }: { configuration: LocalConfiguration | null; onSaved: (configuration: LocalConfiguration) => void; onError: (message: string) => void }) {
  const [form, setForm] = useState<LocalConfigurationForm>({ amapApiKey: "", qweatherApiKey: "", qweatherApiHost: configuration?.qweather.host ?? "", telegramBotToken: "" });
  const [saving, setSaving] = useState(false); const [tests, setTests] = useState<Record<"amap" | "qweather" | "telegram", TestState>>({ amap: idleTest(), qweather: idleTest(), telegram: idleTest() });
  async function save() { setSaving(true); try { const response = await fetch("/api/configuration", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(form) }); const payload = await response.json() as LocalConfiguration & { error?: string }; if (!response.ok) throw new Error(payload.error ?? "API 配置保存失败。"); onSaved(payload); setForm({ amapApiKey: "", qweatherApiKey: "", qweatherApiHost: payload.qweather.host, telegramBotToken: "" }); } catch (caught) { onError(caught instanceof Error ? caught.message : "API 配置保存失败。"); } finally { setSaving(false); } }
  async function test(kind: "amap" | "qweather" | "telegram") { setTests((current) => ({ ...current, [kind]: { status: "testing", message: "正在连接…" } })); try { const request = kind === "amap" ? fetch("/api/amap/places?query=上海市人民广场") : kind === "qweather" ? fetch("/api/weather?location=上海&language=zh") : fetch("/api/connectors/telegram/verify", { method: "POST" }); const response = await request; const payload = await response.json() as { status?: string; failure?: { message?: string }; error?: string }; if (!response.ok || payload.status === "unavailable" || payload.status === "misconfigured") throw new Error(payload.error ?? payload.failure?.message ?? "连接失败"); setTests((current) => ({ ...current, [kind]: { status: "success", message: "连接成功，可以使用" } })); } catch (caught) { setTests((current) => ({ ...current, [kind]: { status: "error", message: caught instanceof Error ? caught.message : "连接失败" } })); } }
  const service = (kind: "amap" | "qweather" | "telegram", name: string, configured: boolean) => <div className="service-test-row"><div><strong>{name}</strong><span className={`test-result ${tests[kind].status}`}>{configured ? tests[kind].message : "请先填写并保存配置"}</span></div><button onClick={() => void test(kind)} disabled={!configured || tests[kind].status === "testing"}>测试连接</button></div>;
  return <section className="settings-card"><header><span>02</span><div><p>服务连接</p><h2>API 配置</h2></div></header><p className="settings-description">密钥保存在本机环境中。保存后请逐项测试，确认服务可用。</p><div className="settings-form"><label><span>高德地图 API Key <em>{configuration?.amap.configured ? "已配置" : "未配置"}</em></span><input type="password" value={form.amapApiKey} onChange={(event) => setForm({ ...form, amapApiKey: event.target.value })} /></label><label><span>QWeather API Key <em>{configuration?.qweather.configured ? "已配置" : "未配置"}</em></span><input type="password" value={form.qweatherApiKey} onChange={(event) => setForm({ ...form, qweatherApiKey: event.target.value })} /></label><label><span>QWeather API Host</span><input value={form.qweatherApiHost} onChange={(event) => setForm({ ...form, qweatherApiHost: event.target.value })} placeholder="https://xxxxx.qweatherapi.com" /></label><label><span>Telegram Bot Token <em>{configuration?.telegram.configured ? "已配置" : "未配置"}</em></span><input type="password" value={form.telegramBotToken} onChange={(event) => setForm({ ...form, telegramBotToken: event.target.value })} /></label><button className="save-button" onClick={() => void save()} disabled={saving}>{saving ? "保存中…" : "保存 API 配置"}</button></div><div className="service-tests">{service("amap", "高德地图", Boolean(configuration?.amap.configured))}{service("qweather", "QWeather", Boolean(configuration?.qweather.configured && configuration.qweather.host))}{service("telegram", "Telegram Bot", Boolean(configuration?.telegram.configured))}</div></section>;
}

function RuntimeSettings({ selected, checks, onSaved, onChecks, onError }: { selected: AgentRuntimeKind; checks: RuntimeCheck[]; onSaved: (workspace: WorkspaceSnapshot) => void; onChecks: (checks: RuntimeCheck[]) => void; onError: (message: string) => void }) {
  const [tests, setTests] = useState<Record<AgentRuntimeKind, TestState>>({ codex: idleTest(), "claude-code": idleTest() });
  async function select(kind: AgentRuntimeKind) { try { const response = await fetch("/api/runtime", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind }) }); const payload = await response.json() as WorkspaceSnapshot & { error?: string }; if (!response.ok) throw new Error(payload.error ?? "AI 基座切换失败。"); onSaved(payload); } catch (caught) { onError(caught instanceof Error ? caught.message : "AI 基座切换失败。"); } }
  async function refresh() { const response = await fetch("/api/runtimes"); if (response.ok) onChecks(await response.json() as RuntimeCheck[]); }
  async function test(kind: AgentRuntimeKind) { setTests((current) => ({ ...current, [kind]: { status: "testing", message: "正在运行最小测试…" } })); try { const response = await fetch(`/api/runtimes/${kind}/test`, { method: "POST" }); const payload = await response.json() as { ok?: boolean; message?: string; error?: string }; if (!response.ok || !payload.ok) throw new Error(payload.error ?? payload.message ?? "测试失败"); setTests((current) => ({ ...current, [kind]: { status: "success", message: payload.message ?? "模型调用成功" } })); } catch (caught) { setTests((current) => ({ ...current, [kind]: { status: "error", message: caught instanceof Error ? caught.message : "测试失败" } })); } }
  return <section className="settings-card"><header><span>03</span><div><p>AI 基座</p><h2>Codex / Claude Code</h2></div></header><div className="runtime-grid">{(["codex", "claude-code"] as AgentRuntimeKind[]).map((kind) => { const check = checks.find((item) => item.kind === kind); return <div className={selected === kind ? "runtime-choice selected" : "runtime-choice"} key={kind}><button className="runtime-select" onClick={() => void select(kind)}><span>{kind === "codex" ? "Codex" : "Claude Code"}<small>{selected === kind ? "当前使用" : "点击选择"}</small></span><em className={check?.installed && check.authenticated ? "ready" : ""}>{check?.installed && check.authenticated ? "就绪" : check?.message ?? "未检测"}</em></button><div className="runtime-test"><span className={`test-result ${tests[kind].status}`}>{tests[kind].message}</span><button onClick={() => void test(kind)} disabled={!check?.installed || !check.authenticated || tests[kind].status === "testing"}>实际测试</button></div></div>; })}</div><button className="text-action" onClick={() => void refresh()}>重新检测本机环境</button></section>;
}

function PreferenceSettings() {
  const [voice, setVoice] = useState(() => localStorage.getItem("landi.voice") !== "off"); const [notifications, setNotifications] = useState(() => localStorage.getItem("landi.notifications") !== "off");
  function toggle(key: "voice" | "notifications", value: boolean) { localStorage.setItem(`landi.${key}`, value ? "on" : "off"); if (key === "voice") setVoice(value); else setNotifications(value); }
  return <section className="settings-card"><header><span>04</span><div><p>基础偏好</p><h2>工作台体验</h2></div></header><div className="preference-list"><label><div><strong>语音输入</strong><small>在制定和修改计划时显示语音按钮</small></div><input type="checkbox" checked={voice} onChange={(event) => toggle("voice", event.target.checked)} /></label><label><div><strong>计划提醒</strong><small>允许 Landi 展示计划内提醒状态</small></div><input type="checkbox" checked={notifications} onChange={(event) => toggle("notifications", event.target.checked)} /></label><div><div><strong>默认时区</strong><small>计划时间统一使用中国标准时间</small></div><span>Asia/Shanghai</span></div></div></section>;
}

function isStarterPlan(plan: Plan): boolean { return plan.title === "Attend an exhibition in Shanghai" && plan.version === 1; }
function formatDate(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric" }).format(date); }
