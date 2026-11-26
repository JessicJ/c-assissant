---
status: converged
---

# Blueprint Workspace Generation Requirements

Design review: 2026-11-17
Scope: Landi-native travel planning generation, Trip Blueprint content shape, Skill Importer expectations, and Web Plan Workspace presentation.

The design decisions for the desktop workspace are settled. T2-1 covers browsing the structured itinerary, its guide and sources, preparation and tips, and versioned editing with booking protection and recovery. Its recorded acceptance uses the current Core, API, and desktop browser behavior in an isolated development environment. The live MAH generation and import chain remains subject to T1-1 acceptance, including queueing, cancellation, restart recovery, provider evidence, and the release conditions below.

## Purpose

This document defines Landi's plan generation and Web workspace design. It retains conversational creation and uses Landi-owned content modules to make the generated plan readable and practical to adjust.

The desired result is not a static guide and not only an executable checklist. It is a structured travel workspace where the traveler can review, compare, adjust, and then activate the plan.

## Design Summary

The Landi-native planning loop uses these boundaries:

```text
Landi-native Blueprint Skill
  -> Landi Trip Blueprint Contract
  -> Skill Importer safe normalization
  -> Plan Compiler
  -> Web Plan Workspace rendered with Landi components
```

Settled product decisions:

- Web remains chat-led for intake and does not add a heavy visible Planning Proposal page.
- The generated plan has three primary content areas: Itinerary, Preparation, and Tips. Sources is a supporting workspace view for evidence inspection.
- Attractions, dining, shopping, and local experiences live as itinerary sub-branches over a shared Guide Catalog.
- The itinerary is a complete recommended plan first, not an empty composition canvas.
- The itinerary sequence presents the time-ordered plan; it is not the primary arrangement tool and does not require a visible line-and-dot timeline treatment.
- The desktop Web workspace is itinerary-sequence-led, with map support and one shared side panel for explore/detail.
- The Web workspace does not target mobile layout or mobile editing.
- Guide Cards are short browsing units; rich value explanation, source context, and comparison live in details.
- Guide source disclosure uses small image markers only when a real image is present; text-only cards, tips, and details use unobtrusive source text or links instead of standalone `i` markers.
- Multiple concrete dining, shopping, and experience options appear as peer choices, not candidates or forced recommendations.
- Preparation is a travel-readiness checklist, not a generic life-advice task list.
- Tips are destination-relevant local cautions, not generic travel inspiration.
- UGC and social material are optional Source Channels, not required dependencies or verified evidence.
- Prepare sourced photographs alongside itinerary planning so that the first plan view includes available imagery. Use place-specific evidence and local names, confirm the branch for businesses, and reuse a photo at repeated stops. An unavailable photograph leaves a complete text card without a placeholder or a traveler-facing image task status.
- Skill output must be structured Landi-native content, not HTML or skill-owned Web UI.

## Product Goal

After a traveler chats with Landi and provides enough trip context, Landi should generate a complete, modular travel blueprint organized around three top-level workspace areas:

- itinerary;
- pre-departure preparation;
- travel tips.

The itinerary is the primary plan presentation surface and contains the elements that compose the trip: attractions, dining, shopping, and local signature experiences. Landi should generate a complete recommended itinerary first, using available time, weather context, user preferences, trip constraints, and evidence. The traveler can apply that plan directly, or use the connected image-and-text sub-branches to understand options and replace, add, remove, or adjust itinerary elements through pending edits.

Pre-departure preparation and travel tips remain separate top-level areas because they serve different user jobs: preparing before travel and understanding local customs, norms, and practical cautions.

## Creation Flow

Landi 保留首次引导、既有桌面工作台与对话式规划。规范流程为：

```text
安装并配置 MAH，从 MAH 打开 Landi
  -> 保存旅行需求，Landi 只询问影响旅行边界的缺失事实
  -> 独立核对配置、公开执行准入与当前会话版本
  -> 旅行者明确接受当前规划方向并继续生成
  -> 经既有公开准入生成完整 Trip Blueprint
  -> 在桌面工作台审阅、调整，并查看重要变化的影响
  -> 旅行者另行确认精确 Plan 版本供执行
```

The product should not introduce a heavy visible "Planning Proposal" page. Internally, Landi may keep a planning direction checkpoint for versioning, deduplication, and generation safety.

## Architecture

```text
Web Conversational Intake
  -> Planning Direction Checkpoint
  -> Landi-native Blueprint Skill
  -> Skill Importer
  -> Trip Blueprint Version
  -> Plan Workspace Presentation Areas
  -> Direct Blueprint Revision or Assisted Replanning
  -> Plan Compiler
  -> Draft Plan review
  -> Execution Plan activation
```

### MAH 有界生成传输合同

本节定义 2026-11-09 确认的目标。Landi Web 保留工作台与「生成行程」入口，Landi Server/Storage/Core 持有提案、版本、业务检查点、校验与保存。MAH 负责普通即时任务的排队、Agent 路由、运行和取消。用户触发的生成可以排队，不依赖专用槽位、定时任务或自动演进。

**当前公开接口。** MAH 0.1.2132 支持下列目标入口。只使用已验证的绝对 CLI 绑定，以参数数组调用。输入写入权限受控的附件；标题和命令参数只携带必要的非敏感标识。

```text
mah task submit --task-id <uuid> --cwd <project-root> --no-write --attach <request-json> --description-file <prompt> --format json
mah task list --cwd <project-root> --format json
mah task show <uuid> --cwd <project-root> --format json
mah task replay <uuid> --cwd <project-root> --format json
mah task context <uuid> --cwd <project-root> --format json
mah task context <uuid> --cwd <project-root> --read <declared-result-subpath> --format json
mah task cancel <uuid> --cwd <project-root> --format json
```

**身份与回执。** 正式提交前，在 Landi 主 Storage 原子保存 Generation、提案版本、operation、batch、attempt、随机 Task UUID、规范 MAH Project Git 根、请求摘要及预期工件路径。唯一提交者在外部调用前先持久记录提交不确定态；提交响应丢失或不符合结构，只查询同一 UUID。匹配的提交回执只说明接收；通过公开 list/show 核对项目和任务身份，并分别呈现排队和运行。排队时间与业务执行时间分开。未知、冲突、暂时未找到及读取失败不允许换 UUID、静默重发、直接调用 Agent 或读取私有记录。用户在确认原任务失败或取消后显式重试才创建新 attempt。MAH 决定实际 Agent 和模型。

**Adaptive 生产和验收。** Direct 保留原有公开运行起点计时。新请求通过冻结的 adaptiveProducerClockV1 声明生产计时策略及校验器的 Node 路径；恢复继续用提交时的路径核对原命令。正常路径由生产者在工作区校验工件，独立验收者在发布后复验，两个原生记录必须绑定同一摘要。该策略通过公开 replay 核实同一 Task 当前代次的生产 Attempt，并以其实际执行时间计算阶段预算。旧任务只有在规范路径未发布、原生接受明确引用原写入及后续复验且摘要相同的情况下才允许恢复；两个生产区间均计入预算。既有请求沿用原有根任务计时。生产结束后最多本地等待验收一小时，等待耗尽保留原 Task 供恢复。生产身份无法核实时保留原 Task；自动超时取消前重新观察其生产状态。导入要求 MAH 完成、生产与独立验收原生证据绑定同一结果工件及附件，并以实际生产 Attempt 绑定 Agent、模型与时间。现有请求字节和已登记的历史回执不改写。

**取消、恢复和导入。** 主库先原子保存取消意图，再按同一 UUID 调用 cancel 和 show。取消后晚到结果一律拒绝。正常停机只停止本地监督；重启从主库原映射重新查回。完成必须通过当前公开回执绑定项目、任务、生命周期、附件与工件摘要及实际执行来源；只读取唯一、字节数一致的预定 Task 工件。Landi 现有领域 Schema、日期/地点/来源/预订约束、Importer 与确定性编译继续适用。结果与检查点、导入标记及 Generation Event 同事务保存，最终 Plan 与 lineage 原子发布；同摘要重放无副作用，摘要变化拒绝。

同一 worktree synthesize Attempt 内可以修正候选并顺序重验。核验原生命令事件的调用身份、成对关系、安全序号与时间边界后，只采用最后一次规范校验；该次须成功且由原生 passed/current 文件证据采信，其 Schema、请求及最终工件摘要须与独立验收一致。末次缺失、失败、重叠或摘要不同保持未核实。worktree 独立验收可以重复只读复核同一已发布工件，每次规范调用均须完整配对、顺序无重叠、退出成功并具有本次 accepted outcome 的 passed/current 原生文件证据；所有输出须绑定相同 Schema、请求及最终工件摘要。只要本次存在规范调用，任一调用失败、缺失或漂移均拒绝，不能回退到前序修订掩盖冲突。本次原生命令事件完整且没有规范调用时保留原有明确引用前序验证的规则；孤立或损坏的当前命令事件不得触发采用前序证据。既有 published 模式的单次校验规则继续适用。

**证据与上线边界。** 已有隔离证据包括普通 task submit 固定 UUID 后完成并公开读回、同 ID 的已完成任务重交被拒、物化前取消，以及独立原生 run 交互任务的结构化结果写入隔离草稿库。不同实验不得拼成生产验收。仍须用同一应用适配验证真实排队、任务运行中取消、提交回执丢失与重启恢复、晚到结果和浏览器草稿。既有 Schema 2 和 Storage 槽位字段保留原语义；新普通队列请求和持久映射须在实施切片显式版本化并完成兼容校验，不把旧记录改写为新协议。工件路径与外层 Schema 必须在实现时配对定义；实验的 business 工件不自动替换旧 stage 工件。生产生成在这些条件通过前保持关闭。旧 sidecar 若仍需迁移，必须逐行全量校验，连同迁移版本标记原子提交；失败完整保留原文件，成功后清理并停止作为事实源。不得通过新迁移覆盖旧 Task 的历史身份、摘要和验收事实。

历史证据保留在原任务和 Git 历史。MAH 0.1.2088 时期的专用交互槽位与旧 execution-carriers 投影属于旧协议，不能作为现行普通队列的验收证据。

### Web Conversational Intake

用户继续使用既有对话规划，只收集目的地、日期、目的、同行人、固定预订、交通偏好及重要限制等旅行边界事实。下载 MAH 的旧弹窗、保存受阻和生成按钮对该弹窗的触发全部退役；首次引导与桌面工作台保留。工作台内的现有 MAH 指导区分别表达配置是否核实、公开执行是否核实、当前会话是否匹配，提供回 MAH 处理及重新检查。只在可信证据支持时说明断连、配置失效或权限不足；缺失、冲突、过期、未来、错作用域或不可读证据保持未核实。普通产品文案沿既有界面语言，不展示内部路径、原始异常或诊断载荷。

返回、刷新、聚焦、轮询及重新检查仅 GET 只读核对，不创建、恢复或重提 Task，不创建会话、不保存需求、不重新导入结果。配置核实与会话匹配均不等于执行授权；当前 `executable:false` 和生产关闭持续保留。用户明确继续时仍须经既有公开确认流程，由服务端再次核当前版本和执行准入。检查结果不得替代该门禁；未核实不得继续执行。

每条消息在发送前持久保存随机原身份、原修订、原会话作用域与不可变文本；持久化不可用或部分损坏时保留草稿及原字节并禁止新发。未知回执先按原 messageId、expectedRevision 和文本摘要只读核对；首次保存尚无 sessionId 也须可精确核对，不扫描当前会话或用 POST 探测。未找到仍是未知；旅行者可另行明确以完整原请求重试，不能改身份或载荷。成功响应和只读回执均须核对完整原身份后，才宣称已保存和按原草稿签名清理；回执确认不能清除后续编辑，即使新文本与旧文本相同。

保存、检查、会话读取、确认和生成结果加载都绑定请求作用域、编辑代次及版本。晚到结果不得改变新会话、新草稿或新版本；版本冲突先重读并等待明确继续。已保存需求、历史方案、Blueprint/Plan 版本和执行指针保持不变；已在进行、已有结果、已关闭或会话不存在分别表达，不能重启、复活或静默创建替代会话。草稿迁移只从未绑定草稿复制并核实后删除，目标冲突保留两份。

### Planning Direction Checkpoint

规划方向检查点沿用 `PlanningProposal` 的精确版本；界面自然说明方向，旅行者明确接受当前版本才授权生成。由 MAH 返回或只读检查恢复不构成接受，不自动开始；Blueprint 发布和 Execution Plan 激活仍是独立边界。

### Landi-native Blueprint Skill

The new generation skill should output Landi-native structured content, not UI, HTML, or map-specific state. It should produce enough detail for the three top-level workspace areas and the itinerary guide sub-branches, with enough metadata for Web to make them interactive.

The skill may use many Source Channels for guide themes, visual direction, local products, and possible experiences. Social, UGC, review, short-video, image-board, and travel-community platforms are optional channels, not required dependencies. Inspiration Sources must remain separate from evidence. Any claim that affects reliability, timing, route choice, reservation need, official requirements, safety, or execution must be checked against a more authoritative source such as maps data, official sources, merchant pages, or other structured provider facts.

Platform selection must support global travel planning without requiring fixed regional strategies. Landi should use Source Capability Selection: choose sources by the capability needed, destination coverage, traveler language, content type, and available connectors. Region can inform coverage quality, but the architecture should not start from hard-coded country or region source bundles.

The source mix may vary by planning need:

- visual inspiration;
- restaurant discovery;
- shopping and local product ideas;
- local experience discovery;
- review or popularity signals;
- maps and place facts;
- merchant pages and booking facts;
- official verification.

Missing UGC or social Inspiration Sources should not block complete plan generation when maps, official, merchant, review, image search, or other structured facts are sufficient for a useful plan. UGC is only one possible Source Channel. When social material is unavailable or low-quality, Landi should produce a more conservative reliable-guide presentation with less social or lifestyle texture.

The Skill should follow Guide Content Selectivity. It should prioritize Schedulable Itinerary Objects and use Informational Guide Items only when they add meaningful context for understanding local food, products, culture, customs, or experience choices. It should avoid producing large volumes of theme-only background content, encyclopedic guide copy, or filler cards that cannot help the traveler review or adjust the plan.

Guide Content Selectivity should not become a fixed content ratio or quota per destination or guide type. The amount of backup material should follow trip context, evidence quality, and usefulness rather than a numeric coverage target.

### Skill Importer

The importer validates and normalizes skill output into Landi's Trip Blueprint contract. It may assign stable IDs, normalize categories, mark uncertain evidence, remove invalid references, and preserve safe content. It must not invent missing facts, silently delete valid places, or turn unverified claims into verified content.

When the Skill outputs a useful theme-level item without a related Schedulable Itinerary Object, the importer should preserve it as an Informational Guide Item and mark it unavailable for timeline placement. It should not discard the content, invent a concrete place, or let Web schedule the theme directly.

This requirements slice does not define a separate post-import enrichment path that later turns Informational Guide Items into schedulable guide material.

### Trip Blueprint Version

Trip Blueprint 是地点、日程、候选、Guide、证据、movement、Action Requirements 及预订行程关系审阅的唯一旅行内容事实源。改变旅行含义的编辑产生新版本；预订关系、覆盖宇宙与有效性由 [预订设计的 Booking Itinerary Assessment](booking-confirmation-requirements.md#booking-itinerary-assessment预订行程关系评估) 统一定义，Web 和 Plan 不另存可编辑关系。

### Plan Workspace Presentation Areas

The Web workspace renders Landi's own presentation areas from the Trip Blueprint and Plan. The skill does not decide the layout. Web chooses the visual language, controls, editing behavior, and navigation.

### Plan Compiler

编译器把已审阅 Blueprint 的显式 Action Requirements 及既有旅客确认的结构化预订承诺转换为执行 Plan。每个 Action Requirement 必须有合法责任方与非空完成条件；主题、Tip、独立准备清单和名称关键词不产生执行任务或提醒。移除按月份、目的地、标题或关键词补出的通用打包任务，编译器当前语义版本为 `2.1.0`，新编译只接受该版本，显式指定历史版本必须拒绝；历史创建身份 helper／resolver 只读识别旧产物，不授权用历史标签运行当前编译语义。取消／ignored 分段不编译任务、提醒、已知安排或住宿配置；预订任务完成身份绑定源单元语义摘要，源变化不能复用旧完成，未变语义跨版本保持身份。历史 `1.0.0` 与 `2.0.0` lineage 保持可读，不重写历史编译结果。`2.0.0` 完成继承必须由 Storage 提供精确原 Plan／Blueprint／lineage，Core 核唯一旧 completed task 的完整 `booking:<constraintId>:<segmentId>` 协议身份与新旧完成条件语义完全一致，才映射新摘要身份。旧新均无源映射时，只有同 Blueprint ID、稳定 constraint／segment 身份及不可变快照语义相同才可证明原任务未变；新选择来源、任何映射改变、状态／时间／地点／强度／分段变化均不继承。不按标题相似或前缀猜测来源，所有预订完成入口均禁止标题兜底。编译不改写旅行文案，精确来源由 requirementId、Plan Compilation Lineage 与不可变 Blueprint 版本共同追溯。

## Content Areas

Attraction guide, shopping guide, local signature experiences, and dining guide are itinerary sub-branches rather than top-level workspace areas. They are different lenses over a shared Guide Catalog. A single place may appear in more than one lens when that helps the traveler decide, for example a historic market may be both an attraction, shopping stop, dining cluster, and local experience.

The workspace should preserve those relationships instead of duplicating independent cards. The generated itinerary should already contain Landi's recommended scheduled stops, timing, and movement structure. Guide material then acts as explainable replacement and enrichment material: when the traveler adds a guide item to a day from any lens, the same underlying place or experience should enter a pending itinerary edit with its guide context still visible. It becomes scheduled or optional itinerary content only after the traveler confirms the edit.

Guide material that is not already part of the recommended itinerary should not recommend a specific day or time by default. It may describe suitable contexts and real constraints, but should not show default replacement-type labels such as "replace lunch" or "replace afternoon shopping" on the card. The traveler chooses when and whether to place it. A specific day or time may be shown only when the item is already scheduled in the recommended itinerary or when a real external constraint requires it.

Guide material should be organized primarily by traveler-facing themes or experiences, with specific places shown inside those cards or groups. The browsing path should start from questions like what to eat, what to buy, what kind of evening to have, or what cultural experience fits the trip, rather than only from a raw place list.

主题浏览以现有 `localFoods`、`localProducts`、`experienceThemes` 的显式关系为唯一依据：主题可关联多个具体 Place，同一 Place 可参与多个主题和类型透镜，身份不复制。主题卡先进入主题详情；详情比较集合是该主题全部有效关联地点。无关联主题可读但不可排程；没有有效 `relatedPlaceId` 的比较行仅展示文本，不显示打开或添加。具体地点继续复用 Placement 与待确认批次。

Unscheduled guide cards should use a consistent default anatomy:

- title and local name when useful;
- short Guide Card Summary with image-and-text teaser when a suitable image is available;
- polished text-only presentation when no suitable image is available;
- tags, area, and itinerary state when useful for scanning;
- concrete place or related place identity when the item can be visited, eaten, bought, or experienced somewhere specific;
- compact image-level Source Marker only when the card contains a real image;
- one primary add action that starts an itinerary edit.

They should not show default day, time, replacement-type label, scheduling rationale, full Guide Value Explanation, comparison tables, or long practical details on the card. Those belong in the shared detail panel.

Guide 实图必须携带图片自身来源，Source Marker 支持悬停、键盘焦点和点击，三种交互都须完整披露长标题、用途、状态与时效。悬停与焦点摘要、点击或键盘展开的来源均在图片下方正常流中换行并推动后续内容，不在图框外浮动或被图框裁切；展开时隐藏重复摘要。文本卡显示条目证据摘要；详情底部的来源披露展开后，以及关联主题与事件各自的来源摘要和链接，均须按侧栏可视宽度完整换行，不得省略裁切；坏图删除图片区域和标记，仍保留正文的准确来源。主题、比较行、事件、准备项和 Tip 分别消费自身 evidence；明确未知、过期和待核实，不以地点正文或全局 Sources 代替。Source 的可选 `purpose` 明示 `evidence` 或 `inspiration`；缺失用途保持未知，不从标题或域名推断。灵感来源与事实证据分开披露；没有来源不得伪造。

### 1. Itinerary

The itinerary area should remain close to the current embedded workspace while becoming the home for the trip's complete recommended itinerary and schedulable guide material:

- a generated recommended itinerary that is complete enough to use directly;
- map and daily time planning;
- typed itinerary blocks for main stops, meals, shopping, local experiences, transit, rest, and flexible time;
- day, city, and phase navigation;
- scheduled stops and candidate places;
- route or sequence visualization;
- place detail side panel;
- same-day reorder;
- add candidate to day;
- remove ordinary stop;
- change priority;
- route status and recheck notices;
- attraction, dining, shopping, and local-experience sub-branches;
- image-and-text guide cards for itinerary elements.

The itinerary guide material should appear in a unified Itinerary Explore Panel inside the itinerary workspace. It should not be scattered under individual days. The panel should let travelers browse all Guide Cards from one place, including material already scheduled in the recommended itinerary and material that remains available as alternatives or enrichment.

Guide Cards in the panel should be state-aware:

- cards already in the recommended itinerary show an "in itinerary" state and a primary action to locate the corresponding timeline block;
- unscheduled cards show a primary action that starts an itinerary edit;
- cards that are informational only, such as a local product without a concrete purchase place, remain visible in search and filter results and can open details, but do not show a scheduling or add action.

Selecting a scheduled Guide Card should create an itinerary-linked Guide Detail state: the corresponding itinerary block is located and highlighted, and the shared detail panel opens with the Guide Item's image or text content, source context, related guide material, and relevant alternatives. Small Source Markers appear only on images; text-only detail content should expose sources through plain source summaries or links. The same detail panel should also be reachable by selecting the itinerary block directly.

Relevant alternatives should appear only after the traveler opens the shared detail panel. Timeline blocks should not display alternative recommendations by default, so the recommended itinerary remains readable as Landi's proposed plan rather than a crowded comparison board.

The shared detail panel should use Guide Detail Templates. All templates share the same panel shell, source disclosure behavior, related material, alternatives, and adjustment actions, but each content type renders the fields that help that decision:

- attraction details: why it matters, visit style, recommended duration, area, practical notes, route context, and related dining, shopping, or experience links;
- dining details: what to eat, Local Food context, Dining Place Comparison for multiple concrete dining places or food areas, reservation or queue expectations, dietary notes, meal fit, and nearby itinerary links;
- shopping details: what to buy, local product context, Purchase Place Comparison for multiple concrete purchase places, price or quality or convenience signals, tax refund/payment/shipping notes, and nearby itinerary links;
- local-experience details: Experience Theme context, Experience Offering Comparison for multiple concrete offerings, suitable traveler, duration, booking need, seasonal fit, etiquette or risk notes, and related places.

The Skill should not be forced to collapse dining, shopping, and local-experience details into one "best" concrete option. When evidence supports more than one useful option, the Blueprint may include a Guide Option Comparison so Web can show multiple concrete dining places, purchase places, or experience offerings as peer choices. Web should not label them as candidates or mark one as the default recommended option. The traveler can choose the concrete option that best fits distance, route, price, queue, reservation, timing, source state, or personal preference before adding or replacing itinerary content.

选项比较默认采用紧凑比较行或表格布局，优先展示名称、区域、距离或路线适配、时间或来源状态、价格或投入、预约或排队要求。字段按侧栏实际可视宽度正常换行；每个选项的完整事实及其逐条来源在该选项下方的全宽区域默认可见，来源用途、核实状态、时效及灵感未核实声明均须完整可读，不能依赖横向滚动、省略文字、悬停提示或全局来源页补全。打开与添加操作使用独立列，不与事实和来源共用窄列。图片仅可作为小幅辅助缩略图，不把并列选项变成独立的大幅图文卡片。

Option Comparison Rows should not contain subjective promotional language such as "must-visit", "super popular", "hidden gem", or social-media hype. If subjective appeal is useful and sourceable, it belongs in Guide Value Explanation or supporting guide copy, not in the comparison row. Comparison rows should remain factual, restrained, and useful for decision-making.

Guide Option Comparison may use Neutral Option Ordering to reduce browsing effort. Web may sort peer options by factual convenience signals such as proximity to the current itinerary, route fit, opening-state confidence, reservation friction, queue risk, timing fit, or source freshness. This ordering should not be presented as a recommendation, ranking, or default winner.

比较优先以当前主题的有效显式关联建立选项；没有主题上下文时使用当前具体地点自身的显式比较行，并保留显式关系图中额外关联的选项，不按同类型猜测替代关系。同一目标已有当前地点明确比较行时保持该行的原事实与证据，不再用关系图默认行覆盖或混拼其字段；关系图的其他目标保留独立行和自身证据。主题关联只证明具体选项身份，不证明其他地点比较行、场次、预约或字段注记适用于当前食物、商品或体验。现有合同未声明这些事实的主题适用范围，因此主题比较仅复用地点身份、区域及地点整体 access.windows 开放事实，并保留开放事实自身证据；开放事实可跨类型共用，不因地点主类型不同而排除。无法证明适用的路线、专属时间、价格或预约等字段显示未知；不得按文案关键词、owner 身份、主显示类型或来源存在推断适用性。显式比较行继续在其原具体地点详情中显示；场次、入场条件和字段注记在关联具体地点详情中保留原文上下文与逐事实来源。每行保留自身证据，不能把其他行或全地点证据当成该字段已核实。

Guide details may include a Guide Value Explanation: why a place, food, local product, or experience is worth considering. This explanation supports browsing and comparison. It may use a polished, magazine-like Guide Editorial Voice, but should stay grounded in concrete reasons such as architecture, history, flavor, craft, local life, landscape, collection, ritual, or experience style. It should not use exaggerated advertising language, unsupported superlatives, or empty social-media hype. It is not a Per-block Arrangement Rationale and should not be used to explain why an item appears on a specific day or time.

Guide Editorial Voice should be limited to Guide Value Explanation and supporting guide copy. Functional workspace surfaces should use Functional Workspace Voice: concise, restrained, and optimized for scanning, judgment, and action. This includes Itinerary Timeline blocks, Preparation Checklist items, Travel Tip Cards, Contextual Tip Surfaces, Option Comparison Rows, route status, and action controls.

Guide Card lists should remain short and scannable. Cards may show title, image or polished text teaser, compact tags when they materially help scanning, itinerary state when useful, and compact actions. Full Guide Value Explanation, type-specific comparisons, purchase locations, dining options, experience offerings, practical notes, and source context should open in the shared detail panel.

The Itinerary Explore Panel should be filterable by type:

```text
Attractions
Dining
Shopping
Experiences
```

The unfiltered complete browsing state should exist without requiring a visible "All" chip. It may also support theme, area, and itinerary-state filters when the Blueprint contains that structure, but these controls should appear only when they reduce real browsing friction. Search is not part of the default Explore chrome and should be introduced only if guide volume makes browsing inefficient. These controls should not create separate top-level pages. They are ways to browse and adjust material that belongs to the overall itinerary.

The panel should keep an unfiltered complete guide browsing state inside the Itinerary Explore Panel and default it to the same contextual Guide Relevance Order as filtered views. When the traveler has selected a day or Itinerary Block, the unfiltered state should prioritize material related to that context; when no context is selected, it should fall back to trip-level relevance.

The default order should use Guide Relevance Order: prioritize relationship to the current trip, current day, or selected Itinerary Block, then use secondary signals such as distance, popularity, rating, source richness, freshness, and image availability. This ordering should help the traveler adjust the current plan, not present a generic destination ranking. The ranking reason does not need to be shown on cards by default.

完整 Explore 与类型过滤使用同一排序：所选具体块的显式主题／地点关系、当前日的真实关联、整趟关联依次优先，再采用实际存在且适用的来源新鲜度、丰富度、图片或距离等事实。不得由名称或关键词推断关系。同日切换块需重新计算；无块回落到日，无日回落整趟。

Landi may use time, weather, traveler preferences, constraints, fixed bookings, and evidence to generate the recommended itinerary, but the Blueprint does not need to include explicit arrangement rationale for each scheduled block. Web should not require a "why this was placed here" explanation field to render itinerary details.

The itinerary should clearly distinguish:

- verified route geometry;
- intended movement plan;
- simple visit order line;
- stale route;
- route that needs verification.

The recommended itinerary should include dining, shopping, and local experiences by default when they are relevant to the trip, rather than leaving the day as a sightseeing-only route. They should be represented as typed itinerary blocks:

- attractions and fixed experiences may become main stops by referencing concrete Attraction Places or Experience Offerings;
- dining should normally appear as meal blocks such as breakfast, lunch, dinner, cafes, snacks, or markets by referencing concrete Dining Places or food areas;
- shopping should normally appear as a shopping block or a route-compatible stop by referencing concrete Purchase Places or shopping places;
- local signature experiences may become main stops, evening blocks, half-day blocks, or reservation-sensitive blocks by referencing concrete Experience Offerings depending on duration and commitment.

Dining, shopping, and local-experience blocks do not all need exact start times. When the activity is useful as part of the recommended day but naturally depends on queueing, energy, weather, opening status, or traveler choice, the Skill may emit a Flexible Itinerary Block with rough timing or optional status. It is still part of the Recommended Itinerary, not merely an unscheduled candidate, and should retain its concrete Schedulable Itinerary Object, guide detail, and replacement behavior.

Flexible Itinerary Blocks should still appear in the day's rough sequence. Web should render them with localized Rough Time Labels, such as around lunch, flexible afternoon, or optional evening, rather than leaving the time empty or inventing precise times like 14:00. Exact times should be reserved for fixed bookings, opening-hour-sensitive visits, transport commitments, and blocks where the planned start time materially matters.

Timeline blocks should contain Schedulable Itinerary Objects. Local Food, Local Product, and Experience Theme content may explain why the scheduled object matters, but those theme-level records should not directly occupy the timeline.

These blocks make replacement clearer: the traveler can replace lunch with another dining option, replace a shopping block with a different specialty area, or swap an evening experience without treating every change as the same kind of place deletion.

Itinerary blocks should not show "why this was arranged here" rationale by default. The itinerary sequence should render them as the time-ordered recommended plan, using compact cards focused on time, full place title, type, and only action-relevant short status. Itinerary blocks should not show Source Markers, long descriptions, source lists, route-check badges, internal labels, or full guide copy by default. Selecting a block should open image-and-text details, source context, related guide material, relevant alternatives, and available adjustment actions in the detail panel.

The itinerary sequence should not add a separate day overview, daily summary card, or header module above each day. It should start from the day's concrete Itinerary Blocks. Weather, pacing, fixed commitments, and contextual cautions should appear through relevant blocks, detail panels, route status, Placement Advisories, or Contextual Tip Surfaces.

具体块前不渲染独立日概览。既有起止点、运输节点和天气等必要日上下文仍保留在相关块、详情、路线状态或提示中，不因移除概览而丢失旅行事实。

#### Attraction Sub-branch

The attraction sub-branch is a visual reading and selection surface for sightseeing, museums, landmarks, neighborhoods, nature, and cultural venues.

Expected presentation:

- image-led cards or editorial rows;
- theme groups such as first-time landmarks, architecture, rainy-day museums, neighborhoods, or family-friendly stops;
- Attraction Guide Cards correspond directly to concrete Attraction Places;
- attraction themes are browsing groups only, not separate schedulable objects;
- title, local name when useful, area, category, recommended duration, and concrete place identity;
- why it matters, with enough context to understand the visit;
- best fit, such as morning, rainy day, family-friendly, architecture, art, first-time visit;
- compact image-level Source Marker only when a real image is present;
- relationship labels when the attraction also belongs to dining, shopping, or experience modules;
- actions to start an itinerary edit, compare alternatives, mark must-visit, or archive.

#### Shopping Sub-branch

The shopping sub-branch covers malls, markets, local brands, streets, specialty stores, souvenir areas, and shopping customs.

Expected presentation:

- image-and-text guide cards grouped by area or shopping purpose;
- theme groups such as local specialties, design brands, markets, luxury malls, daily-life shopping, or gifts;
- what to buy or browse, including local products and specialties when relevant;
- Local Products modeled separately from Purchase Places, so Landi can explain what to buy before asking the traveler where to go;
- one Local Product may link to multiple concrete Purchase Places;
- concrete recommended Purchase Places for each local product when available, using real place identities rather than vague shopping areas;
- Purchase Place Comparison when multiple purchase places exist, including location, suitable itinerary area, convenience, price or quality signals, hours, source state, and nearby itinerary links when available;
- price or effort signal when available;
- tax refund, payment, shipping, opening-hour, or reservation notes when relevant;
- nearby dining, attraction, or experience links when useful;
- one primary add action that starts an itinerary edit, plus secondary actions to keep as optional or open details.

If a Local Product has no concrete Purchase Place, it may remain informational guide content but should not be promoted as a schedulable shopping block. If it has multiple Purchase Places, the traveler should choose a specific place before adding it to the itinerary.

#### Local Signature Experience Sub-branch

This sub-branch contains destination-specific activities that are not just places, such as workshops, performances, seasonal events, local rituals, bathing culture, tea, nightlife, festivals, short excursions, or guided experiences.

Expected presentation:

- image-led story cards;
- theme groups such as seasonal events, hands-on workshops, performance nights, neighborhood life, bathing or wellness, or short excursions;
- Experience Themes modeled separately from Experience Offerings, so Landi can explain the local experience before asking the traveler which concrete activity or place to choose;
- one Experience Theme may link to multiple concrete Experience Offerings;
- concrete Experience Offerings when available, using real place, provider, event, route, or activity identities rather than vague local custom ideas;
- Experience Offering Comparison when multiple offerings exist, including location, duration, suitable itinerary area or day part, booking need, seasonal fit, accessibility, etiquette or risk notes, source state, and nearby itinerary links when available;
- experience type, suitable traveler, duration, booking need, seasonal fit;
- cultural context and practical notes;
- risk or etiquette notes when useful;
- related attraction, dining, or shopping places;
- one primary add action that starts an itinerary edit, plus secondary actions to save as candidate or create a preparation item.

If an Experience Theme has no concrete Experience Offering, it may remain informational guide content but should not be promoted as a schedulable local-experience block. If it has multiple Experience Offerings, the traveler should choose a specific offering before adding it to the itinerary.

#### Dining Sub-branch

The dining sub-branch covers local food culture, restaurant candidates, food streets, cafes, markets, dining etiquette, reservation-sensitive meals, and dietary constraints.

Expected presentation:

- image-and-text cards grouped by food type, area, or meal moment;
- theme groups such as breakfast, classic local dishes, casual lunch, dinner reservations, night snacks, cafes, desserts, or markets;
- Local Food modeled separately from Dining Places, so Landi can explain what to eat before asking the traveler where to go;
- local dish names and plain descriptions with enough context for a traveler to choose;
- one Local Food may link to multiple concrete Dining Places;
- concrete Dining Places or food areas for each Local Food when available, using real place identities rather than vague food ideas;
- Dining Place Comparison when multiple dining places exist, including location, suitable itinerary area or meal moment, reservation or queue expectation, dietary fit, price or quality signals, hours, source state, and nearby itinerary links when available;
- reservation or queue expectations;
- dietary or accessibility notes when known;
- nearby attraction, shopping, or experience links when useful;
- one primary add action that starts an itinerary edit, plus secondary actions to keep as nearby option or open the map/source.

If a Local Food has no concrete Dining Place or food area, it may remain informational guide content but should not be promoted as a schedulable meal block. If it has multiple Dining Places, the traveler should choose a specific place or food area before adding it to the itinerary.

The dining guide should not claim live table availability, ordering, delivery, or payment.

### 2. Pre-departure Preparation

This area turns preparation needs into actionable checklist items. It should be checklist-first and text-only. It does not need images; items that need traveler understanding before action can expand into concise written instructions or source-backed notes.

Preparation should follow a Preparation Relevance Rule. The Skill should generate items that materially affect travel readiness, legality, access, booking use, payment, connectivity, weather fit, health, safety, transport setup, or destination-specific procedures. It should not generate generic life advice or filler tasks such as buying an unrelated cup, organizing photos, or getting more rest unless the item is tied to a concrete travel requirement.

Expected presentation:

- grouped checklist sections;
- documents, booking confirmations, payment, connectivity, insurance, weather packing, local apps, transport setup, and destination-specific rules;
- expandable detail for items such as local apps, transport cards, entry materials, weather-specific equipment, or unfamiliar local procedures;
- due timing and accountable party in the underlying data when they materially affect readiness, but not as noisy default card text;
- source-backed status when official evidence is needed, shown through unobtrusive text or links rather than standalone `i` markers;
- ability to mark complete;
- ability to open related source or booking handoff.

准备项显示自身与所关联 Action Requirement 的精确来源、时效和未知状态。来源／预订交接只能打开既有有效链接，不自动勾选或声称外部完成。无执行任务关联的检查项使用 Blueprint 内独立 `completed` 状态；有 requirementId 的条目继续采用规范 Task 完成路径。独立检查项完成更新绑定当前 Plan 与 Blueprint 精确版本，并在重新编译时保留。

Preparation checklist rows should not expose internal generation labels, stage names, or bureaucratic category words such as "authorization" unless that wording is the traveler-facing name of a required action.

Preparation items that are time-sensitive may compile into dormant reminders in a Draft Plan and active reminders only after Plan activation.

### 3. Travel Tips

Travel tips should help the traveler behave well and avoid destination-specific friction. They should focus on local customs and practical cautions, including etiquette, transport habits, payment norms, safety, language, weather, dress, taboos, scams, tourist traps, and common local mistakes.

Travel tips should follow a Travel Tip Relevance Rule. The Skill should only generate tips tied to the destination, local culture, local infrastructure, trip context, or a concrete itinerary situation. It should not generate generic travel inspiration, broad life advice, motivational copy, or obvious universal reminders.

Expected presentation:

- compact text-first Travel Tip Cards;
- theme groups such as payment, transportation, dining etiquette, clothing, religious or cultural norms, safety, language, weather, and common mistakes;
- Canonical Tips in the Tips area for full browsing;
- short Contextual Tip Surfaces beside relevant itinerary days or blocks when the tip affects that moment;
- local transport norms, payment habits, safety, etiquette, weather, language, accessibility, family/elder needs, scams or tourist traps when evidence supports them;
- source and freshness disclosure for custom, safety, payment, transport, or other change-sensitive claims through unobtrusive source text or links rather than standalone `i` markers;
- source and freshness state for facts likely to change;
- actions to pin, dismiss, or turn into a preparation item when appropriate.

Travel tips should be organized primarily by theme in the Tips area as Canonical Tips, but the same tip may also appear as a small Contextual Tip Surface beside a relevant Itinerary Day or Itinerary Block. Contextual surfacing should show only the short caution needed at that itinerary moment, while the full explanation stays in the Tips area or shared detail view. It should reference the original tip and should not duplicate it as itinerary content. Travel tips are not execution tasks unless they have a concrete accountable action and completion condition.

Canonical Tip 持有 `pinned` 与 `hidden` 持久状态；隐藏不删除原文，提供恢复入口。日／块提示按明确 dayId、blockId、placeId 关联并链接回原 Tip 完整解释，隐藏 Tip 不再显示情境提示。Tip／Guide 转准备项须记录 origin 的 kind（tip/place/local_food/local_product/experience_theme）、id、blueprintId 和精确 blueprintVersion，复制当时证据与关联，重复转换不重复创建。转换只产生检查项；只有责任、完成条件和证据齐备的显式 Action Requirement 才能编译执行工作，不从文案推断任务或提醒。

## Cross-module Behavior

The workspace should treat attraction guide, shopping guide, local signature experiences, and dining guide as connected itinerary material. A traveler should be able to start from any of these itinerary sub-branches and add the selected item into a pending itinerary edit without losing its original guide context.

The workspace should allow content to move between modules through clear actions:

- add an attraction, shopping area, dining option, or experience to a day;
- save a place for later review;
- mark an item as must-visit, preferred, optional, archived, booked, or needs recheck;
- create a preparation task from a guide item;
- lock a fixed booking or scheduled commitment;
- ask Landi to rework one day, one area, or one module without rebuilding unrelated content.

When the traveler selects the add action on an unscheduled Guide Card, Web should open a lightweight Placement Selection State instead of inserting the item directly. In that state, the traveler should be able to choose:

- exact day;
- placement position or rough time block when useful, such as morning, lunch, afternoon, evening, or flexible;
- whether the new item should replace, append to, or be compared with existing content when that distinction is required.

Web should not expose a required scheduled-or-optional meaning selector in this flow. Landi may mark the resulting replacement draft as scheduled content or flexible itinerary content after route, timing, and constraint checks.

Placement Selection State should show available positions and lightweight Placement Advisories. Advisories may flag route friction, opening-hour uncertainty, meal timing mismatch, reservation sensitivity, weather fit, or day pacing risk. They should guide the traveler without blocking selection by default. Hard blocking should be reserved for fixed bookings, explicit traveler constraints, safety constraints, or structural defects that would make the Blueprint unusable.

选择位置后，工作区建立 Pending Itinerary Edit，不打开新的对话轮次。普通添加、同日重排和删除先在工作区预览，可撤销单项或取消整批；旅行者通过现有确认栏提交整批修改。直接 Blueprint Revision 写入路径已经连接，保存以所审阅的 Plan 与 Blueprint 版本为依据，生成新 Blueprint 版本并编译 Draft Plan，保留无关内容。保存失败时不得显示已保存，也不得丢弃仍可恢复的待确认编辑。Server 仅公开类型化业务错误的稳定 code、状态与安全产品文案；未知存储、编译或运行异常返回稳定 HTTP 500／internal_error，不回显异常。Web 不信任响应的 error/message（包括非 JSON 正文），以稳定 code 映射安全中文提示，保护、高影响与冲突仍保留结构化业务预览。已知拒绝必须在产生处区分实际动作：当前／执行行程不能从历史删除、只能丢弃未确认草稿、只能结束当前执行行程、重排／旧修改撤销／住宿调整要求草稿；这些拒绝不能统一建议辅助重规划。确认前的版本／执行基线冲突、已不待确认状态与真正内容审阅分别投影；生成忙碌、资料缺失、路线及住宿前置拒绝同样必须进入稳定code合同，不能在客户端被降为未知结果。安全业务文案与请求摘要的规范字段投影由 Core 同一纯合同实现拥有，Web 通过 @c-assistant/core/workspace-mutation-error 浏览器安全子入口消费，避免引入编译、存储与 Node 运行依赖。网络失败、正文读取失败、畸形 JSON／成功正文及响应丢失均为结果未知，不因重读当前版本推断原请求成败。普通添加不要求额外的强制影响摘要；高影响修改仍受下节约束。保存草稿不等于批准执行。

## Editing and Impact Rules

Low-impact edits may become Direct Blueprint Revisions:

- changing priority;
- assigning an unscheduled item to a traveler-chosen day with advisory checks;
- removing an ordinary non-fixed stop;
- same-day reorder within capacity;
- archiving a candidate;
- creating a preparation item from a guide card.

These edits should still pass through the existing edit confirmation path before becoming durable Blueprint Revisions, but they do not require the high-impact preview treatment.

High-impact edits require an impact preview before saving or replanning:

- changing trip dates;
- changing destination or city sequence;
- moving a fixed booking;
- deleting a must-visit or booked item;
- changing lodging anchor;
- exceeding day capacity;
- moving content across incompatible cities;
- affecting reminders, transport commitments, or official-source preparation.

影响预览解释受影响日期、路线、提醒、预订、证据与保持内容。日期按原始蓝图与完整提交批次投影：有 dayId 的编辑使用真实目标日，优先级编辑展开该地点所有 stop／block 所在日，按蓝图顺序去重并逐项对应日期。Web 用完整原批次校验精确地点、日与日期集合，不接受漏日、多余日、错配或重复。完全未排程的优先级或归档修改允许日期与日集合同时为空，并明确说明地点尚未安排日期、修改涉及整体优先级或归档状态；这不表示无影响或可确认。预订影响遵循上述预订设计，展示已知受影响的具体预订／分段及理由、已知排除事实和单列的未知原因，不把全量记录当影响集合，也不把空列表显示为已证明无影响。辅助重规划按钮仅在既有删除交接可执行时展示。

优先级和未排程候选归档与添加、重排、删除共用待确认编辑：展示预览、取消和整批确认，服务端绑定精确版本。must-only 删除先在 Core 产生三态高影响预览，再由 API 暴露受影响内容和后续选项；关系语义与保护优先级统一遵循预订设计。已知安全的软关联允许经过精确预览确认保存；booked、预约和显式固定承诺继续辅助重规划，不能用确认绕过。Remove、Move／拖动（含显式 reorderable）、Add／具体日期 Placement、优先级／归档及提示统一消费与当前 identity 匹配的 Blueprint 快照和 Core 唯一保护分类，按真实日期与完整最终命令（包括 Add／Move 的插入位置）派生；初始卡和比较入口只开启 Placement，实际选日、位置及提交按钮消费同一最终命令，不用无位置的投影推断整地点固定；不复制 assessment 到另一 presentation。快照已知固定禁用相应动作，未知独立提示并保留审阅及提交预览恢复，不永久阻挡，也不等于当前来源完整或可确认；无快照的历史展示仅保留独立 booked／预约保护及关系未知。

工作区提供真实“审阅预订关联”与更正入口：旅行者选择预订／分段，查看全部日程目标与跨日依赖，以本机本地日期、地点名称及可读来源确认关联或明确无关联和理由，不在普通面板暴露内部关系 ID、model 或摘要。旧来源恢复遵循预订设计：完整展示旧快照和真实候选 booking 层强度、全部分段及字段，旅行者逐约束、逐分段明确选择并填写理由/证据，不按名称自动匹配；先独立保存来源，再取得新上下文独立审阅关系。固定结构不等价的拒绝说明核对来源或辅助重规划的实际动作，保留原草稿，不把来源选择当降低承诺的授权。未知状态明确说明尚未核对的内部资料和剩余义务，提供审阅、返回草稿、取消或辅助重规划；相关未知排除前不显示可确认删除，不永久阻止恢复。审阅接受经 API／Core 原子创建新 Blueprint 与 Draft Plan，保持旧执行 Plan；不代表批准 Blueprint 生成或激活执行。

关系审阅前后保留已有待确认编辑，按实际命令会移除的全部出现位置重新校验目标和版本；不得丢弃草稿或沿用旧确认凭据。审阅后的 reviewRebase 必须绑定精确 save requestId／digest、已提交 revision／result 的新 Plan 与 Blueprint 身份，以及完整原未提交编辑批次摘要；版本 +1、宇宙摘要和源摘要相同只是必要条件，不是提交证明，未知结果或并发变化不得重绑。旧源映射恢复必须通过预订设计规定的真实选择与审阅，不由 Web 拼接来源或把执行快照当真预订。审阅／更正、补充导入或源结构变化后重算预览，高影响确认同时绑定原编辑批次与当前 assessment digest；旧凭据明确拒绝并返回重新审阅入口。关系更正本身复用同一持久请求身份、回执与未知结果恢复流程，不增加旁路写入。关系事实及保护语义归预订设计所有，本节规定工作区交互；实现及隔离验收证据独立记录，不代表正式交付或外部规划服务可用。来源祖先记录无法恢复时，保留原草稿与待确认编辑，提供从本人确认资料重新规划的正规入口；来源选择或普通审阅不能修复损坏审计。

失败保留可恢复编辑，旧版本拒绝，重复请求按原请求身份幂等。保存及撤销发出前必须在 sessionStorage 持久化完整不可变原始请求（含 requestId、原 Plan/version、Blueprint version、revisions 或 undo revisionId、highImpactConfirmation），并联结原草稿存储键与签名；持久化失败阻止发送。相同 requestId 不得改变载荷，高影响预览明确拒绝后确认采用新身份。刷新及未知结果恢复先只读查询 GET /api/plans/:planId/blueprint-revisions/receipts/:requestId，携带 operation=save|undo、expectedVersion、expectedBlueprintVersion 与原始载荷 requestDigest，撤销额外携带 revisionId。摘要对规范字段递归按键排序后取 UTF-8 SHA-256，保存覆盖原 Plan/version、Blueprint version、去除服务端 createdAt 的 revisions 及 highImpactConfirmation，撤销覆盖原 Plan/version、Blueprint version 与 revisionId；生成摘要期间同步锁住初始发送，避免双击产生两次身份。Storage 从既有原子 request_id/fingerprint/result_json 核验完整原身份与载荷摘要，不要求原 Plan 仍为当前。committed 返回完整身份及当前 workspace，保存还返回原 revision；只有完整匹配才能确认及按原草稿签名 compare-and-clear，不清理后续新编辑。确认原请求已提交时，同时清除该操作先前的未知告警；清除发生在发布当前工作区之前，之后真实加载失败产生的新提示仍须保留。显式重试和只读回执确认共用此收敛边界。not_found 仅表示尚未读到回执，不证明未提交；保留原身份、未知提示与草稿，不自动 POST。旅行者可明确选择以完整原请求再次提交以安全恢复；刷新读回不得悄悄创建新身份或更改载荷。

## Data Requirements

The Trip Blueprint contract should be extended or adapted to support module-aware presentation without making Web depend on skill-specific fields.

Required content structures include:

- module identity and display order;
- place and guide item identities;
- place display intent, including `display.type` for guide branch membership and optional `display.markerKind` for map marker icon semantics;
- guide theme identities and ordering;
- Guide Relationship Graph for concept-to-place relationships;
- `localFoods -> diningPlaces` relationships for dining guide material;
- `localProducts -> purchasePlaces` relationships for shopping guide material;
- `experienceThemes -> offerings` relationships for local-experience guide material;
- `attractions -> placeIdentity` relationships for attraction guide material;
- itinerary block type and replacement scope;
- itinerary block timing mode, including exact, rough, optional, and flexible states;
- rough time label intent for flexible timeline rendering;
- itinerary block references to Schedulable Itinerary Objects rather than theme-level records;
- guide item scheduling eligibility, including Informational Guide Items that are not available for timeline placement;
- cross-module memberships for attractions, shopping, dining, and experiences;
- image query or image source metadata;
- inspiration source references when guide material comes from social, UGC, review, short-video, image-board, or travel-community content;
- rich guide copy, not only one-line descriptions;
- Guide Card Summary for list browsing;
- Guide Value Explanation for places, foods, products, and experiences when useful;
- Guide Editorial Voice constraints for polished but grounded guide writing;
- Functional Workspace Voice constraints for timeline, preparation, tips, comparison rows, status, and action controls;
- Guide Option Comparison data when multiple concrete dining places, purchase places, or experience offerings are useful;
- Option Comparison Row fields for compact side-by-side comparison;
- Comparison Facts for option rows, avoiding subjective promotional copy;
- Neutral Option Ordering signals for peer options when useful;
- localized names and plain names;
- categories and tags;
- local products and related purchase places for shopping content;
- concrete purchase place identities for schedulable shopping content;
- local foods and related dining places or food areas for dining content;
- experience themes and related concrete offerings for local-experience content;
- recommended duration or effort;
- suitable contexts;
- internal scheduling compatibility for validation and impact checks, without default day, time, or replacement-type labels on unscheduled guide cards;
- whether an item is already part of the recommended itinerary or is available as replacement/enrichment material;
- evidence status;
- source references;
- compact source marker metadata for hover, focus, and tap disclosure;
- actions eligible in Web;
- relationship metadata, such as alternative, nearby, pairs well with, conflicts with, requires booking, or requires preparation.

The Web presentation should read from Landi-owned normalized structures. It should not read raw skill output.

Current Trip Blueprint Contract V2 slice:

- `moduleIdentity` declares that the Trip Blueprint primarily powers the Itinerary workspace while Preparation, Tips, and Sources are supporting Blueprint-backed modules.
- `guideTheme` records the trip narrative, visitor mode, taste model labels when used, and city or route segments tied to itinerary days.
- `guideRelationshipGraph` records place-to-place relationships such as alternatives, same-direction additions, meal support, rainy-day swaps, and anchor support.
- `localFoods`, `localProducts`, and `experienceThemes` record non-schedulable guide catalog themes. They link only to concrete `places` through dining, purchase, or offering place ids; itinerary days and blocks still reference concrete places, not themes.
- `schedulingEligibility` on places records whether an item is directly schedulable, informational only, blocked, or high-impact.
- `guideDisplay` on places records Web workspace guide-display intent such as guide inclusion, short card summary, compact tags, detail headings, traveler-facing add labels, and factual comparison rows. Web may fall back to legacy inference only when this field is absent.
- `blocks` on itinerary days records typed sequence units such as stops, flexible time, meals, rest, transfers, lodging anchors, and events.
- `travelTips` records destination-relevant, traveler-facing practical cautions with theme, context, optional day/place linkage, and evidence. Web falls back to older place/task tip inference only when this Blueprint field is absent.
- `preparationChecklist` records traveler-owned checklist items grouped for Web display, linked back to structured Action Requirements when applicable. Web falls back to compiled Plan task grouping only when this Blueprint field is absent.
- `fieldEvidence` records evidence for specific Blueprint fields or claims so importer validation does not treat whole-place evidence as proof for every displayed assertion.
- 直接修订沿既有规范路径扩展 Tip 状态、Guide／Tip 转准备项和独立准备项完成更新；优先级、归档与四类既有编辑共用版本和确认边界。一次确认批次只产生一个新 Blueprint 版本。
- 单项及批次修订记录保留原始与新 Plan／Blueprint 精确身份、请求身份、修订身份、受影响内容及撤销快照，作为主 Storage 审计事实；读模型只投影，不另建事实源。
- 预订关系采用预订设计的唯一不可变快照；生成候选、导入、编译和展示不得丢失审阅来源或把缺失当 complete。删除后的目标移除状态、覆盖失效与源语义版本重校也纳入同一修订 before/after 和回执。
- 保存后直接 Blueprint 编辑撤销是独立持久操作，绑定当前 Plan ID/version、Blueprint ID/version、原修订 ID 及幂等 requestId。仅当前仍对应原修订结果才可撤销；冲突拒绝。Core 恢复该修订影响范围（包括受改关系与覆盖）并按当前预订源语义版本验证完整性，不复活过期审阅，Storage 在一个事务中保存合法的新 Blueprint 版本、编译草稿、lineage、审计和撤销结果；任一步失败全部回滚。重复同请求返回同一结果，变更载荷不得复用身份。刷新／重启可回读可撤销记录。存在精确匹配的可撤销修订时，禁止自动路线刷新推进版本；路线检查保持可见，只有旅行者明确选择并读到新版本将结束当前撤销的说明后才刷新。保留无关内容、已完成工作、配置、预订和当前已批准执行 Plan 指针，撤销草稿不批准执行；本地未保存取消与已激活替换计划撤销仍是各自独立边界。

规范消费者为 Core `blueprint-revision.ts`／`workspace-mutation-error.ts`、Storage `applyDirectBlueprintRevisionBatch` 及直接修订撤销与回执读取、Server `local-web-routes.ts`／`plan-management-routes.ts`／`plan-presentation-routes.ts`／`web-agent-routes.ts`／`web-agent.ts`、Web `App.tsx`／`api-client.ts`／`plan-mutation-recovery.ts`／`direct-blueprint-recovery.ts`／`blueprint-impact-review.ts`／`CurrentPlanWorkspace.tsx`／`LandiBlueprintWorkspace.tsx`。Schema、Importer、投影与测试必须与这些状态一致。此设计约定不宣称验收完成，实际结果由本次测试和隔离实例证据判断。

Public source lookup has one 24-second set deadline, with at most four concurrent place reads. Read-only prefetch starts during research and has one 48-second set deadline. Completed independent place results remain available after the source deadline, and successful reads finish immediately. User cancellation stops result application. These source-read budgets are independent of MAH production and queue supervision.

Images are optional enhancements for itinerary guide material. If no suitable image is available for a guide item, itinerary block, or product, Web should render a polished text-only card and should not reserve an empty image area or show a decorative placeholder. Pre-departure preparation and Travel Tips do not require images and should render as text checklist or text card content.

时间序列卡无图或所有候选图片失败后采用完整文字展示，删除图片区域，不渲染装饰插图或预留空位。Guide 卡和时间序列卡分别验证无图与坏图。

## Web Presentation Requirements

The Plan Workspace should feel like a rich travel planning studio, not a static generated report.

Primary navigation:

```text
Itinerary
Preparation
Tips
Sources
```

The itinerary tab should use an Itinerary Workspace Layout on desktop: the left side presents the time-ordered itinerary sequence as the plan body, the right side presents the Itinerary Map as spatial and route context, and one openable Workspace Side Panel switches between the Itinerary Explore Panel and shared detail view. Detail does not need its own persistent top-level panel tab; selecting an itinerary block, guide card, or map item may open detail directly, with a clear return control back to Explore. The map should not dominate the workspace.

The layout should embrace Desktop Workspace Density. When screen space allows, the traveler should be able to keep the timeline, map, and Workspace Side Panel visible together for side-by-side reading, spatial review, and guide comparison. Explore and detail should be modes of the same side panel rather than two simultaneous sidebars. The workspace should not collapse into a mobile-style single-column flow.

The Workspace Side Panel should preserve Side Panel Navigation State when switching from explore mode into detail mode. Returning from detail should restore the previous explore filters, sort order, scroll position, and selected card rather than resetting the panel.

进入详情前保存 Explore 过滤、排序、日期、块、滚动和选中项的完整导航快照；详情内跨日定位不覆盖该快照。返回恢复原上下文和列表位置；当前具体块以可辨识的边框、背景及非纯颜色轮廓表达，并向辅助技术表达当前定位项。选中呈现覆盖实图、无图、坏图降级及适用卡片形态，悬停或聚焦不抹除它；拖动和待确认样式仍表达各自状态。同一地点多次出现时，以块身份保持当前定位，仅有地点身份的入口选择一个明确的可点击卡片出现位置，不将所有同地点块同时声明为当前项。仅作路线呈现的 transport 连接不承载当前详情卡选择；普通、紧凑及待确认的有地点卡片共用可选判断。添加或单项撤回草稿时同步更新其当前卡片上下文，不沿用其他地点块的身份。同日与跨日均需真实浏览器验证。

The itinerary sequence's primary role is to present the time-ordered recommended plan. The map should support spatial understanding, selected-place context, and route review; it should not be the default entrypoint for adding or replacing guide material. The itinerary sequence should support plan reading, block selection, status review, and changed-placement highlighting inside the existing edit state. The traveler should use the Itinerary Explore Panel, shared detail panel, Placement Selection State, and existing edit confirmation path to adjust the plan.

Attraction, dining, shopping, and local-experience sub-branches should be available inside the itinerary workspace. Those sub-branches should prioritize image-and-text cards, readable grouping, filters, and promotion actions into pending itinerary edits.

Preparation should prioritize actionable checklist groups. Tips should prioritize local customs, etiquette, and practical caution cards. Sources may remain a supporting view where evidence and freshness need to be inspectable.

The workspace should support:

- visual browsing;
- lightweight filters when they materially reduce browsing friction;
- card detail views;
- small source markers on real images only;
- hover, focus, or tap source disclosure for image markers, plus plain source summaries or links in details and the Sources view that separate inspiration sources from fact or evidence sources;
- itinerary sub-branch add/save/archive actions;
- version-aware save;
- 保存后的直接编辑撤销遵循上方精确版本、持久审计与原子编译合同。
- clear recheck and evidence states.

## Non-goals

- Do not generate standalone HTML as the product artifact.
- Do not let the skill define Web layout or interaction controls.
- Do not design or support a mobile version of the Web workspace.
- Do not design a post-import enrichment workflow for Informational Guide Items.
- Do not treat guide copy as executable work unless it compiles from a structured Action Requirement.
- Do not claim booking, ordering, payment, ride dispatch, live availability, or official eligibility without separate evidence and user confirmation.
- Do not rebuild the whole trip for a small direct edit.

## Acceptance Criteria

- A user can create a trip through the current chat-style flow without a heavy visible proposal page.
- The generated result contains Itinerary, Preparation, and Tips when relevant to the trip.
- Itinerary opens in an itinerary-sequence-led desktop workspace with map support and openable explore/detail side-panel modes.
- Attractions, shopping, experiences, and dining render as itinerary guide sub-branches with rich Guide Cards.
- Travel Tips render as compact text-first cards and contextual tip surfaces.
- Preparation renders as actionable grouped checklists.
- Guide cards can be promoted into itinerary days or preparation items where appropriate.
- Direct edits create version-aware Blueprint Revisions or an equivalent migration-safe write path.
- High-impact edits show an impact preview before changing travel meaning.
- 真实工作区可建立、审阅和更正预订关系，未知有可操作恢复；同日无关、跨日无关及同名异物不误列，跨日依赖、全局关系和同日重复酒店 blocks 不漏报，实际删除范围与评估一致。
- 预览后关系／源变化拒绝旧确认；已知安全软关联 must-only 可保存，固定保护不可绕过；刷新、回执、隔离重启与撤销保留关系、完成状态及旧执行 Plan。
- The Plan Compiler creates executable tasks and reminders only from structured requirements.
- Web never depends on raw skill UI output or skill-specific presentation assumptions.

## Skill Output Acceptance Criteria

A Landi-native planning Skill artifact is acceptable when it satisfies these generation-quality checks before or during Skill Importer normalization:

- It outputs Landi-native structured data for the Blueprint Contract, not standalone HTML, map-specific UI state, or Web layout instructions.
- It contains a complete Recommended Itinerary when the trip context supports one, with typed Itinerary Blocks for attractions, dining, shopping, local experiences, movement, rest, and flexible time where relevant.
- It uses Schedulable Itinerary Objects in timeline blocks. Local Food, Local Product, and Experience Theme records may explain choices but do not directly occupy the timeline.
- It supports Flexible Itinerary Blocks with timing modes and rough time label intent instead of inventing exact times for naturally flexible dining, shopping, local-experience, rest, or exploratory content.
- It does not require Per-block Arrangement Rationale for scheduled blocks, and it does not put arrangement explanations into timeline defaults.
- It treats attractions, dining, shopping, and local experiences as itinerary sub-branches over a shared Guide Catalog, not as separate top-level plan modules.
- It provides explicit Guide Relationship Graph data for food-to-place, product-to-place, experience-theme-to-offering, and attraction-to-place relationships.
- It marks useful guide material without a concrete schedulable object as Informational Guide Items that remain visible but unavailable for add-to-itinerary actions.
- It keeps Guide Card Summary short and scannable, with optional images, useful scanning tags, itinerary state where useful, image-level Source Marker metadata when an image exists, and state-aware actions.
- It assigns every place a structured display type for Attractions, Dining, Shopping, or Experiences, and only uses a distinct marker kind when the map icon should intentionally differ from the guide branch.
- It provides Guide Value Explanation when useful, using grounded Guide Editorial Voice rather than advertising language or social-media hype.
- It confines Guide Editorial Voice to guide value/supporting copy, and uses Functional Workspace Voice for timeline, preparation, tips, comparison rows, statuses, and action controls.
- It supports Guide Option Comparison for multiple concrete dining places, purchase places, or experience offerings as peer options, without candidate labels, default recommended labels, or forced best choices.
- It provides Option Comparison Row fields and Comparison Facts for peer options, keeping comparison rows factual and compact.
- It may provide Neutral Option Ordering signals, but only as non-promotional factual ordering, not as recommendation ranking.
- It treats images as optional enhancements. Missing suitable images should not produce placeholders or empty reserved image areas.
- It treats UGC, social, review, image-board, short-video, and travel-community material as optional Source Channels and possible Inspiration Sources, not required dependencies or verified evidence.
- It uses Source Capability Selection for global planning rather than hard-coded regional source bundles.
- It separates Inspiration Sources from evidence sources, and supports compact Source Marker disclosure for images plus plain source disclosure for text-only cards, tips, itinerary details, and the Sources view. Itinerary blocks do not show Source Markers by default.
- It generates Preparation Checklist items only when they satisfy the Preparation Relevance Rule.
- It generates Travel Tips only when they satisfy the Travel Tip Relevance Rule, and supports short Contextual Tip Surfaces for itinerary-linked cautions.
- It does not claim booking, ordering, payment, live table availability, ride dispatch, official eligibility, or external action completion without separate evidence and traveler confirmation.
- It produces rich guide content beyond one-line place descriptions while avoiding filler, generic life advice, generic travel inspiration, and large volumes of unschedulable background material.

### Explicit continuation development boundary (2026-11-19)

The Generate plan action invokes the existing confirmation handler only after an explicit user click. For isolated development, an internal continuation dependency may provide a short-lived observation bound to the current session, saved requirements revision and proposal version. The component reads that dependency without submitting on mount, return, focus or recheck; a click reads it again, rejects stale/changed/unknown observations and prevents concurrent confirmation. Every awaited result remains bound to the original component scope and edit generation.

The optional dependency is absent from the production App. The isolated factory's object identity prevents accidental deserialization or replacement by HTTP, environment, query strings or browser storage; it is not a permission credential. The current public MAH readiness contract remains blocked and is not extended with an invented affirmative schema. Server admission and version checks remain authoritative. Passing a development positive branch with a fake transport proves the component-to-existing-API wiring, not real MAH execution or production readiness.

The dedicated planning-continuation development harness mounts the real component and sends its ordinary API requests to the real isolated Server/Storage composition. Only its clearly named test control/readiness dependency and MAH transport are fictional. The ordinary production entry does not expose that harness. A07 covers explicit action, exact current identity and content preservation; A18 covers revocation/version changes on recheck and the independent Server version guard. Live affirmative MAH admission remains a separate runtime obligation.

### Ordinary MAH planning request submission

The normal new-plan entry saves the user's original message and freezes one conversation request before submission. The installed MAH public read-only preview must identify this canonical project and exclude project writes. The ordinary immediate Task queue receives the request attachment with the preallocated Task ID. An independent durable submission journal records uncertainty before the CLI runs, so an interrupted or repeated HTTP request never submits a replacement Task.

Submission admission and plan readiness are distinct. The submission preview only admits sending the request. A project-bound public Task readback establishes receipt. Applying a planning response still requires the completed public lifecycle, exact attached request digest and public result artifact receipt. A delayed, failed or unverifiable result keeps the saved requirements and reports the observed stage. This entry does not enable generation, revision, email or hosting readiness.

### Real MAH generation acceptance in an isolated workspace

For an explicitly authorized local acceptance run, `node scripts/start-generation-validation.mjs <existing-synthetic-database> <saved-session-id> [port]` starts the standard Landi application with its existing isolated runtime factory and the installed public MAH CLI. The selected database must exist outside the project and component source repositories and contain the synthetic session being tested. The operator checks the selected database and session before launch. The server reads that session's proposal identity from the database. It keeps admission scoped to that instance, session and proposal, with the current saved revision checked on every admission and confirmation.

The normal workspace reads `generation-admission` and sends `expectedRevision` with its explicit confirmation. Each request performs the public read-only submission preflight independently. Only an authorized confirmation establishes the async execution context for that selected proposal. The existing stage transport, public result validation, cancellation and atomic import remain responsible for the generated result. Recovery reads only this generation's existing task identities and rechecks admission before continuing. An admission response certifies the ability to attempt this isolated submission. Full production generation remains closed until its required real execution and result evidence pass acceptance. Email, active travel operation and unrelated generation scopes retain their existing gates.


### Accommodation for confirmed same-day trips

A user-confirmed date range that starts and ends on the same date has no destination night. When the traveler has no explicit accommodation request, omit hotel-anchor research and accommodation-selection publication requirements. An explicit no-lodging fact applies to that same-day boundary. Preserve requested day-use rooms, specific user stays and accepted bookings. Multi-day or unresolved date ranges retain their existing overnight planning checks. The generation request must describe the confirmed arrival and departure endpoints as the day's route boundaries, without adding an overnight hotel placeholder.
