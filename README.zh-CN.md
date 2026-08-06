# C-assistant

> 暂时代号。一个面向“地区助手”生态的开源项目。

C-assistant 的目标不是只做旅行问答，而是帮助来到某个国家或地区的人更快适应当地生活。首个 Country Pack 面向中国，V1 聚焦来华准备与吃、住、行，并为以后扩展法律、银行、经商等能力保留模块化结构。

项目已完成架构基线，并有第一段本地可运行演示：Web 工作台、Core HTTP 服务和 Plan 确认流程已经连通。它仍不是可供真实用户使用的助手：SQLite、Telegram、高德、官方来源、调度和真实 Agent Runtime 都尚未接入。

## 已确定的产品形态

- 每位用户一套实例，使用自己的 Codex 或 Claude Code 账号。
- Telegram 是移动端入口，负责对话、提醒、定位请求和快捷操作。
- Web 工作台是完整桌面端入口，不是运维后台。
- Core 保存长期 Profile、当前 Plan、Task、Reminder、Event、Run 等结构化状态。
- Agent 每次按需运行，不承担常驻进程、定时调度或长期记忆。
- China Country Pack 对外整体发布，内部由独立 Skills 组成并由 Core 自动编排。
- Amap（高德）作为 V1 吃、住、行的位置事实与行动交接底座。
- 预订、叫车、支付等不可逆动作在第三方应用中由用户完成。

## 核心原则

- 少问、边用边补：只有生成可靠计划或执行当前动作确实缺少关键字段时才追问。
- 先给完整计划：计划开头列出所依据的已知信息，允许用户一句话纠正。
- 计划确认后少干预：在确认范围内按计划自动执行提醒和可逆准备。
- 最新且可追溯：政策和手续结论必须附带最新官方来源。
- 明确事实边界：AI 负责区域与方案决策，Connector 提供可验证事实，第三方应用完成交易。
- 隐私最小化：精确位置只为当前任务短期使用，不写入长期 Profile。

## 计划中的技术基线

- TypeScript / Node.js monorepo
- pnpm workspace
- SQLite
- React + Vite Web
- HTTP + SSE
- Telegram Bot
- Codex / Claude Code Runtime Adapter
- 本地 MCP Tool Gateway

详细设计从 [docs/README.md](docs/README.md) 开始阅读。

## 当前状态

## 运行本地演示

需要 Node.js 20 及以上版本与 pnpm：

```bash
pnpm install
pnpm dev
```

打开 Vite 输出的本地地址即可查看 Web 工作台。默认健康检查地址是 `http://127.0.0.1:8787/health`。

可使用下列命令验证：

```bash
pnpm build
pnpm typecheck
pnpm test
```

演示数据只保存在内存中，重启后会恢复初始状态；它不会发送 Telegram 消息，也不会访问高德或任何 Agent Runtime。下一阶段应实现 SQLite 持久化与真实 Plan 生成，然后接入 Telegram 和高德交通卡片闭环。
