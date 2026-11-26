# Landi Product Baseline

## Purpose

Landi is a personal, long-running travel assistant. It helps a traveler turn an incomplete travel goal into a reliable Plan, then continues assisting after that Plan is activated.

This document defines the current product behavior and scope. 产品范围由 product-scope.md 拥有；旅行阶段调整、来源及原子版本交接由 email-execution.md 拥有，本文件引用其合同。

Current scope is defined in [product-scope.md](product-scope.md). Country Pack products, Telegram and WhatsApp are retired; destination research remains part of the traveler’s trip.

## Product promise

Landi has two responsibilities:

1. build a complete, reviewable travel Plan from the traveler’s information; and
2. assist the traveler as that Plan progresses and real-world conditions change.

The product should feel like one continuous assistant. Internal Skills, Agent Runtime runs, Connectors, and scheduling work are implementation details, not separate personas or products.

## Primary traveler experience

```text
Describe the trip
  -> Refine the planning context
  -> Review a planning proposal
  -> Generate a complete Plan
  -> Review and activate the Plan
  -> Receive relevant assistance
  -> 按旅行阶段确认或应用经校验的调整
  -> Complete and archive the trip
```

## Plan creation

Plan creation begins with a conversational Planning Session on Web.

The first message may be incomplete. Landi stores the facts provided, identifies what materially affects the trip, and asks focused follow-up questions. It does not create a complete Plan from every message.

Before detailed generation, Landi presents a versioned planning proposal containing:

- the objective;
- destination sequence and broad pacing;
- major trip segments;
- important tradeoffs;
- assumptions;
- unresolved decisions that could reshape the trip.

The traveler can revise or approve the proposal. Only the latest proposal version can be approved.

## Generation-critical facts

Before Landi generates a complete Plan, it confirms:

- destination and city sequence;
- exact travel dates, including the year;
- arrival origin, node, and expected time;
- departure node and expected time;
- party size;
- transportation preference.

Lodging does not block Plan generation. When lodging is unknown, Landi uses an explicitly provisional area or routing anchor and never represents it as a booked property.

## Plan integrity

A generated result may become a formal draft Plan only when:

- dates, destinations, cities, and itinerary days are structurally consistent;
- scheduled Places exist and use normalized coordinates when required;
- candidates are not also represented as scheduled stops;
- fixed commitments do not conflict;
- traveler constraints and transportation preferences are preserved;
- every itinerary day has an explainable structure;
- external facts retain their verification state and source evidence.

Provider failure must not be replaced with invented routes, opening hours, reservation conclusions, weather, or policy facts. A Plan may remain usable with explicit limitations and items that require another check.

## Plan workspace

Web is the primary Plan creation and management surface.

It supports:

- conversational intake and proposal approval;
- complete Plan review and activation;
- itinerary, map, day, Place, candidate, route, preparation, and source exploration;
- 工作区内经确认的添加、删除和同日重排；优先级的 Core/API 能力与工作区入口边界见下文 Plan changes；
- conversational Plan revision;
- 版本冲突保护、未保存编辑撤销及替换计划撤销；具体范围见下文 Plan changes；
- review of material impact and replacement drafts;
- Plan history and settings.

The Plan remains authoritative structured data. Generated HTML, browser-local state, map markers, and conversation text do not replace persisted Plan data.

## Mobile assistance

Email is the only approved proactive execution channel after a Plan is activated. The detailed transition contract is [email-execution.md](email-execution.md); implementation and live readiness must be verified separately.

It supports:

- time-sensitive Reminders;
- daily illustrated handbooks, transfers, dining suggestions and material-change notices;
- planned-time assistance without routine arrival or completion check-ins;
- weather and nearby discovery;
- route and external-action handoffs;
- 出发前桌面精确版本确认；行中可靠客观变化由 Landi 校验应用并邮件说明，详见 email-execution.md。

Normal background checks remain quiet. Landi sends a proactive message only when the traveler needs to act or a meaningful exception affects the Plan.

## Plan lifecycle

Only one Plan executes at a time.

A traveler may create or review a replacement draft while the previous active Plan continues running. 执行切换须符合 email-execution.md 的阶段、来源、完整替代及原子版本合同；阶段未知、未确认出发前方案或失败均保留旧执行。

Activating a replacement Plan must cancel or rebuild affected future Reminders and monitoring work. Sent notifications and earlier Plan versions remain auditable.

The Roadmap extends the current lifecycle with explicit pause, completion, and archive behavior.

## Plan changes

直接低影响编辑通过版本化 Blueprint Revision 保存，再编译为 Draft Plan。四类直接操作的支持范围、当前工作区入口及三类撤销的区别，统一以 [Blueprint 工作区需求的 Current Trip Blueprint Contract V2 slice](blueprint-workspace-generation-requirements.md#data-requirements) 为准；保存后直接编辑撤销仍是目标，不能从本地草稿撤销或替换计划撤销推断其已经可用。本条明确收敛原有笼统的“保存并撤销”能力描述，不改变 Blueprint 权威及执行激活边界。

Changes that affect dates, destination sequence, lodging base, fixed commitments, party constraints, or automation scope require an impact preview before replanning.

A replacement draft must preserve:

- unaffected itinerary content;
- completed Tasks;
- traveler decisions that still apply;
- an audit link to the Plan version it replaces.

Changed routes and external facts must be marked stale or unverified until refreshed.

## Long-running assistance

After Plan activation, Core owns Reminders, current-destination state, travel events, and monitoring.

The current product includes initial weather, venue, arrival, departure, and Task Reminder capabilities. The next development stage unifies them into persistent Monitoring Jobs and a Travel Attention flow.

Monitoring must follow these principles:

- bind work to a specific Plan version;
- survive a service restart;
- stop obsolete work when the Plan changes;
- remain quiet when no material change exists;
- preserve source and observation time;
- 按 email-execution.md 的分阶段应用门禁处理重大变化；监测本身不授权切换。

## External actions

Landi may prepare information and open an external application, but the traveler completes irreversible actions there.

Landi does not automatically:

- book transportation or lodging;
- place an order;
- make a payment;
- call or confirm a ride;
- claim that an external action succeeded because a link was opened.

User-owned and external Tasks advance only after explicit confirmation or reliable evidence.

## Profile and trip-scoped data

Profile stores stable information and preferences that the traveler explicitly confirms for reuse.

Plan stores trip-specific information, including:

- dates;
- arrival and departure details;
- lodging;
- party composition;
- luggage;
- temporary transportation preferences;
- itinerary decisions and completion state.

Landi does not store passport or visa images or full document numbers. Exact location is used only after explicit sharing, scoped to the current action, and excluded from long-term Profile data.

## Current destination and time

Landi derives the current destination from itinerary dates and travel nodes, then corrects it from explicit traveler input such as an arrival confirmation.

Pre-trip assistance follows the traveler’s current time zone when known. During travel, messages and scheduled work follow the relevant destination time zone. Time-bearing messages display the applicable zone.

## Product scope

The current product focuses on one traveler-owned instance and one active travel Plan.

In scope:

- conversational travel planning;
- structured and interactive Plans;
- source-backed preparation;
- versioned revision;
- reminders and long-running monitoring;
- user-approved partial replanning;
- Web planning and email execution;
- external handoff for irreversible actions.

Outside the current scope:

- Country Pack products or a regional-assistant platform;
- Telegram or WhatsApp channels;
- general legal, banking, business, study or immigration assistance outside a trip;
- a generic project-management interface;
- visible internal Agent orchestration;
- automatic booking, payment, ordering, or ride confirmation;
- document-image storage;
- multiple active Plans executing at the same time.

## Product completion path

The long-term travel assistant reaches its intended first complete form when this path works end to end:

```text
Web travel intake
  -> Proposal approval
  -> Complete validated Plan
  -> Plan activation
  -> Persistent travel monitoring
  -> Material change detection
  -> Impact preview and alternatives
  -> User-approved partial replanning
  -> Synchronized Web and email update
  -> Continued trip execution
  -> Plan completion and archive
```
