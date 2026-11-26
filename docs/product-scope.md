# Landi: personal travel assistant

This is the current owner-approved product scope. It supersedes older regional-assistant, Country Pack, Telegram and WhatsApp product descriptions. Historical evidence and stored records remain unchanged.

Landi 服务个人旅行：理解需求、研究目的地、生成可审阅行程并通过邮件协助。Web 承担桌面规划管理与出发前审阅；出发前替代方案须明确确认具体方案及当前 Plan、Blueprint、执行版本。行中可靠客观突发变化经影响和完整替代校验后由 Landi 应用，无需再次确认。Email 是唯一主动旅行渠道，可在手机阅读；不要求手机工作台或远程审阅。阶段、事实或版本不足时保留现行执行和未决事实。MAH 生成与运行接入仍待验收。

## Retired product concepts

- Country Packs, regional assistants and independently installable country feature bundles are outside the product. Destination-specific sources and travel facts remain useful internal data; users do not select or install country bundles. General banking, legal, business, study and immigration-assistant ambitions are removed. Travel preparation may still flag relevant document or entry checks without deciding eligibility.
- Telegram and WhatsApp are retired, not optional channels. Remove configuration forms, pairing/verification/webhook routes and background polling/sending from the active application. Existing credentials, bindings, history and database schema must not be deleted or migrated as part of retirement. Email verification, timing, version checks and ambiguous-delivery protection remain mandatory; no email opt-in is inferred from an old chat binding.

## Existing implementation boundaries

行中变化的当前能力、来源日期/新鲜度、未知与恢复、精确版本审阅确认及旧执行计划连续性，由 [email-execution.md 的当前设计](email-execution.md#行中变化事实版本与审阅t3-1-当前设计) 统一拥有。已有场馆、当前天气、保存预订监控、持久观察去重、出发前草稿确认及旧执行连续性继续复用；尚存证据与行为缺口不等于能力未初始化。T3-1 design 的现状/差距属于该设计阶段记录；后续 implementation 已有阶段、原子应用和持久交接源码，当前可信邮件消费缺口以 email-execution.md 为准。实施验收不代表独立 verification、运行门禁或整行交付。T3-2 保留邮件队列、四模板及发送责任；T5-2 保留 MAH 调度、监督及行中应用与提醒邮件的联合运行门禁。本范围不恢复聊天、签名确认页或国家包，不把计划时刻、投递或地图交接当作实际到达、登机、完成或收信。

目的地研究复用 `packages/travel-support` 的天气、交通、住宿与附近餐饮函数；普通官方来源注册表保留既有 ID，目前已审阅的注册表覆盖中国和日本。地图地点解析与官方来源覆盖是两件事：国家缺失、不支持或歧义时需要确认，不影响其他可用旅行事实，也不能用地点名称猜国家。参考目录、两个读取器及其测试已退役，原始内容保存在 `scripts/historical/travel-catalogs` 的摘要索引历史档案中，不属于现役包数据或能力。原国家包、manifest、Skill 注册表、国家专属 Plan 编译入口及聊天处理器已移出应用依赖图；Web/邮件复用共享 Plan 修订与持久执行状态读取器。

研究只产出有来源、地点身份、日期和旅行者条件的候选。Landi Core 拥有领域校验、Research Set/Blueprint/Plan 版本与确认；Server 组合既有目的地解析、注册表、显式刷新及 Importer；Connector 获取外部事实，Storage 保存不可变快照和编译溯源。UGC 只能启发选项，来源存在、官方标记、哈希变化或准备材料齐全均不证明政策资格。日期改变、条件缺失、过期、冲突和未知必须保留复核义务；没有证据不得升级为事实结论。

当前能力、源码依据、真实缺口及后续隔离场景统一见 [Connector 合同的 T4-1 design](connector-contract.md#目的地研究能力与差距t4-1-design)。该设计核对确认已有注册表、刷新、快照及候选导入路径，不宣称真实 provider 或 MAH 生成已验收。设计成果在自身交付前以静态一致性验收；implementation、运行门禁、verification 与整行交付分别保留，不以缺失历史 Task 为由重做现有能力。研究或候选导入不会授权发送邮件、预订、叫车、交易、付款或其他外部动作，生成与执行仍须分别遵守当前版本确认及失败关闭边界。

Existing SQLite tables, historical run triggers, compilation provenance and numbered migrations are compatibility records. They remain readable without enabling the retired channels. Removing code must not delete, rename or rewrite these records. There is no production database migration or service restart in this cleanup.

The active server must not read old Telegram/WhatsApp credentials, poll those services, register their public callbacks/pairing routes, or fall back to chat delivery for a plan without email authorization. Such a plan remains inert for proactive delivery until email is explicitly configured and verified. No service is restarted and no live traveler action is authorized by this source change.

## Verification and handoff

Local call-migration boundaries and additive compatibility requirements are defined in [agent-call-migration.md](agent-call-migration.md). They do not authorize a MAH Task, a live database migration or a replacement hosting path.

Preserve the failed MAH Project Care task, its original Git-start and nineteen adopted source outcomes. Do not create a replacement MAH Task, alter its delivery declaration, or claim that its delivery failure is repaired. Keep the user's in-progress email changes and ignored production data. Do not rerun historical suites as proof of this change; static checks and new retirement-specific verification must identify their own scope and limits. The MAH formal delivery and any future archive remain pending.
