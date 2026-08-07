# Landi

> 暂时代号。一个面向“地区助手”生态的开源项目。

Landi 的目标不是只做旅行问答，而是帮助来到某个国家或地区的人更快适应当地生活。首个 Country Pack 面向中国，V1 聚焦来华准备与吃、住、行，并为以后扩展法律、银行、经商等能力保留模块化结构。

项目已完成一条本地 V1 闭环：Web 工作台、Core HTTP 服务与调度器、本地 SQLite、Profile、Plan、Codex/Claude Code 草案、中国 Country Pack 完整编排、官方来源刷新与追溯、高德/QWeather 事实、Telegram 配对/完整审阅/提醒/定位交接和 Plan 确认已经连通。用户可为单人实例选择运行底座，登录凭据与 Connector 密钥不会写入领域数据或传给 Skill。V1 仍保持明确边界：不根据网页正文替用户作受监管资格结论，也不点餐、订房、叫车或支付。

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

Pull Request 以及向 `master`/`main` 的推送会在 GitHub Actions 中执行相同的构建、类型检查和测试；CI 不配置任何真实 Connector 或运行底座凭据。

首次启动会在 `data/c-assistant.sqlite` 创建本地数据库。配置本地 `.env` 后，高德可提供地点、周边餐饮与住宿、驾车、步行和公共交通事实，并把路线交接给用户自行打开；QWeather 可提供实况和三天预报。QWeather 不可用时，即时查询可降级显示高德基础天气；高德未提供的降水量、UV 和体感温度不会被猜测，降级结果也不会进入打包或交通决策。住宿只有在用户明确表示已完成第三方预订后才会标记为已确认，系统不会点餐、预订、叫车或支付。

Settings 会显示 SQLite schema 与完整性状态，并允许用户显式创建经过再次校验的本地备份。备份保存到 `data/backups`（自定义数据库则保存在其旁边），权限为 `0600`，不包含 Codex/Claude Code 登录凭据或 Connector 密钥。恢复会覆盖当前 workspace，因此 V1 不自动执行恢复。

配置 `TELEGRAM_BOT_TOKEN` 后，可在 Settings 验证 Bot 并创建一次性私聊配对链接。首次普通文本或 `/new <事项>` 会使用本机已登录且在 Settings 选定的 Codex 或 Claude Code，结合已确认的 Profile 生成待确认 Plan；身份字段只作计划上下文，不能作为政策资格结论。用户创建的 Plan 仍为草案时，后续普通文本会作为一句话修订，`/new` 则始终新建独立 Plan。修订失败不会用模板覆盖原草案。新草案和 `/plan` 都会把完整 Plan 自动分页发送到 Telegram，确认按钮只出现在最后一页，并绑定当前 Plan ID 与版本；旧按钮不能确认已替换或已修改的草案。Web 工作台也保留同一套完整审阅和确认能力。

Web Plan 页面或 Telegram `/prepare` 会刷新已批准且缓存过期的官方来源，收集高德和 QWeather 当前事实，依次运行 China Pack 的七个 supporting Skills 与组合 Skill，并原子保存新的完整草稿版本。缺少住宿路线、Profile 或时间等关键事实时，只返回需要补充的项目并保留原草稿；成功后仍必须完整审阅并确认，Task 和 Reminder 才会激活。

`/profile` 可直接在 Telegram 查看和补充长期基础资料，不阻塞先创建 Plan。姓名、语言和国籍只有在用户先点选字段后才会读取下一条文本，15 分钟自动失效；性别和来华签证/居留状态使用白名单按钮。命令与定位消息不会被误保存，资料不完整时也不会被错误标记为 ready，更不会被当作政策资格结论。

`/weather` 可按当前 Plan 地点显式查询天气：高德负责解析地点，QWeather 优先返回实况和带日期的三天预报，并保留官方来源与抓取时间。QWeather 不可用且地点具有有效高德行政区编码时，只降级显示高德基础事实并标注能力限制。地点未确认或两个服务均失败时不会猜测；查询不会创建 Reminder，也不会把天气写入 Profile 或 Plan。

Plan 激活并设置预计抵达时间后，Bot 会在该时刻发送到达提醒。“我还没到达”或五分钟无回应才会触发一次明确的位置请求；共享 GPS 只用于当次高德路线计算，不写入 Profile 或数据库。到达只把明确标记的任务推进为 ready，只有用户点击“我已完成此步骤”才会记为 completed。所有 Connector 凭据都留在本地 Server，不显示在 Web，也不传给 Agent。
