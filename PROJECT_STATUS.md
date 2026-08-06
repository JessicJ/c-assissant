# C-assistant 项目交接状态

更新时间：2026-08-06

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

- 建立 TypeScript / Node.js monorepo 基础配置。
- 建立 `apps/server`、`apps/telegram-bot`、`apps/web` 目录。
- 建立 `packages/core`、`packages/skill-runtime`、`packages/agent-adapters`、`packages/connectors`、`packages/storage` 目录。
- 建立 `country-packs/china` 及内部 Skills 目录约定。
- 提供中英文 README、环境变量示例和 Git 忽略规则。

## 未完成内容

- 尚未实现任何可运行的服务端、Web、Telegram Bot 或数据库代码。
- 尚未实现 Codex 和 Claude Code Runtime Adapter 的真实调用与登录检查。
- 尚未实现本地 MCP Tool Gateway。
- 尚未实现 Amap Connector，也未验证实际 API 产品、字段、配额和深链接行为。
- 尚未建立中国官方来源注册表、采集、快照和适用性测试。
- 尚未实现 Plan 生成、确认、版本管理、调度、提醒和事件执行。
- 尚未实现 SQLite Schema、迁移、备份、恢复和数据保留策略。
- 尚未实现 Web 工作台界面与 Telegram 配对。
- 尚未确定最终项目名称、开源许可证和贡献治理方式。
- 尚未确定一键部署与全天在线方案。

## 运行方法

当前仓库已进入第一段可运行骨架实现：Server 和 Web 使用本地内存中的演示 Workspace 数据，可以完成 Plan 展示与确认演示。SQLite、Telegram、高德、官方来源和真实 Agent Runtime 尚未接入，因此仍不能用于真实用户数据或真实提醒。

阅读顺序：

1. `README.zh-CN.md`：中文项目概览。
2. `docs/README.md`：设计文档索引。
3. `docs/architecture.md`：系统边界与运行拓扑。
4. `docs/core-data-model.md`：核心数据模型。
5. `docs/skill-contract.md` 与 `docs/connector-contract.md`：扩展契约。
6. `docs/agent-runtime-adapter.md`：Codex / Claude Code 适配边界。
7. `docs/china-pack-v1.md`：China Pack V1 范围与第一条演示闭环。
8. `docs/decisions-and-open-items.md`：已确认决策和待确认问题。

基础环境是 Node.js 20 及以上版本和 pnpm。依赖安装完成后，可使用 `pnpm install`、`pnpm dev`、`pnpm build`、`pnpm typecheck` 和 `pnpm test`。`pnpm dev` 会启动本地 Server 与 Web；真实部署和外部服务配置仍不在这一阶段。

## 已知问题与风险

- 仓库骨架不代表功能已经实现，README 中也明确标记为架构基线阶段。
- 高德是 V1 的位置事实和行动交接底座，但其 API 兼容性仍需要真实验证。
- Ctrip 目前只是假设中的住宿搜索交接渠道，具体链接能力尚未确认。
- 政策、入境、法律、银行和医疗结论必须使用最新官方来源；该来源体系尚未实现。
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
6. 实现 Telegram 文本接收、计划确认和定时交通卡片发送。
7. 实现最小 Web 页面，展示完整 Plan、Timeline、Sources 和确认入口。
8. 用场景测试验证：用户描述来华事项 → 生成完整 Plan → 用户确认 → 到达时间触发 → 刷新路线事实 → Telegram 发送交通卡片 → 跳转 Amap。

## 安全交接说明

- 仓库中不应提交真实 Telegram Token、Amap Key、Codex/Claude Code 登录信息或其他账号凭据。
- `.env.example` 只保留空值字段说明；真实值应放入被 Git 忽略的本地环境文件或安全的秘密存储中。
- 切换账号后，先检查本机 Runtime 的官方登录状态，再继续开发；不要把登录缓存复制到项目目录。
