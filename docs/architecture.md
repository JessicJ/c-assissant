# Landi System Architecture

## System purpose

Landi is a single-user, long-running travel assistant. It combines conversational planning, structured Plan storage, source-backed regional preparation, scheduled assistance, and user-approved Plan adjustment.

The system is designed so that no Agent process needs to remain alive to preserve travel state. Core and Storage own continuity; Agent Runtimes perform bounded reasoning runs when needed.

## Runtime topology

```text
Web browser
     |
              Landi Server
                    |
        +-----------+------------+
        |           |            |
       Core     Scheduler     API/Channels
        |           |            |
        +-----------+------------+
                    |
              Local Storage
                 SQLite
                    |
       +------------+-------------+
       |            |             |
 Agent adapters  travel-support  Connectors
```

One production Server process hosts:

- the built Web application;
- the Core HTTP API;
- version-bound Email execution and its durable outbox;
- Reminder scheduling;
- current weather and venue monitoring;
- Connector access;
- local persistence.

The Roadmap moves the current fixed monitoring loops toward durable, database-backed Monitoring Jobs.

## Major components

### Web

Web is the primary planning and Plan-management surface.

Responsibilities:

- run conversational Planning Sessions;
- present and revise planning proposals;
- review and activate complete Plans;
- render itinerary maps, days, Places, routes, preparation, and sources;
- apply direct structured Plan edits;
- review impact and replacement drafts;
- 管理 Profile、历史、MAH 连接与只读诊断、Connectors 和本地数据；Web 不提供独立 Agent 选择或本地直连后备路径，MAH 选择 Agent 是已批准的目标职责。

Web never owns the authoritative Plan. It reads and writes through Server APIs.

### Execution delivery

Email is the only proactive travel channel. SMTP supplies normalized delivery results. 旅行者在桌面完成出发前精确版本审阅；行中可靠客观变化按完整校验应用，阶段未知保留旧执行。 The canonical contract is [email-execution.md](email-execution.md).

Responsibilities:

- deliver time-sensitive Reminders and travel alerts;
- present planned-time assistance without inferring actual travel progress;
- 出发前以文字引导桌面精确版本审阅；行中说明真实应用原因及新版安排，不注入确认链接；
- hand irreversible actions to maps, booking services, payment services, or ride applications.

Historical chat bindings and delivery records remain readable for compatibility.

### Server

Server is the composition and delivery boundary.

Responsibilities:

- expose validated APIs;
- translate channel input into Core operations;
- 经明确的 planning、blueprint 和 email 业务接口请求 AI 能力；公开 MAH 合同缺失时失败关闭，不调用本地 Agent 作为后备；
- collect normalized Connector facts;
- reuse shared travel-support and Connector facts;
- run Reminder and monitoring loops;
- sanitize failures before returning them to product surfaces.

Server may coordinate work but cannot bypass Core version and state checks.

### Core

Core owns domain behavior.

Responsibilities:

- Planning Session and proposal rules;
- Plan structure and integrity;
- Plan version and lifecycle rules;
- Task and Reminder semantics;
- current-destination resolution;
- change impact and replacement behavior;
- confirmation scope;
- compilation of validated Blueprint and Plan versions.

Core is provider-neutral. It receives normalized facts and structured proposals rather than provider SDK responses.

### Storage

Storage owns durable local state and concurrency protection.

Responsibilities:

- SQLite schema migrations;
- Profile, Planning Session, Plan, Stage, Task, and Reminder persistence;
- current and executing Plan pointers;
- source snapshots and evidence links;
- Run and delivery audit;
- compare-and-write protection for Plan versions;
- Reminder retry and deduplication state;
- backup and integrity checks.

Future Storage work adds durable Travel Events, Monitoring Jobs, and Travel Attention records.

### Agent Runtime Adapter

当前调用边界由 [agent-call-migration.md](agent-call-migration.md) 定义。Adapter 位于明确业务接口之后，MAH blueprint 执行采用组合，不继承本地进程 Adapter。本地 Codex/Claude 安装与登录检查仅供诊断，不构成执行授权或运行可用证明。

现行职责：

- 仅接收最小化且获准的业务上下文，排除 Connector 凭据与敏感运行状态；
- 校验结构化结果、请求关联和当前业务版本后交由 Core 处理；
- 保留现有 generation transport 和权威 generation 映射，等待经验证的公开 API，不复制到新 work store；
- 在公开合同缺失时保持生产失败关闭；conversation、legacy draft 与无人值守 email 返回明确的公开合同阻断，不静默调用本地 Codex/Claude。

MAH 选择 Agent、统一 AI 执行是批准目标，尚不代表当前生产接线可用。Agent 执行本身不拥有业务调度、长期记忆、Plan 激活或 Connector 凭据；现有业务定时职责保留到公开合同、运行验收和切换批准齐备。

### Destination research
Destination research uses shared travel-support and Connector capabilities. Country is a source-selection fact, not a product or an installable workflow. The current boundary is defined by [product scope](product-scope.md) and the [Connector contract](connector-contract.md).

### Skill

A Skill performs one bounded transformation over minimized travel facts.

A Skill:

- accepts minimized structured input;
- returns a versioned structured result;
- declares sources, assumptions, warnings, and failure state;
- has no direct database, messaging, scheduling, or credential access.

### Connector

A Connector communicates with an external provider.

Examples include:

- place search and route facts;
- weather observations and forecasts;
- official-source retrieval;
- external route or ride handoff.

Connectors return normalized facts or typed failures. They do not make product decisions, generate travel recommendations, or mark Tasks complete.

## Planning flow

```text
Web message
  -> Planning Session update
  -> Structured facts and next question
  -> Versioned planning proposal
  -> Traveler approval
  -> Agent Runtime generation
  -> Connector and shared travel-support enrichment
  -> Core integrity validation
  -> Atomic draft Plan persistence
  -> Traveler activation
```

No complete Plan exists before the generation boundary. No Task or Reminder becomes active before Plan activation.

## Active Plan execution

```text
Active Plan
  -> Core resolves due work
  -> Scheduler claims a Reminder or monitoring check
  -> Server requests current normalized facts
  -> Core decides whether the result matters
  -> Storage records result and audit
  -> Email or Web receives user-facing output when needed
```

The current implementation has separate loops for Task Reminders, arrival behavior, itinerary departures, weather, and venues. The target architecture preserves those capabilities behind one durable scheduling model.

## Plan adjustment flow

规范流程由 [email-execution.md 的旅行阶段与原子版本交接](email-execution.md#旅行阶段与原子版本交接) 拥有：来源观察 → 阶段／适用性／影响判断 → 完整替代校验 → 出发前精确确认或行中客观变化应用 → 原子执行版本及交接意图 → T3-2 后续提醒和原因／新版通知。阶段未知、版本冲突或任何门禁失败保留旧执行与未决事实。已有无关草稿不被自动覆盖；异步陈旧结果拒绝，通知失败不回滚已提交应用。

## Evidence flow

```text
Approved source definition
  -> Connector retrieval
  -> Immutable SourceSnapshot
  -> Normalized Skill input
  -> Skill and compilation provenance
  -> Plan, Task, and Run evidence references
  -> User-visible original source link
```

Evidence preparation does not itself establish personal eligibility or policy applicability. Policy conclusions require a separate, source-bound review.

## State and trust boundaries

### Authoritative state

SQLite is authoritative for:

- Profile;
- Planning Sessions;
- Plans and versions;
- Tasks and Reminders;
- execution pointers;
- source evidence;
- minimized Run and delivery state.

Browser state, conversation text, Agent memory, and external-app screens are not authoritative.

### Sensitive data

- Runtime login credentials remain in the official local runtime.
- Connector credentials remain in the Server environment.
- Skills and Agent Runtimes receive normalized facts, not credentials.
- Exact location is short-lived and action-scoped.
- Plan-scoped travel details do not automatically enter Profile.

### Irreversible actions

Booking, ordering, payment, and ride confirmation occur in external applications. Landi may prepare or hand off the action but must not claim completion without explicit confirmation or reliable evidence.

## Deployment model

The current deployment target is one local instance per traveler.

Supported path:

- 面向 macOS 当前芯片架构的本地包，并携带经校验、支持 `node:sqlite` 的官方 Node 运行环境；
- 一个生产 Server 进程；
- 一个规范启动实现，Finder 启停入口仅作为薄调用方；
- 位于包外的应用支持、数据库、日志和实例运行目录；
- 系统浏览器打开前完成实例绑定的健康检查和端口所有权检查；
- 本地 Runtime 登录；
- 本地 Connector 配置；
- 明确的本地停止和失败恢复，且永不认领或终止未知服务。

打包、实例所有权、数据隔离、归档卫生和本机验收的权威合同是 `macos-local-launch-package.md`。打开 Web 工作台不要求 MAH、Agent 登录或 Connector 配置。启动器只拥有本地进程生命周期；Server、Core、Storage 和 Agent Runtime Adapter 的边界保持不变。

MAH 持续承载本地实例的公开合同由 [mah-background-runtime.md](mah-background-runtime.md) 定义。目标职责见项目的 [MAH 与 Landi 协调架构](../../../docs/architecture/landi-mah-private-travel-assistant.md)。在公开合同和切换验收通过前，现有业务定时与本机生命周期继续由原路径负责。MAH 外围监督只能调用同一个规范启动器。

Future deployment work may add Linux, Windows, or hosted operation, but it must preserve single-user data isolation, local ownership, version safety, and credential boundaries.


### Email execution runtime (implementation in progress)

[Email execution](email-execution.md) owns sender and recipient authorization, version-bound outbox execution, and delivery outcomes. Uncertain SMTP results stop automatic retransmission. 出发前替代须桌面精确确认；行中应用遵循同一权威阶段合同。旧签名手机路由返回 410，手机远程审阅及其发布门槛取消。系统已应用不能冒充用户已确认；当前源码已有阶段依据、领域校验、原子版本应用及持久交接路径；邮件已实现人工确认的同请求规范可信消费投影及通知、旧版工作、新版 timing 分别读回；客观应用因既有 producer 未持久保存可独立核验的公开执行依据继续拒绝消费，通知 outbox ACK 或 timing pending 不等于新版提醒完成，精确字段来源和恢复边界由 email-execution.md 的可信消费合同拥有；Task `4d5280f5-f624-4f5a-bef2-2859ec15e039` 已完成 T3-1 `implementation`，该实施的独立源码验收在其原始范围内继续有效。T3-1 另立的 `verification`、T3-2 及 T5-2 的公开执行与同版本联合运行仍按各自合同待验；历史实施验收不证明这些切片或运行门禁通过。

Email timing is bound to the approved Plan version and destination time zone. The MAH research and timing paths remain blocked until their public execution contract is verified. Server validates notification windows and Storage preserves generation leases, bounded retry and accepted decisions. The durable outbox executes those decisions across restarts; user-owned fixed morning/lead settings have been removed by schema 24. Missing or failed timing is visible and does not restore a fixed-time fallback. Non-secret sender settings are projected back to Web; passwords never are.
