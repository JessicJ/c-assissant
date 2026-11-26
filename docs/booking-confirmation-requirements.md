---
status: converged
---

# Booking Confirmation Requirements

Design review: 2026-11-17

T2-1 acceptance covers the desktop workspace path for establishing, reviewing, and correcting booking relationships, previewing impacts, and saving or undoing a versioned change. Live generation remains subject to T1-1 acceptance. The Later items below retain their own design and verification requirements.

## Purpose

预订关系闭环规范：以下 Booking Itinerary Assessment 是关系事实、来源生命周期和保护判断的唯一规范。实现与隔离验收证据分别记录，指导或单项验证不代表正式交付，也不证明外部规划服务已可用。

Landi should use confirmed and pending travel bookings such as hotels, flights, trains, rental cars, restaurants, tickets, and tours as foundation facts for Plan generation.

The feature is inspired by TREK's reservation, accommodation, and transport model, but adapted to Landi's single-user, versioned Plan architecture. The goal is not to book, pay, cancel, or modify reservations on behalf of the traveler. The goal is to turn booking evidence into structured generation input first, then into Plan facts that drive itinerary shape, review, reminders, route anchors, handoffs, and in-trip assistance.

## Product Principles

- 预订在生成前作为 Planning Session 证据保存；生成后通过 Blueprint 的明确源引用成为逻辑 Plan-linked Booking，原始 owner 与稳定 ID 不变，不复制或搬移记录。旅行者未明确要求保存可复用偏好时，不写长期 Profile。
- A discovered booking, imported file, or external link never becomes a confirmed booking without either reliable parsed evidence or explicit traveler confirmation.
- Traveler-initiated import confirms that the source material should be considered Booking Evidence, but it does not automatically confirm every parsed field as a hard Booking Constraint.
- Opening a booking, map, airline, rental, or payment link does not prove completion.
- Imported or AI-extracted bookings may be useful before they are complete; incomplete records must be marked as needing review.
- Confirmed booking times, locations, and stays are hard generation constraints unless the traveler explicitly marks them as flexible.
- Pending or needs-review booking records are soft constraints: they should shape the proposal and draft Plan, but remain visibly unresolved.
- Booking changes that affect dates, lodging base, fixed commitments, arrival/departure, reminders, or itinerary structure require a version-bound impact preview before altering an active Plan.
- Sensitive confirmation codes and attached documents should be treated as private trip data, not normal descriptive plan text.

## Role in Plan Generation

Booking information should be available before a complete Plan exists. Landi should treat it as high-priority structured context during Planning Session collection, proposal creation, and generation-critical fact checks.

### Generation Input Behavior

- Booking Evidence may provide facts that satisfy the Planning Minimum, such as destination and travel dates, but it does not add new mandatory fields to the Planning Minimum.
- A confirmed hotel stay defines a date-bounded Lodging Anchor, check-in/check-out boundaries, and daily route anchor for affected itinerary days.
- A confirmed inbound flight/train defines arrival city, arrival node, local arrival time, and the first transfer requirement.
- A confirmed outbound flight/train defines the final departure node, local departure time, and return-transfer requirement.
- A confirmed rental car defines pickup/return windows and Transport Availability for that time window. It should not rewrite the Plan's global transport preference.
- A confirmed event, restaurant, ticket, or tour defines a fixed commitment on a specific date/time and should block conflicting itinerary suggestions.
- A pending booking may be used as a candidate anchor, but the generated Plan must label it as pending and ask for confirmation before treating it as fixed.
- Missing booking details should become targeted Planning Session unknowns instead of generic "please provide more information" questions.

### Planning Session Changes

The Planning Session should accept booking facts alongside normal conversational facts:

- manual booking snippets from the user;
- pasted confirmation text;
- uploaded confirmation files, when upload is implemented;
- connector-discovered reservations, when connectors are implemented;
- AI-extracted candidates, only after preview.

Imported confirmation content immediately becomes Booking Evidence after the traveler submits it. Parsed fields from that content become Proposed Booking Constraints until the traveler accepts them in preview or correction flow.

Booking Import does not create a Plan, Draft Plan, Trip Blueprint, or Blueprint Generation by itself. It enriches the current Planning Session and must survive browser refresh or session reopening. Blueprint Publication 与 Draft Plan 编译后，通过不可变 Blueprint 的源引用将证据和接受的约束逻辑关联到 Plan；不产生第二份可编辑 booking。

If no Planning Session exists, Booking Import may create one. Import alone must not auto-create a Planning Proposal or start Blueprint Generation. Landi should first ask the traveler whether to plan around the imported booking evidence and collect any missing trip intent.

When multiple booking items are imported, Landi may suggest that they belong to the same trip based on date proximity, city or airport continuity, traveler names, and provider clues. Suggested grouping does not establish the trip boundary until the traveler confirms it.

The proposal should summarize booking-derived constraints separately from assumptions. Example:

- "Arrive at HND on 2026-10-08 at 17:40."
- "Stay at Hotel Metropolitan Tokyo from 2026-10-08 to 2026-10-12."
- "Rental car pickup is pending; itinerary will avoid assuming a car until confirmed."

The Planning Proposal should emphasize only Booking Constraints that affect generation. Non-structural Booking Evidence, such as room type, breakfast, seat, confirmation code, supplier contacts, prices, or cancellation notes, should appear only in a compact imported-evidence summary or later Trip Logistics view.

Before generation, Landi should verify that all hard booking constraints have enough structure to be used safely:

- local date and time;
- time zone or location from which a time zone can be resolved;
- city or node;
- booking status;
- whether the commitment is fixed or flexible.

If a booking lacks those fields, Plan generation may continue only when the missing field is non-critical or clearly marked as needing review.

Booking Evidence is not an absolute prerequisite for Blueprint Generation. Landi may generate without imported flights, hotels, or rental cars when the Planning Minimum and generation-critical facts are otherwise satisfied. Missing lodging may use an explicit provisional area or routing anchor. Missing arrival or departure details may remain a Blocking Unknown or visible Planning Assumption depending on whether the trip boundary is otherwise safe.

An accommodation confirmation may provide destination and date-boundary facts for generation. It must not be used to invent arrival node, arrival time, departure node, or departure transport when those are not present in the Booking Evidence or traveler input.

Round-trip transport Booking Evidence may provide arrival and departure anchors for generation even when lodging is unknown. In that case, lodging may be represented only as a Planning Assumption or candidate area. Landi must not create a Lodging Anchor, confirmed accommodation, or verified accommodation-to-place route without accepted accommodation evidence or traveler confirmation.

If the traveler states that a hard real-world commitment exists, such as "I already booked the hotel" or "my flight is confirmed", but the commitment lacks usable date, time, location, or status fields, Landi should keep it as an unresolved booking item and must not fabricate the missing constraint.

When imported booking times omit a time zone, Landi may infer the time zone from a sufficiently specific endpoint, airport, station, property location, or city. Inferred time zones must be shown in preview for traveler confirmation. If location context is too weak to resolve a time zone, the segment remains `needs_review` and cannot become a hard Booking Constraint.

Booking Import success must not depend on external geocoding. MVP should preserve textual locations such as airport codes, station names, hotel names, addresses, and city labels. If a map connector is available, Landi may enrich accepted records with coordinates, resolved city, and time zone asynchronously. Route calculation or map placement may remain pending until geocoding succeeds.

Booking Evidence that does not match the current Planning Minimum, date window, destination, or traveler-confirmed trip boundary should be marked out of scope. Out-of-scope evidence remains visible in the Planning Session but does not produce Booking Constraints for the current Blueprint Generation unless the traveler explicitly includes it.

### Conflict Behavior

Accepted hard Booking Constraints take precedence over natural-language trip intent, but Landi must not resolve conflicts silently.

Examples:

- The traveler says the trip is October 8-12, but an accepted hotel stay is October 9-13.
- The traveler says they prefer public transit, but an accepted rental-car booking creates a fixed pickup/return window.
- The traveler asks for a day trip, but an accepted event ticket occupies the same time window.

When a hard Booking Constraint conflicts with traveler intent, Planning Proposal, or another hard constraint, Landi should:

- show the conflict in the Planning Proposal or pre-generation review;
- block Blueprint Generation when the conflict changes the trip boundary or makes the itinerary infeasible;
- let the traveler edit the Booking Evidence, downgrade the Booking Constraint, ignore the conflicting segment, or revise the trip intent;
- record the chosen resolution before generation proceeds.

The traveler may explicitly downgrade an accepted hard Booking Constraint. Downgrading keeps the Booking Evidence and parsed details visible, but prevents that constraint from controlling Blueprint Generation as a fixed commitment. The Planning Proposal should show downgraded constraints as ignored or informational context, not as Planning Assumptions.

## Reference Behavior From TREK

TREK provides a useful reference shape:

- Reservations are grouped by status and type, with cards showing date/time range, confirmation code, linked place/day, notes, files, and type-specific metadata.
- Hotels are special: an accommodation is a distinct stay record tied to check-in/check-out days, and it also creates a linked Hotel reservation.
- Transports are special: flights, trains, cars, and cruises are created through a dedicated transport flow with endpoints, local times, and type-specific fields.
- Booking import supports email, PDF, pass, HTML, and text files; parsed results are previewed before saving; partial parses are flagged for review.
- AI parsing is a fallback for files that structured extraction cannot read, and every AI result requires review before saving.

Sources:

- TREK Reservations and Bookings: https://github.com/liketrek/TREK/wiki/Reservations-and-Bookings
- TREK Accommodations: https://github.com/liketrek/TREK/wiki/Accommodations
- TREK Transport: https://github.com/liketrek/TREK/wiki/Transport-Flights-Trains-Cars
- TREK MCP tools: https://github.com/liketrek/TREK/wiki/MCP-Tools-and-Resources

## Scope

### MVP

The first Landi version should support:

- Manual creation and editing of booking records during Planning Session intake and after Plan generation.
- User-provided booking email import from pasted confirmation text or uploaded `.eml`, `.html`, or `.txt` content.
- Import preview before any imported booking becomes Booking Evidence or a Booking Constraint.
- Hotel/accommodation records that can seed Plan accommodation configuration and itinerary day boundaries.
- Flight, train or long-distance transport, and rental-car records that can seed arrival/departure facts, movement assumptions, and fixed time windows.
- Semi-structured event, ticket, tour, restaurant, and other booking records without full parser coverage.
- Confirmation code, supplier, status, local times, notes, source/evidence, and document attachment metadata.
- Inclusion of privacy-minimized booking facts in the Landi generation context and capability-based research where needed.
- A booking review surface in Web.
- Reminder generation for check-in, check-out, flight departure, car pickup/return, and "review booking details before trip".
- Explicit "needs review" state for incomplete or imported bookings.

### Later

Later phases may add:

- Structured parsing for `.pdf` and `.pkpass`.
- AI extraction fallback for hard-to-read confirmations.
- Gmail, Outlook, or other mailbox connectors with explicit account authorization.
- Calendar export/import.
- Airline or flight-status connectors.
- Live rental, hotel, or ticket provider integrations.
- Budget linkage.
- Search across bookings and attached documents.

## Domain Model

A `TravelBooking` is a separate aggregate that can be referenced by `Task` and `PlanPlace`. The owning `PlanningSession` or `Plan` stays fixed. After generation, the accepted Blueprint source references and compilation lineage link the booking to the generated Plan.

### TravelBooking

Required fields:

- `id`
- `planningSessionId`
- `planId`
- `planVersionCreated`
- `type`: `accommodation`, `flight`, `train`, `rental_car`, `cruise`, `restaurant`, `event`, `tour`, `ticket`, `other`
- `status`: `pending`, `confirmed`, `cancelled`, `needs_review`
- `constraintStrength`: `hard`, `soft`, `informational`
- `fixedCommitment`: boolean
- `title`
- `providerName`
- `confirmationCode`
- `startAtLocal`
- `startTimeZone`
- `endAtLocal`
- `endTimeZone`
- `notes`
- `source`: `user`, `imported_file`, `connector`, `ai_extracted`
- `sourceRefs`
- `createdAt`
- `updatedAt`

Recommended fields:

- `travelerNames`
- `partySize`
- `price`
- `currency`
- `cancellationPolicySummary`
- `contactPhone`
- `contactEmail`
- `manageBookingUrl`
- `checkInUrl`
- `mapUrl`
- `needsReviewReasons`
- `sensitiveFields`

### Booking-Derived Planning Fact

During proposal and generation, Landi should not pass raw booking records as loose prose. It should derive explicit planning facts from them.

Fields:

- `id`
- `bookingId`
- `planningSessionId`
- `key`
- `value`
- `source`: `booking_manual`, `booking_import`, `booking_connector`, `booking_ai_extract`
- `confirmed`
- `constraintStrength`
- `generationRole`: `arrival_anchor`, `departure_anchor`, `lodging_anchor`, `fixed_event`, `transport_mode_hint`, `budget_hint`, `document_reference`
- `missingRequiredFields`
- `updatedAt`

### Booking Itinerary Assessment（预订行程关系评估）

本节唯一拥有预订与行程关系的语义、覆盖、来源、审阅和有效性。关系评估随不可变 Trip Blueprint Version 保存，规范字段为 `bookingRelationshipAssessment`。TravelBooking 拥有真实预订与私密执行资料，Blueprint Booking Constraint 是其隐私最小化输入快照；TravelBooking 不另存可编辑日程关系，任何查询索引只能从 Blueprint 快照生成，不成为第二事实源。

每个评估单元绑定稳定的 `bookingConstraintId` 与精确 `segmentId`；没有分段的预订使用明确 booking 级单元，不得遗漏。保留可逆、唯一且经服务端校验的源 booking／segment 身份映射，以及源结构的规范语义摘要（对规范字段递归按键排序的 UTF-8 JSON 取 SHA-256）；审阅基准另保留 Blueprint ID/version，不维护第二套可任选的源修订事实。摘要覆盖接受的时间、地点、状态、强度、分段和语义来源；确认码、原邮件、旅客姓名和其他私密非结构资料不进入 Blueprint 或摘要输入审计文本，也不因这些资料更正而强制重审。

关系目标必须明确区分下列作用域：

- `occurrence`：有 blocks 时以 `dayId + blockId` 指向具体物理出现，并核验 `placeId` 一致；同日酒店的入住、取行李等多次出现分别保留。只有旧的无 blocks 且 stops 同日 Place 唯一的记录才使用 `dayId + placeId`。跨日同 Place 是不同目标；不引入不存在的 stopId，不以 order、名称或日期相似替代身份，不把 block 目标降级成 stop-only。按 dayId/placeId 删除的现有命令若移除全部同地点 blocks，必须展开其实际移除的全部出现位置；单 block 删除需要先演进命令和请求摘要合同。
- `place_global`：旅行者或 Agent 明确声明对该 Place 全部出现位置的关系。本轮采用“任一所列出现位置变化需复核”的明确语义；缺 dayId 不能自动成为全局关系。
- `dependency`：显式记录预订／分段依赖的 occurrence 或 movement 及受影响的其他 occurrence／movement，可跨日表示住宿基地、取还车和转乘。保存方向、业务作用（直接承诺、资源依赖或行程上下文）、触发操作及理由；审阅时列出完整依赖集合，不从同日、时间交叠、文本或任意图可达性推断业务影响。

每条关系及“明确无关联”决定均保留安全来源引用、理由、决定来源（旅行者或 Agent）、负责身份、时间、基准 Blueprint 版本、源语义摘要和目标集合摘要。complete 单元或含正关系的单元、每条正关系及其负责决定均须有非空安全 evidenceRefs；旅行者的明确声明可以用 traveler-declaration 来源记录，不冒充外部核实。partial／unknown 且无正关系可保留空来源，不能产生排除事实。coverage=complete 是唯一类型化的全量直接、间接和跨日责任声明，不另设重复确认字段，也不按理由关键词判断；decision.obligations 保存非空职责说明。Agent 候选还保留实际 Agent、model、rationale、evidence references 与 obligations，身份来自可信调用边界，不接受客户端自称 Agent。确定性代码只校验结构、归属、摘要和版本，不能代替语义判断。

每个单元声明 `coverage=complete|partial|unknown`。覆盖宇宙包括当前 Blueprint 全部日程出现位置、全局地点、movement、显式依赖及全部已采用预订单元，保留规范全量集合摘要；取消、忽略和排除单元也要有可追溯状态，不能因过滤而隐去缺口。complete 要求审阅者明确已考虑直接、间接及跨日依赖，并且所有单元及引用齐备有效。只有有效且已审阅的 `complete + []` 才表示明确无关联；字段缺失、空数组、漏分段、partial、坏引用及过期结果均不证明无影响。纯 Blueprint 离线计算只评价该快照，零单元不证明当前真实来源集合完整，也不证明外部没有预订。

真实工作区调用由 Storage 的单一 resolver 提供可信运行时 `BookingRelationshipSourceContext`：精确 Plan ID/version、Blueprint ID/version、sourceSetDigest、已采用真实源当前投影的单元摘要、pendingSources 的真实 sourceBookingId/sourceDigest，以及缺源、坏映射、无法验证祖先或来源范围的 typed resolutionIssues。当前直接归属、已采用引用及经核实精确祖先产生待核对义务；仅为候选的兄弟来源不产生义务。该 context 不持久化为另一成员表，不接受客户端提交，也不把 pending 伪装成 adopted constraint 或改写历史 universeDigest。Core 验证精确 Blueprint 身份与字段，affected/unaffected 只包含已采用约束；unknown 保留约束单元分支，并明确区分 source_obligation 与 source_resolution，无可用真实源身份时保留范围级问题。源已变化时旧正关系也不能冒充有效。assessmentDigest 与高影响 token 绑定完整 context，事务内重新解析，源变化即使 Plan 未变也不能复用确认。

同一 context 必须贯通公开 single、batch、每个子预览、固定保护、关系审阅和 Undo。高影响预览响应返回该 context 的独立只读投影；真实工作区必须提供并核对精确当前 Plan／Blueprint 身份，缺失、错身份、遗漏已采用单元或 pending／resolution 义务的响应一律拒绝可确认展示。客户端在核对未知集合的来源覆盖前，先验证该集合及每个条目的结构，结构异常须直接拒绝，不能继续解引用条目核对来源覆盖；再复用 Core 规范影响计算核对完整三态集合、来源覆盖及 assessment digest，不另立关系语义；离线快照计算可省略 context，客户端不能将该投影作为可信写入输入。single 与 metadata 的 options 确认和既有 remove 命令确认归一为同一值，两处冲突必须拒绝。待核对来源使关系操作未知且不能确认，Tip／准备项等不改变关系目标语义的编辑继续保存并通过精确祖先保留义务；来源选择只采用明确选择项，余项仍 pending。有 pending 或解析缺口时不能接受完整关系审阅，须先选择真实来源再独立审阅。固定保护仅解引用真实已采用约束，pending 的强度不证明它与目标有直接承诺；booked／reservation 独立保护不变。

Core 对具体编辑批次同时返回已知受影响、已知不受影响和未知：有效关系命中是已知影响；完整有效覆盖且无交集才可排除；其他单元保留未知原因和复核义务。局部已知影响不消除其他未知。Core 接受审阅时派生并保存 `reviewedTargetDigests`，以精确目标 kind/day/block/place/movement 身份为键，摘要覆盖目标旅行语义及显式跨日依赖的完整成员、方向与目标集；客户端不能提供该字段作为可信判断。某单元源摘要与相关目标／依赖摘要仍有效时，其明确正关系可以保留已知影响，同时其他单元或覆盖缺口保持未知；已知不受影响仍须该单元源摘要和全量宇宙 complete 均有效，不能由局部摘要扩大排除。影响集合只列真实命中的预订及分段，未知单列；与本次操作有关且尚未排除的未知阻止生成确认凭据，必须提供可恢复审阅，不能永久拒绝。Core 在唯一保护分类中区分已知 fixed 直接承诺与约束单元未知下的保守固定保护；写入沿用任一成立即拒绝，source_obligation／source_resolution 不伪装固定约束。Web 只读快照按真实 day／place 与完整最终操作（含插入 position.kind／afterPlaceId）展示已知固定与独立未知提示，位置缺省、after 和 end 不得复用同一派生缓存，已知固定不被其他未知覆盖；缺快照保持关系未知，不从名称／位置推断关联，也不宣称当前真实来源完整。关联不自动成为硬保护，软关联即使受影响仍可经精确高影响确认处理；独立 booked、reservation requirement 及显式 fixed/hard 直接承诺优先保护，不能通过改关系或先降优先级再删除绕过。

Core 与 API 的日期范围按完整原始编辑批次及精确原蓝图投影：dayId 编辑保留真实目标日，priority 展开 Place 所有 stop／block 所在日，按蓝图顺序去重并逐项对应日期；priority 保存后的影响摘要也覆盖全部出现日，但不制造路线刷新。未排程 priority／归档的全局影响允许 dayIds／dates 成对为空，仍保留准确 placeIds、三态、来源义务与 token，不推导可确认性；blocks-only 排程仍阻止直接归档。Server 原样传递 Core 投影，不补当前日、首日或全行程。

无法定位到具体约束或真实源的范围级 resolutionIssue 只增加 source_resolution 未知项，不撤销另有真实源摘要及目标摘要证明的局部 affected 关系。仅当 missing_source、invalid_mapping 或 source_scope_unresolved 精确定位该约束／来源，或该单元实际源摘要失配时，撤销对应单元的已知关系；全局 unverified_ancestor 不得扩大为全部已采用来源失效。范围级未知仍阻止关系操作确认和完整审阅，保留已知影响不等于放行。

最小真实生产者是旅行者在现有 Web 工作区选择预订／分段、查看全量目标和跨日依赖、明确关联或无关联、确认理由后审阅接受或更正。流程必须贯通真实 Web → 类型化 API → Core → Storage 新版本事务，不能依靠夹具、控制台、脚本或数据库注入。Agent 生成只提供结构化候选，合法候选可因来源或目标过期成为 invalidated／unknown，绝不自动升为 reviewed；缺候选保持未知。服务器可在结构校验后把候选绑定到后分配的真实 Blueprint ID/version，作为导入元数据，不认证其自述来源，不补造覆盖摘要或证明；已有受信评估只在精确同 Blueprint lineage 保留历史基准后 reconcile，跨 Blueprint 不搬移 reviewed 结论。接受候选、批准 Blueprint 生成与激活 Execution Plan 是三个独立决定。

审阅写入绑定精确 Plan ID/version、Blueprint ID/version、源语义版本、完整审阅输入及 requestId；同身份异载荷拒绝。关系变动产生新版 Blueprint 和 Draft Plan，旧执行 Plan 连续。审阅提交的 assessment 保留真实输入基准 N，事务产物为 N+1；持久消费者不得将合法历史基准误当陈旧提交，也不得改写基准冒充 N+1。写入准入仍要求精确当前版本；持久严格读取仅在 reviewed、同一 Blueprint lineage、合法版本边界及来源/宇宙/全量目标结构等价时允许该历史基准，继续核验完整覆盖、生产者证明及真实源/分段身份。语义目标或来源变化、未核实 Agent、缺失真实身份仍失败关闭。高影响确认凭据同时绑定这些基准、完整原始编辑批次及规范 assessment digest，服务端确认时重新核对。新增预订、分段增删／更正、状态／强度／时间／地点变化或目标／movement／依赖变化使相应评估失效，新增单元使整体覆盖不完整；非语义变动仅在可证明结构等价并记录延续依据时保留审阅，不因任意版本递增永久清空，也不沿用实际语义变化前的 complete。

删除行程目标不删除或取消真实预订。历史版本及审计保留关系，当前版本保留原目标快照并标记目标移除／待复核，不能伪装成有效悬空引用或静默丢弃。Undo 先从精确 before/after 与 current 三方恢复生成保留无关当前内容的目标快照，并确定实际逆向日程操作；booked／独立预约保护仍检查 current，预订关系固定保护与三态影响统一在精确恢复目标及其历史审阅证明上，使用当前持久来源 context 重校。不能以删除后 current 的覆盖失效把已证明无关的硬承诺扩大为固定保护，也不能直接用 before 替代恢复目标或省略关系未知、源变化及真正命中固定承诺的拒绝；不再可证明安全时返回 typed 来源待审拒绝或辅助重规划，保留重新审阅／编辑入口，不发明另一 Undo 确认协议，也不能先删除目标再仅标 invalidated。纯内容撤销可继续。恢复涉及的关系与覆盖后仍重校当前源，不能复活过期 complete，来源选择的撤销也不能抹去来源义务。before/after、审计、回执、Blueprint、编译草稿与 lineage 同事务提交，故障回滚；保留合法预订任务、提醒、完成状态和旧执行 Plan，复核义务不授权外部取消或执行切换。

旧无字段数据一律未知。名称／位置匹配不得作为精确事实源或并行保护回退：旧固定预订缺关系时进入未知审阅，明确审阅证明无关后可解除该项未知，但不能解除独立 booked／预约保护。readiness 等诊断也必须消费同一关系或标未知，不能以文本匹配输出正式“已支持”。

### BookingEndpoint

Transport and location-based bookings need ordered endpoints.

Fields:

- `id`
- `bookingId`
- `role`: `origin`, `destination`, `stop`, `pickup`, `return`, `venue`
- `name`
- `address`
- `city`
- `country`
- `iataCode`
- `stationCode`
- `coordinates`
- `timeZone`
- `scheduledAtLocal`
- `terminal`
- `gate`
- `platform`

### BookingSegment

A booking may contain multiple time-bound segments derived from the same Booking Evidence.

Fields:

- `id`
- `bookingId`
- `segmentType`: `flight_leg`, `train_leg`, `hotel_stay`, `rental_pickup`, `rental_return`, `event_window`, `other`
- `title`
- `status`
- `startAtLocal`
- `startTimeZone`
- `endAtLocal`
- `endTimeZone`
- `constraintStrength`
- `fixedCommitment`
- `originEndpointId`
- `destinationEndpointId`
- `sourceRefs`

Behavior:

- A round-trip flight confirmation may create one Booking Evidence item, one TravelBooking, and multiple flight-leg Booking Segments.
- A hotel confirmation usually creates one hotel-stay Booking Segment; extras such as breakfast, late checkout, or shuttle notes remain add-ons unless they create fixed time windows.
- A rental-car confirmation usually creates pickup and return segments under one TravelBooking.
- Blueprint Generation uses accepted Booking Segments as the time-bound units that constrain itinerary structure.
- 取消或 ignored 分段在隐私最小化 Blueprint Booking Constraints 中保留稳定源身份与状态，供覆盖审阅、历史和失效校验；它们不塑造生成行程，不编译执行任务或 Dormant Reminders。其他旅行的 out-of-scope 证据仍不自动纳入当前源集合。
- Soft segments may shape the proposal or create review work, but should not generate time-sensitive action reminders until upgraded to hard.

### AccommodationStay

Accommodation should remain special because it affects daily route anchors and active trip context.

Fields:

- `id`
- `planId`
- `bookingId`
- `placeId`
- `propertyName`
- `address`
- `coordinates`
- `checkInDayId`
- `checkOutDayId`
- `checkInFromLocal`
- `checkInUntilLocal`
- `checkOutByLocal`
- `confirmationCode`
- `status`

Behavior:

- A confirmed stay updates or links to `Plan.configuration.accommodation`.
- Route recalculation from accommodation to first stop should reuse the existing `prepareAccommodationDepartures` flow.
- A stay appears on every itinerary day from check-in through check-out, with boundary labels for check-in and check-out.
- Multiple stays may create multiple Lodging Anchors. Each itinerary day should use the applicable stay rather than assuming a single trip-wide accommodation base.
- Checkout day handling should distinguish morning checkout, luggage storage, and later departure assumptions when those details affect the day's route.
- Landi must not assume luggage storage after checkout. If checkout-day itinerary structure depends on leaving bags at the property, the Trip Blueprint should mark the assumption as needing review or compile an Action Requirement to confirm luggage storage, unless the Booking Evidence or traveler explicitly confirms it.

### BookingAttachment

Files should be tracked as metadata first, even before binary upload is fully implemented.

Fields:

- `id`
- `bookingId`
- `fileName`
- `mimeType`
- `sizeBytes`
- `storageKey`
- `uploadedAt`
- `sourceHash`
- `extractionStatus`: `not_attempted`, `parsed`, `partial`, `failed`

Behavior:

- Full imported email or file content may be retained only as a protected attachment.
- Normal booking records should store structured fields, source hash, attachment metadata, and short necessary excerpts rather than complete raw email content.
- Protected attachment content must not be copied into ordinary Plan text, Trip Blueprint content, application logs, or Agent Runtime input.

## User Flows

### Booking-First Plan Generation

The traveler starts a Planning Session by pasting or entering known booking details before asking for a complete Plan.

Example inputs:

- "I land at Haneda on Oct 8 at 17:40 and leave from Narita on Oct 13 at 11:10."
- "Hotel is booked near Shinjuku from Oct 8 to Oct 12."
- "I have a rental car from Oct 10 09:00 to Oct 12 18:00."

Acceptance criteria:

- Landi extracts booking facts into structured booking records or booking-derived planning facts.
- The next Planning Proposal lists fixed booking constraints separately from assumptions.
- Generation-critical checks reuse booking facts instead of asking for the same arrival, lodging, or departure details again.
- The generated itinerary respects hard booking constraints and labels soft or pending records.
- A booking-derived conflict, such as a hotel in one city and an event in another city with insufficient travel time, blocks generation or produces an explicit proposal warning.
- Generated route anchors, reminders, and timeline milestones cite the source booking when applicable.

### Manual Booking Entry

The traveler opens a "Bookings" or "Trip details" Web view and creates a booking before or after Plan generation.

Minimum fields by type:

- Accommodation: property name or location, check-in date, check-out date, status.
- Flight or train: departure location, arrival location, local departure time, local arrival time, status.
- Rental car: pickup location/time, return location/time, status.
- Restaurant/event/tour/ticket/other: title, venue or location, start time, status.

Confirmation code is strongly recommended for execution reference but does not block Blueprint Generation because it does not shape itinerary structure.

Acceptance criteria:

- Saving a booking does not activate external actions.
- Missing important fields are allowed only when the booking is marked `needs_review` or `pending`.
- Saving a booking during Planning Session updates the structured planning facts and may revise the Planning Proposal.
- Editing a draft Plan applies directly to that draft.
- Editing an active Plan creates an impact preview when the booking changes itinerary dates, lodging base, fixed commitments, or reminders.

### Accommodation Linking

The traveler adds or confirms a hotel.

Acceptance criteria:

- Before generation, the stay becomes a lodging anchor for itinerary generation.
- The stay links to check-in/check-out itinerary days.
- The Plan accommodation status can move from `not_set` or `candidate` to `confirmed`.
- Daily accommodation-to-first-stop routes are recalculated where possible.
- Any route that cannot be verified remains visible as `needs_verification`.

### Transport Booking

The traveler records flight, train, cruise, or car rental details.

Acceptance criteria:

- Before generation, inbound and outbound transport become arrival and departure anchors.
- Departure and arrival times preserve local time zones.
- Flights support airline, flight number, airport codes, terminal, gate, and seat when known.
- Rental cars use pickup and return semantics instead of generic departure/arrival labels.
- Transport bookings can appear in the timeline and can generate departure reminders.

### Import Preview

The traveler pastes confirmation text or uploads one or more booking email files.

Acceptance criteria:

- Landi records the submitted content as Booking Evidence and shows a preview before accepting parsed fields as Booking Constraints.
- Each detected booking can be accepted as one record, ignored, or edited before save.
- A detected booking that appears to belong to another trip can be kept out of scope, included in the current trip, or deleted. Moving it to a separate Planning Session is outside the MVP.
- High-risk fields that shape generation must be prominent in the preview: dates, local times, time zones, locations, airports, stations, accommodation check-in/check-out, and rental-car pickup/return windows.
- The preview should allow editing parsed fields and changing each segment's constraint strength to hard, soft, or ignored before acceptance.
- The traveler should not need to confirm every field individually. Accepting the record accepts its visible parsed fields as Booking Constraints.
- Partially parsed records are flagged `needs_review`.
- The original attachment metadata is retained and linked to created bookings.
- AI-extracted records never save as confirmed without review.
- Accepted import records update Planning Session facts when no Plan exists yet.
- MVP import is traveler-initiated. Landi does not connect to Gmail, Outlook, or another mailbox to scan mail automatically.
- Import should perform lightweight duplicate detection. The same source hash should be reported as already imported. Different sources with matching provider, confirmation code, date, and location should be shown as possible duplicates.
- Duplicate detection must not auto-merge records, because repeated imports may represent corrections, forwarded copies, or changed bookings.
- If an import appears to update an existing booking, Landi should present explicit choices: update the existing booking, save as a new booking, or ignore the import. Updating must not silently overwrite accepted Booking Constraints, and structural changes follow the Trip Blueprint Versioning rules.

## Generation Requirements

Plan generation must receive normalized booking context in addition to ordinary planning facts.

The generation input should include:

- hard constraints from confirmed bookings;
- soft constraints from pending or needs-review bookings;
- fixed events and immovable time windows;
- accommodation anchors by date range;
- arrival and departure anchors;
- transport mode hints from car rental, rail pass, or flight segments;
- booking records excluded from generation, with reasons.

Generation input must be privacy-minimized. It may include accepted Booking Constraints, segment timing/location facts, constraint strength, and short source labels. It must not include confirmation codes, full imported email bodies, raw attachments, payment details, full passenger identity details, provider contact messages, or other protected attachment content.

Traveler names from Booking Evidence may support import grouping and traveler review, but MVP must not write them to Profile, Trip Blueprint, or Agent Runtime input.

Accepted Booking Constraints should default to hard constraints only when they represent real itinerary boundaries:

- flight, train, event, tour, ticket, or restaurant start/end times;
- accommodation check-in/check-out date ranges;
- rental-car pickup and return windows;
- arrival and departure nodes tied to fixed transport.

Rental-car bookings also create local Transport Availability during the pickup-to-return window. Blueprint Generation may prefer self-driving, parking-aware stops, and driving route checks within that window, while preserving the Plan's overall transport preference outside it.

Accepted booking details should remain contextual rather than hard constraints when they do not independently shape itinerary feasibility:

- room type, breakfast, hotel notes, loyalty details, and cancellation summary;
- airline seat, gate, terminal, baggage allowance, and fare class;
- rental-car model, insurance, price, supplier notes, and contact details;
- provider phone numbers, emails, and manage-booking links.

Imported prices may be saved as Plan-linked booking details, but MVP should not use them for budget totals, cost splitting, or recommendation ranking.

The generated Plan should include:

- timeline entries for booking commitments;
- itinerary day anchors for accommodation stays;
- route segments or handoff tasks for airport/station/hotel transfers;
- proposed reminders derived from booking times;
- visible warnings for unresolved booking fields;
- source references linking generated details back to the booking evidence.

生成的 Trip Blueprint 保存塑造行程结构的隐私最小化 Blueprint Booking Constraints，并按上方 Booking Itinerary Assessment 保存关系候选与审阅状态。真实生成输入须携带稳定 booking／segment 身份、源语义版本和覆盖宇宙；生成输出、检查点恢复、语义 structurer、Importer 及持久化须传递该结构并校验完整性。Importer 的受信 Context 仅由服务器从精确持久 Blueprint 取得已有 assessment，保留原生产者、决定、历史基准及 Core 派生证明，按新结构 reconcile；该 Context 不接客户端自述。普通模型 artifact 永远为候选并清除自述证明，只绑定当前实际 carrier 生产者；修复候选不复用被拒初稿身份。重启继续读取规范持久 Blueprint 和 Task 工件摘要映射，不依赖内存弱映射保存历史证明。Importer 重映射目标身份时同步校验关系，不得丢字段、以名称修复关系或把缺失／空集合默认 complete。生成候选缺失仍可保留可读草稿，但相关删除必须先完成关系审阅。确认码、保护附件及敏感原始确认内容不进入这些产物。

Integrity checks should reject or warn when:

- a hard booking constraint conflicts with another hard constraint;
- a hard booking constraint conflicts with traveler intent and has no recorded resolution;
- a scheduled stop overlaps a fixed booking window;
- a day uses an accommodation anchor outside its check-in/check-out range;
- a transfer to a booked flight/train/event has no feasible buffer;
- a booking-derived local time lacks enough location/time-zone context.

## Web Requirements

Booking Import should have two front-end entry points because travelers often generate a plan before every hotel, flight, or rental car is booked.

Required UI:

- Planning Session intake should provide booking import beside the normal travel-intent conversation, including paste, upload, and manual entry affordances. This entry point shapes the Planning Proposal and Blueprint Generation.
- Draft Plan and Execution Plan surfaces should provide supplemental booking import inside Trip Logistics or Bookings. This entry point adds execution details and may trigger impact preview or Blueprint Revision when accepted constraints change itinerary structure.
- The Plan surface entry point should not imply that importing a booking silently mutates the active itinerary. Structural changes follow the existing replacement-draft flow.
- Status groups: Needs review, Pending, Confirmed, Cancelled.
- Type filters: accommodation, flight, rental car, restaurant/event/tour/ticket, other.
- Cards with: type, status, title, local date/time, provider, confirmation code, linked itinerary day/place, notes, files.
- Confirmation codes should support hidden-by-default display.
- Accommodation cards should show check-in/check-out boundary information.
- Transport cards should show endpoints in order.
- Booking forms should use type-specific fields rather than one generic notes form.

Integration with existing UI:

- Planning Session should show booking-derived constraints before proposal approval.
- Planning Session should allow the traveler to import booking emails, review parsed records, resolve out-of-scope evidence, and accept Booking Constraints before Blueprint Generation.
- `TravelPlanAdditions` should evolve from accommodation-only into a compact "Trip logistics" panel that can also import bookings after a Draft Plan or Execution Plan exists.
- `ReservationView` should render first-class `TravelBooking` records instead of relying only on generic Tasks.
- Booking-related preparation tasks should link back to their source booking.
- 关系建立、审阅接受和更正复用现有工作区；三态预览、未知恢复、待确认编辑保留及精确确认交互由 [Blueprint 工作区需求的 Editing and Impact Rules](blueprint-workspace-generation-requirements.md#editing-and-impact-rules) 拥有，关系语义遵循本设计 Booking Itinerary Assessment。

## API Requirements

Suggested endpoints:

- `GET /api/planning-sessions/:sessionId/bookings`
- `POST /api/planning-sessions/:sessionId/bookings`
- `PATCH /api/planning-sessions/:sessionId/bookings/:bookingId`
- `POST /api/planning-sessions/:sessionId/bookings/import-preview`
- `POST /api/planning-sessions/:sessionId/bookings/import-confirm`
- `GET /api/plans/:planId/bookings`
- `POST /api/plans/:planId/bookings`
- `PATCH /api/plans/:planId/bookings/:bookingId`
- `DELETE /api/plans/:planId/bookings/:bookingId`
- `POST /api/plans/:planId/accommodations`
- `PATCH /api/plans/:planId/accommodations/:stayId`
- `POST /api/plans/:planId/bookings/import-preview`
- `POST /api/plans/:planId/bookings/import-confirm`

All write endpoints should require:

- `expectedSessionUpdatedAt` or equivalent compare-and-write protection for Planning Session writes.
- `expectedVersion` for draft writes or impact-preview handling for active Plans.
- Zod or equivalent schema validation.
- No silent mutation of active Plans when the booking affects execution.

生成端点应在持久输入审计中记录隐私最小化预订事实、源语义版本和关系候选来源，不泄漏原确认文本。

关系审阅／更正 API 必须通过同一 Core 审阅命令复用现有版本化修订、请求身份、回执和未知结果恢复合同；读接口返回全量审阅宇宙、当前源语义版本、已知影响及未知原因，写接口接受完整审阅决定并返回新 Blueprint／Draft Plan 身份。预订 CRUD／补充导入改变结构时与覆盖失效原子保存；Server 不另算相关性。关系确认与高影响编辑确认分别绑定本设计规定的版本与 assessment digest，不能以普通 booking PATCH 绕开。具体路由与输入输出 Schema 须在实施时共同落实，本设计不宣称端点已可用。

无会话的导入先只读取得 `/api/planning-sessions/bookings/context` 的存在性及 revision；默认确认请求必须原样绑定 `expectedSessionId`（明确 `null` 表示当时不存在）与 `expectedRevision`。事务核对存在性后才创建会话，不在提交时选择最新会话或补当前版本。路径中明确 sessionId 的确认绑定该会话 revision。回执安全身份保存这些原始基准，私密正文只以原载荷摘要参与幂等，不进入回执正文。

无 Blueprint 的旧执行 Plan 不新增来源绑定机制。新预订或现有预订结构更正明确拒绝并全部回滚；现有真实源的非结构资料可经记录 CAS 保存，但不改变批准 Plan、配置、时刻、任务或提醒。旅行者须先重新规划获得可审阅 Blueprint；MAH 不可用时保留原资料及执行安排，不声称旧 `reviseGeneratedPlan` 能更正原 owner。旧无 Blueprint 草稿仅保留合法自身来源操作，底层保存原语不得绕开上述执行门禁。已有 Blueprint 的旧无关系记录仍通过来源选择及独立关系审阅恢复。

## Storage Requirements

Add durable SQLite tables:

- `travel_bookings`
- `booking_planning_facts`
- `booking_segments`
- `booking_endpoints`
- `accommodation_stays`
- `booking_attachments`

日程关系唯一保存在不可变 Blueprint JSON 快照的 Booking Itinerary Assessment 中，不新增 `booking_plan_links` 可编辑表。若需要查询索引，必须标注来源 Blueprint 版本且只从快照生成。

本轮预订保存回执采用追加 Schema 30：新增 `booking_mutation_receipts(request_id,request_digest,result_json,created_at)`，仅存原请求安全身份投影、摘要和原结果身份，不存私密正文或第二份关系。既有 1–29 编号、历史内容和编译 lineage 不重写。初始化与该编号标记处于同一事务，失败不留下新表；开发验收仅升级独立合成 SQLite。受控打开的唯一校验 owner `packages/storage/src/guarded-schema.ts` 在既有完整指纹绑定之外，核对回执表精确列、约束、表属性、PK 自动索引及完整迁移集合；DDL 复用迁移的唯一声明。显式历史只读准入保持原版本语义。此增量不改变启动包或发布协议，也不代表已执行任何生产迁移。

Indexes:

- `travel_bookings(planning_session_id, status)`
- `travel_bookings(plan_id, status)`
- `travel_bookings(plan_id, type)`
- `travel_bookings(plan_id, start_at_local)`
- `booking_planning_facts(planning_session_id, generation_role)`
- `booking_segments(booking_id, start_at_local)`
- `booking_endpoints(booking_id, role)`
- `accommodation_stays(plan_id, check_in_day_id, check_out_day_id)`

Promotion behavior:

- Planning Session 的原始预订在草稿保存时由 Blueprint 的经校验源映射引用，原 owner、ID 与附件不变。
- 生成 Plan 通过既有 Compilation Lineage 引用源 Blueprint 版本；预订关系及审阅只有该不可变 Blueprint 快照一个事实源，Plan 投影不能独立编辑。
- 生成 Trip Blueprint 保存隐私最小化 Booking Constraints 及本设计规定的关系、覆盖与审阅；读取旧快照不补造 complete。
- Plan-linked bookings store execution details that do not belong in the Trip Blueprint, such as confirmation codes, protected attachment metadata, supplier links, notes, and user-visible logistics.
- The Planning Session retains import history, source hash, and accepted constraint snapshots after promotion.
- Protected attachment content should be associated by source or attachment id rather than copied into multiple records.
- The original booking records remain editable through normal draft or active Plan rules.
- Booking Import before generation does not create a Plan or Draft Plan.

Migration should preserve existing `Plan.configuration.accommodation` data by creating an accommodation stay only when enough property/date data exists. Otherwise, keep existing configuration and do not fabricate dates.

### 当前预订源与已批准快照

`TravelBooking` 原始 owner 不可变，修改请求的目标 Plan 是独立字段，不能通过搬移 owner、复制改 ID 或复制私密内容来连接新草稿。当前源读取 `listCurrentTravelBookingSourcesForPlan` 服务于关系审阅、导入和变更监测；已批准快照读取 `get/listApprovedBookingConstraintsForPlan` 仅通过精确 Compilation Lineage 提供执行安排与提醒内容。快照不能伪装成缺少私密字段、sourceHash 等事实的 TravelBooking。监测可读取当前源，但集合仅限旧执行 Plan 已明确绑定的来源，只提示变化，不改写批准安排。

源映射保存经校验的 `sourceBookingId`／`sourceSegmentId`。旧数据保留直接 plan_id 真记录和历史 Blueprint；无可靠映射不猜 session 或 ID 前缀，不自动合并分歧 session／clone。恢复总是分两步，复用同一 direct batch、请求身份和回执：先通过独立 `select_booking_sources` 命令显式选择合法真实记录，绑定 `sourceBookingIds`、`expectedSourceSetDigest` 及需要恢复的 `legacyBindings`；服务端可信解析及重投影新版 Blueprint 后，再取得新上下文，以独立 `review_booking_relationships` 命令接受完整关系。来源选择不是关系审阅，不与关系或原删除批次混提，也不自动重绑原待确认草稿。原 owner、旧执行 Plan 与历史版本不变。生成 promotion 移除复制 booking 并改 ID 的旧生产路径，保留原源。

每个 `legacyBindings` 条目由旅行者明确声明 `bookingConstraintId`、`sourceBookingId`、逐旧 `segmentId` 对应真实 `sourceSegmentId` 的 `segments`、理由与非空安全 `evidenceRefs`；不能预选最佳匹配。缺可靠映射的旧 hard 或任一 hard/fixed 分段约束必须完整声明，既有可靠映射不可改写。受保护 booking 按整个聚合及全部分段逐对应保全：type、status、title、强度、完整分段成员，以及每段类型、状态、title、全部起止时刻/时区/地点、固定性和复核理由相同；只剥离来源展示元数据与正在恢复的身份字段。不能靠数量、文本、匿名集合或交叉分段配对判定同物；两个旧约束或分段不得复用同一真实源身份。真实持久旧投影缺 segment.status 时，仅用其旧 booking.status 作本次保护比较基准；选中真实状态必须与该基准相同，不回写旧历史，也不泛化其他缺字段为已知值。固定结构差异返回 typed `assisted_replanning_required`/409，格式或非法来源为 `invalid_edit`/400，并发为 `version_conflict`/409，全部事务不写。

绑定、理由与证据原样进入规范请求摘要及 fingerprint；Core 修订元数据 `sourceSelectionAudit` 另保存由可信 Storage/API 绑定的本地旅行者责任、服务端时间与使用的有界旧状态规则，不接受客户端 Agent 身份。只读候选展示完整安全 booking 层强度及全部分段结构，不带保护附件或私密原文；客户端不能提交任意 resolvedConstraints。已明确采用的真实源不能因漏选而移除，取消和 ignored 也保留来源单元；原无映射约束不能用空选择抹成零预订。来源更正改变结构时保留原草稿并要求重新审阅。当前直接 owner 的未采用资料及经精确原提交结果验证的正规父 Plan 义务仍为 unknown；候选池中的兄弟/后继来源不自动变成本 Plan 义务。选择一部分后剩余义务经不可变修订/导入回执的确切祖先链继续保留，不按时间、名称或“最新”猜祖先，不另建成员表。软无关资料可明确纳入后逐项审阅为 complete+[]，不以漏选或无审计排除证明无预订。

正规 direct／import／Undo 的不可变创建回执证明结果 Plan 与原 expected Plan 的父边；当前 lineage 可因同 Plan 的路线刷新或执行修复推进，只证明当前投影，不能要求等于创建时版本。创建结果须符合原编译器规范身份与创建基线，before／after 快照、审计行和原结果须交叉一致、同 Blueprint／session／proposal 范围，结果版本不超过当前投影。父 expected 版本须为正安全整数、不超过父持久版本；父投影仍指向 before 时还须不低于该 lineage 的 Plan 版本。父投影已推进时，旧正规已提交回执作为当时 CAS 见证，不用当前投影反推历史版本；禁止自环、多父及跨范围继承。

新 direct／import／Undo 回执在原 result_json 顶层记录服务端事务内捕获的 beforeIdentity（planId、planVersion、blueprintId、blueprintVersion，四字段齐备），与原请求及不可变 before 快照核对。Undo 保留原工作区结果结构，附加身份仅属于持久回执；客户端不能提交该身份。非 Blueprint 自身资料更新不伪造创建父边。整个字段缺失的旧记录按历史已提交 CAS 与版本边界兼容；字段存在但损坏不得回退。旧合法区间内单字段 expectedVersion 改写可能无独立证据可判，不宣称逐版本防篡改。真正损坏祖先保留范围未知，来源选择不能修复审计；须保留旧草稿并经正规辅助重新生成入口建立新明确基准，服务不可用时如实提示。

历史祖先验证信任正规事务已提交且应用不会删除的创建回执；检查仍存在记录的身份不一致、越界和必需引用缺损。整条回执被数据库外操作删除时，现有证据可能无法独立区别合法无父根节点，不能以 Blueprint 版本、名称或 ID 前缀补造根证明，也不宣称能够检出所有历史删除。原子事务故障必须保留无部分提交的证据。

## Reminder and Monitoring Requirements

Accepted Booking Constraints may compile into Dormant Reminders, inert until Plan activation. Booking Import alone must not schedule active reminders.

- Review all bookings before departure.
- Hotel check-in.
- Hotel check-out.
- Flight departure buffer.
- Airport transfer reminder.
- Car pickup.
- Car return.
- Event or tour arrival reminder.

MVP reminder buffers should use conservative defaults and remain editable in the Draft Plan review:

- Flight: a 24-hour check plus an airport-departure reminder derived from route/buffer assumptions.
- Train or long-distance transport: 2 hours before departure unless local context suggests another buffer.
- Hotel check-in: morning of check-in day.
- Hotel check-out: evening before checkout.
- Rental-car pickup and return: evening-before review plus same-day advance reminder.
- Event, ticket, tour, or restaurant: arrival reminder based on accepted start time and route context.

Reminder copy must include uncertainty when fields are missing:

- "No terminal recorded."
- "Confirmation code saved, but check-in time needs review."
- "Route to airport needs verification."

Later monitoring may add:

- Flight status checks.
- Venue booking requirement changes.
- Hotel check-in policy changes.
- Rental office opening-hours checks.

## Change and Versioning Requirements

Booking changes should be routed by whether they change travel structure.

Changes that require a new Trip Blueprint Version:

- flight, train, or other fixed transport date/time changes;
- arrival or departure node changes;
- accommodation date range, property, or location changes;
- rental-car pickup/return window or location changes;
- fixed event, ticket, tour, or restaurant time/location changes;
- downgrading or re-enabling a hard Booking Constraint when it affects itinerary feasibility.

Changes that may update only Plan-linked booking data:

- confirmation code corrections;
- seat, room type, fare class, baggage, breakfast, or add-on notes;
- price, cancellation summary, provider contact details, and manage-booking links;
- protected attachment replacement that does not change accepted Booking Constraints.

执行中 Plan 的结构性预订变更沿既有影响预览与替换草稿流程，并按 Booking Itinerary Assessment 使相关覆盖失效；非结构执行资料可只更新 Plan-linked Booking。关系审阅、更正、删除及撤销的源版本重校、原子保存和历史语义统一由该节规定；不得在另一持久路径保留旧 complete 或恢复过期判断。

## Import and Extraction Requirements

MVP should support traveler-initiated booking email import from pasted confirmation text or uploaded `.eml`, `.html`, and `.txt` content.

MVP extraction may be narrow and template-based:

- preserve the original imported content as protected attachment metadata and source hash;
- read `.eml`, `.html`, and `.txt` through a local deterministic extraction pipeline that converts supported input into normalized text before field extraction;
- extract obvious fields such as provider name, confirmation code, local times, property names, airports, and pickup/return windows when possible;
- treat extracted fields as Proposed Booking Constraints until accepted;
- create `needs_review` records when important fields are missing;
- require preview confirmation before writing Booking Evidence or Booking Constraints.
- when parsing fails, keep the imported content as Booking Evidence, do not create Booking Constraints, and show a minimal manual form for the traveler to enter core fields.

Parsing failure must not cause the imported evidence to be discarded, and must not cause the full imported email or attachment to be sent to Blueprint Generation for the Agent to interpret directly.

MVP parser coverage should focus on:

- hotel or accommodation confirmations;
- flight confirmations;
- train or long-distance transport confirmations;
- rental-car confirmations.

MVP parser coverage targets English booking confirmations. Non-English confirmations may still be imported as Booking Evidence, but they can fall back to manual field entry without parser-specific support.

English extraction should start with general heuristics plus a small pluggable provider-template extension point. The MVP should not attempt a large provider-specific template library. Generic extraction should identify common fields such as confirmation numbers, date/time ranges, hotel names, airport-like locations, train endpoints, rental pickup/return windows, and provider labels.

Event, ticket, tour, restaurant, and other confirmations may be imported as semi-structured records, but first-phase extraction does not need provider-specific coverage for them.

MVP does not perform live flight-status or schedule-change checks. Flight numbers support parsing and display, but itinerary constraints come from traveler-accepted local departure and arrival times. Live status belongs to later monitoring connectors.

When extraction is added:

- Use a deterministic parser first when available.
- Use AI only as a later optional fallback for files or fields the deterministic parser cannot read, and only after explicit traveler action.
- Never send booking files to a remote model unless the user explicitly enables that connector and understands the data boundary.
- Store extraction provenance and confidence.
- Require preview confirmation for every created booking.

## Security and Privacy Requirements

- Confirmation codes, attached files, and passenger names are sensitive.
- Confirmation codes should be hidden by default in Web cards.
- File uploads need size and MIME limits.
- Attachment download endpoints must verify Plan ownership/access.
- Logs must not include confirmation codes or extracted raw document text.
- Full imported email content must not be stored as ordinary business text. If retained, it must be a protected attachment separated from Plan, Trip Blueprint, logs, and Agent input.
- Generation input may include accepted Booking Constraints and short source labels, but not confirmation codes, full email bodies, or raw attachments.
- Traveler names from imported confirmations are used only for grouping and review in MVP, not for Profile enrichment or generation.
- Backups should include booking records and attachments if the backup feature covers trip data.

## Non-Goals

- Booking hotels, flights, cars, restaurants, tickets, or tours directly.
- Paying, cancelling, checking in, or changing reservations automatically.
- Using imported booking prices for budget totals, cost splitting, or recommendation ranking in MVP.
- Claiming an external booking task is complete just because a link was opened.
- Treating AI extraction as authoritative.
- Storing passports, payment cards, or full identity documents in MVP.

## Suggested Delivery Plan

### Phase 1: Booking Intake for Generation

- Add domain types, storage tables, Planning Session API CRUD, and Web intake forms.
- Add traveler-initiated booking email import with preview for pasted text, `.eml`, `.html`, and `.txt`.
- Support accommodation, flight, rental car, event/ticket, and other.
- Derive planning facts from bookings and include them in proposal/generation context.
- Validate hard constraints before generation.

### Phase 2: Generated Plan Integration

- Promote Planning Session bookings into Plan-linked bookings when a draft Plan is persisted.
- Link bookings to itinerary days, Places, route handoffs, Plan configuration, and generated reminders.
- Link accommodation to Plan configuration and daily departure route recalculation.
- Add impact preview behavior for active Plan edits.
- Render bookings in timeline and preparation sections.

### Phase 3: Import Preview

- Extend import preview to richer document formats such as PDF and pass files.
- Improve deterministic extraction coverage across common providers.

### Phase 4: Smart Assistance

- Add AI extraction fallback.
- Add optional mailbox connectors only after explicit authorization, duplicate handling, and retention rules are defined.
- Add optional flight-status or calendar connectors.
- Use the existing email execution design for approved booking-aware assistance.

## Decisions and Follow-up

Planning Session bookings use the normalized records in Storage Requirements. The Change and Versioning Requirements define when an edit requires a replacement draft and when execution details can be updated in place. The existing booking entry remains the workspace entry for relationship review.

Attachment encryption policy and provider selection for place resolution require their own decisions if that scope advances. The current design retains the protected attachment and source verification requirements above.
