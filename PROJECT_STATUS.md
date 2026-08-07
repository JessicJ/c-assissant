# C-assistant 项目交接状态

更新时间：2026-08-07

## 项目位置与 Git 状态

- 项目目录：`/Users/mable/Documents/C-assissant`
- Git 分支：`master`
- 远端仓库：`https://github.com/JessicJ/c-assissant.git`
- 本文件创建前的基线提交：`a775962 chore: establish C-assistant architecture baseline`
- 产品名称仍为临时代号 `C-assistant`；远端仓库名称使用 `c-assissant`

## 已完成内容

### 产品方向

- 确定项目定位为可扩展的“地区助手”生态，而不只是旅行助手。
- 首个完整扩展单元是 China Country Pack，服务对象是需要适应中国生活的外国人。
- V1 聚焦来华准备以及吃、住、行，未来可扩展法律、银行、经商、教育等能力。
- 确定一人一实例，用户使用自己的 Codex 或 Claude Code 账号。
- 确定 Telegram 为 V1 移动端入口，Web 工作台为完整桌面端入口。
- 确定少问、边用边补，先生成完整 Plan，再由用户一次确认并激活计划。

### 架构与契约

- 完成总体架构设计：Core、Country Pack、Skill、Connector、Agent Runtime Adapter 和 Tool Gateway。
- 完成 Core 数据模型设计：Profile、Plan、Stage、Task、Reminder、Event、Run、Confirmation、SourceSnapshot。
- 完成 Skill Contract，包括输入最小化、结构化输出、来源、风险、失败与测试规则。
- 完成 Connector Contract，包括 Amap、Telegram、官方来源和外部应用交接边界。
- 完成 Codex / Claude Code Runtime Adapter 设计。
- 完成 Web 工作台的信息架构、登录配对和 Telegram 协作规则。
- 完成 China Country Pack V1 的内部 Skills 划分和组合顺序。
- 已记录已确认决策和待确认事项。

### 仓库骨架

- 建立 TypeScript / Node.js monorepo 基础配置与本地启动、构建、类型检查和测试命令。
- 建立 `apps/server`、`apps/telegram-bot`、`apps/web` 目录。
- 建立 `packages/core`、`packages/skill-runtime`、`packages/agent-adapters`、`packages/connectors`、`packages/storage` 目录。
- 建立 `country-packs/china` 及内部 Skills 目录约定。
- 提供中英文 README、环境变量示例和 Git 忽略规则。
- 实现本地 SQLite 保存：Profile、当前 Plan、Stage、Task 和 Inbox 在重启后保留。
- 实现 Web 中创建本地 Plan、确认 Plan 和保存 Profile 基础字段的流程。
- 实现高德 Connector：关键词地点搜索与驾车路线的距离、时长、出租车费用事实。
- 完成一次本地高德真实验证：上海站地点搜索和上海市内驾车路线均成功返回结果。
- 实现 Codex Runtime Adapter：检查 CLI 与登录状态，在隔离临时目录中运行 `codex exec`，使用 JSON Schema 约束 Plan 草案；仅传入已确认的语言、国籍、性别和来华签证/居留状态作为计划上下文，并剥离高德/Telegram 等 Connector 密钥。身份字段不得被当作政策资格结论。
- 实现 Claude Code Runtime Adapter：用 `claude auth status` 进行无破坏登录检查；每次草案生成都在隔离临时目录中以 Print JSON 模式运行，禁用内建工具和 MCP，再按与 Codex 相同的 Plan 契约验证结果。它也会剥离 Connector 和运行时密钥，且不会读取或保存 Claude Code 登录凭据。
- 为 Claude Code Adapter 增加模拟 CLI 集成测试：覆盖安装/登录检查、无工具 Print JSON 命令、临时目录清理、输出契约验证和 Connector 密钥剥离；测试不会实际调用 Claude 账号。
- 实现实例级运行底座选择：Web Settings 可检查并选择 Codex 或 Claude Code，选择只保存类型，不保存登录凭据；Web 与 Telegram 的后续 Plan 草案都使用该选择，故障时不会静默切换。生成后的完整草案会写入 SQLite，仍需用户确认才会激活。
- 实现最小 Plan 生成 Run 审计：Web 或 Telegram 每次请求已选运行底座时，都会保存运行底座、入口、开始/完成时间、成功/失败/模板降级状态及成功后的 Plan ID；不保存用户请求、模型原文、错误原文、账号状态或任何凭据。Settings 提供用户可读的近期记录。
- 实现 Task 级结构化 Reminder 提案：Codex/Claude Code 只有在具备具体日期、当地时间和 IANA 时区时才可输出提醒；Core 与 SQLite 保存提醒时间、时区和目的，Web 完整 Plan 与 Telegram 预览都会展示。草案阶段不会发送，最终通知正文也不会被提前冻结。
- 实现确认后 Task Reminder 的最小 Telegram 调度：仅激活 Plan、已配对账号、未结束且非 arrival 专用的 Task 可触发；到期或服务重启后 30 分钟补发窗口内执行。暂时性故障按 1 分钟、5 分钟退避，最多尝试 3 次；成功或最终失败都会同步 Web Inbox。发送文案读取当前 Task 和提醒目的，不执行任何外部行动。
- 实现 Task Reminder 显式取消和旧计划失效保护：用户可在 Web 完整 Plan 的 Task 旁直接取消，Core 移除提醒并递增 Plan 版本、写入 Inbox。每次投递前都会重新核对当前激活 Plan 与提醒的时间、时区和目的；旧 Plan、已取消或已变化的提醒不能开始新的发送尝试。
- 实现 Task Reminder 到期天气刷新：投递尝试确认后，以当前 Plan 地点调用高德地理编码和 QWeather；仅把与提醒当地日期精确匹配的三天预报作为预报展示，并附抓取时间、来源链接和保守的雨具、保暖、防暑、防晒建议。高德或天气不可用时仍发送原提醒，不猜测天气；这次天气上下文不写入 Profile 或 Plan。
- 实现 Reminder 动态事实显式策略：Agent 必须为新提醒声明 `refreshFacts`，仅在天气会实质影响眼前任务时选择天气，其余提醒不调用天气服务；旧 Plan 缺少该字段时兼容为不刷新。Web 与 Telegram 完整计划会显示该策略，策略变化也会使旧的待发送尝试失效。
- 实现 Task Reminder 到期 Run 审计：同一 Plan/Task/Reminder 的最多三次投递共用一条本地 Run，记录到期与起止时间、尝试次数、天气是否可用及安全失败分类、Telegram 安全失败分类和最终状态。取消提醒或替换当前 Plan 会终止未完成 Run；已在途且最终成功的消息仍记录实际成功。不保存提醒正文、天气原始响应、坐标、账号身份或凭据，并提供只读本地接口 `/api/runs/task-reminders`。
- 完成一次真实 Codex 端到端验证：结构化草案已通过 Schema、保存为 4 个 Stage 和 16 个 Task；测试数据库随后已删除。
- 实现 Telegram Connector 的本地配置状态与显式 Bot 身份验证；Token 仅停留在本地 Server 进程，不会传给 Web 或 Agent。
- 实现 Telegram 显式解绑：用户可在 Web Settings 确认断开当前私聊绑定；解绑只移除绑定身份并保留 Plan、Profile、本地 Bot Token 与更新游标，之后可重新配对。
- 实现 Telegram 完整 Plan 确认：新草案和 `/plan` 会完整分页发送，确认按钮只出现在最后一页，并绑定当前 Plan ID 与版本；旧按钮无法激活已替换或已修改的草案。确认只激活已声明的提醒范围，不执行预订、支付、叫车等外部动作。
- 实现 Telegram 一句话修订草案：用户创建的 Plan 仍为 draft 时，普通文本会连同经过最小化的完整草案交给所选运行底座进行修订，`/new` 始终新建。修订结果是需要重新确认的完整替代草案，保留人数、行李等 Plan 临时配置但不自动沿用官方证据；运行失败保留原草案，运行期间状态变化会拒绝旧结果覆盖。
- 实现 Telegram Profile 基础资料编辑：`/profile` 展示长期配置，姓名、语言和国籍使用显式选择后的 15 分钟下一条文本输入，性别及来华签证/居留状态使用白名单按钮；命令和定位不会被误写入。编辑状态只保存字段名与开始时间，解绑时清除；国籍或来华身份缺失时继续标为 incomplete，不构成政策结论。
- 实现 Telegram 按需天气查询：`/weather` 只在用户发送命令时按当前 Plan 地点调用高德地理编码和 QWeather，返回实况、带明确日期的三天预报、保守携带建议、抓取时间和官方来源。地点未确认或 Provider 失败时不猜测；结果不写入 Profile/Plan，也不创建提醒。
- 实现 Telegram 附近餐饮闭环：`/food` 读取或补充当前 Plan 人数，再由 Telegram 明确请求一次定位；定位用途绑定当前 Plan，15 分钟过期并在一次使用前消费，未请求、过期或旧 Plan 的坐标不会调用高德，任何坐标均不落库。高德返回附近餐饮名称、分类、地址和距离事实，Telegram 保留 Provider 顺序并提供 HTTPS 高德地点跳转；不做 AI 排名、桌位判断、下单、订座或支付。
- 实现 Web 工作台 Today 顶部常驻的 `Ask Agent` 主入口：用户无需先寻找或打开弹窗，可直接选择创建新 Plan 或修订当前草案，由 Settings 中选定的本机 Codex/Claude Code 返回完整结构化草案；成功后自动进入完整 Plan 审查。输入与模式严格校验，结果保持待确认；Runtime 执行期间若 Plan ID 或版本发生变化，旧结果会被拒绝，保留用户较新的修改。该入口不是无限制通用聊天，也不执行 Connector 或外部行动。
- 落地首个可执行的 China Pack 内部 Skill：`food-nearby` `0.1.0`。它以独立 manifest、instruction、TypeScript 入口和测试存在，只通过完整 China Pack 包供 Core/Server 调用；输入为 Plan 人数及高德已归一化事实，输出有版本的结构化 SkillResult、最多五个事实和外部交接提案。Telegram 只负责渲染和链接；Skill 不做虚假排名、桌位判断或完成推断。
- 落地 `housing-area-recommendation` `0.1.0`：用户从 Plan 选择场馆、学校、工作地等中心点后，Server 将高德住宿 POI 事实交给 China Pack Skill；Web 展示最多三个基于高德附近距离的初步交通便利理由，并保留候选、地图查看和用户自行预订边界。当前不会把 POI 距离说成真实通勤，也不会猜测价格、库存、品质、预订状态或外国人接待资格；多中心路线和偏好驱动的完整区域选择仍待实现。
- 落地 `transport-planner` `0.1.0`：Web 路线比较和 Telegram 到达路线均通过完整 China Pack 调用该内部 Skill。它尊重本次 Plan 偏好，并结合人数、行李、高德路线事实及与预计抵达日期匹配的 QWeather 事实给出可解释的初步交通方式；已移除固定 1.5 公里步行阈值，改用已比较路线的相对时长。输出保留来源时间和限制，打开高德不构成叫车、导航开始、预订、支付或 Task 完成。
- 实现高德路线行动交接：选择高德地点后可检查驾车路线，并生成由用户自行打开的高德路线链接；不调用叫车、预订或支付。
- 实现 QWeather Connector：经高德地理编码解析地点后，提供实况和三天预报；Key 与 Host 不会暴露给 Web 或 Agent。
- 实现官方来源 Connector 的安全基础：仅从 Country Pack 注册表批准的 HTTPS 官方域名抓取，保留原始标题、规范链接、抓取时间、内容指纹和限长摘录；拒绝任意外部域名与跳转，且不生成个人政策适用性结论。China Pack 初始注册了国家移民管理局与国务院英文入口。
- 实现官方来源快照 SQLite 持久化：按来源、规范 URL 与内容指纹去重，保存后续不同指纹所对应的前一版本，明确报告内容发生变化；不会因此自动断言政策变化或适用于用户。
- 将官方来源刷新接入 Core：只读接口列出 Country Pack 的批准来源；只有显式刷新单个来源时才抓取、写入和比较快照。已用临时本地实例验证注册表接口，未执行外网刷新。
- 实现 Web Settings 的官方来源工作台：显示批准来源、原文链接、最近快照及内容变化提醒，并提供显式刷新入口；刷新不自动执行，也不显示任何政策适用性结论。
- 实现最小 `policy-applicability` 证据准备门槛：只读取已保存的 Profile、当前 Plan 和官方来源快照，检查国籍、来华签证/居留状态、地点、日期以及七天内的国家移民管理局快照，并在 Plan 页面给出“补资料 / 刷新证据 / 可进入审查”的状态。它不会读取或解释政策正文，更不会判断签证、居留或入境资格。
- 实现官方来源到当前 Plan 的显式关联：用户在 Settings 中选择一条已保存的快照后，才会把该快照的 ID、内容指纹、原文标题、官方机构、链接和抓取时间写入当前 Plan 的 Sources；重复选择不会重复写入。关联不触发刷新，也不构成政策结论。
- 完成一次真实高德地理编码与 QWeather 联合验证：输入 Shanghai 被解析为上海市，并成功返回实况与三天预报。
- 实现高德周边餐饮发现：以用户选择的地点为中心，按高德周边搜索返回餐饮 POI 与距离事实；不把候选伪装为排名推荐，也不调用点餐、预订或支付。
- 实现高德周边住宿发现：在 Plan 的地点决策中，以用户选择的展馆、学校、工作地点或区域为中心，返回住宿 POI 与距离事实；预订仍由用户在其选定的第三方服务中完成。
- 餐饮和住宿地点可交接到高德：手机上尝试打开高德地点页，桌面端打开高德 H5 地图；用户仍自行决定导航、预订、点餐或支付。
- 实现 Plan 临时配置中的住宿候选：用户可把一个高德住宿结果保存到当前 Plan，Plan 版本会递增；候选不会被标记为已预订，也不会写入长期 Profile。
- 实现住宿确认：用户在第三方服务完成预订后，可显式将当前住宿候选标记为已确认；系统不会自行推断预订成功。
- 实现用户直接录入住宿：输入住宿名称和地址后由高德解析位置，再只写入当前 Plan；用户勾选已在外部完成预订时才保存为已确认住宿。
- 已保存的 Plan 住宿可一键作为路线比较的起点或终点；手动录入住宿没有高德 POI 编号时只使用已验证坐标，不伪造编号。
- 扩展长期 Profile：保存国籍、性别和来华签证/居留状态；字段可选、可修改，为以后按旅游、学生、工作或居留身份检索官方政策建立基础。
- 扩展 Plan 临时配置中的交通偏好：默认由未来的上下文决策确定；用户可为本次 Plan 指定出租车、公共交通或步行偏好，设置不进入长期 Profile。
- 扩展 Plan 临时配置中的出行上下文：可选保存同行人数和行李量，为以后按时间、天气和出行偏好推荐交通方式提供事实输入。
- 扩展 Plan 临时配置中的预计抵达时间：可保存当地日期、时间与时区，作为后续天气刷新、交通卡片和提醒调度的事实输入；保存本身不会安排或发送提醒。
- Web 首页会在长期 Profile 未完成时提供首次资料引导；引导不阻塞用户立即创建 Plan，资料仍可以后修改。
- Plan 详情可按当前 Plan 的地点一键刷新 QWeather 实况与三天预报；天气结果只临时关联当前 Plan，不写入长期 Profile，也不创建提醒。
- 扩展高德路线事实：可比较驾车、步行和公共交通的距离、时长，并在高德提供时显示公共交通票价；公共交通只在起终点都有高德城市编码时查询，不会猜测城市。
- Plan 路线卡可一键并列比较驾车、步行与公共交通的路线事实；某个方式不可比较时保留其原因，不影响其他方式的事实返回。
- 实现可解释的初步交通选择：尊重本次 Plan 的明确偏好，并结合同行人数、行李和已比较路线事实；当预计抵达日期与 QWeather 三天预报中的日期精确匹配时，也会谨慎考虑降水，且不触发出行。

## 未完成内容

- 已完成 Telegram Bot 身份验证、一次性私聊配对，以及已绑定账号的最小输入入口：普通文本和 `/new` 都会使用 Settings 中选定的本机 Codex 或 Claude Code 生成待确认 Plan；所选运行底座不可用时会明确降级为本地模板草案，另有 `/help` 和 `/plan`。官方来源 Connector 已具备受限刷新和快照能力；完整的数据库迁移体系尚未实现。
- 已实现第一条 Plan 事件状态转换：任务只有显式 `arrival` 触发标记时，预计抵达事件才会把它从 `scheduled` 转为 `ready`，记录本地收件箱并更新当前下一步；不会推断或自动完成任何任务。
- 已实现到达任务的显式完成闭环：只有绑定 Telegram 用户点击“我已完成此步骤”时，当前 Plan 内的 `ready` 任务才会改为 `completed`，并记录为用户确认；不会把打开高德或其他第三方应用当作完成回执。
- Telegram 的 `/plan` 已提供当前完整 Plan：已知信息、需要纠正的假设、阶段、任务状态、提醒策略和下一步都会显示；超过单条消息安全长度时自动分页，确认按钮只附在最后一页。
- Claude Code Adapter 已实现并通过契约测试、接入用户可选的运行底座，但尚未在真实已登录账号上做端到端验证；Plan 生成已具备最小 Run 审计，取消、优先级队列及 Task/Reminder/Event/Skill 级审计仍未实现。
- 尚未实现本地 MCP Tool Gateway。
- 尚未实现天气兜底、餐饮与住宿的第三方应用行动交接、地图深链接真机验证和限额/配额可视化。
- 住宿候选已有相对一个 Plan 中心点的初步距离理由，并支持保存或直接录入后由用户显式确认；尚未支持多中心路线、住宿地点偏好和完整区域级比较。
- 初步交通选择只会在预计抵达日期落入已刷新 QWeather 三天预报窗口时考虑降水；没有日期匹配时不会用天气猜测未来行程。它已成为独立的 `transport-planner` Skill，不再使用固定步行距离阈值，但仍未纳入服务中断或精确位置，也不会替用户自动启动出行。
- 已建立 China 官方来源注册表并实现受限采集、SQLite 证据快照、去重及内容变化检测；快照可显式关联到当前 Plan，但尚未链接到 Task/Run，也尚未实现会解释官方政策正文的适用性 Skill。
- Plan 生成、确认和基础版本递增已实现；Task Reminder 已完成结构化提案、持久化、展示、Telegram 到期发送、有限失败重试、显式取消、旧计划失效保护、可降级的到期天气刷新和最小到期 Run 审计，但尚无其他动态事实刷新、Skill/证据版本关联和审计保留策略。事件执行另有显式 arrival 任务的最小闭环。
- Task Reminder 在本地可防止已记录成功或失败后的重复发送；但如果 Telegram 已接受消息、进程却在写入本地成功状态前崩溃，租约恢复后仍可能重复发送。跨 Telegram 与本地 SQLite 的严格 exactly-once 尚未解决。
- 尚未实现 SQLite 的正式迁移、备份、恢复、加密和数据保留策略。
- Telegram 配对只接受一次性、短时效 `/start` 指令，并且一套实例只能绑定一个私聊账号。服务运行时会持续读取已绑定私聊的消息，并持久化更新游标以避免重复处理；已激活 Plan 的结构化 Task Reminder 与预计首次抵达时间均可触发通知。Task Reminder 的暂时性发送故障最多重试两次，最终状态写入 Web Inbox；到期时会尝试刷新目的地天气，失败则无天气继续发送。用户点击“我还没到达”后，或五分钟没有回应后，才会出现 Telegram 的系统位置共享按钮；若当前 Plan 已保存具体住宿，GPS 坐标会即时转换为高德坐标，按本次交通偏好查询路线事实。公共交通或自动选择模式还会即时解析起终点的高德城市编码，以查询公交/地铁距离、时长和可用票价；随后发送用户自行打开的高德 HTTPS 路线链接。坐标不会写入 Profile 或数据库。用户可从 Web 显式解绑当前私聊账号；多阶段提醒已具备最小发送链路，但其他动态事实刷新和复杂条件仍未实现。
- 尚未确定最终项目名称、开源许可证和贡献治理方式。
- 尚未确定一键部署与全天在线方案。

## 运行方法

当前仓库已进入第一段可运行实现：Server 和 Web 使用本地 SQLite Workspace 数据，可以完成 Plan 展示与确认演示；高德地点/路线/地理编码、QWeather 天气事实和 Codex 结构化草案已做过真实验证；Claude Code 也已有同契约的适配器并可被选中，待真实账号验证；Telegram 可在配置 Token 后做显式 Bot 身份验证。它仍不能用于真实用户提醒或外部行动。

阅读顺序：

1. `README.zh-CN.md`：中文项目概览。
2. `docs/README.md`：设计文档索引。
3. `docs/architecture.md`：系统边界与运行拓扑。
4. `docs/core-data-model.md`：核心数据模型。
5. `docs/skill-contract.md` 与 `docs/connector-contract.md`：扩展契约。
6. `docs/agent-runtime-adapter.md`：Codex / Claude Code 适配边界。
7. `docs/china-pack-v1.md`：China Pack V1 范围与第一条演示闭环。
8. `docs/decisions-and-open-items.md`：已确认决策和待确认问题。

基础环境是 Node.js 22 及以上版本和 pnpm。依赖安装完成后，可使用 `pnpm install`、`pnpm dev`、`pnpm build`、`pnpm typecheck` 和 `pnpm test`。`pnpm dev` 会启动本地 Server 与 Web，并在首次启动时创建 `data/c-assistant.sqlite`；真实部署和外部服务配置仍不在这一阶段。

## 已知问题与风险

- 当前可创建并保存本地 Plan；确定性模板和选定运行底座的 Schema 草案都可用；两种运行底座都不会自行检索官方来源，也不会执行外部动作。Claude Code 尚未完成真实登录账号的端到端验证。
- 高德关键词地点搜索、周边餐饮、周边住宿、驾车、步行、公共交通路线和地理编码，以及 QWeather 的实况和三天预报，均已使用本地凭据验证；天气兜底和地图深链接真机行为仍需分别验证。
- Ctrip 目前只是假设中的住宿搜索交接渠道，具体链接能力尚未确认。
- 政策、入境、法律、银行和医疗结论必须使用最新官方来源；当前仅实现“资料与证据是否准备好进入审查”的状态，尚未形成可交付的适用性判断。
- Profile 中的签证/居留状态目前已作为受限 Plan 草案上下文传给选定 Agent，但尚未接入官方来源的适用性判断，且不能被当作政策资格结论。
- Telegram 不能静默读取 GPS，只能由用户通过明确操作分享位置。
- Telegram 附近餐饮目前只能依赖高德 POI 事实，无法验证营业状态、排队、桌位、菜单或外国人实际可用性；这些内容不会被推断。
- C-assistant 不应存储 Codex 或 Claude Code 登录凭据，也不应把 Connector 密钥暴露给 Agent 或 Skill。
- V1 不直接预订、叫车、点餐或支付；外部链接被打开也不能视为任务已经完成。
- 全天在线依赖部署主机持续运行，目前没有确定的一键部署和进程守护方案。
- 当前远端默认工作分支为 `master`；是否迁移为 `main` 尚未决定。

## 下一步建议

优先完成一条端到端的最小闭环，避免先同时开发全部模块：

1. 为 monorepo 各应用与包补充可构建的 TypeScript 配置和测试框架。
2. 实现最小 Core 数据模型、SQLite 迁移和 Plan 版本确认。
3. 实现一个 Runtime Adapter，先用 Codex 或 Claude Code 其中之一完成结构化输出 PoC。
4. 实现受限的本地 Tool Gateway。
5. 实现 Amap 的路线与地图交接最小能力。
6. 实现 Telegram 用户配对、文本接收、计划确认和定时交通卡片发送。
7. 实现最小 Web 页面，展示完整 Plan、Timeline、Sources 和确认入口。
8. 用场景测试验证：用户描述来华事项 → 生成完整 Plan → 用户确认 → 到达时间触发 → 刷新路线事实 → Telegram 发送交通卡片 → 跳转 Amap。

## 安全交接说明

- 仓库中不应提交真实 Telegram Token、Amap Key、Codex/Claude Code 登录信息或其他账号凭据。
- `.env.example` 只保留空值字段说明；真实值应放入被 Git 忽略的本地环境文件或安全的秘密存储中。
- 切换账号后，先检查本机 Runtime 的官方登录状态，再继续开发；不要把登录缓存复制到项目目录。
