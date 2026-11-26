# Landi 邮件执行阶段

## 当前交互范围（以 product-scope.md 为准）

当前产品范围由 [product-scope.md](product-scope.md) 统一定义。邮件是唯一主动旅行渠道；Web 承担桌面规划与出发前精确版本审阅确认。行中可靠客观突发变化经影响与完整替代校验后由 Landi 应用，再交接提醒和原因／新版安排通知；阶段或事实不足时保留旧执行与未决事实。独立邮件确认页、签名确认链接及公网确认地址设置已停用，旧入口返回失效提示，不读取或修改计划。待审阅提醒复用现有 Change 模板，以文字引导打开工作台，不注入 localhost、占位或签名链接。历史确认回执、队列内容和用户配置保留；旧签名确认内容在发送边界被拒绝，不批量删除或重写历史记录。四封邮件的视觉设计不变，SMTP 授权与投递结果不明保护不变。下方旧流程与验收仅为历史记录。

下列邮件设计起于 2026-10-13；当前范围覆盖历史 Telegram 过渡和远程签名确认条款。四封邮件的视觉合同仍为 `mobile-email-templates.md`。后续 MAH 驱动遵循项目的 `docs/architecture/landi-mah-private-travel-assistant.md`，手机工作台、远程审阅确认及其发布门槛已取消；目标批准不恢复旧签名入口或证明接入已验收。实现验收与真实发信/客户端验收分别记录，不从设计存在推断交付。 当前本地 AI 调用、就绪门禁与未实现的公共准入边界以 `agent-call-migration.md` 为准：研究与自动发送安排缺少经验证的 MAH 合同时保持阻塞，不能把下方历史直连 Agent 流程当成当前可用路径。现有本地业务计时及已持久化邮件事实不因此被重写或停止。

## 用户流程

出发前在桌面明确确认具体方案及当前 Plan／Blueprint／执行版本 → 验证收件邮箱并启用邮件 → 按持久阶段依据处理变化：出发前先确认，行中可靠客观变化经完整校验应用 → 后续提醒和原因／新版邮件跟随真实应用版本。未知或失败保留旧执行；无回复不阻断服务。Gmail 与 iCloud 均可收信；不读取收件箱、不要求收件账户密码。发信账号可以与收件地址不同。发送适配层采用标准 SMTP，支持专用或已有发信账号，凭据仅在本机配置边界读取；默认不配置真实账号。开发使用模拟 SMTP 客户端和隔离存储。

## 时间与版本

### 行中变化事实、版本与审阅（T3-1 当前设计）

本节拥有变化事实、来源适用性、阶段判断、确认／应用与旧计划连续性合同。当前实施以获批行程调整决策和 T3-1 implementation 冻结合同为准；已交付 design 的原合同和证据保留为历史，不代表新行为已实现或运行就绪。Core 拥有领域判断，Storage 拥有精确版本和持久事务，Connector 归一化来源事实，Server 编排与校验，Web 展示完整审阅及明确确认。Email 是唯一主动旅行渠道，不能批准 Plan。邮件队列、四模板、lease 与发送仍归 T3-2；MAH 调度、持续运行及行中应用与提醒邮件的联合门禁仍归 T5-2，本节只定义其交接输入，不重建或验收这些责任。

当前实现继承组件设计基线 `9c10880` 之前已有的监控、预订双读取、Core 确认、Storage 版本事务及邮件 outbox。下表描述本次演进后的规范路径；原设计交付及其历史差距保留在 Git 历史和原 Task，不将历史测试结果复述为本次通过。开发验证材料属于本 Attempt，最终验收及运行门禁分别结算。

| 冻结义务 | 当前规范路径 | 保留的边界 |
|---|---|---|
| 场馆与天气覆盖 | `email-plan-monitoring.ts` → `email-attention-monitor.ts`，逐活动/到访保存查询候选和覆盖原因；`plan-venue-monitor.ts` 只缩小候选，天气 current/forecast 分开，提交前复核有效期 | 不以名称、坐标或天气阈值判定业务变化；当前场馆查询不证明未来营业，远期无匹配预报保持未覆盖 |
| 保存预订 | 沿 `listCurrentTravelBookingSourcesForPlan` 精确执行绑定逐分段采集最小候选；批准安排仍由 `listApprovedBookingConstraintsForPlan` 读取 | 新草稿独有预订不进入旧执行；保存资料不是实时供应商核实，不带确认码、附件或自由原文 |
| 阶段和判断 | Core `travel-adjustment.ts` 定义阶段、来源、负责判断和完整替代门禁；Storage `recordTravelPhase` 保存依据及执行版本，陈旧绑定按 unknown 读取 | 时钟、激活、地图和邮件不是阶段证据；公开执行合同缺失默认未决，可信替身只用于隔离开发 |
| 观察、事件和恢复 | Schema 31 的 `travel-adjustment-store.ts` 保存候选、最后可靠事实、episode、判断及回执；`commitTravelAdjustment` 以同库事务提交 | 失败与未知不清警；过期不冒充恢复；负责执行证据缺失不提升为可靠事实或新事件 |
| 版本与授权 | `captureAdjustmentContext` 冻结 Plan、Blueprint、草稿、阶段、源集合、观察集合和完整授权快照；提交事务内 CAS 复核 | 暂停或时区更正即使不增加收件地址修订也使旧输入失效；拒绝迟到结果不污染当前观察 |
| 替代与明确确认 | 复用编译及唯一内部激活事务；自动替代需在原编译入口持久绑定事件来源；`activateReviewedPlan` 与 Web 所见摘要、版本、来源和授权绑定 | 同 Blueprint 的无关新草稿也不能被自动吸收；出发前明确确认与系统应用分别保存依据，不把只读/无回复当确认 |
| 原子交接 | 应用回执与交接意图同事务保存；`email-plan-review.ts` 从完整新版快照幂等消费既有 outbox 并保存读回；旧版未发送工作在原授权入口失效 | 通知故障保留 pending，不撤回应用；sending/accepted/uncertain 历史与原投递语义不变，不承诺网络 exactly-once |
| 开发与独立验收 | 受影响构建、类型检查、聚焦正反例、普通 Fastify/真实 Web 与隔离磁盘读回映射 `landi-t3-implementation` / `application` / 两项 acceptance ID | 不等于独立 verification、T3-2 整体、T5-2 联合运行、真实 MAH/供应商/收信或服务切换就绪 |

### 状态、输入输出与持久事实

可恢复观察还保存 `candidate` 安全投影，按 `sourceKind` 使用封闭结构并在 Core 写入边界拒绝额外字段、超长文本及超量候选。场馆保留公开地点名称、城市、坐标、有限匹配集合及查询时间；查询时间不是事实发布时间，匹配也不是适用性终判。天气只保留目标地点、当前观测或目标日预报的明确公共字段，缺失观察时间仍为空。保存预订只保留源/分段身份、状态、时间时区、各层约束强度和固定承诺标记，不保存确认码、附件、联系人、解析原文或自由备注。该投影属于受控本地业务事实，不进入公开投影、运行日志或真实用户测试工件；指纹从投影组织候选，不能代替内容或负责判断。来源失败仍保留最后可靠事实与本次失败，恢复读取沿同一 Storage 入口。

预订的两个读取边界由预订设计的源生命周期合同拥有。监测读取执行 Plan 已绑定源的当前保存状态，只形成观察和复核义务；观察本身不改变批准安排，后续应用须独立通过本节阶段、判断及完整替代门禁；常规邮件的确认预订与安排事实读取 `listApprovedBookingConstraintsForPlan` 返回的精确 Blueprint 约束快照，不伪造 TravelBooking。当前源与批准快照不同或来源无法确定时，文案明确待复核，不能继续声称该资料当前已确认。新草稿新增源不进入旧执行集合，原始 owner、任务、提醒、配置及执行指针不因源更正而迁移；现有收件人、lease、outbox 与发送版本门禁继续有效。

后续实施沿用上述规范路径。输入须绑定执行 Plan ID/version、活动/到访或预订分段、当地日期与时区、provider、公开来源引用、事实观察时间、获取时间及适用有效期。未知事实时间不得用 now 补成来源时间；保存预订另绑定保存记录修订和变更来源，不把受保护附件、个人原文或凭据放入 Agent/证据。输出分为有适用证据的变化、有适用证据的无变化、未知/失败/过期/未覆盖；未覆盖必须说明范围，不能显示一切正常。

观察、语义判断、替代草稿、只读审阅、人工确认与行中客观变化应用分别建模。只有出发前明确确认，或行中可靠客观变化通过全部门禁后，才能由 Landi 切换执行版本；自动应用记录不得伪装成人工 confirmation。Core 拥有重大性、影响、建议和恢复语义；现有天气正则/阈值、场馆名称包含及 `plan-change-impact.ts` 规则只能组织候选或拒绝结构无效输入，不替代有责任 Agent 的最终适用性与业务判断。判断保留真实 Agent/model、理由、义务及证据引用；公共执行合同或有效判断缺失时保留未知/待处理，不恢复直连、另一个 Agent/槽位或调度旁路。生产来源监控只产生候选及可恢复未决；没有经验证的公共判断执行合同，不产生确定警告、恢复或自动应用。

Storage 须持久保存安全来源事实、判断、版本、episode、恢复关联与通知交接意图，并在同一事务内保持观察决定和交接一致，可幂等恢复。来源失败保留最后可靠观察及本次失败，不能把旧事实继续说成新鲜；只有同对象、日期适用的新可靠证据与明确判断可清警。过期标为过期并取消未发送意图，不冒充恢复。取消预订后更正正常仅证明保存记录恢复，不证明重新预订或供应商确认。发送中、已接受及结果不明历史保留。

Server 编排并在异步提交前复核执行版本、适用窗口及授权修订，失败保存安全原因与可恢复意图。Web 从安全候选白名单展示对应活动和目标日期的具体来源事实：场馆记录状态、当前天气或目标日预报的公开值、保存预订分段状态及承诺，保留获取与适用时间、缺失和未知；不回显内部判断原文、provider 标识或执行引用。事实陈述只展示已归一化内容，不由关键词或阈值推出影响。没有可公开的负责判断时明确显示影响尚待核实，结构前后差异与完整安排可供旅行者审阅，不能冒充已核实的重大性。Web 展示来源可用性、事实、影响、未知、完整旧/新安排和确认状态，使用产品本地化日期与可操作恢复提示，不展示诊断路径/原始异常。确认绑定所见版本，版本变化重读重审；明确结构化拒绝在先读回确认尚未提交后释放旧确认绑定，重读后只有新的显式操作才可再次提交。网络、内部故障或读回失败仍保持原请求未明，不自动重发；丢回执先对账，人工确认和自动应用分别保存真实依据，通知故障不回滚已经提交的应用。Email 复用现有 Change：未应用建议、用户已确认和系统已应用须有不同语义，系统已应用只取持久应用回执，不能借用确认时间；没有完整替代不伪造已应用安排，无实质变化不发新警告，未知不生成确定警告或假恢复。

### 旅行阶段与原子版本交接

阶段持久保存为 pre_departure、on_trip、ended 或 unknown，绑定旅行与执行版本、依据引用、记录时间和修订。pre_departure/on_trip/ended 必须有旅行者明确陈述或经负责 Agent 核实的可靠实际旅行事实；仅激活 Plan、计划起止日期、当前时钟、地图交接、发送或收信均不足。执行版本变化后，旧版本阶段依据不自动迁移为新版本事实；缺少当前绑定的明确声明或可靠实际依据时按 unknown 读取。阶段无法确定或依据失效时记 unknown，不自动应用；计划时间仍可决定通知有效窗口，不能改写真实进度。此合同不新增手机交互或打卡要求。

出发前确认绑定具体替代方案及其内容摘要、草稿 Plan ID/version、Blueprint ID/version、原执行 Plan ID/version、来源集合及相关授权修订；只读、刷新、无回复、邮件成功均非确认。行中只允许可靠客观突发事件；有责任 Agent 保存身份／模型、原执行证据、适用性、影响、理由与义务，再由 Core 校验完整替代安排，包括日期时区、地点、活动实际占时、交通连续性、预订固定承诺及关系覆盖。自动应用按具体到访核验前活动结束加交通耗时不晚于下一活动开始：明确结束时刻优先，其次该活动明确时长，再次同一次地点活动的明确停留时长；时长必须是有限非负数，明确结束不得早于开始，活动与交通占用不得无表示地超出该活动的当地日期；仅有 HH:mm 的区间不能隐含推断跨日。缺关键开始、结束或时长则保持未决，不能用零时长代替未知。人工桌面审阅可明确接受已呈现的时间待定、交通待复核或缺耗时，不将其伪装成已核实或可自动执行；已知非法占时、确定的时间冲突、路线邻接、预订固定承诺及完整关系评估、来源与精确版本等硬门禁均不可豁免。已知领域校验拒绝返回可重新审阅的明确结果，未知内部故障保留结果未明保护。主观偏好手机交互不在范围内。缺失公开判断执行合同、事实不足或任何校验失败，均记录可恢复未决事项并维持原执行。

Storage 在同一事务中 CAS 核对阶段修订、原执行、当前草稿、Blueprint、来源及授权修订，保存观察决定、事件／episode、判断、应用回执、执行指针和可恢复交接意图。存在无关新草稿时不得覆盖、吸收其预订或隐式迁移 owner；冲突保留原执行与该草稿。逐到访观察 key 保留活动身份；场馆及天气的业务 objectRef 使用既有稳定 Place Identity，不随停留排序或区块身份重建而变化，保存预订仍使用原源/分段身份。不以名称或坐标推断不同 Place Identity 的语义等价；该关联须有负责判断，不能冒称已自动识别。业务事件／episode 身份按同一旅行及相同适用对象、目标日期保留，独立于执行版本 CAS 基准；同一未恢复 episode 的已应用标记跨 Plan 版本唯一，不因新草稿、重新声明阶段或指纹变化而再次应用。完整来源集合内只对本次负责判断标为 changed 且仍 open 的 episode 检查及登记消费；其他已恢复或未变化对象的历史应用不得阻止新客观变化。只有负责判断确认的可靠恢复才能结束该 episode，随后再次异常形成新 episode；未知、失败与过期均不能作为恢复。重复、并发、重启和丢回执读取同一业务结果，事务失败全部回滚。哈希仅组织身份，不作业务判断。

#### 可信生效事实与邮件消费合同

唯一生效事实由既有 `SqliteWorkspaceStore.commitTravelAdjustment`（客观应用）或 `confirmPlan`（出发前明确确认）提交，不由邮件构造。`TravelAdjustmentPersistence.save` 在同一数据库事务保存 `travel_adjustment_receipts` 的 context、observations、decision、result 及 `travel_adjustment_handoffs` 的完整安排快照；执行指针、episode 消费标记和旧工作失效与应用一同提交。`getTravelAdjustmentReceipt`、`getTravelAdjustmentReceiptForPlan`、`listPendingTravelAdjustmentHandoffs`、`readTravelAdjustmentArrangement` 是已有读取入口，`consumeTravelAdjustmentHandoffs` → `enqueueAppliedAdjustment` 是已有邮件消费路径。真实 producer 已存在，不沿用历史“producer 缺失”判断。

邮件通过 Storage 同一规范领域边界的只读消费投影读取同请求 context、observations、decision、result 和安排，核对持久关联后才可消费；邮件不得自行查询内部表、接受调用方拼接事实或以观察／草稿替代回执。既有客观应用 producer 仅以回调布尔核验执行，未保存可独立读回的公开核验事实，因此该类历史记录保持拒绝消费；本轮不扩建 T3-1 producer。人工确认从真实确认表关联读取，客观消费正向仅由明确标记的领域 fixture 验证。下表定义该投影的字段来源和拒绝条件；这是消费合同，实际实现与当前验证结果分别记录。目标结构以同一设计 Schema 的 `#/$defs/emailConsumption` 显式校验；现有根结构仍是设计交换格式，不是实际 API 返回值。

| 目标字段／事实 | 当前真实来源 | 消费前必须核对 |
|---|---|---|
| `requestId`、`intentId`、`receiptRef`、`applicationKey` | 持久 request 主键、handoff 意图、result | 同请求读回；客观应用有 applicationKey，同 eventId/episode 不因重启、指纹或 Plan 变化重复消费；确认沿原确认身份，不伪造客观事件 |
| `base`、`replacement`、`proposalDigest`、`arrangementRef` | handoff 的新旧 Plan/Blueprint 版本、result 的审阅摘要及完整 Plan/Blueprint 快照 | 两侧是真实已提交版本，lineage 与快照一致，当前执行仍是 replacement；拒绝未激活草稿、歧义关联、丢失快照或迟到版本 |
| `context`、`phase`、`authorizationDigest`、`recipientRevision` | 同请求 context_json；`captureAdjustmentContext` 冻结 execution/blueprint/draft/draftBlueprint、来源及观察摘要、阶段、完整邮件授权摘要 | 使用实际 authorizationDigest，不虚构 authorizationRevision；应用时的 CAS 与消费/发送时当前授权分别核实。暂停、改址、时区更正及 lease 丢失拒绝旧动作，历史应用事实不被改写 |
| `events`、`observations`、`decision`、`executionVerificationRef` | 同请求 observations_json、decision_json、result.events，以及负责领域公开执行核验依据 | objective_change 必须有 changed 的 open event/episode、适用对象/日期/时区、事实/获取/有效时间、来源及修订、负责 Agent/model/executionRef、理由/义务/证据；仅有自报 executionRef 不证明已核验。缺公开核验或来源过期/歧义即拒绝新通知，不撤回应用 |
| `basis`、`reason`、`appliedAt`、`confirmationRef` | result 与 handoff；人工确认另从 `email.planConfirmation` 读真实回执 | objective_change 不借用确认时间；user_confirmation 绑定真实确认回执、所见 proposalDigest、新旧版本和出发前阶段。当前人工路径 decision=null、observations/events=[]，不为满足统一结构补造 Agent 判断、事件或 validationRef |
| `arrangement`、`effects` | 持久完整快照；既有 outbox、旧版失效及新版定时记录 | 完整新版安排保留日期/时区、活动占时、交通、预订固定承诺；分别读取通知身份、旧工作失效、新版提醒或可恢复安排待处理，不把意图布尔值当执行证明 |

领域投影的结构校验之后，负责 Agent 必须判断其证据完整性和适用性，Storage 复核跨记录关联、摘要、精确版本及授权；模板只渲染已授权内容。领域拒绝不得用 fixture、手写 SQL、MAH 私有接口、直连 Agent 或新调度器绕过。公共判断核验缺失阻断真实客观应用／在线执行证明；不阻断隔离 fixture 验证邮件消费拒绝，也不把 fixture 证明升级为真实 producer 在线接通。

新增持久回执交接在既有 Change 输入显式声明 `locale=zh-CN`，人工确认与系统应用各自保留真实依据及时间；完整安排与实际渲染固定文案使用简体中文，其他三模板和既有默认邮件保留原英语合同。语言选择不依赖关键词，不减弱来源、版本、完整性、收件修订、lease 或 outbox 门禁。主观偏好手机操作不在本期；行程应用、通知和地图交接均不构成预订、付款或叫车授权。

应用与交接意图原子提交后，通知失败保持待处理，不撤回已应用版本。邮件消费复用原 outbox，以 intentId 与收件修订形成唯一逻辑通知，重启读取同一意图，组装后的 HTML、URL、CID 原字节及 Message-ID 冻结。旧 pending/retry 在原发送授权入口失效，sending/accepted/uncertain 历史保留，不盲重发，不承诺网络 exactly-once。通知不等待定时生成；新版安排失败持久保留待处理及原因，按既有身份恢复，不回退固定时刻。必须独立读回 Change outbox、旧版失效、新版 timing／提醒（或明确的持久 pending 状态），完成与待处理分别记录。`acknowledgeTravelAdjustmentHandoff` 的 `email-outbox:<id>` 只证明通知入队与后续安排义务已持久接管，不能作为全部效果完成证据；通知冻结内容保存交接与初始 timing 身份；Schema 32 的邮件安排当前关联按精确 Plan/version 持久指向规范 producer 当前接管的 timing，时区补齐后原始记录与冻结正文保留，效果与用户设置状态读取同一当前关联，原记录仅保留历史，不按 rowid 猜测。分别按精确 outbox、旧版待发工作和当前 timing 记录读回。pending／failed 安排均保持待处理，不宣称已生成；`updateFutureWork:true` 仅是义务。消费崩溃、入队后 ACK 前失败、安排生成失败、重复/并发都须可恢复，且发送边界再次核当前 Plan、收件授权与 lease。旧实现已入队的应用通知按原 intentId／收件修订唯一身份关联持久回执，再走相同可信消费拒绝；不因缺新元数据绕过门禁，不改写 sending／accepted／uncertain 历史字节。T5-2 仍拥有同一版本联合运行和切换验收。

本地领域交换设计合同是 [landi-travel-adjustment.v1.schema.json](contracts/landi-travel-adjustment.v1.schema.json)；它不等于内部 SQLite 表结构或公开 MAH API。根格式与目标邮件消费投影分别校验，不把两者或实际 TypeScript 类型当成同一格式。既有 business v1 不含旅行调整操作，保留原语义；不可把 email_research 当作应用权限。Schema 检查结构，Core／Storage 另验跨记录关联、CAS、事务、幂等、授权与恢复；Schema 通过不证明这些性质。

### 隔离实施与独立验证验收

冻结合同声明 `landi-t3-implementation` 和 `landi-t3-verification` 均为 `application` profile、`execution_environment=development`、`runtime_required=true`，绑定 `landi.t3.behavior` 与 `landi.t3.boundaries`。场景身份引用不是执行证明，以下矩阵补齐具体信号，不修改冻结合同。implementation 补真实缺口并复用已有能力，verification 在其后独立复核；implementation 在本 Attempt 执行源码及隔离开发验证，独立 verification 仍由后续原切片承担。

| 场景组 | `landi.t3.behavior` 正向/无变化 | `landi.t3.boundaries` 反向与证据 |
|---|---|---|
| 场馆与天气 | 适用变化形成可追溯观察；出发前完整替代待确认，行中经门禁应用；无变化不增加事件；多到访、多活动、跨城跨日各有覆盖；当前与预报分开 | 异地同名、身份歧义、无时刻/坐标、截断、未来/过期来源、目标日无预报、无时区、未配置/失败/限流保留未知；保存 Connector 输入输出、适用性判断及 Storage 读回 |
| 保存预订 | 首次基线、时间/状态/地点/时区与分段变化、取消和更正有准确来源；ignored/无变化不新增建议 | 不冒充实时供应商；过去分段、修订冲突、受保护附件边界；恢复关联旧事件，核未发送取消与历史保留 |
| 重复与恢复 | 同事件重复轮询、重建 worker、重新打开隔离磁盘 SQLite、并发仅同一业务 episode；可靠恢复结束警告，再异常新 episode | 在基线/观察/交接边界注入崩溃和事务失败，不丢不重；失败不清警、过期不假恢复；分开读回 pending/retry 与 sending/accepted/uncertain，只验证模拟交接，不重验 T3-2 整体 |
| 版本及授权竞态 | 当前版本观察、所见版本确认一次切换并持久化回执 | await 中替换 Plan/暂停/改收件修订、旧草稿/Blueprint/基线变化、迟到结果、重复点击/丢响应拒绝陈旧动作；记录安全错误及状态前后读回 |
| 阶段、审阅与连续性 | 出发前展示完整来源、未知、影响及新旧安排，精确确认切换；行中客观变化经完整校验应用并持久交接 | 阶段未知、只凭时钟／地图／邮件、主观偏好、无完整替代、冲突、迟到来源、无关新草稿均不自动切换；丢回执先对账；通知失败不回滚应用 |
| 产品与公共合同 | Web 桌面规划与出发前审阅、Email 主动通知，时间服务不等打卡 | 退役聊天、签名页、国家包不可用，原 Work 与公共合同缺失失败关闭；不以时刻/投递/地图推断到达、登机、完成、收信；无真实消息、授权配置、生产迁移、服务切换或外部发布 |

静态结构检查入口为 `node --test scripts/travel-adjustment-contract.test.mjs`，已纳入既有 `test:supplemental`，仅证明本地 Schema 正反样本；不替代下述开发运行场景。`phase` 对应阶段依据，`observations` 对应来源覆盖，`base/context` 对应版本与授权 CAS，`decision` 对应 Agent 判断，`result` 对应人工确认／客观应用与交接。`landi.t3.behavior` 覆盖正向、无变化及真实应用／确认结果，`landi.t3.boundaries` 覆盖全部拒绝、未知和恢复边界。

后续实施 Agent 使用独立开发目录、虚构 Plan/预订、可控时钟、注入 Connector 与模拟 SMTP，补缺并运行受影响 Core/Storage/Connector/Server/Web 聚焦测试及适用 application 检查。后续验收 Agent 从该次源码/开发构建独立执行矩阵及原生 profile，以隔离开发实例分别观察出发前事实→完整审阅→明确确认，以及行中事实→判断→完整校验→应用→交接读回，按治理委派浏览器操作。两者须记录精确源码/构建身份、环境/fixture、开始结束时间、实际命令/退出码、完整失败及复测、状态前后读回、浏览器观察、逐 acceptance ID 的 Agent 终判；未发生的保留未验证。Mock 不证明在线供应商、MAH 承载或真实收信；不要求含本次设计的未来安装版或部署。

本次实施核对冻结义务、源码、责任、设计 Schema 及验收映射；相关 Rules／Skills 同步分阶段边界。Schema 31 仅在隔离开发库验证追加与回滚，保留旧记录，不运行生产迁移。application 保留原脚本与门禁；是否通过以本 Attempt 完整原始结果及最终判断为准。路线/slice-state 由原 Work 标准验收事务结算，不手改；提案完整证据不可读时保持开放。下方历史验收原文保留。

邮件跟随计划目的地的当地时间。用户不设置每日发送时间或固定提前量；选中的应用 Agent 根据已确认行程、预约时间、已核实交通耗时及准备需求生成结构化发送安排，并给出每项安排或省略的理由。后台验证这些安排不更改计划时间，将其绑定精确 Plan 版本和时区并持久化为定时工作，后台重启不重复请求已保存的安排。没有精确时间的活动只进入每日手册，不创建假预约或猜测通知时间。出发机场等固定节点保留独立截止时间计算；预计到达时间不表示已降落或到达。多城市/跨日以活动的日期及时区绑定；时区缺失应在设置/计划中补齐，不猜测时间。

用户不回复不影响后续计划时段的服务。任何时钟与发送成功都不写入到达、登机、活动完成或 Task 完成。旧执行进度保持历史事实，不用作邮件推进条件；当日未完成反馈不阻塞次日。旅行日期结束只结束定时服务，不声称旅行活动全部完成。

激活当天晚于早间时刻，可发一次剩余安排。普通转场/用餐消息有有效窗口，重启后取消过时消息；重要变化检查重新核实证据，而非补发过期警告。每条工作绑定 Plan ID/version；发送前再次比对正在执行的版本。替代草稿不改变当前执行；正式激活才取消旧版本未发送工作。

## 内容

Agent 安排使用独立的结构化运行时请求，只传精确计划中所需的目的地、活动时间类型、交通估算及已解析时区，不传收件地址、发信凭据或预订附件。Agent 不发送消息、不修改计划，不创建 Codex/MAH 系统自动化。后台验证活动身份、邮件类型、当地时间、重复项及发送时间不得晚于计划节点；未定时活动必须明确省略。生成失败或无足够时间/时区信息时不回退到固定 07:30/20/30 分钟规则，而是显示发送安排待处理；有限重试后用户可在设置里重新请求安排。重要变化邮件独立发送，不等待安排生成。计划变更、收件变更、暂停及生成 lease 失效时不得发布旧任务。

用户进一步明确：开源自部署由部署者配置一次发信服务，旅行用户填写并验证收件地址；两者可以是同一邮箱。管理员配置不等于旅行用户授权读取收件箱。当前本机单用户界面不宣称具备托管多租户权限隔离。

邮件在发送窗口内动态生成。调度器读取已激活的精确 Plan 版本、当天行程和计划起点，复用已有资料并查询天气/地图等事实，再通过用户选中的 Codex 或 Claude Code Runtime 搜索相关公开资料并生成结构化内容。AI 不生成邮件 HTML、不拥有计划写入或发信权限；四模板统一渲染。研究资料保留来源与核实时间，计划时间、交通估算和预约事实不被文案改写。提前量覆盖预计交通及准备；活动时刻不表示实际到达，也不是等待上一轮聊天结束后才能触发。

AI 搜索生成有时间预算，发送前复核 Plan、收件人和 lease。生成或搜索失败使用已保存且可靠的信息作为明确的降级邮件，不虚构新事实；同一邮件一旦内容组装完成便保存，已知安全的发送重试复用原内容。正在生成时计划替换或暂停则取消；失去 lease 的 worker 不能发信。只有在确认未调用 SMTP 的阶段失败才能安全重试生成。

Morning 使用关联 Blueprint/Plan 的当日内容与图片，包含交通、日期匹配的天气、预约和准备。Transfer 使用计划起点/目的地、地图查询与可明确标注的估算。Dining 若已安排餐厅就介绍该餐厅，否则使用计划区域的少量备选，提供图片/菜单/来源与交通；不强迫用户选餐厅或打卡。Change 说明事实、影响、建议以及确认状态；无实质变化则不发送。所有内容经过既有来源与完整性边界，缺失图片、菜单和天气不生成假事实。

复用现有地图、天气、菜单和地点图片能力。邮件图片必须是允许使用、可公开访问的 HTTPS PNG/JPEG；本地文件、base64、开发示意图不能进入正式邮件。缺图退化为完整文字，不让发送因装饰图片失败无限等待。邮件正文保持四模板的表格/内联 CSS；设置、确认、暂停和重试在 Web，交互不进入正文。

## 发送与存储

收件设置、验证挑战、Agent 发送安排及邮件 outbox 使用本机 SQLite 持久化。schema 24 移除旧 morning_time/transfer_lead/dining_lead 配置列，保留收件验证、既有历史和凭据边界；新增安排记录保存生成 lease、尝试次数、重试时间及结构化结果。开发仅在隔离实例验证迁移。生产数据库不作为开发迁移样本。每条 outbox 唯一键包含计划版本、邮件类型、活动/日期或变化指纹。重复调度、并发 worker 与重启只领取同一条工作。

SMTP 成功只表示服务器接受；不宣称到达收件箱或已读。连接建立前的可判定临时失败才有有限退避重试。发送过程中超时或连接断开可能已经被接受，标记结果不明并停止自动重发；SMTP 没有服务商幂等查询能力时不得宣称 exactly-once。Message-ID 固定，作为诊断关联而非去重保证。发送凭据不进入数据库、UI 读回、日志或 Task 提示。

收件地址变更使原验证失效并停用自动邮件；未验证或未配置 SMTP 不启用。暂停邮件不会伪造 Plan 完成。验证邮件与测试邮件必须由用户明确操作触发，不能当作普通开发测试发送。

## 历史远程确认设计（已停用，不是当前实现要求）

手机确认是独立、精简的审阅页面，不把桌面规划工作台改成手机版。它仅审阅既有修改流程已生成的替代草稿，展示原安排、完整新安排、影响与仍待核实事项。没有可审阅草稿时，变化邮件仅提供来源和建议，不伪造一个可确认的新安排。

远程入口采用限时签名能力，绑定执行 Plan ID/version、替代草稿 ID/version、关联 Blueprint version、收件地址 revision 和配置的 HTTPS origin。链接令牌只在 SMTP 投递边界注入正文，不保存到 SQLite 内容、不进入请求 URL、日志、Agent 提示或开发证据。签名密钥只在本机环境配置边界保存；页面通过 URL fragment 接收令牌并在内存中使用。只向持有有效能力的客户端返回此次对比所需的最小行程投影，不能访问 Profile、完整 Workspace、预订附件或发信设置。

页面 GET 和对比读取都不修改 Plan。确认必须显式 POST 提交所看到的全部版本，走与桌面相同的激活校验及 Storage/Core 事务；同时校验旧执行 Plan、当前草稿和 Blueprint，保存确认时间并取消旧版本待发工作。重复提交返回同一确认事实，不重复切换或重复通知。确认后按 Change 模板发送已确认状态邮件，仍受收件验证、启用状态与发送边界约束。保留原安排按钮只是结束本次阅读，不隐式批准或删除草稿。

`LANDI_EMAIL_REVIEW_BASE_URL` 只允许公开 HTTPS origin，`LANDI_EMAIL_ACTION_SECRET` 由本机设置保存时生成，不读回 UI。生产默认关闭远程入口；未配置时不给邮件注入本地或占位链接。公开发布只允许 `/email-review` 与 `/api/email-review/view`、`/api/email-review/confirm`，其余工作台/API 继续限制本地 Host/Origin。反向代理必须仅发布这三个入口，设置固定 Host，保留 TLS；配置地址本身不证明手机可访问，开发不启动隧道或部署。隔离验收可注入只限 loopback 的临时配置，不进入正式环境配置。

打开邮件链接是只读动作，不构成修改确认。确认页面提供原安排、建议、影响及版本；明确提交后使用当前 Plan 版本和既有替换确认规则。过期/旧版本入口拒绝修改。不会创建另一套 Plan 或绕过 Core。

邮件内远程操作入口需要配置手机可访问的 HTTPS 基础地址。localhost 只能用于开发，不作为途中可用的入口；未配置公开入口时在 Web 明确提示限制，不宣称有远程确认闭环。不在开发任务内自动部署、开隧道、注册账号或发布图片。

## 退役渠道与历史数据边界

Telegram、WhatsApp 及其主动发送、轮询、配对、Webhook 和命令入口已退役，不作为可选渠道保留。旧 Plan 绑定、聊天凭据和历史 schema 仅作为兼容记录保存；不因旧绑定、邮件暂停、SMTP 故障或收件配置变化重新启用聊天服务。此范围同步不删除凭据、历史数据库表或记录，不执行生产迁移或服务重启。

邮件是唯一主动发送路径，但退役聊天绑定不构成邮件授权。未明确配置并验证收件人的 Plan 保持主动发送静默。旧卡片、按钮和历史命令不能修改当前执行状态，也不能成为恢复旧引擎的依据。目的地研究、天气、交通和用餐能力继续通过共享旅行能力供 Web 与邮件使用。

## 完整验收

隔离实例验证收件设置/地址变更、验证失效、重启、发送 lease、可判定失败与结果不明、计划替换、取消与过期工作、全天无反馈的邮件推进、跨日跨城市、餐厅有/无预约、事实缺失、变化去重与重大确认。真实桌面 Web 观察设置与出发前精确确认，行中观察应用及同版本交接；手机只保留阅读邮件，不再要求远程审阅，不使用历史签名页测试作为通过证据。四模板三种手机宽度、深色/无图验证延续。真实 Gmail/iCloud 收信需用户指定地址及账号配置后另行验收；未实际测试不得标记已通过。

邮件生效消费的后续开发验收须在独立磁盘 SQLite、真实隔离 Server、虚构 Plan、可控时钟及假 SMTP/AI/Connector 中，分别读回两种 basis、缺 producer／公开执行核验、陈旧版本／授权、完整安排缺失、事务中断、并发、重启、通知已入队但新版安排仍待处理、lease 丢失与 uncertain 不重发。结构 Schema 的错字段样本不能替代跨记录错版本、错收件修订和来源适用性拒绝的实际领域测试。按 `landi-email-email-runtime` 的 behavior、boundaries、review、agent-timing 四项 acceptance ID 独立判断，未运行的保持未验证。

受影响生效 Change 邮件的18格实际视觉矩阵为三宽度（375/390/430）×两种文本（普通／压力）×三种显示（明色正常图片／暗色正常图片／完全阻断图片）；每格保留实际宽度、事实/完整安排、操作和可读性观察及截图，两种 basis 的差异另核。其他三模板及 Change 既有默认英语、Morning 原时间/未定时区域与圆线、Dining 图片来源、四模板链接及 MIME/CID 原字节恢复继续按原合同回归，不以18格缩减原信号。原 Design Kit HTML、390px 原图及原 PNG 须先核身份和可访问性，缺原件明确保留，不能以衍生图或当前截图替代。GUI 按治理委派 Terra；支持入口预检或历史截图不等于这18格，本指导修订不执行下游矩阵。

交付时先记录本次源码／构建身份、实际命令退出码、完整失败与复测、持久前后读回和负责 Agent 终判。执行者在每个改动仓库完成提交、从绑定源仓目标分支 fetch 并合入精确 FETCH_HEAD，核其包含于 HEAD；不推送源仓、不操作源仓 Git。执行者返回后，宿主才捕获本次 closing-sync 冻结签名及后续交付证据；不得要求执行者提前取得未来签名，也不得用其他 Task 的签名、普通祖先关系或历史 coverage 替代本次最终同步。原失败历史继续保留。完整 Work 成果真正具备后，严格 `mah/change-request-delivery/1` 工件及只读检查必须使用原 Task Request 外给的五项身份和精确 delivery_contract；本轮指导／Schema 工件不得冒充整个 Work 已 delivered，也不预判宿主未来验收。


## 历史实施与验证记录（2026-10-13）

本节保留当时的实现、测试和渠道过渡记录；它不声明旧命令、聊天渠道或签名确认入口目前可用，不覆盖上方当前范围。

本轮新增应用 Agent 发送安排及 schema 24 迁移、保存/刷新发信表单修正：服务端 527、Storage 78、Agent Adapters 81 项测试通过；完整设置页 9 个隔离浏览器场景通过。后台安排使用 Codex/Claude 的独立、无发信/外部操作工具的结构化请求；结果和安排理由持久化，运行时未报告的模型身份明确保留为未知。所有新安排验证均使用模拟 Agent 与 SMTP，实际在线 Agent 的定时选择质量未经验证。早期治理更新失败由项目依赖缓存未忽略引起，排除生成的 `.pnpm-store/` 后通过规范写入器成功更新原 T3-2 合同，未绕过写入器或声称切片交付。

当前工作树已接线邮件运行时。开发检查使用隔离实例；随后按用户明确要求更新并重启同一 Landi 后台，先验证数据库备份，再将当前实例升级到 schema 24。已核对非密码字段恢复、密码不读回、旧时间设置移除、自动邮件仍关闭；未发送真实邮件或部署公网入口。

- `packages/connectors/src/email.ts`：SMTP 适配与可判定失败/结果不明分类。
- `packages/storage/src/email-store.ts` 与 schema 24（23 保留邮件历史）：收件验证、时区设置、队列、lease、内容/研究来源保存、变化事件去重及有期限的旧 Plan 连续性。
- `apps/server/src/email-schedule.ts`、`email-execution-worker.ts`、`email-content.ts`：计划时间调度、发送前复核、固定模板渲染、实时路线查询和事实缺失降级。
- `packages/agent-adapters/src/email-research.ts` 与所选 Runtime 方法：三类常规邮件的公开来源研究、结构化文案、核实时间和依据；不输出或执行发信命令。重要变化邮件由新近查询的场馆/天气/保存的预订事实动态组成，当前不自动生成替代 Plan。
- `email-attention-monitor.ts`：事实变化通知与恢复取消；查询失败不构成变化，不阻断普通邮件。过期来源不会无限补发。
- `email-execution-routes.ts`、Web `EmailExecutionSettings.tsx/.css`：发信连接检查、收件验证、时间/时区设置、启用与暂停、发送状态。原 first-run readiness 使用邮件条件。
- `email-review-capability.ts`、`email-plan-review.ts`、`email-review-routes.ts`、`email-review-page.ts`：SMTP 边界注入签名入口、手机原/新安排对比、显式精确版本确认与确认回执。审阅页显示具体地点、时间类型、计划时长和待核实事项；不复用位置或逐站完成流程。
- `plan-activation.ts` 与 Storage/Core 事务：桌面与手机共享发布检查，事务内检查原/新计划、Blueprint 与收件版本，切换一次、取消旧队列并保存确认时间。
- Telegram 旧到达/延迟/完成按钮及旧 arrival-route 位置请求在邮件模式下失效；暂停不恢复。主动 `/go`、`/food` 仍可按用户请求提供帮助。

设置入口位于应用 Settings → Travel emails。旅行邮件卡片位于设置页顶部，集中提供发信服务、收件验证、发送时间和手机确认地址配置。发信区明确显示未配置/已配置状态；已保存的凭据不读回，空白输入不表示配置丢失。首次配置需要完整发信信息；已有凭据可留空保留，但更换发件账号需要新凭据。保存后保留非密码字段，只清空密码，明确提示已保存；刷新从窄化 API 读取服务器、端口、账号、发件地址和密码是否已保存，不读取密码。连接检查本身不发送邮件。连接失败、明确授权失败和未分类检查失败分别提供安全的错误类型；网络/握手失败不得表述成密码错误或建议反复修改密码。只投影稳定类别，不输出 SMTP 原始响应、账号、凭据或内部异常。部署者填写 SMTP server、secure port、sender account、From address 和应用专用凭据；收件人可与发件地址相同。收件地址需主动请求验证并输入验证码，随后再主动启用。发信凭据仅写入已有本机配置边界，API 不读回；不会访问收件箱。自动时区查找不可用时，可按行程城市添加时区后保存。界面不再提供 Morning handbook 时间、Transfer preparation lead 或 Dining lead 输入。安排失败时可选择 Arrange emails again；Agent 安排失败不影响已有重要变化通知。静态视觉预览仍为 `http://127.0.0.1:5186/email-preview.html`，不连接发送服务。

实际验收：Core 103、Agent Adapters 79、Connectors 40、Storage 78、Server 512 项测试通过。Server 构建与全项目类型检查通过，后续 Server/Web 变更也单独通过检查。固定四模板 22 个隔离浏览器场景通过；实际邮件设置组件 7 个隔离浏览器场景通过，包括时区、验证、启用、无发信配置时暂停、地址变更，以及 375/390/430/1024px。独立手机审阅页 9 个浏览器场景通过，覆盖三种宽度、暗色、保留原安排、明确确认、已确认入口重开、过期和扫描读取；服务端补测收件变更、暂停、原/新版本失效、签名、公开 Host 的私有 API 隔离、令牌不持久化及旧 Telegram 入口。生成与 SMTP 均使用模拟客户端；实际 Agent 在线研究质量、Gmail/iCloud 收信和手机邮箱自动反色未经测试。

本轮设置入口验证使用完整 `SettingsWorkspace`，而非单独的邮件卡片：8 个隔离浏览器场景通过，另验证卡片位于设置顶部、发信配置状态、空白表单不可保存、连接检查不发送，以及 375/390/430/1024px 的完整设置布局。Web 类型检查与构建通过。证据位于 `output/email-settings-entry-verification/`，不代表真实 SMTP 或客户端验收。

原始开发日志和截图保存在忽略目录 `output/email-runtime-verification/`、`output/email-settings-verification/`、`output/email-template-verification/`、`output/email-review-verification/`。保留早期失败：样例缺少有效 stops/routes/evidence；测试使用旧 schema 22 断言；设置页标题等待与时区控件可访问名称不完整。修复后复测通过，不用初次失败截图冒充通过截图。

复核命令（从组件目录，使用隔离数据与模拟发送）：

```sh
pnpm --filter @c-assistant/server exec tsx --test src/email-execution.test.ts src/email-execution-routes.test.ts src/email-attention-monitor.test.ts src/email-review.test.ts src/telegram-email-boundary.test.ts src/email-templates/templates.test.ts
pnpm --filter @c-assistant/agent-adapters exec tsx --test src/email-research.test.ts
pnpm --filter @c-assistant/server exec tsx ../../scripts/verify-email-settings.ts output/email-settings-verification
pnpm --filter @c-assistant/server exec tsx ../../scripts/verify-email-review.ts output/email-review-verification
node scripts/verify-email-preview.mjs output/email-template-verification
```

当前工作树已实现手机重大修改入口与精确版本确认，并完成隔离浏览器闭环；Change 的待确认和已确认邮件明确区分。变化监控不会自行编造或批准替代 Plan：只有既有修改流程保存了完整草稿，才生成待审阅邮件。未配置公开 HTTPS origin 时不发送确认占位入口，用户仍可在本地工作台审阅。

仍待真实部署/独立验收切片与过渡期结束后的旧引擎清理。公开 HTTPS 的可达性、真实手机邮箱跳转与回信未验证，不宣称远程生产闭环已交付。localhost 不是远程入口；不能把本机完整 workspace 对外开放作为替代实现。

真实验收还需要部署者配置发信服务、用户指定测试收件地址与真实测试指令，以及允许使用的公开 HTTPS 图片和适当的操作入口部署。本开发阶段没有注册账号、发真实邮件、发布图片或启动收信。T3-2 保持实施中，不从上述模拟与浏览器通过推断签名交付、后续切片验收或正式发布。

实际连接排查补充：同一现有本机代理下 Google HTTPS 可连接，但 Gmail SMTP 587 欢迎信息和 465 TLS 握手均失败；公开 DNS 的地址通过代理/直连也失败。此证据只定位到认证前网络路径失败，不能断言具体节点、运营商或密码原因。补充的 Connector/Route 安全错误分类共 6 项测试及设置页 10 个隔离浏览器场景通过；不修改系统代理、不发送真实邮件。

2026-10-14 后续排查纠正：普通 socket 仍可能经过 TUN。明确绑定物理网卡后，Gmail 465 的 TLS/欢迎信息及 587 的 EHLO/STARTTLS 均成功，先前失败仅代表先前测试的网络路径。

SMTP 独立直连配置：部署者可设置 `LANDI_SMTP_DIRECT_INTERFACE`（例如 `en0`）与 `LANDI_SMTP_DIRECT_DNS`（逗号分隔的 IPv4 DNS 地址）。直连网卡与两种 DNS 配置均为空时维持系统网络；显式直连配置必须包含有效网卡与一种有效解析模式。运行时从指定网卡获取当前 IPv4 地址，UDP DNS 解析（采用该模式时）绑定该本地地址，SMTP socket 也绑定它；不保存用户 IP 或 Gmail 的固定 IP，不修改系统代理、TUN、订阅及其他 API 路径。使用 Node 自带 DNS/net 和 Nodemailer 的自定义连接入口，无新增依赖。拒绝代理 fake-IP 地址；网卡缺失、解析或连接失败时明确失败，不自动回到代理路径。DNS 和建立连接有总超时。465/587 继续保留正确主机名/SNI、证书验证及 TLS/STARTTLS；只替换连接建立阶段，不改变凭据边界、outbox、重试或发送授权。绑定本地地址的实际路由效果需在部署机器验证，不能宣称所有系统/TUN 都被绕过。

本次直连验收：Connectors 45 项与邮件 Routes 3 项测试通过，Connectors 构建通过。物理网卡绑定加独立 DNS 的实际 Gmail 账号认证通过；在隔离空数据库、临时本地 HTTP 端口上的 `sender/check` 返回 200/ready=true，未发送邮件。用户已授权保存这台机器的直连配置，原发信字段及密码保留且私有备份已创建。完整 Server 构建失败于另一项尚未完成的 MAH generation carrier/恢复流程改动；未修补其源码，未重启运行实例，不能声称现有 8787 后台已采用直连。未执行正式邮件发送、客户端收信或 Evolution 切片交付。

后续用户明确要求重启时，Server 类型检查及 Connectors/Server 构建均已通过。创建并验证当前实例的 SQLite 备份后，重启原 `io.landi.local` 服务；实际 8787 后台 `sender/check` 返回 200/ready=true，SMTP 直连及账号认证已在运行实例生效。自动邮件仍为关闭状态，未发送邮件。此运行检查不等同于完整生成流程验收、客户端收信或正式切片交付。

实际手册测试进一步发现：不同解析路径返回的 Gmail 地址可达性不同，UDP DNS 取得的地址可能连接超时；此前一次认证成功不足以证明持续发信稳定。可配置 `LANDI_SMTP_DNS_HTTPS_PROXY` 为无凭据的本机 HTTP 代理 URL（仅允许 `127.0.0.1`/`[::1]`），仅用于通过固定 Google Public DNS HTTPS 接口查询 SMTP 主机 A 记录。配置该项时只使用 HTTPS DNS，原 UDP DNS 不参与回退；SMTP socket 仍绑定指定网卡，邮件、账号认证不进入代理。HTTPS 查询保留 TLS 验证、响应大小和超时限制；不把 Gmail 地址固定在源码或配置中。无此项时仍使用显式 UDP DNS 服务器。网卡必填；任一解析路径失败均不改走系统/代理 SMTP，不扩大允许的代理目的地或外部发送授权。

用户明确授权按当前 Plan 测试后，单封每日手册使用实际 Plan 只读投影、Codex 在线研究与正式模板生成，包含 4 张 HTTPS 图片、4 个研究来源，正文约 23 KB。收件设置为空，按既有会话授权发送至此前配置的同一 Gmail 账号，不修改收件设置或验证状态。两次投递在连接阶段被明确拒绝，私有记录保留；修正 HTTPS DNS 后，一次投递获得 SMTP accepted。未把拒绝或未知结果视为已收信，未盲目重复接受过的邮件，未激活 Plan 或开启自动邮件。实际收件箱显示、图片加载和手机邮箱样式仍待用户收信验收。Connectors 47 项、邮件 Routes 3 项测试通过，Connectors/Server 构建及 Server 类型检查通过；这不代表四种邮件与完整自动执行已完成真实验收。

最新邮件编辑要求：四种正文、标题、alt 与链接名称均使用英语；只复用样稿结构和样式，不套用样稿旅行文案。导语、地点说明及各提示分别限一句简短句子；保留实际 Plan 身份、顺序、时刻和确认事实。Morning 仅把有具体开始时间的安排放到时间轴，无具体时刻的活动另列 At your own pace，删除 Planned 标签；确认预约仍须可辨认。2026-10-14 新版参考要求取代分段短线：时间、连续浅绿细线与活动正文形成三列视觉布局，圆点与线同心且时间与标题对齐；连接线仅存在于首末定时节点之间，不穿透空心节点、不产生首尾尾线。地图保持一个主要按钮，官网来源在其下以简短官方名称的文本链接呈现，不把标题、日期和核实说明塞进按钮。邮件组装前请求 Agent 搜索目的地的官方资料与指定日期天气，返回带来源、日期匹配且简短的英文内容；天气接口缺失时使用已核实的短期官方预报，超出预报期则明确 unavailable，不用当前天气或季节平均冒充当日预报。失败时使用明确未核实的英文保存事实，不虚构状态。需验证英文、时间完整性、未定时隔离、天气日期和来源、移动宽度与长标题，以及真实资料生成。

本轮英文编辑验收：27 项邮件模板、内容、审阅、监测和研究边界测试通过；四模板 22 个隔离手机浏览器场景通过，包含 375/390/430、深色、图片失败与长文本，额外验证了圆点/线中心偏差不超过 1px、无中文及无 Planned 标签。真实指定 Plan 的手册经 Codex 在线研究生成，保留五个计划时刻、未定时活动独立呈现，所有四张图片在浏览器加载成功，三种宽度均无溢出、圆线对齐且无白色来源按钮。日期按英文日历展示，交通摘要与城市标签来自实际路线/地点。未再次发送邮件；真实 Gmail/iPhone Apple Mail 新版显示待用户收信验收。实际手册 HTML 与截图仅保存在被忽略的私有运行数据目录，不进入源码或测试夹具。应用内浏览器拒绝 file 协议导航，未绕过其策略；可查看现有 HTTP 开发模板预览或本机生成的静态截图。


## 每日手册 Premium Travel Editorial（2026-10-14）

新版用户设计图是 Morning 的主要视觉依据：奶油白与深松绿、衬线大标题、背景照片封面及底部深绿渐变、日期城市和实际标题/导语、浅色嵌入式摘要卡、浅鼠尾草绿天气卡、连续时间轴、照片与短句过渡、单列大图景点卡、统一交通及准备卡、全宽地图按钮、轻量官网链接与简短页脚。摘要完全使用已有数据，不推断节奏或天气；不凭名称分类行程类型。未定时区域独立保留。仅修改模板视觉层，不改变研究、发送、预览和 Plan 逻辑。

邮件用 presentation table、内联 HEX 色与系统 Georgia/Arial 字体；色值由模板常量输出，不依赖 CSS 变量、外部字体、定位、JavaScript 或 Flex/Grid。渐变/阴影/背景照片是增强：背景图片未加载或不被客户端支持时保留实色深绿封面和全部文字；Outlook 可降级为方角与无阴影。不把浏览器截图验收称为真实邮件客户端验收。以真实已有行程生成 375/430 整页图，检查长标题、无图片、深色、链接与数据完整性。

本次新版验收：28 项邮件模板/执行/研究/审阅/监测测试通过；23 个隔离浏览器场景覆盖原四模板三宽度、深色、无图、长餐厅名与新增 Morning 长标题。实际新西兰 Plan 的五个原始时刻和未定时区域、全部原有 HTTPS 链接与四张照片保持完整；375/430 整页截图及 375 深色/无图截图存于私有运行目录。HTML 约 25KB，无脚本、CSS 变量或外部字体。连续细线采用单列背景渐变，以避免多行描述推移节点；不支持背景渐变的客户端可能仅显示对齐圆点，仍保留全部时刻与文字。封面照片、圆角与阴影也属于增强；Outlook 旧版未实机测试，Gmail/Apple Mail 收信渲染与自动反色亦未实机验证。没有发送新的邮件、改变行程或启用自动发送。

Morning 视觉精修继续以同一新版参考为准：封面减轻遮罩并保留照片明亮区域，摘要卡横跨照片与奶油底色，使用纯文本轻量装饰与图文渐变横幅。时间轴图标只由调用方明确的 isTransfer 字段显示交通箭头，其余使用中性地点符号，不根据名称推断用餐/住宿类型；手机单列卡片压缩图高与留白，保留全部事实。此项属于原 Premium Travel Editorial 合同范围内的还原修正，不改变研究与执行语义。

本轮精修复核：Server/Web 类型检查通过，17 项模板与执行测试、23 个手机浏览器场景通过；已查看实际375px新版整页图，封面变亮、摘要跨底色、连续节点对齐、图文横幅柔和融合。过期研究缓存被既有验证拒绝后重新经原 Agent 研究流程生成（4个来源），保留全部五个原始时刻、未定时区域和地图链接。375/430无溢出，深色和无图降级通过；没有发送邮件。照片继续使用现有真实资源，封面主体与用户参考图片仍不同，邮箱客户端实机限制保留。

图标还原修正：删除箭头/星形占位符，使用与参考相应的巴士、相机、餐具、汽车、树林实心剪影与统一40px浅色圆底。剪影以压缩的逐行 HTML presentation table 输出，不使用 Emoji、字体图标、SVG、data URI、外部图片或 JavaScript；属于装饰性视觉，不能替代路线方式与已确认事实。调用方投影视觉 iconKind：meal 原始块为餐具，transfer 原始块/角色为交通剪影，明确自然类地点 category 为树林，其他地点为相机；分类仅决定装饰，不写入领域状态或生成交通事实。保证 HTML 不超过95KB，375/430渲染及图片失败时图标可见，客户端实机尚需验证。

图标修正验收：七项模板测试（含逐行24px剪影完整性与无外部资源）及23个浏览器场景通过；实际Plan图标顺序为bus/camera/dining/car/forest，375/430无溢出，正文约59KB。剪影边缘进行多点采样平滑，圆底40px，交通/用餐节点空心、景点实心。已查看实际时间轴局部图，形状是依照参考的独立重绘，并非原图素材的逐像素复用，不声明100%相同；邮箱客户端实机验证仍待完成。

## 当前设计基准：Landi Email Design Kit v1（替代前述概念图与重绘方案）

用户提供的 Design Kit 原始HTML DOM与mobile-390截图为最新基准：照片与深绿文字相邻分块、独立白底摘要、PNG图标、四列时间轴、浅绿未定时卡、引号与叶片分隔、横向图文Highlights、路线/准备卡、地图及官网链接。最大邮件容器600px，375/390/430手机留白24px，极窄屏17px。不新增桌面产品页面，仅验证同一模板较宽容器。继续使用现有Landi字标与真实HTTPS照片；不复制样板照片/地点/时间/天气/预览状态。

用户已明确允许原PNG图标CID内嵌附件：将原文件纳入源码，生成固定字节目录，模板仅带cid引用与用到的去重附件；组成内容与附件一并经原outbox保存/恢复，SMTP只把已验证PNG字节作为inline附件提交，不读取任意文件/URL，不改变重试与发送授权。正式HTML没有base64或相对本地路径；开发展示副本把CID转换成相同PNG的data URL以浏览器渲染，禁止发送展示副本。测试原字节/内容ID一致、MIME内嵌、无重复、缺失/非法附件拒绝、恢复后字节保留、原Plan时间和边界不变。

内嵌公开PNG附件的唯一序列化合同在Core email-presentation中定义，Storage与Connectors均消费同一类型；Connectors新增已有Core的本地workspace类型依赖，无新增外部框架或SDK。PNG原文件为权威资源，icon-data.ts由导入脚本生成并记录摘要，不作为第二套独立编辑来源。

Design Kit v1 集成验收：35项模板、执行、研究、监测、审阅和SMTP测试通过；23个四模板预览场景与20个0/1/5/10活动/四宽度/原HTML对照场景通过。原PNG逐字节一致、CID无重复、非法或缺失附件预发送拒绝、实际multipart/related MIME中的PNG字节一致、文件发件箱重启恢复附件均已验证。邮件相关模块、Connectors、Storage、Web与当前全Server类型检查通过；期间并行MAH生成改动曾造成全Server类型错误，在重新生成Storage声明后复测通过，未修改这些并行源文件。品牌继续使用现有字标并按参考调整尺寸，不采用演示Logo/JPG；正式CID正文约30KB，data URI仅存在于私有开发展示副本。实际行程375/390/430及600容器截图存于私有运行目录。

尚未进行真实Gmail/Apple Mail/Outlook收信验收；需人工检查CID图标是否内嵌显示、图片屏蔽后文字/地图是否完整、自动深色是否可读，以及旧Outlook的圆角/背景线退化。本次没有发送新邮件或重启现有服务，已更新源码、构建产物和本地开发预览。正式HTML及附件与展示副本分别保存，禁止把展示副本用于发送。

Morning 的引号/叶片过渡区使用独立 poeticLine：由选定 Agent 依据当天真实地点、活动与已核实体验生成一句不超过120字符的自然、有诗意的英文，不套用固定标语、不重复封面导语，不暗示实际到达或虚构天气/预约；空白、不可用或研究失败时整块隐藏，无固定句降级。该内容随已组装邮件持久化，重试不再生成。

Morning 的 Today’s itinerary 仅呈现计划时间、原PNG图标及活动名称；普通景点/交通介绍不显示。已确认预约与确实必要的预约或出行要求保留为短提醒，依据原计划/预约事实由 Agent 提取，不以关键词判定重要性，不新增要求。Places to explore 保留照片与一句介绍。未定时活动仍单列；不变更原计划、时间、事实或发送边界。

2026-10-14 当天诗意文案及精简时间轴已按用户明确授权应用：用户允许本次先修改模板、暂不等待 MAH 合同同步；canonical row update 两次返回 project_git_head_mismatch，合同同步仍待恢复，不声明切片交付。新增可选 poeticLine 与活动 reminder，研究提示以当天实际体验生成短句、从既有要求提取必要提醒；时间轴不渲染普通 detail，未定时与景点区保留介绍，确认预约标签保留。30项研究/模板/执行/SMTP测试、Server/Web类型检查及23项手机预览场景通过；真实11月6日行程新研究生成预览，未发新邮件，未重启服务。

真实11月6日新版整页预览：375/430px无横向溢出、5个定时节点同心、全部图片加载成功；本日无必要的定时行提醒，普通介绍未出现在时间轴。独立诗意句由新研究生成（6个官方来源），空白/无来源/越界与不支持语言的验证均通过。旧可变 revised-handbook.html 展示副本已更新，原投递记录和发送内容未改写。

Dining照片缺口修复：Agent对每个实际餐厅搜索可核实的实景或本店菜品照片，结构化返回targetId、HTTPS图片URL、英文alt、已列出的sourceUrl和身份适用理由；优先官网、运营者公开页面、官方旅游资料或本店配送菜单，不用通用图库、相邻店照片、臆造路径、需密钥的Places Photo链接或短期签名URL。既有照片优先；Server复用公共HTTPS图片探针检查最多3张，将探测通过的照片传给卡片；明确识别为代理合成DNS时保留已核实来源的照片并标记recheck，实际私网与明确坏图拒绝，保持来源与图片关联随outbox冻结；失败按餐厅独立降级、正文与操作链接完整，不改变餐馆/行程/预约/发送权限。用户此前允许先应用本轮模板修订，MAH合同同步问题仍如实保留。

照片真实网络验收修订：现有图像探针在本机代理198.18/15合成DNS环境返回unknown，即使照片可返回JPEG。复用已有Blueprint的source-backed/recheck降级原则：仅对明确的代理合成DNS保留Agent已核实来源的HTTPS照片并记录status=recheck，服务器不向合成/私网地址发探测请求；真实私网DNS、无解析或明确坏图拒绝。正常探测通过记录available，404/非图片拒绝。浏览器另验实际加载，不将unknown说成已通过服务端探测；不改网络/SMTP配置、DNS/IP防护、或全局图片pipeline。

2026-10-15 Dining照片修复验收：43项研究、邮件执行、照片/原图片探针及模板测试通过，Agent Adapters/Storage/Server构建及Web类型检查通过。当前真实行程新研究得到Pinoy Tres Cuisine、Trail Kitchen、Okareka Restaurant三张来源绑定照片；375/430px浏览器实际3/3加载、无溢出、所有链接HTTPS；375px阻断图片后正文及操作链接仍完整。本机合成DNS导致服务端探针状态recheck，浏览器加载成功另记为真实展示证据，不伪称服务端独立探测通过。来源/照片及状态随发件内容冻结，无数据库迁移；没有发送新邮件。MAH合同更新仍返回project_git_head_mismatch，按此前用户允许先应用模板修复的边界实施，不宣称治理切片已交付。

邮件打车入口：四模板复用原执行服务目录与Connectors手动交接，不引入下单API。以已配置UBER_CLIENT_ID为本次邮件打车开关；只读该公开client id，不向Agent提供配置或凭据。按具体计划起点的坐标反查国家/城市，复用有效期内第一方supported覆盖；unknown/check_in_app/过期/解析失败不显示，不根据整趟Plan国家猜测。Uber使用现有handoff扩展的无GPS模式pickup=my_location，目的地名称/地址可预填，实际起点由Uber确定与用户确认。Grab使用官网公开OneLink域及BOOKING深链的HTTPS入口，保留官方安装页fallback，不臆造目的地预填参数；提示用户手动填写目标。Morning地点卡、Transfer路线卡、Dining每家餐厅及Change明确已确认且含目的地的内容支持同一可选ride结构；未确认替代/闭馆地点/没有明确目的地的变化通知不显示。HTTPS表格按钮保持导航入口，用户在服务中确认价格/车辆/付款；邮件不跟踪位置、不改Plan、不预订、不自动发送测试。链接与已组装正文一起冻结重试；验证配置/国家城市/过期/缺失起点/四模板/窄屏/重大变更边界。
来源：Uber官方deep-links introduction（https://developer.uber.com/docs/riders/ride-requests/tutorials/deep-links/introduction），Grab官网download（https://www.grab.com/sg/download/）及BOOKING公开链接（https://www.grab.com/th/campaign/consumer/grabxtat24/），2026-10-15核对；手机App跳转与邮件客户端实机验收单独报告。

2026-10-15邮件打车入口实现验收：复用地区服务目录与Connectors，添加Uber无GPS(my_location)模式及Grab官方HTTPS OneLink到BOOKING；保留现有Telegram传入GPS时的行为。Morning每地点卡、Transfer路线卡、Dining每餐厅自动使用配置及地区门槛；Change模板仅已确认且调用方提供明确目标的内容渲染入口，现有泛化确认回执/闭馆/天气建议不凭空挑选叫车目的地。76项邮件、地区服务、确认和Connectors测试通过；24个四模板×两服务×375/390/430px隔离布局场景无溢出且按钮高度>=44px；Server/Web类型与构建通过。当前实例UBER_CLIENT_ID未配置，实际邮件正确隐藏；未注册/修改配置、未发新邮件、未叫车。App在Gmail/Apple Mail中的实际唤起与登录后目标识别未实机测试；Grab目的地需手动输入。MAH合同更新仍为project_git_head_mismatch，保留待同步状态，不声明治理切片交付。

2026-10-15 supporting-template refinement: visual-only Transfer/Dining/Change redesign using the existing design kit; preserve research provenance, route links, conditional Uber/Grab handoffs and proposed-versus-confirmed behavior. Produce new private preview artifacts; never rewrite previously accepted bodies or send journals. MAH T3-2 contract synchronization remains pending under the user's explicit template-change waiver after project_git_head_mismatch; no delivery completion is claimed.

Transfer refinement (2026-10-15): render distance, route duration and estimated arrival as separate fields. Estimated arrival is planned departure plus a verified route duration, with next-day indication; never derive it from the following activity's start time. Show that start separately as the itinerary target. Missing route facts remain explicitly unavailable. Resolve absent endpoint coordinates through the existing provider's address geocoder using the named planned place and city, retain only the ephemeral projection and reject stale/invalid responses; do not mutate Plan coordinates or infer actual pickup. Prefer the exact leg's declared supported mode over the overall preference. Preserve conditional Uber/Grab coverage/configuration gates; when unavailable show an inactive ride control and an honest explanation, never a fabricated functional link. Update local preview from the actual renderer, no SMTP.

On the Way V2 uses the compact supplied layout and original PNG assets. Transfer time arithmetic now consumes the same known city-zone projection as scheduling, formats destination local ETA and calculates numerical lateness from dated instants; absent/invalid zone or route duration suppresses numerical conflict. Rendering never determines lateness from prose or text comparisons. Unavailable ride controls are omitted. Real available handoffs keep the existing gate. Other email types and SMTP/outbox/Plan behavior stay unchanged. The earlier inactive ride placeholder guidance is superseded for Transfer.

Visual correction: the confirmed target-image composition now supersedes the compact Transfer arrangement. Background-image/VML hero uses the same source photograph and separate accessible HTML text; dated lateMinutes remains unchanged. Support actions link only to an existing official place URL, a sourced weather URL (or the same explicit weather-search fallback already used by Morning), and Maps' route-options page. Such links do not assert current forecasts or transport availability, alter the Plan, or request a ride. Restore the brand footer without repeating the planned-location disclaimer.

Event-specific photographic heroes (2026-10-15, explicit user override): Important Update no longer chooses a fixed scene illustration by event kind. Preserve the exact accepted shell/cards/type/buttons. A public-only visual brief (city, destination, planned activity, concise public issue) drives an image-generation Connector before final outbox content is frozen. Never send booking IDs, traveler names/contacts, coordinates, SMTP or Agent secrets to the image service. Use fixed official Images API, bounded time/response/image dimensions, generated JPEG CID bytes with an AI-generated atmospheric-image alt/visible caption; numeric facts remain HTML and images are not incident evidence. Reuse persisted output on retry; version/recipient/lease checks still precede SMTP. Unconfigured/failed generation produces a readable image-free email, never the rejected fixed illustration or a made-up photo URL. Deployment owner enables LANDI_EMAIL_HERO_ENABLED and supplies OPENAI_API_KEY; optional LANDI_EMAIL_HERO_MODEL defaults to official gpt-image-2.5-flare. No service enabling/config credential writes or test email sending implied. Existing icon PNG support remains; bounded verified JPEG support is added to the same CID transport/preview path. Six-case fixture illustration imagery is superseded; the current arrival-conflict preview uses the actual previously generated Rotorua/forest-transfer header. Live provider readiness is reported separately from injected tests. Existing user template waiver applies; contract sync remains pending.


Event-photo implementation verification (2026-10-15): Core, Connectors, Storage and Server TypeScript builds pass. 54 focused tests pass, including JPEG MIME transport, provider opt-in/failure/bounds, generation persistence/retry reuse and recipient pause during generation; the final public-city guard was rebuilt and 6 affected tests passed again. Six distinct built-in ImageGen photographs were embedded in six complete simulation emails; 49 multi-width/theme/blocked-image/layout checks plus 7 current-email checks pass. Demo assets/prompts/provenance are in data/email-manual-tests/2026-10-15-event-photo-hero; six-case output in 2026-10-15-important-update-photos. These are demonstration outputs, never a production event-type image bank. No live Images API request, actual email-client test, SMTP delivery, backend restart, Plan edit or credential write occurred. OPENAI_API_KEY remains absent; automatic generation is implemented but not enabled. Owner configuration is still required. Official configuration reference: https://developers.openai.com/api/docs/guides/image-generation .


Important Update cover alignment (2026-10-15, user approved): reuse the accepted On the Way photo-cover composition: 14px rounded cover, consistent content gutters, generous upper photo space, bottom dark-green gradient and HTML serif destination title with optional distinct city. Keep numeric impacts/actions in the body, not in the bitmap. Generated images retain a compact AI-generated caption. CID remains canonical for JPEG attachments; development preview resolves every matching CID image reference including background/VML attributes, never changes delivery content. Solid green/text fallback must stay readable with blocked images or unsupported gradients. Existing six generated demonstration photographs may be reused for layout verification only. Do not modify the other three templates, generation/sending/approval logic, or live settings. Verify 320/375/390/430/600 widths, dark, blocked images and long destination text; user template-contract waiver remains in effect.


Important Update cover verification (2026-10-15): destination/city now render as accessible HTML over the event photograph, using the accepted On the Way gradient/rounded-cover composition and compact AI caption. Same public hero context drives both direct rendering and deferred image preparation; existing public HTTPS images use the same cover treatment. Dev CID resolution includes background and VML references; persisted mail keeps CID. Server TypeScript build and 24 relevant template/hero/persistence/approval tests pass. Six cases at 320/375/390/430/600px plus dark, fully blocked images, enlarged copy and long cover destination pass 49 browser checks; light/dark/blocked full-page screenshots inspected. Initial old-caption assertion was adjusted to the approved smaller caption. Evidence: data/email-manual-tests/2026-10-15-important-update-cover. No live mail-client/SMTP or live image API test, no settings changes or sending. Existing image API configuration requirement remains.


Important Update annotation simplification (2026-10-15, explicit user request): remove the whole bottom source/sample/brand-footer section, the proposed-plan unchanged-status card, the duplicate city line inside the hero (keep the top header city), and the visible AI-image caption. Collapse their spacing and end with comfortable bottom padding after the primary action/optional ride. Keep AI provenance in alt/generation metadata and public source validation/evidence in the existing business inputs. Demo labeling belongs to the development preview wrapper, never to production email or the stripped footer. Confirmed changes retain a short factual confirmation line and confirmation time, without restoring the removed card; generic suggestions retain their existing suggestion chip and per-option confirmation requirement. Do not alter approval, source freshness, arrival estimates, generation, transport or sending logic. Supersedes prior visible-caption/source-footer/proposed-status-card instructions for Important Update only. Rebuild and check all six compact previews; no real sending.


Important Update annotation verification: removed all four selected presentation areas across six cases, including the entire footer wordmark/divider, not only source text. Preserved top-header city and destination overlay, confirmation validation, explicit review actions, generation provenance/alt and source freshness gates. No stale status/footer icon attachments are emitted. Server build, 24 focused tests and 49 browser checks pass at 320–600px, dark, blocked images, enlarged text and long destination; closure screenshot visually inspected. Earlier assertions expecting removed source/status/caption copy were updated to the user-approved display contract; live-source/action rejection tests remain passing. Preview evidence: data/email-manual-tests/2026-10-15-important-update-clean. No mail sent or live settings modified.


Important Update real-client CID correction (2026-10-15): a CID hero must be a visible full-width img, never a hidden 1px probe plus CSS/VML background. The previous browser-only overlay is superseded by one rounded editorial cover composed of the visible photo and adjoining deep-green HTML destination caption. Keep alt/provenance, CID MIME, no duplicate city/caption/footer, and data/actions unchanged. Prefer reliable readable image+caption over an unverified CID-background overlay. Verify actual canonical template through multipart/related MIME, JPEG bytes and Content-ID plus browser rendering with stylesheet removal and blocked images. Some clients may still list inline images as attachments; do not promise suppression across clients or treat SMTP acceptance as display proof. No automatic resend implied by diagnosis.


CID visibility verification: Server build and 29 existing focused tests pass; an additional canonical-renderer real MIME test passes (30 total), proving visible508px JPEG img, multipart/related, inline disposition, matching Content-ID and byte-identical decoded JPEG without SMTP. 50 browser checks pass including stylesheet removal and hero bounding-width assertion, plus mobile/dark/blocked/long cases; closure full screenshot visually inspected. Evidence in data/email-manual-tests/2026-10-15-important-update-cid-fixed. Browser/MIME evidence does not establish Gmail/iPhone actual-client success; no new mail sent during this fix, no live settings changes. Existing CID bytes necessarily remain related MIME parts and client attachment listing cannot be universally controlled.


HTTPS generated cover correction (2026-10-15, user authorized): generated Important Update photos must be published through one deployment-owner-configured S3-compatible object-store Connector, then rendered by the same public HTTPS background/gradient/HTML-title approach as accepted On the Way. Restore the clean-3 crop/overlay geometry, with no independent green caption strip. Store content-addressed public JPEGs with no personal/event identifiers; freeze the verified public URL with outbox content for retries. Generated hero is URL+alt+contextDigest, never a CID attachment; original PNG icon CID handling remains unchanged. Require explicit object-store endpoint, bucket, region, public base, access/secret keys (optional session token), fixed bounded JPEG upload with SigV4, no redirects, and anonymous public byte verification before accepting URL. Missing storage fails before image generation, no CID fallback, invented URL, automatic account creation or service enablement. Update env example and deployment docs; local previews may serve actual generated fixture bytes from an isolated localhost server as development-only substitution while canonical HTML retains an illustrative HTTPS URL. No live readiness claim without owner config, actual upload and email-client check. User template waiver remains; no source/control/delivery state change.


Fixed six-hero pack (2026-10-16, user supplied landi_six_hero_pack): supersede dynamic photographic generation, proposed S3 upload work and its CID transport with six fixed original illustrations. Preserve uncropped16:9 composition as a visible responsive image, no overlaid dynamic title, no independent green title band; factual destination/time/issue remain accessible in concise body. Match asset to explicitly supplied ImportantUpdate kind, never classify prose. Compress only for delivery; retain source filenames/digests/dimensions in provenance. Deployment-owner LANDI_EMAIL_ASSET_BASE_URL points to the published static asset root; no image-generator key, runtime upload, arbitrary hosting account or per-traveler configuration. Missing/invalid base never yields a local/CID/fake production hero. Explicit caller HTTPS image is allowed. Remove the abandoned dynamic generation connector/preparation/types/tests/config docs as a live workflow; preserve existing frozen historical deliveries without rewriting live data. Keep existing icon CID, timing/approval/source/recipient/version gates and other templates unchanged. Local preview resolves fictional canonical HTTPS paths to local static assets only in display copies and labels simulations in the wrapper. No real email sending/publishing/credential changes. Existing template-contract waiver applies.


Fixed six-hero verification (2026-10-16): six originalPNG files visually inspected; only resized/compressed JPEG derivatives imported, full16:9 composition retained (51–75KB each), source/copy digests in assets/email/important-update/v1/manifest.json. Core/Connectors/Storage/Server builds pass.45 focused tests pass; one additional actual MIME test passes (46 total), proving hero remains HTTPS and no JPEG/event-hero attachment is sent; only existing PNG icons remain inline parts.50 browser checks pass at320/375/390/430/600 plus dark/blocked/enlarged/no-stylesheet/long labels; full closure email inspected. Initial pre-existing status-copy assertion was updated for the user's earlier status-card removal, no source/approval/Plan guard relaxed. Retired dynamic-generation modules/exports/types/env example/test entry and preview helper removed; no live .env/SQLite/SMTP/settings changes. Historical frozen delivery JSON is not rewritten. Current preview evidence: data/email-manual-tests/2026-10-16-important-update-illustrations. Public static hosting is not configured or verified, so live delivery has no new hero until owner sets LANDI_EMAIL_ASSET_BASE_URL. No real mail sent or assets published. Deployment instructions: assets/email/README.md.


Fixed illustration cover styling correction (2026-10-16, user approved): restore a rounded editorial hero rather than a bare image. Use the art's left negative space for a dark-green HTML serif destination title (optional explicit heroTitle), keep the right-side traveler unobscured, and retain the established body warning/timing/actions. Follow the existing HTTPS background/VML approach of accepted On the Way/Dining; never use CID heroes. Preserve full artwork proportions with contain/no-repeat against matching sage fallback; title remains readable with image blocked. No duplicated city kicker, AI caption, status card, footer or separate green title strip. Preview geometry must check the title stays left of the character area across320–600px, long words, dark and no stylesheet. No real sending or hosting/config change. Supersedes the bare-image/no-overlay statement in the prior pack note.


Illustrated cover verification: Server build and25 affected template/MIME/attention/source/timing tests pass.50 browser checks pass with titles constrained to the left half at320/375/390/430/600px, dark/blocked/enlarged/no-stylesheet and long unbroken destination;390px full closure screenshot inspected after eliminating letterbox strips at target mobile widths. Destination headings use explicit fixture/producer heroTitle, no city kicker or pixel-baked dynamic facts. No mail sent, upload, backend restart or live setting changes. HTTPS asset base remains required and unconfigured; no real-client display claim. Evidence: data/email-manual-tests/2026-10-16-important-update-styled-cover.


Important Update headline placement (2026-10-16 user correction): the single primary headline (e.g. Te Puia is closed today), not a separate destination label, belongs in the illustration's left negative space as accessible HTML h1. Remove duplicate body headline when hero exists; preserve it as the image-free fallback. Retire separate heroTitle input and producer/preview projections. Keep factual introduction, comparison, warning chip and actions unchanged. Verify one h1, exact event title/derived ETA headline and left-half geometry across all six cases and mobile widths, dark/blocked/enlarged/no-stylesheet/long titles. No sending or public hosting/configuration implied.


Headline placement verification: Server build,25 related tests and50 browser checks pass. All six illustrated cases have one h1 within the left cover area; exact derived ETA/event headline is preserved and duplicate body headline omitted only when hero exists. Image-free fallback still has one body h1. Closure390px full screenshot visually inspected; no live send, hosting or settings change. Evidence: data/email-manual-tests/2026-10-16-important-update-headline-cover.


Important Update badge placement (2026-10-16 user approved): status chips sit at the left of the hero bottom boundary, with their vertical center on the image edge, not as another body block. Implement a presentation-table two-row boundary rail with a rowspan badge and paper-colored lower half, avoiding negative margins/absolute positioning unsupported by Gmail. Keep left inset aligned to cover copy and reserve space before body introduction. Image-free emails retain their normal status chip. Preserve full event h1, static HTTPS image, original PNG icons, no duplicated status/footer, dark readability and all facts/actions. Verify badge center/edge geometry across six kinds, mobile widths, dark, blocked and enlarged text; email-client proof remains separate.


Hero-edge badge verification: Server build and23 affected template/MIME tests pass.50 browser checks pass including six kinds at320/375/390/430/600, dark, blocked, enlarged, no stylesheet and long title. Measurements assert badge vertical center matches hero image-edge rail within1.1px, fits inside cover and is inset on the left; no negative margins, absolute positioning or scripts in email. Added nowrap prevents unintended three-line badge text.390px late-arrival full screenshot visually inspected. Only the local preview updated; no SMTP/hosting/settings changes. Gmail/Apple Mail/Outlook real-device rendering remains untested. Evidence: data/email-manual-tests/2026-10-16-important-update-edge-badge.


Badge horizontal alignment correction (2026-10-16): remove the left inset of Important Update hero badges. Their outer left edge must equal the hero's outer left edge, while the vertical center remains on the hero bottom boundary. Retain existing text/icon padding inside the badge and body spacing. Update browser geometry assertion from inset to equality at all target widths; no other layout/business/send changes.


Badge left-edge verification: Server build and50 existing browser checks pass, now asserting badge left equals hero left within1.1px and badge center remains on the boundary.390px arrival-conflict screenshot inspected. Evidence: data/email-manual-tests/2026-10-16-important-update-aligned-badge. Preview only; no mail or live setting changes.


Revert latest badge horizontal alignment (2026-10-16 explicit user request): undo only the immediately preceding flush-left badge adjustment. Restore24px desktop/18px mobile inset aligned with cover text, keeping the previously accepted vertical overlap, full headline, illustrations and every other change. Browser geometry assertion returns to inset; no other rollback or live sending.


Badge revert verification: restored only24px/18px inset and previous inset browser assertion; Server TypeScript build and diff whitespace check pass. Reused the already verified50-check inset preview artifacts from2026-10-16-important-update-edge-badge, cache version edge-badge-6; no new browser-test claim. No live settings or mail changed.


Default public illustrations (2026-10-16, user authorized publication): publish only the six artwork JPEGs and provenance manifest to JessicJ/c-assissant. Pin the built-in default to immutable public HTTPS commit cec3eca9bfb58f54ff997d0b7c4e85fa3218825d at https://raw.githubusercontent.com/JessicJ/c-assissant/cec3eca9bfb58f54ff997d0b7c4e85fa3218825d/assets/email. Missing/blank LANDI_EMAIL_ASSET_BASE_URL uses this project default; explicit nonblank deployment override remains supported. No per-computer or traveler image setup. Freeze final image URLs in assembled mail as before. Public anonymous bytes and response type must be verified before claiming readiness; source-code delivery remains separate from the asset-only remote commit. Preserve local changes, SMTP credentials and live settings; test sending is authorized to the previously specified Gmail after full actual-URL render and scope checks.


Public-asset publication verification (2026-10-16): GitHub master advanced non-force from113d680b80fdd5c1c7919cc4a47c48d46963003f tocec3eca9bfb58f54ff997d0b7c4e85fa3218825d with exactly7 added asset files, confirmed by remote commit readback. No local application-source changes were published in that asset-only commit. Anonymous HTTPS GET returned200/image/jpeg for all six images and exact SHA256 matches. Built-in local default points at immutable commit, blank/missing override tested;25 focused tests and Server build pass. Actual network browser renders at375/390/430px load the real public image and preserve full headline, inset badge/edge center and no overflow; screenshot inspected. Latest HTTPS-headline simulated test sent once to the previously specified Gmail using existing sender, SMTP acceptance read from receipt; inbox/display remain user verification. Publication/test receipts under data/email-manual-tests/2026-10-16-public-assets-release and2026-10-16-public-https-test. Live .env/SQLite/auto-delivery/Plan untouched. Default-source changes remain in the working tree for normal source delivery; artwork hosting is already live.
