# Landi

> 开源旅行助手，正在接入 MAH。

Landi 是私人旅行助手：了解旅行需求、制定和调整行程，并通过邮件持续协助。当前范围以 [产品范围](docs/product-scope.md)为准；不再发展 Country Pack、地区助手生态、Telegram 或 WhatsApp。

Landi 采用 [Apache License 2.0](LICENSE) 开源许可证。

## 使用前先了解 MAH 依赖

- 无需先安装 MAH，就可以打开本地工作台、填写并保存旅行需求。提交前的文字在浏览器存储可用时保留于本机浏览器；收到保存成功提示后，需求已保存至本地服务端。保存需求不会启动 Agent 处理或计划生成。
- 生成计划依赖 MAH。用户在 MAH 中配置 Agent 使用权限，由 MAH 管理和选择 Agent；Landi 不再要求用户选择或配置 Agent。
- MAH 是独立的闭源软件。Landi 的 Apache-2.0 许可证不覆盖 MAH，也不包含 MAH 或其中配置的 Agent 服务的使用权限。请分别确认它们当前的条款与使用条件；下载 Landi 不代表获得这些服务。
- 生成草案与批准该版本计划执行是两个步骤。旅行数据、版本、业务校验与用户确认仍由 Landi 管理。

## 当前接入状态

MAH 接入仍在验证。历史基线 MAH `0.1.1968` 缺少 Landi 设计所需的公开任务物化与后台服务合同。2026-10-22 对 `0.1.2008` 的只读核实仍未建立完整执行与服务托管证据，见 [MAH 后台承载合同](docs/mah-background-runtime.md)；因此**经 MAH 生成计划、由 MAH 持续托管运行尚未就绪**。仅安装 MAH 不能证明这些能力可用。

目标流程为先安装并配置 MAH → 从 MAH 打开 Landi → 保存需求 → 公开执行准入核实后明确继续生成 → 审阅草案 → 另行批准精确版本执行。当前完整流程仍未通过端到端验收；首次引导与桌面工作台保留，规划区分别核对配置、执行和会话。返回 MAH、重新检查或刷新均只读，不自动启动；旧下载弹窗退役。原保存结果未知时先核对原消息回执，保留草稿与身份。详细行为以 [工作区需求](docs/blueprint-workspace-generation-requirements.md#web-conversational-intake) 为准。

现有直连 Codex/Claude Adapter 保留为迁移实现，不是绕过 MAH 故障的生产后备路径；历史直连测试不证明 MAH 接入。旧 macOS LaunchAgent 工具与安装、预览、卸载命令已移除，现有用户服务及数据保持不变。面向用户的本地启停仅采用 [启动包设计](docs/macos-local-launch-package.md)规定的规范启动器；源码开发命令不承担该职责。Landi 保留旅行规则、数据与明确确认；迁移期间现有本地定时器保留，MAH 托管仍须等待正式公开合同。

自带运行环境的 macOS 启动包仍待最终交付与验收。下面的源码开发命令不等于可下载、已验证的启动包。边界和剩余门禁见 [macOS 启动包设计](docs/macos-local-launch-package.md)与 [MAH 后台承载合同](docs/mah-background-runtime.md)。

## 产品形态

- Web 工作台：旅行需求、提案确认、行程审阅与编辑、历史和设置。
- 邮件：唯一主动通知渠道，承接每日行程、转场、餐饮与重要变化；重大调整需回 Landi 工作台审阅并明确确认。
- MAH：目标负责 Agent 的管理和选择、AI、定时和执行，接入状态如上文所述，仍待验收。
- Landi Core 与 Storage：拥有旅行数据、版本、确认与业务校验；迁移期间保留现有监测和提醒模块。
- 目的地研究：旅行所需的来源核验、天气、路线和当地准备；用户不选择或安装国家能力包。

Telegram 与 WhatsApp 不再是可选渠道。旧账号绑定与历史数据保留，不自动转为邮件发送授权。邮件设计见 [邮件执行](docs/email-execution.md)与 [手机邮件模板](docs/mobile-email-templates.md)。

## 核心原则

- 先收集需求、再生成完整计划：每次只追问一个关键事实；生成前先确认最新版本提案。
- 生成与执行分别确认：关键信息足够后生成完整草案，用户审阅后再明确批准该版本执行。
- 计划确认后少干预：在确认范围内按计划自动执行提醒和可逆准备。
- 本次出行默认由 Plan 根据上下文决定交通方式；用户只在有明确偏好时才覆盖它。
- 同行人数和行李情况只在确实影响本次出行时才补充，并仅保存到当前 Plan。
- 最新且可追溯：政策和手续结论必须附带最新官方来源。
- 明确事实边界：AI 负责区域与方案决策，Connector 提供可验证事实，第三方应用完成交易。
- 隐私最小化：精确位置只为当前任务短期使用，不写入长期 Profile。

邮件执行的现行设计见 [邮件执行](docs/email-execution.md)与 [手机邮件模板](docs/mobile-email-templates.md)。模板预览和 SMTP 接受不等于实际收信或真机显示通过。

## 计划中的技术基线

- TypeScript / Node.js monorepo
- pnpm workspace
- SQLite
- React + Vite Web
- HTTP + SSE
- 邮件通知与 Landi 工作台审阅确认
- MAH 生成接入；现有 Codex / Claude Code Runtime Adapter 保留为迁移实现
- 本地 MCP Tool Gateway

详细设计从 [docs/README.md](docs/README.md) 开始阅读。

MAH 依赖、Landi 开源许可与 MAH 独立闭源软件的区别，以及当前接入尚未就绪的状态，见本文使用说明与规划入口。首次引导保留原有设计。称呼必填，当前首次引导使用英语，性别与目的地签证/居留状态可选；引导不会安装或核验 MAH。规划设计要求先保存需求、确认最新版本提案，生成草案后再单独批准执行；这一 MAH 完整流程仍待验收。

设置中的 Agent 控件标为本机诊断；本机登录检测、选择和诊断测试都不能证明 MAH 已就绪。工作台标识为私人旅行助手，规划入口会再次说明 MAH 生成和持续运行尚未通过验收。

## 本地源码开发

需要 Node.js 22 及以上版本，以及 [package.json](package.json) 固定的 pnpm 版本。请在包含本 README 的 Landi 组件目录运行；这些命令不配置 MAH，也不证明生成能力就绪。开发检查使用隔离配置与数据，不复用正在使用的数据库、凭据、端口或已启用的消息发送。

```bash
pnpm install
pnpm dev
```

根目录 `pnpm dev` 会同时启动 Core 服务和 Vite Web 工作台。开发 Core 服务绑定到 `http://127.0.0.1:8877/`，Vite 工作台打开在 `http://127.0.0.1:5173/`；Vite 会把 `/api` 和 `/health` 代理到同一个 Core 端口。如果只单独运行 `pnpm --filter @c-assistant/web dev`，Web 代理会读取环境变量或 `.env` 中的 `C_ASSISTANT_PORT`，未设置时回退到默认 Core 端口 `8787`。如果 Web 工作台先于 Core 服务打开，它会显示可恢复的启动提示、短暂自动重试状态，并保留手动重试按钮。

如果 Web 工作台已经打开，但无法加载 Plan 数据，可以运行：

```bash
pnpm check:workspace
```

这个检查会验证 Vite 工作台、Core 服务健康状态、Web 代理健康端点和 `/api/workspace`。输出会说明更可能是前端、后端、代理端口，还是 workspace 数据本身的问题。需要检查非默认环境时，可以传入 `--web-url`、`--core-url`、`--core-port` 或 `--timeout-ms`。

浏览器测试使用隔离的临时 Core 服务端口 `8765`。这个端口只用于测试，不应作为日常手动打开工作台的地址。

贡献者可按实际改动选择下列验证命令；列出命令不表示当前工作树已通过，也不要求每次重复全量检查：

```bash
pnpm build
pnpm typecheck
pnpm test
pnpm test:supplemental
pnpm test:guarded-contracts
pnpm test:browser
pnpm release:check
```

`pnpm release:check` 会先执行不访问外部账号的结构与 Git 跟踪文件安全预检，再执行构建、类型、应用、补充与 guarded 合同测试。guarded 合成夹具验证需要 Node.js 24 及以上和 Python 3.9 及以上，不读取真实部署证据或操作服务。每次浏览器验证使用独立临时数据库与空配置，并阻止远程动作和子进程启动。`pnpm test:browser` 会构建产品，并用隔离的临时 SQLite 数据库运行 Chromium 规划流程测试；不会调用 Agent Runtime 或 Connector。Pull Request 以及向 `master`/`main` 的推送会在 GitHub Actions 中执行两类验收。

首次启动会在 `data/c-assistant.sqlite` 创建本地数据库。配置本地 `.env` 后，Google Maps Platform 可提供地点、周边餐饮与住宿、驾车、步行和公共交通事实，并把非打车路线交接给用户自行打开；Uber 负责打车交接。Google Weather 仅在其支持的坐标范围内提供天气；不支持某个地点时会明确降级，不猜测天气、不切换地区型天气服务，也不阻塞 Plan 的其余部分。住宿只有在用户明确表示已完成第三方预订后才会标记为已确认，系统不会点餐、预订、叫车或支付。

Settings 会显示 SQLite schema 与完整性状态，并允许用户显式创建经过再次校验的本地备份。备份保存到 `data/backups`（自定义数据库则保存在其旁边），权限为 `0600`，不包含 Codex/Claude Code 登录凭据或 Connector 密钥。恢复会覆盖当前 workspace，因此 V1 不自动执行恢复。

## 后续资料

请从 [产品范围](docs/product-scope.md)、[产品基线](docs/landi-product-baseline.md)和 [设计索引](docs/README.md)阅读当前设计。旧渠道处理器、国家包与注册器已移除；有用的旅行函数和来源资料迁入 `packages/travel-support`。历史数据格式保留供审计，历史验收不表示当前 MAH 接入已完成。
