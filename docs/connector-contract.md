# Connector Contract

> Contributor reference. This contract defines how Landi obtains external facts and hands actions to provider applications. It is not part of the primary product-design reading path.

Current provider decision: Google Maps Platform is the active global place, route, and nearby-discovery provider; Google Weather is used only within its own coverage, and unsupported locations degrade without a regional fallback. Uber is the taxi handoff. Amap and QWeather are paused. Their sections below are retained as historical contracts only and do not describe an active runtime dependency.

Connectors isolate external systems from Core and research. Server composition and shared `packages/travel-support` use normalized provider capabilities and ordinary destination source data. No active Country Pack selects or installs providers; current product scope is [product-scope.md](product-scope.md).

## Boundary

A Connector may:

- authenticate with its provider;
- fetch or normalize external facts;
- send or edit messages when Core explicitly requests it;
- create a handoff link or location request;
- report provider errors and freshness metadata.

A Connector must not:

- decide whether a policy applies to a person;
- silently mutate a Plan;
- infer that opening a link completed an external action;
- expose provider credentials to a Skill or Agent runtime.

## Common result

```ts
type ConnectorStatus =
  | "available"
  | "degraded"
  | "not_configured"
  | "unauthorized"
  | "rate_limited"
  | "unavailable"
  | "unsupported";

interface ConnectorResult<T> {
  status: ConnectorStatus;
  data?: T;
  provider: string;
  observed_at: string;
  freshness?: {
    source_updated_at?: string;
    expires_at?: string;
  };
  evidence?: SourceReference[];
  failure?: {
    code: string;
    message: string;
    retryable: boolean;
  };
}
```

Core decides whether to retry, degrade the experience, ask the user, or create a follow-up Task.

## Historical messaging Connector contract (retired)

The following Telegram/WhatsApp contract is retained only for old records. Neither channel is a current runtime, configuration or implementation requirement; do not restart its handlers, polling or sending. Email is the sole proactive traveler channel, governed by `email-execution.md`.

Telegram and WhatsApp implement the same minimal outbound capability contract: a channel identity, configuration status, and normalized text delivery receipt. Provider-specific controls remain typed extensions rather than leaking into Core.

Telegram is the default channel. WhatsApp is optional and may be left completely unconfigured without affecting Setup readiness. Its configuration progresses through `webhook_pending`, `template_pending`, and `available` states. WhatsApp free-form text is refused unless Core supplies a still-active user-opened 24-hour service window; proactive reminders use a named, approved template. Incoming WhatsApp webhooks must pass `X-Hub-Signature-256` HMAC verification before text, location, button/list replies, or delivery states are normalized. Neither access tokens, webhook secrets, verify tokens, nor raw webhook bodies may enter Profile, Plan, Skill input, or Agent runtime context.

The first inbound slice binds one international WhatsApp number in private instance configuration. A signed `wamid` is claimed once in SQLite before its text enters the shared bounded Plan/command handler, and Plan-generation Runs retain `trigger: whatsapp`. Other senders and duplicate deliveries are acknowledged but ignored. URL handoffs are rendered as text; callback confirmation and location controls explicitly remain Web/Telegram-only until native WhatsApp action state is implemented.

## Capability naming

Capabilities are stable product concepts, not provider method names. Examples:

- `location.geocode`
- `location.reverse_geocode`
- `place.search`
- `place.nearby`
- `route.plan`
- `weather.lookup`
- `handoff.map`
- `message.receive`
- `message.send`
- `message.edit`
- `message.request_location`
- `official_source.discover`
- `official_source.fetch`
- `official_source.extract`
- `official_source.snapshot`
- `official_source.compare`

Provider-specific response fields remain inside the Connector and are normalized before reaching Skills.

## Google Maps Connector

V1 capabilities:

- geocoding and reverse geocoding;
- place search and nearby search;
- route planning;
- weather lookup where the API supports the required area and horizon;
- map/search handoff links.

Google Maps supplies global location and route facts. It does not decide which neighborhood, restaurant, hotel area, or transport option is best for the user. Those decisions belong to Skills using Plan context.

The Connector must preserve enough provider identifiers to produce stable handoffs, but provider payloads must not leak into long-term Profile data.

## Historical Telegram Connector (retired)

V1 capabilities:

- receive text, button callbacks, and user-shared location;
- send messages, reminders, and action cards;
- edit a previously sent card when it remains valid;
- request location with an explicit Telegram control;
- attach Web and external-app links.

Each instance is bound to one user. Bot tokens are isolated from Agent runtimes and Skills. A location request is not a location read: Telegram still requires the user to tap and share.

Replies go back to Telegram when Telegram originated the interaction. Proactive reminders appear in Telegram and in the Web Inbox.

## Official Source Connector

官方来源 Connector 获取可追溯的事实证据，不决定旅行者资格。Server 从共享 travel-support 的普通来源注册表组合服务，经只读 `GET /api/official-sources` 查询、显式 `POST /api/official-sources/:sourceId/refresh` 刷新；没有 V1 后台爬取授权。研究评估来源与实际地点、日期、旅行者条件的相关性，Core/Importer 校验领域候选，Storage 保留不可变快照与旧来源引用。原始标题、最终获准 URL、获取时间、内容哈希与摘录必须可追溯；用户产品说明仍遵守既有英文文案合同。

### 目的地研究能力与差距（T4-1 design）

以下是 2026-11-06 的源码静态核对。组件路径均相对组件根；“已满足”只指注明的源码能力存在，“未满足”指该完整义务仍有明确缺口，“未验证”指没有本次真实边界运行证据。测试文件和历史验收不等于本次测试通过。当前核对未运行应用、真实 provider、MAH 生成或政策资格研究；本 Attempt 的实际命令、退出码、阅读清单和主线身份保存在对应 Task artifacts。本文拥有长期责任与场景，Task 工件仅保存本次证据。

| 信号 | 能力状态及源码依据 | 本次实际依据、缺口与后续义务 |
|---|---|---|
| 地点身份与目的地解析 | 已满足：`apps/server/src/destination-research.ts` 的 `resolvePlanDestination → maps.geocodeAddress → resolveDestinationCatalog` 由 provider 国家事实选择 CN/JP 注册表；缺失、不支持、逗号/斜线歧义为 `needs_confirmation`。`packages/core/src/skill-importer.ts` 的 `importSkillResearchBatches` 地点映射与 `trip-blueprint.ts` 保留候选地点身份。 | 静态读链；未验证真实 geocode。未满足：此国家别名选择不是全球来源覆盖或完整地理消歧。后续证明不猜国家、不把多个地点合并，不把未知来源覆盖误作全部旅行能力不可用。 |
| 日期和旅行者条件 | 已满足：`packages/core/src/policy-research.ts` 的 `assessPolicyResearch` 保留目的地、国籍、护照国、目的、过境与日期等缺口；`policyResearchForTrip` 在日期变化时转 `needs_recheck`；`policy-applicability.ts` 只检查准备程度。 | 静态读条件；未验证当前应用流程。未满足：字段完备不是实际适用性裁决，条件改变后的全链路重评未证明；`ready_for_review` 不是资格通过。后续验证条件缺失、日期变化不产生肯定结论，也不删除无关有效旅行内容。 |
| 官方来源身份、URL、白名单 | 已满足：`apps/server/src/official-sources.ts` 的 `parseOfficialSourceRegistry`；`packages/connectors/src/index.ts` 的 `OfficialSourceConnector` 按 sourceId 查已审阅来源，校验初始与最终 HTTPS 主机及其子域，返回原始标题、authority 和最终 URL。 | 静态读初始/最终检查。未满足：`redirect: "follow"` 后才校验最终域名，不能证明越界请求发生前被拒绝；也未证明每跳、DNS/私网、端口与 URL 凭据的完整出站防护。后续隔离测试必须观察实际请求目标，不能只断言返回错误。 |
| 获取时间、内容摘要及有界性 | 已满足：Connector 保存 `retrievedAt`、截取 HTML 的 SHA-256 `contentHash` 与最多 12,000 字符摘录。 | 静态读实现。未满足：`response.text()` 全量读取后截取 250,000 字符，并非下载字节上限或全响应摘要；正文读取异常不在 fetch 的捕获中，没有此路径的显式请求超时。后续核定传输大小、超时和错误归一化；不得把截断哈希称为完整网页哈希。 |
| 新鲜度 | 已满足：注册表 `refreshHours` 是元数据；`packages/core/src/policy-applicability.ts` 对 `nia-english` 快照使用七天阈值（只检查下界，未来获取时间也可能判为新鲜）；`policy-research.ts` 检查时间有效性/未来时间，始终保留复核。 | 静态读规则。未满足：通用来源刷新服务没有消费 `refreshHours` 的 TTL/过期状态；政策研究元数据检查没有通用年龄门槛。不得把中国准备检查推广为所有来源的新鲜度或法律有效期。后续分别验证过期、未来/无效时间与旅行日期适用性。 |
| 失败、冲突和未知 | 已满足：Connector 返回 `unknown_source`、`unapproved_source_url`、`fetch_failed`、`source_http_error`、`unapproved_redirect`、`unsupported_content_type`、`empty_source_text` 等状态；研究使用 `not_assessed/needs_input/needs_recheck`。 | 静态读错误分支。未满足：正文读取异常统一化、多个官方来源语义冲突检测与裁决尚未证明；hash 变化只说明保存内容变化。后续保留冲突证据、解释待核实，不以来源顺序或哈希自动判政策真伪。 |
| 研究候选与领域导入 | 已满足：`packages/core/src/skill-importer.ts` 的研究/行程导入、检查点合并及 `assertResearchSetIntegrity`；缺失顶层元数据的 HTTPS 证据可合成为 `official:false/status:recheck` 来源。`trip-blueprint.ts` 校验引用与领域完整性。 | 静态读导入链；未验证本次生成运行。未满足：格式/关联有效不证明事实可信；独立来源快照与 Research Set 字段证据的完整端到端关联仍待验。后续验证 sourceId、地点 ID、字段引用及去重映射，拒绝悬空引用，不臆造关系。 |
| UGC 与官方事实 | 已满足：来源类型与证据状态可区分；ADR-0133、0136、0138 规定 UGC 是可选灵感，官方资格证据不可替代；Importer 合成来源不会提升为官方已核实。 | 静态核对指导与导入；未验证生成是否全面遵循。后续分别检查地点灵感、营业/预订/安全/资格等主张，不能因 HTTPS、平台流行度或 `official` 布尔标记就接受结论。 |
| 旧来源、不可变快照及重启 | 已满足：`packages/storage/src/index.ts` 的 `saveSourceSnapshot` 与 `source_snapshots` 按 source/url/hash 去重，保留旧行，新 hash 返回 previousSnapshot/contentChanged；`linkSourceSnapshotToPlan` 仅关联当前草稿并校验版本；工作区读回保留近期快照。 | 静态读 SQL 与版本检查；未验证本次临时库重启。未满足：同 hash 返回原快照及原 `retrievedAt`，不是新的抓取观察；近期列表限 30 条不能证明任意历史引用完整回读。后续验证同内容/变化/恢复到旧内容/重启及旧引用，不能重写历史时间或丢弃旧快照。 |
| 编译溯源兼容与动作权限 | 已满足：`packages/core/src/blueprint-plan-compiler.ts`、`packages/storage/src/index.ts` 保留 Blueprint/Plan 编译身份；历史来源/Skill lineage 仍是兼容记录。共享 `travel-support/src/index.ts` 返回候选/建议，研究不授权外部动作。 | 静态核对职责；未验证旧数据库/历史全量回读或真实动作边界。后续用隔离旧格式夹具证明不改写来源 ID、快照、编译和 Skill lineage，不恢复退役运行路径；确认候选导入不激活 Plan、不发送邮件、不预订/交易/付款。 |

当前接口还有一个需保留的设计/实现差异：本文前述 `Common result` 是目标语义示意，使用 `observed_at/freshness/evidence`；现行 `ConnectorResult` 为 `observedAt` 加可选 `failure`，没有通用 freshness/evidence 字段。它不是可直接提交的运行时 Schema；后续如需新增字段，应先明确规范合同再实施，不在本设计维护中静默改字段。

### 后续隔离场景与证据映射

下表每个场景都同时映射既有 implementation 的 `landi-t4-implementation` 和 verification 的 `landi-t4-verification`，`profile_id=application`，`execution_environment=development`，验收标识为 `landi.t4.behavior` 与 `landi.t4.boundaries`。implementation 只补经确认的真实缺口；verification 独立验证完整可观察结果。每项保存夹具、源码提交、实际命令/退出码、完整原始输出、失败与观察；记录行为及边界两类证据，不新增平行 profile。本次仅定义这些场景，未执行它们。

| 场景 | 隔离输入与预期可观察结果 | 证据边界与现有落点 |
|---|---|---|
| D1 支持、未知、歧义目的地 | 注入 CN/JP、空 country、不支持国家、带逗号/斜线国家及非当前 Plan；分别选择正确注册表或 422/待确认，不猜国家，保留其他可用旅行事实。 | `destination-research.ts`、`destination-research-startup.test.ts`（包含目的地解析与路由夹具）；记录 geocode 调用与 GET/POST 路由结果，真实地图覆盖另验。 |
| D2 日期变化与条件缺失 | 使用合成国籍/护照国/目的/过境信息、空/未知条件、非法或变更日期；导入/读回保留 `needs_input/needs_recheck/not_assessed`、复核清单和原有效内容，不得给资格结论。 | `policy-research.test.ts`、`policy-applicability.ts`、`skill-importer.test.ts`；覆盖已存研究重评与日期关联，不能以中国准备检查替代全球适用性。 |
| D3 合法与拒绝 HTTPS | 注入获准主机/子域、HTTP、相似后缀恶意主机、未知 ID、跨域/多跳重定向、私网/DNS/端口/URL 凭据以及超大或缓慢正文。 | `packages/connectors/src/index.test.ts`、`official-sources.test.ts`；使用可观察的隔离 fetcher/本地受控网络，记录每次目标与正文界限。请求前越界拦截、大小/超时不满足时必须失败记录，不能只凭最终状态声称安全。 |
| D4 失效、过期、冲突来源 | 注入离线、HTTP 错误、非 HTML、空文、正文读取失败、旧/未来/无效获取时间及两份内容冲突的官方证据。 | Connector、`policy-research`、Storage；保存结构化失败和并存证据，缺口保持未知/复核。分别证明七天准备阈值、注册表元数据与政策有效期不混同；不能以 hash 判语义冲突。 |
| D5 去重、变化、重启读回 | 临时 SQLite 保存 A、同 source/url/hash A、不同 B、再 A，重启同临时库；比较 snapshotId、原获取时间、previousSnapshot、contentChanged 与历史 Plan 引用，扩展到超过 30 条。 | `packages/storage/src/index.test.ts` 与 `official-sources.test.ts`；同时记录去重命中旧 A 时的真实结果，不能把它说成新的“当前内容”快照。新抓取观察如未保存须明确缺口。不得迁移或读生产库。 |
| D6 地点及字段证据关联 | 合成同名不同地点、显式 externalIdentity 重复、悬空 source/place ID、仅字段 HTTPS URL、缺顶层元数据，跨批次合并并导入 Research Set/Blueprint。 | `skill-importer.test.ts`、`trip-blueprint.test.ts`；比较导入前后完整地点集合、源 ID 映射、字段引用与检查点，不丢地点、不造关系；格式完整与事实可信分别判断。 |
| D7 UGC 与官方事实区分 | 同时提供 UGC 灵感与官方来源；移除可选 UGC、缺官方证据或仅标记 verified；研究仍可保留灵感，政策/营业/预订等未证事实必须待核实。 | ADR-0133/0136/0138、Importer、`policy-research.test.ts`；证明灵感不成为资格证据，元数据布尔值不代替 Agent 对原证据的语义判断。 |
| D8 候选导入与权限隔离 | 合成合法及畸形候选、旧来源/Skill lineage/编译记录、过时 proposal/Plan 版本；完成候选校验及兼容读回，拒绝错误关系和版本。注入禁止外部副作用的适配器。 | Importer、Compiler、Storage 与版本门禁；记录 Plan 激活、邮件发送、预订、叫车、交易、付款及外部发布调用均未被研究授权；合法导入也不绕过独立确认。历史兼容不得恢复国家包或聊天。 |

真实 provider 的网络可达性、实际 geocode 精度、注册表当前权威性/页面含义和具体旅行者政策适用性均未验证，不能由上述模拟隔离测试代替。MAH 生成另遵守 [Blueprint 生成设计](blueprint-workspace-generation-requirements.md) 的“MAH 有界生成传输合同”：只有公开回读、传输/业务 Schema、Importer 与领域校验完整证据才可接受候选；公共物化/调度来源未核实时保留 `public_materialization_contract_missing` 失败关闭。本设计不提交生产生成、不启动业务时限、不把历史 Task、安装版存在或内部单测当作运行门禁通过。

## External action handoff

```ts
type HandoffKind = "direct_link" | "search_handoff" | "copy_handoff";

interface ExternalHandoff {
  kind: HandoffKind;
  provider: string;
  label: string;
  url?: string;
  copy_text?: string;
  instructions?: string[];
  completion: "unknown_until_user_confirms";
}
```

V1 does not claim completion after a user opens Google Maps, Uber, or another external app. Core may ask for confirmation only when knowing completion changes later execution.

Google Maps Platform is the global source of place and route facts used for planning and conservative arrival timing. A taxi action opens Uber's mobile rider experience with the device's one-time WGS-84 pickup coordinate and the Plan destination text. The user must verify pickup, destination, availability, live fare, vehicle type, payment method, and the final request in Uber. Landi must not infer that opening the link hailed a ride, and it never sends Uber a client secret, access token, or payment credential. `UBER_CLIENT_ID` is optional public application attribution only; the V1 handoff does not require a privileged Ride Requests API integration. Amap and QWeather are paused and receive no runtime calls.

A delivered email or displayed handoff link does not prove that the traveler opened a provider app. `handoff_opened` requires a separately verified observable event and must not be synthesized from delivery, planned timing or historical Telegram receipts. Timing may support planned travel guidance, but never proves arrival, boarding or completion.

## Security and observability

- Credentials are injected into the Connector process and redacted from logs.
- Every call receives a correlation ID and Run ID.
- Logs record capability, provider, timing, status, and error code, but not unnecessary personal data.
- Connector responses are bounded in size and validated before use.
- Rate limits and provider outages must degrade to explicit user-facing states.
