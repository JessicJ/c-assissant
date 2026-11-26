# Landi 的 MAH 隔离后台承载合同

## 当前核实入口

2026-10-26 已对当前源码与安装版 MAH `0.1.2029` 重新检查，见 [当日接入审计](mah-integration-audit-2026-10-26.md)。可执行 `pnpm check:mah-integration` 重新读取公开接口；成功仅表示诊断读取成功，不代表生产接入。以下 10 月 22 日与 20 日内容保留为历史基线。

## 定位与实施边界（2026-10-22）

MAH 管理定时、AI 执行和持续运行监督，并选择 MAH 中配置的 Agent 与模型。Landi 保留旅行领域规则、用户审阅确认、业务数据、结果校验、邮件模板及被动执行模块。目标架构中，Landi 不再自行触发业务定时运行；界面刷新、网络超时等非业务计时不在迁移范围。

本次仅对齐文档与合同。生产开关保持关闭，不接通真实调用，不停用现有定时器，不改表结构，不执行 resume、不新建任务、不重跑历史测试。现有本地计时器仍在运行代码中；不能将“AI 门禁关闭”表述成“所有后台业务已经停止”。

截至 2026-10-22 的只读核实安装版为 **0.1.2008**：`task submit --schedule-json` 支持 manual/cron/interval/defer_until/after；`task schedule` 提供 preview/start/stop/update/list/runs 等公开入口；本项目 schedule list 返回 0 个注册。已确认接口存在，不等于已验证幂等、停用在途实例、恢复和业务结果关联。`project runtime register` 仍只证明项目注册，尚未核实满足本合同的服务托管入口。

调度与执行合同见 [业务调度合同](contracts/landi-mah-scheduling-v1.md)，服务动作合同见 [服务生命周期合同](contracts/landi-mah-service-lifecycle-v1.md)。这些是 Landi 的待对接要求，字段不是声称 MAH 已支持的参数。

## 历史核实基线（2026-10-20，0.1.1968）

本合同定义 MAH 持续承载一个隔离 Landi 本地实例时必须满足的公开边界。2026-10-20 对绑定安装版 MAH `0.1.1968` 的公开帮助与结构化读回表明：当前版本能注册项目、显示项目入口、读取依赖资源、管理定时 Task，并能读取部分 Task、Agent 与 Personal OS 投影；它没有公开的 Landi 服务注册、实例启停、实例所有权、崩溃监督、持久化期望状态或重启恢复合同。因此本能力当前状态为 `blocked_on_public_mah_contract`，不得进入生产实现，也不得把已有启动包、`project runtime register`、Project Entry、Schedule 或一个长期 Task 描述为“MAH 已托管 Landi”。

业务权威与执行责任分开：Core 与 Storage 保留旅行规则及持久数据；MAH 在公开合同齐备后负责业务定时、执行调度及外围服务监督。Server 保留 API 和唯一启动器管理的本地生命周期。以下版本、配额及旧任务读数均为历史快照，不代表当前就绪状态。

## 历史公开能力基线

所有结论都来自绑定安装版公开 CLI，不沿用 MAH `0.1.1896` 的能力假设。

| 公共入口 | 当前退出码 | 可证明事实 | 不能证明的事实 |
|---|---:|---|---|
| `--version` | `0` | 当前版本为 `0.1.1968` | 任一子命令一定存在 |
| `setup status --format json` | `0` | Codex 探针就绪且已认证；Claude 探针失败 | Scheduler 已物化 Task，或本地服务已运行 |
| `capabilities --agent codex ...` | `0` | Codex 公开能力及可路由模型投影 | 本次调用最终路由、Landi 服务实例或后台监督 |
| `agent quota show codex ...` | `0` | Codex 当前可路由配额投影 | Personal OS 槽位可用性或服务配额 |
| `agent schema-probe codex ...` | `2` | 当前项目上下文探针以 `task_execution_context_invalid` 失败 | 结构化生成已可验收 |
| `personal-os quota list ...` | `0` | 当前槽位容量、reservation 与离线投影 | 用户偏好、后台服务状态或永久额度 |
| `task submit/show/context` 的公开帮助 | `0` | 有界 Task 的提交与公开结果读回合同仍存在 | 一个 Task 等于常驻服务；`show/context` 能证明 Scheduler 物化来源 |
| `task execution-carriers ...` | `1` | 当前版本没有该公开命令 | 不得使用旧版 carrier Schema 补证 |
| `task list ...` | `1` | 当前项目读回以 `project_git_owner_unresolvable` 失败 | 不得从失败推断“没有 Task” |
| `task schedule list ...` | `0` | 当前项目没有公开 Schedule | Schedule 能监督任意本地进程 |
| `project runtime list/validate/resources ...` | `0` | 项目已注册、拓扑有效、依赖资源可读 | 服务注册、进程所有权、启动、停止或恢复 |
| `project entry list ...` | `0` | `preview` 是导航到本地 URL 的 Web 入口 | 入口会启动、认领或停止 Landi |
| 实际调用不存在的 `health` | `1` | 顶层没有该公开命令 | 不得把 `--help` 回退到父帮助当成健康接口存在 |

当前 Task 的 Personal OS 公开投影显示只有 `interactive` 槽位有容量且已被当前工作占用，`background` 与 `review` 没有可用容量。该读数只是本次快照，不能改写产品语义，也不授权提交子 Task。账户标识、reservation 标识和其他敏感运行值不得写入设计、Git 或验收工件。

## 历史成果的合法复用

- Project 提交 `35391eb31fb7c63c241df67e4af1bd9fdf836121` 是当前 Project 起点的祖先；组件提交 `c2849eba13267d7913c17212d47a5701756a2c66` 是本 Task 冻结的组件起点。
- 旧 Task 的公开 context 工件证明组件提交包含规范启动器、隔离用户目录、实例收据、健康所有权证明、停止与重启路径、打包与发布适配器；历史干净归档验收记录为 `21/21` 通过。这些事实可作为源码与启动包设计的复用依据。
- 同一批公开历史工件还保留两次早期失败，且 Evolution writer 以 `project_task_fact_mutation_identity_invalid` 拒绝更新；四个 T5-1 运行时切片当时没有被规范交付。历史源码测试成功不等于当前 MAH 后台承载成功，也不等于本 Task 新验收。
- 旧 MAH `0.1.1896` 的 `execution-carriers`、后台 Task 或 Scheduler 结论仅是历史证据。当前 `0.1.1968` 未提供该命令，不能继续作为生产依赖。

## 历史能力矩阵

| 能力 | 当前判定 | 必要证据 |
|---|---|---|
| Project 注册 | 已实现 | `project runtime list/validate` 的结构化读回 |
| Landi 服务注册 | 未提供 | 稳定 `serviceId`、唯一启动器合同、项目与组件身份的公开投影 |
| 启动与幂等复用 | 未提供 | 公开 start 收据及同实例 readback |
| 安全停止 | 未提供 | 公开 stop 收据，且由启动器所有权证明约束 |
| 实例所有权 | Landi 启动器已有源码合同；MAH 未投影 | 启动器收据、进程启动身份、端口与健康证明摘要的组合 |
| 崩溃监督 | 未提供 | 最后退出、重启计数、策略、退避与最终降级状态 |
| 期望状态持久化 | 未提供 | `running/stopped` 期望状态的持久公开投影 |
| MAH/主机重启恢复 | 未提供 | 重启后的 reconcile 收据、恢复世代和同实例或新实例判定 |
| Landi 数据持久化 | 启动器设计与历史测试已覆盖；本 Task 未重验 | 包外用户目录、数据库重启读回及无破坏恢复 |
| 后台槽位 | 当前不可用 | 公开容量快照；它不是服务承载合同，也不能用其他槽位替代 |

## 选定架构

在 MAH 提供下述公开合同时，采用“MAH Scheduler 外围监督 + Landi 唯一规范启动器”的两层架构：

1. 一个 Project 只能注册一个稳定 `serviceId=landi`。注册绑定规范 Project 根、`componentId=c-assissant`、启动器合同版本和允许的动作；不携带凭据、用户数据或健康令牌。
2. MAH 持久化外围服务的 `desiredState`，拥有 reconcile、退避、崩溃计数及 MAH/主机重启后的恢复。它同时通过独立业务调度合同管理提醒、邮件研究、旅行监测及 Blueprint 的执行调度；服务进程存活与业务运行成功必须分别核验。
3. 服务生命周期操作只能调用现有唯一规范启动器的结构化 `start`、`status`、`stop` 动作。Finder 入口、CLI 验收和 MAH 适配层都必须是这个实现的薄调用方，不得新增第二套 Server 启动路径。
4. 规范启动器继续拥有端口绑定、实例收据、PID 启动身份、实例绑定健康证明、工作台就绪和安全停止。MAH 不按端口或进程名直接认领、终止或复活进程。
5. MAH 的公开投影必须符合 `docs/contracts/landi-mah-background-runtime.schema.json`。健康令牌只能留在隔离运行目录；公开投影只保存不可逆摘要和非秘密身份。
6. `desiredState=running` 时，MAH 重启后先调用同一启动器读取身份：完全匹配且就绪则复用；收据陈旧或进程已退出才按有界策略重启；身份冲突则进入 `degraded` 并停止自动动作。`desiredState=stopped` 时不得自动启动。
7. 用户停止先持久化 `desiredState=stopped`，再通过规范启动器停止。普通 Landi Server 停机不得取消 MAH Task、清空 Generation checkpoint 或改变 Core/Storage 状态。

## 最小公共缺口

公开命令名称可以由 MAH 决定，但语义上至少必须提供：

- 服务注册、注销和精确 show/list，读回唯一服务身份、项目根、组件、启动器合同版本和期望状态；
- 幂等 start、stop、reconcile，返回 transition ID、前后期望/观察状态、实例身份与结构化错误；
- 公开 status 投影，包含 supervisor owner、实例所有权摘要、最后观察时间、就绪子检查、最后退出、重启次数、退避和恢复世代；
- MAH 与主机重启后的持久恢复证据，能区分复用同一实例、启动新实例、明确停止和身份冲突；
- 不暴露令牌、凭据、原始日志、私有 IPC 或内部 Task 文件的安全读回；
- 对未知 Schema、项目根漂移、组件漂移、启动器合同变化和身份冲突失败关闭。

`project runtime register` 单独不满足以上合同。它当前只注册 Project，不声明服务、期望状态、实例或监督。`task schedule` 只计划 Task，Project Entry 只导航，依赖资源只提供缓存/工具链；三者都不能拼接成隐式服务管理器。

## 明确反例与禁止旁路

- 端口监听、通用 `/health`、PID 存活或浏览器可打开都不能单独证明实例所有权。
- 启动一个长期 MAH Task、定期 Schedule 或反复 `task submit` 不能代替服务监督；这会把有界 Agent 工作错误地变成第二调度器。
- 不得直连 Codex/Claude 维持服务，不得让 Agent 拥有 Landi 生命周期，不得把 Agent session 恢复当成进程恢复。
- 不得新建 LaunchAgent、守护脚本、桌面壳、Electron/Tauri 或另一个 Finder 启动器来弥补 MAH 公共合同缺失。
- 不得读取私有 Task 文件、IPC、日志、运行数据库或自然语言 summary 推断服务状态。
- 不得因当前 `background=0` 而挪用 `interactive` 或 `review` 槽位；服务监督需要独立正式能力，不以 Agent 槽位猜测实现。

## 验证与发布门禁

`mah-background-runtime-contract` profile 只验证本设计、Schema 与治理引用一致，不表示当前 MAH 已承载服务。后续生产实现至少还需要独立运行时验收：注册、重复启动、重复停止、未知端口、身份冲突、崩溃退避、MAH 重启、主机登录后恢复、`desiredState=stopped` 不复活、数据库持久化，以及公开投影的 Schema 与摘要校验。

现有 `landi-local-launch-package` release profile 只证明本机启动包及其结构化 readback。其物料指纹必须包含本合同与后台运行 Schema，但 release 成功仍不得表述为 MAH 托管成功。只有 MAH 公共缺口关闭、运行时 profile 全部通过、正式 committed source readback 成功且对应 Evolution 实现与验证切片规范交付后，才能发布“由 MAH 持续承载 Landi”的产品声明。

在这些门禁满足前，只允许更新设计、Rules、Skills、Schema、验证/发布合同和 Evolution 状态；禁止修改生产启动器、Server 或 Scheduler 来实现猜测接口。

## 切换顺序与新增合同验收

1. 当前阶段只记录目标责任、调度/服务合同和离线样例验证；现有计时器和立即触发路径原样保留。
2. 逐项核实 MAH 的公开字段与语义，特别是调度版本、实例身份、停止与在途任务、恢复、可信回执和服务所有权。缺失即阻断，不用 show/list 拼凑物化证明，不直连 Agent。
3. 获得授权且公开合同齐备后，先建立只读对账，再设计唯一调度所有者切换。禁止 MAH 与本地计时器同时负责同一业务。确认计划后的立即监测入口也必须纳入切换，不能只删除 setInterval。
4. 独立验收重复触发、过期运行、计划版本变化、发送结果未明、停止后恢复和服务身份冲突后，才考虑另行开启生产门禁。停止服务不等于取消任务；暂停业务调度不等于服务停止。

本次新增检查只使用虚构 JSON 样例验证 Schema、身份与状态约束及文档引用，不启动进程、发送邮件、访问业务数据库或运行历史测试。Schema 合格不证明真实 MAH 行为，跨对象版本比较、摘要、授权和时区计算必须由未来适配器及运行时验收完成。
