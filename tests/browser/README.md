# 隔离工作区验收准备

本目录的 `isolated-workspace-server.mjs` 是唯一隔离夹具启动入口，运行当前组件构建，使用真实 Core、Storage、SQLite 事务和 Server API。全部地点、来源、图片及旅行事实均为虚构验收材料。本准备不改变产品合同，也不代表真实窗口验收通过。

从组件目录使用已核验的 Node >=22 启动：

```sh
node tests/browser/isolated-workspace-server.mjs --data-dir <本任务自有空目录> --port <自有loopback端口>
```

只使用带夹具所有权标记的目录；重启沿用同一目录、同一端口，禁止 `--reset`。实例退出后数据保留。空配置、禁生成、禁外网及子进程边界持续有效；未知端口不得认领或终止。测试入口不会安装或修复浏览器工具。

测试专属 loopback 传输层提供 `/__fixture/` 说明页、三份完整长标题来源、有效 PNG 与明确 404 坏图。来源页始终标记“虚构验收来源”。Core 的图片 HTTPS 校验保持不变，数据库保留规范虚构 HTTPS URL；只在送往浏览器的 JSON 展示副本中将这两个精确素材 URL 替换为同实例 HTTP 地址。原始事务、版本、审计行、请求摘要与回执身份不改写；展示副本不能充当未经变换的原始回执证据。

`/__fixture/` 控制页与 JSON 控制接口只存在于测试启动脚本。写控制要求精确 Host、同实例 Origin 及 `application/json`，无跨域许可。每次故障绑定精确的 API 路径和 requestId；可以预先登记固定请求身份，或选择“捕获下一次保存”后在页面核对捕获的完整原请求，再对该请求设置故障。控制状态仅进程内存，重启不延续故障。

- `POST /__fixture/control`：`{ action: 'arm', path, requestId, mode }`；mode 为 `rollback` 或 `drop_response`。rollback 在对应真实审计 INSERT 安装临时 SQLite ABORT trigger，真实 API 返回 500/internal_error，事务整体回滚；不得称业务 409。drop_response 只在真实 API 已返回 2xx 后发送响应头，再截断响应体。客户端读不到完整结果，本次 Chromium 验收中，保存请求在此条件下未被自动重发。
- `POST /__fixture/control`：`{ action: 'receipts', path, unavailable: true|false }`，精确回执路径暂时返回 503，不伪造 not_found 或 committed。
- `POST /__fixture/control`：`{ action: 'capture' }` 登记只读捕获下一次保存/撤销的原请求，不阻止或替换该提交；结果可从 `GET /__fixture/state` 查看，后续故障必须显式绑定其中的 path/requestId。
- `POST /__fixture/control`：`{ action: 'clear' }` 清除本实例内存控制及自有 trigger。真实版本竞争由第二个真实 API 保存产生，不能直接改版本行。

界面验收时，可先在控制页选择“下一次保存真实回滚”或“下一次保存提交后丢失响应”：该操作在传输层捕获完整下一请求后绑定该确切请求身份，再执行一次；回执暂不可见同样绑定被捕获原请求的回执路径。控制页会披露完整虚构原请求，供显式原载荷重试与证据比对。

验收必须分别记录：明确拒绝、结果未知、原请求只读回执查询、尚无回执（不能推断未提交）、显式原载荷幂等重试，以及同目录重启后的保存内容。测试通过不能代替对隔离浏览器中交互、来源落地、长文排版和恢复文案的实际观察。

Terra 隔离浏览器验收顺序：

1. 先核验 Node 身份。本任务已核验可用命令为 `/opt/homebrew/Cellar/node@24/24.22.1/bin/node`；记录当前源码、构建及实例身份。用该绝对命令启动上述脚本，在隔离浏览器访问本机回环 URL。进入工作区后打开来源落地页、有效图片来源的悬停／键盘焦点／展开及坏图，观察完整长标题。
2. 打开同一实例的第二个工作区窗口。第一窗口建立待确认批次且保持不刷新，第二窗口通过正常保存产生真实竞争版本；回第一窗口尝试旧保存，观察拒绝及草稿保留。API 自动测试不替代这个观察。
3. 另开同实例 `/__fixture/` 控制页。点“下一次保存真实回滚”后，只在目标工作区执行一次保存；代理收全原始载荷后立即绑定该确切路径和 requestId，读控制状态核对捕获原文。观察真实 500 的安全提示及草稿，解除故障后通过产品操作恢复。
4. 点“下一次提交后丢失响应并暂不可读回执”，再在目标工作区保存或撤销一次。该控制在转发前绑定原请求和对应回执路径，真实提交成功后才断开响应；回执遮蔽先于提交生效。观察未知提示、刷新后继续未知，禁止宣称失败或已保存。控制页恢复原回执读取后，使用产品的“核对上次操作结果”；若选择显式重试，优先使用产品原请求重试动作，核对 sessionStorage 中不可变原请求未换身份或载荷。控制页/API POST 不能替代真实 UI 验收。
5. `not_found` 单独以真实尚未提交的 requestId 和完整摘要查询真实回执接口，观察该事实只表示尚未读到回执；不能据此推失败或自动重发。自动测试随后用完全相同载荷提交并证明可保存。
6. 保存后关闭并重新打开工作区，核对内容；只向本次会话持有且已证明所有权的 Server PID 发送 SIGTERM，记录退出码，再以原绝对 Node 命令、原数据目录和原端口重启，禁止 `--reset`。核对保存内容、撤销和原回执继续可读。不同端口/origin 重启应拒绝，旧库保持不变。

针对性检查命令：

```sh
/opt/homebrew/Cellar/node@24/24.22.1/bin/node --test tests/browser/isolated-workspace-transport.test.mjs tests/browser/isolated-workspace-api.test.mjs tests/browser/workspace-error-api.test.mjs
```

静态映射只证明本地隔离素材可读，不证明规范 HTTPS 图片地址可访问、在线 Provider 就绪或真实来源事实。传输代理唯一网络例外是私有 Agent 固定连接本次内层 `127.0.0.1` 端口；没有通用 loopback 放行、重定向、CONNECT 或 Upgrade 支持。请求/响应有界缓冲及超时，错误、正常停止均解除自有 trigger 并关闭连接。运行测试创建的自有临时目录在 finally 清理；如工具明确拒绝删除，必须停止该清理并报告，禁止换工具绕过。

## 预订关系专项

完整隔离浏览器验收使用 `scripts/run-isolated-browser.mjs`：为各场景创建各自空目录和本机端口，依次执行原工作区及预订专项，保留服务、测试的原输出、退出状态、截图及结构化结果，并只停止本进程启动的服务。工作区专项包含真实事务回滚、保留草稿和原请求恢复；控制层按捕获的确切请求身份安装SQLite中止触发器，不伪造500响应。默认输出在组件的 `test-results/isolated-browser`；Task 可通过 `LANDI_ISOLATED_BROWSER_ARTIFACTS` 指定绝对证据目录。它不构建、不安装、不重置数据；须先构建当前源码。任何场景失败或跳过使整体退出非零。不同场景和每次运行使用不同目录。

历史空／缺失快照场景在部分来源选择后由 runner 收到测试握手，停止自有服务并以同一目录、端口和场景重启，再由同一浏览器页面刷新核对剩余义务；重启过程有独立命令、输出和退出记录。owner 先完整写入同目录独占临时文件，再原子替换发布，避免观察到截断记录。重启等待只容许已验证并正常退出的旧自有 owner 原记录暂时存在，直到同目录中新 PID、相同端口和类型的 owner 出现，再验证真实 HTTP 就绪；未知或被改写的 owner 立即拒绝，超时拒绝，不删除 owner、不自动重试。该两项需要 runner 管理，不能手工伪造重启握手。

`booking-priority` 使用独立软预订夹具，检查跨日重复出现的优先级影响、未知关系恢复及未排程地点的全局关系和空日期说明。它与普通、旧固定和历史来源场景各自使用新目录。

CI 默认使用无头桌面视口浏览器；runner 在各场景 `page-evidence` 按测试及关键状态保存 Playwright 页面截图、可见 DOM 文本、URL、视口和浏览器身份，标记只表示 `captured`。Terra 需独立审查截图、DOM、交互结果与最终 SQLite，采集本身不代表观察或接受。历史原生观察失败仍保留。原生窗口观察是显式可选专项：设置 `LANDI_BROWSER_HEADFUL=1 LANDI_NATIVE_OBSERVE=1`，关键状态在 `native-observe` 写入具名 `.ready`，观察者核验本次自有测试窗口后创建同名 `.observed`，脚本才继续；超时视为失败。不得自动创建确认文件冒充观察，页面截图不等于原生窗口截图。

在当前源码构建完成后，使用新的自有空目录和未被其他服务占用的本机端口启动普通预订关系夹具；`legacy-booking-sources` 为旧固定来源映射专项，必须使用另一自有空目录。同一目录重启时场景和端口保持不变，不使用 `--reset`：

```sh
/opt/homebrew/Cellar/node@24/24.22.1/bin/node tests/browser/isolated-workspace-server.mjs --data-dir <自有空目录> --port <自有端口> --scenario booking-relationships
```

在另一终端以相同端口、绝对证据输出目录运行专项：

```sh
LANDI_BOOKING_IMPACT_E2E=1 LANDI_BOOKING_SCENARIO=booking-relationships LANDI_TEST_SQLITE_PATH=<自有目录的workspace.sqlite绝对路径> LANDI_WORKSPACE_BASE_URL=http://127.0.0.1:<自有端口> LANDI_BROWSER_OUTPUT_DIR=<绝对证据目录> /opt/homebrew/Cellar/node@24/24.22.1/bin/node node_modules/@playwright/test/cli.js test --config tests/browser/booking-impact-isolated.config.ts --grep '真实界面从未知'
```

旧来源以 `--scenario legacy-booking-sources` 在另一空目录启动，将上述环境变量 `LANDI_BOOKING_SCENARIO` 改为 `legacy-booking-sources`，并将 `--grep` 改为 `旧固定来源逐预订`。每次使用独立证据输出目录。

关系保存丢响应测试另以新空目录启动 `booking-relationships`，环境仍设相同场景，`--grep` 改为 `关系保存响应丢失`。普通套件中的专项没有明确地址时会跳过，跳过不代表专项通过；`test:browser:ci` 后半段的隔离 runner 则分别执行七组并验证数量和结果。必须结合浏览器实际观察、事务和重启读回判断完整验收；模拟 API 的普通测试不能替代。
