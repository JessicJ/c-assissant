# 规划连续性隔离开发入口

本入口仅供开发验收，全部数据虚构。它通过仅测试代理连接真实构建后的 Server、Storage 与 Web 资产。配置三态是代理注入的虚构输入，任何状态始终 `executable:false`，不证明真实 MAH 配置或公开执行合同。

先完成组件 `pnpm build`。以本 Task 的 Node、一个自有空目录及随机空闲端口启动：

```sh
node tests/browser/planning-continuity-server.mjs --data-dir "$FIXTURE_DIRECTORY" --port "$FIXTURE_PORT"
```

入口拒绝不明非空目录、符号链接、运行中的旧所有者、端口占用、来源或场景改变与 reset。实例有空 env、独立 SQLite；外网、子进程和全局 fetch 被阻断，测试代理只保留到其自有上游 localhost 端口的连接。停止仅对本次创建的 PID 发送 SIGTERM；不得停止未知服务。本辅助不负责源码与最终运行字节绑定，主会话必须在最后构建后记录精确摘要。

`GET /__fixture/state` 返回测试控制、原保存身份和按方法/路径计数。`GET /__fixture/snapshot` 用 SQLite readOnly 连接读取虚构会话、版本、回执及业务表计数；还返回所有 SQLite 表（含执行指针、版本、序列）的完整行排序摘要及 Schema 摘要，可核前后持久数据不变。摘要是规范序列化的领域行摘要，不冒充 SQLite 文件物理字节摘要。不迁移、不回填。两者不会计入业务请求计数。控制仅在测试代理，未接入任何生产路由。

使用同源 JSON `POST /__fixture/control`：

| action | 其他字段 | 用途 |
| --- | --- | --- |
| configuration | value: verified / needs_setup / unverified | 虚构配置证据；生产执行各项 false 原样保留 |
| next-save | mode: normal / drop_response，hideReceipt: boolean | 下一次 `/api/agent/chat` 原身份保存提交后截断响应；可令回执 GET 暂时 503 |
| receipts | unavailable: boolean | 恢复或阻断回执读取 |
| delay | path: 精确 API pathname，ms: 0–20000 | 上游真实响应已完成后延迟返回；控制变更不改已捕获的旧响应 |
| session | create: true 或 sessionId，status，advanceProposalVersion: boolean | 通过真实 Storage 创建/改变虚构会话；递增提案版本会按现行 Storage 内容变化规则递增会话修订，测试单独核实二者 |
| read-failure | path: 精确 API pathname，failed: boolean | 将指定只读 GET 返回 503，模拟会话、工作区或历史读取失败，不伪造领域状态 |
| clear | 无 | 清响应故障；不清数据库、不重置计数或配置 |

session 的 status 支持 collecting、proposal_ready、proposal_confirmed、generating、draft_ready、abandoned。status=missing 返回空且不改变数据库；用一个从未存在的虚构 sessionId 查询。领域会话没有 failed 状态，使用 read-failure 模拟读取失败，不写无效领域状态。此入口不伪造可执行或完整生成结果。

非 collecting 的虚构状态补齐已确认的目的地、目标、明确日期、往返边界、人数及交通偏好，清空虚构待答事项，不设置含糊预算。proposal_ready 因而能进入既有需求审阅卡；其生成按钮仍由真实产品门禁保持 disabled。draft_ready 的 outputPlanId 仅引用隔离库已存在的虚构 activePlan；计划内容、版本和执行指针均不改动，不创建生成事件、来源或执行证明。这些均为测试状态设置，不表示实际生成成功。相同事实保留原 updatedAt；只有实际提案/事实变化才由真实 Storage 规则推进 revision，纯状态/结果关联不伪造修订。

状态控制使用可写 Storage，其构造器可能更新 SQLite 查询统计 sqlite_stat1/sqlite_stat4；完整快照继续披露这些变化。状态控制测试要求除会话及其真实修订外的业务表不变；只读 snapshot/API 检查仍要求包括统计表在内的全部摘要不变。

纯 Node 检查：`node --test tests/browser/planning-continuity-fixture.test.mjs`。现有 `tests/browser/*.test.mjs` supplemental glob 会收录本测试。测试包含真实 Server 规划路由与 Storage 的只读对账、三态输入、延迟、丢响应、原身份回执和幂等重放；不包含 GUI 验收，也不能代替最终完整实例和浏览器矩阵。

## 明确继续的专用隔离接线

`planning-continuation-server.mjs` 是独立开发入口，挂载真实 PlanComposer 与现有确认 API，以内部受控依赖验证允许、撤销、版本变化和双击。它使用空目录临时 SQLite 与假 MAH transport；不调用真实 MAH，不发送邮件，不改变生产 readiness。命令必须显式给出自有空目录和端口：

`node tests/browser/planning-continuation-server.mjs --data-dir "$FIXTURE_DIRECTORY" --port "$FIXTURE_PORT"`

该入口在 `/` 清楚标注开发身份。`/__continuation/state` 公开虚构请求与假 transport 计数；`/__continuation/snapshot` 读回全表摘要；同源 `POST /__continuation/control` 支持 `{action:"ready",value:boolean}`、`{action:"advance-proposal"}`。`GET /__continuation/check` 只读当前范围与虚构准入；它不是 MAH 公共合同，也不出现在生产 Server。浏览器只读事件的确认 POST 计数必须为零，明确点击后至多一次。设置撤销或版本改变后再点击，必须拒绝且保留输入。实际生产仍无内部 dependency、Generate disabled，不能借这个夹具宣布真实 MAH 执行恢复。

专用 harness 的 `Test parent controls` 只用于真实组件的父层边界验收：Show session A/B、New draft、Reload selected session、虚构状态设置及 Seed booking question 均保持同一 PlanComposer 挂载实例，不以强制重挂掩盖旧请求竞争；它们不证明生产导航入口。状态与会话从真实隔离 Storage/API 读回。预订使用真正本地 BookingRoutes，虚构文本上传、预览、确认和回执可触发真实 BookingImportPanel 回调，不调用 Agent 或 SMTP；首会话导入的底层迁移由实际组件依赖测试独立证明，不宣称新增了生产入口。

`POST /__continuation/control` 另支持 `{action:"hold",path:"/api/agent/chat",enabled:true}` 和 `{action:"release",path:"/api/agent/chat"}`，也可绑定精确确认 API 路径。真实 API 事务完成后才保留响应，最多同时八个、每个最长三十秒，state 的 held/timeline 明确记录到达、提交完成、hold 与释放；不替换响应内容。竞争场景须在编辑前后读回 held 仍存在，不能把自动等待解除后的填写称为 pending 竞争。所有控制要求同源 Origin；必须核对 HTTP 200 及读回状态，403 不是有效前置。
