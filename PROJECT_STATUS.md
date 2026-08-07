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
- 实现 Codex Runtime Adapter：检查 CLI 与登录状态，在隔离临时目录中运行 `codex exec`，使用 JSON Schema 约束 Plan 草案，并剥离高德/Telegram 等 Connector 密钥。
- 实现 Web 中的显式 Codex Plan 草案生成按钮；生成后的完整草案会写入 SQLite，仍需用户确认才会激活。
- 完成一次真实 Codex 端到端验证：结构化草案已通过 Schema、保存为 4 个 Stage 和 16 个 Task；测试数据库随后已删除。
- 实现 Telegram Connector 的本地配置状态与显式 Bot 身份验证；Token 仅停留在本地 Server 进程，不会传给 Web 或 Agent。
- 实现高德路线行动交接：选择高德地点后可检查驾车路线，并生成由用户自行打开的高德路线链接；不调用叫车、预订或支付。
- 实现 QWeather Connector：经高德地理编码解析地点后，提供实况和三天预报；Key 与 Host 不会暴露给 Web 或 Agent。
- 完成一次真实高德地理编码与 QWeather 联合验证：输入 Shanghai 被解析为上海市，并成功返回实况与三天预报。
- 实现高德周边餐饮发现：以用户选择的地点为中心，按高德周边搜索返回餐饮 POI 与距离事实；不把候选伪装为排名推荐，也不调用点餐、预订或支付。
- 实现高德周边住宿发现：在 Plan 的地点决策中，以用户选择的展馆、学校、工作地点或区域为中心，返回住宿 POI 与距离事实；预订仍由用户在其选定的第三方服务中完成。
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
- 实现可解释的初步交通选择：尊重本次 Plan 的明确偏好，并结合同行人数、行李和已比较路线事实；它不触发出行，并明确标注尚未接入实时天气、服务中断或精确位置。

## 未完成内容

- 尚未实现 Telegram 用户配对、消息接收/发送、提醒调度、Claude Code Adapter、官方来源 Connector、完整的数据库迁移体系。
- 尚未实现 Claude Code Runtime Adapter；Codex Adapter 已实现，但没有 Run 审计、取消和优先级队列。
- 尚未实现本地 MCP Tool Gateway。
- 尚未实现天气兜底、餐饮与住宿的第三方应用行动交接、地图深链接真机验证和限额/配额可视化。
- 尚未支持住宿地点偏好和候选比较理由；当前只支持保存一个住宿候选或一个直接录入的住宿，再由用户显式确认。
- 初步交通选择尚未纳入实时天气、服务中断、精确位置或抵达时间，也不会替用户自动启动出行；这些事实与确认机制仍需在提醒调度阶段接入。
- 尚未建立中国官方来源注册表、采集、快照和适用性测试。
- 尚未实现 Plan 生成、确认、版本管理、调度、提醒和事件执行。
- 尚未实现 SQLite 的正式迁移、备份、恢复、加密和数据保留策略。
- Web 工作台已支持 Telegram 本地配置状态和显式 Bot 验证；尚未实现 Telegram 配对。
- 尚未确定最终项目名称、开源许可证和贡献治理方式。
- 尚未确定一键部署与全天在线方案。

## 运行方法

当前仓库已进入第一段可运行实现：Server 和 Web 使用本地 SQLite Workspace 数据，可以完成 Plan 展示与确认演示；高德地点/路线/地理编码、QWeather 天气事实和 Codex 结构化草案已做过真实验证；Telegram 可在配置 Token 后做显式 Bot 身份验证。它仍不能用于真实用户提醒或外部行动。

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

- 当前可创建并保存本地 Plan；确定性模板和 Codex Schema 草案都可用，但 Codex 不会自行检索官方来源，也不会执行外部动作。
- 高德关键词地点搜索、周边餐饮、周边住宿、驾车、步行、公共交通路线和地理编码，以及 QWeather 的实况和三天预报，均已使用本地凭据验证；天气兜底和地图深链接真机行为仍需分别验证。
- Ctrip 目前只是假设中的住宿搜索交接渠道，具体链接能力尚未确认。
- 政策、入境、法律、银行和医疗结论必须使用最新官方来源；该来源体系尚未实现。
- Profile 中的签证/居留状态目前只作本地记录，尚未接入官方来源的适用性判断，也不会自动传给 Agent。
- Telegram 不能静默读取 GPS，只能由用户通过明确操作分享位置。
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
