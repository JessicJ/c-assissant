# C-assistant

> 暂时代号。一个面向“地区助手”生态的开源项目。

C-assistant 的目标不是只做旅行问答，而是帮助来到某个国家或地区的人更快适应当地生活。首个 Country Pack 面向中国，V1 聚焦来华准备与吃、住、行，并为以后扩展法律、银行、经商等能力保留模块化结构。

项目当前处于架构基线阶段：已确定产品边界、核心数据模型、Skill 与 Connector 契约、Agent 运行方式以及 China Pack V1 的内部能力拆分。仓库暂未提供可运行版本。

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

当前仓库只包含设计文档和目录骨架。下一阶段应先实现一条最小闭环：用户输入来华事项，生成完整 Plan，在到达时间通过 Telegram 发送基于高德事实生成的交通卡片，并跳转高德完成后续动作。
