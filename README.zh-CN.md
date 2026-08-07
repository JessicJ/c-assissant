# C-assistant

> 暂时代号。一个面向“地区助手”生态的开源项目。

C-assistant 的目标不是只做旅行问答，而是帮助来到某个国家或地区的人更快适应当地生活。首个 Country Pack 面向中国，V1 聚焦来华准备与吃、住、行，并为以后扩展法律、银行、经商等能力保留模块化结构。

项目已完成架构基线，并有第一段本地可运行流程：Web 工作台、Core HTTP 服务、本地 SQLite 保存、Profile（国籍、性别、来华签证或居留状态）编辑、Plan 创建和确认流程已经连通；高德地点搜索、周边餐饮事实与驾车、步行、公共交通路线事实 Connector、QWeather 实况与三天预报事实 Connector 已接入，Codex 已能按 Schema 生成完整 Plan 草案；Telegram 已支持安全的本地配置、Bot 身份验证和一次性私聊配对。它仍不是可供真实用户使用的助手：Telegram 任意消息理解与提醒、官方来源、调度、Claude Code 和除已验证的高德行动交接都尚未接入。

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
- 本次出行默认由 Plan 根据上下文决定交通方式；用户只在有明确偏好时才覆盖它。
- 同行人数和行李情况只在确实影响本次出行时才补充，并仅保存到当前 Plan。
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

需要 Node.js 22 及以上版本与 pnpm：

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

首次启动会在 `data/c-assistant.sqlite` 创建本地数据库。如果 `.env` 中配置了 `AMAP_API_KEY`，可在 Plan 中验证高德地点、查看选定地点周边的餐饮和住宿 POI 与距离事实，并比较驾车、步行和公共交通路线事实；也可直接录入已选住宿的名称和地址，由高德先解析位置后写入当前 Plan。驾车路线可交接到用户自行打开的高德，步行和公共交通先作为事实比较，待真机验证后再增加行动交接。住宿只有在用户明确表示已完成第三方预订后才会标记为已确认。餐饮与住宿结果只是事实候选，不做排序推荐，也不会点餐、预订或支付。如果配置了 `QWEATHER_API_KEY` 和 `QWEATHER_API_HOST`，可查看城市实况和三天预报，凭据不会显示在 Web 工作台。如果配置了 `TELEGRAM_BOT_TOKEN`，可在 Settings 中主动验证 Bot 身份，并创建一次性私聊配对链接；用户发送该链接带出的 `/start` 后，才会绑定当前实例。配对成功时 Bot 会持续接收已绑定私聊的消息：普通文本或 `/new <事项>` 都会创建待确认草案，`/help` 和 `/plan` 可查看当前状态。若 Plan 已激活、已设置预计首次抵达时间且 Telegram 已配对，Bot 会在该时刻发送一条到达提醒，并提供“我还没到达”按钮；只有用户点击它，或五分钟没有回应后，才会出现 Telegram 的系统位置共享按钮。若当前 Plan 已保存具体住宿，Bot 会将共享的 GPS 坐标即时转换为高德坐标，按本次交通偏好查询可用路线事实，并发送可由用户打开的高德 HTTPS 路线链接；坐标不会写入 Profile 或数据库，也不叫车、不预订或支付。其他任务提醒和基于 Codex/Claude Code 的深入理解仍未启用；Token 不会显示在 Web 工作台。如果本机 Codex CLI 已登录，用户可在计划输入框中主动点击按钮，让 Codex 按 Schema 生成 Plan 草案。
