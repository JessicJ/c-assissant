# MAH 服务生命周期合同 v1（待公开接口对接）

MAH 管理 Landi 服务期望状态、启停监督和恢复；服务动作通过现有唯一规范启动器执行。业务定时与执行另按 `landi-mah-scheduling-v1.md`，服务 ready 不代表业务调度成功。

本次保留 `landi-mah-background-runtime.schema.json` 原有投影合同与历史证据，不改其版本或字段。新增 `landi-mah-service-lifecycle.v1.schema.json` 定义待对接的动作和回执，不声称 MAH 已支持这些参数。旧投影描述中的 0.1.1968 是历史基线；最新只读核实为 0.1.2008，服务公共缺口仍待核实。

## 动作与回执

动作绑定 requestId、serviceId=landi、规范 projectRoot、componentId、启动器合同版本、expectedRevision 和 desiredState。支持 register/start/stop/reconcile/unregister。stop/unregister 必须 desiredState=stopped；start 必须 running。注册默认应选 stopped，未得到明确启动授权不得启动。

同一动作重试复用原 requestId 和完整请求摘要。MAH 必须以 expectedRevision 比较更新并返回单调 revision；陈旧请求拒绝。回执绑定请求摘要、transitionId、期望状态变化及公开投影摘要。accepted 只表示接收，unknown 只允许只读核对，不能推断完成或重复执行。completed 必须有已验证所有权及投影摘要；适配器还必须验证请求/回执/投影对应、项目根、组件、版本、观察时刻和实际动作结果。JSON 结构不能证明真实所有权。

start/reconcile：仅复用完整身份匹配的实例；新实例需唯一启动器的启动回执、进程启动身份和健康证明。端口监听或 PID 存活不足以认领。身份冲突进入 degraded，禁止自动 kill 或重启其他进程。

stop：先持久化 stopped，再按所有权安全停止；完成时现有投影必须 observedState=stopped、instance=null。不得恢复后复活。unregister 先完成安全停止，再解除注册，不能删除用户目录、数据库、业务调度历史或原任务。其最终回执应保留停止投影及注销事实，需公共接口可读回。

## 持续运行与恢复

MAH 持久化注册和期望状态，公开 restartCount、退避、lastExit、reconcileGeneration、最后恢复时间与可核验的重启恢复证据。崩溃按有界退避恢复；MAH/主机重启后先核对实例身份再复用或启动。明确 stopped 时绝不自动启动；未知状态先查证。用户数据保持包外持久化。

`project runtime register`、Project Entry、长期 Task 或定期运行启动命令不能代替服务监督。不得新增守护脚本、第二启动器或直连 Agent 兜底。

## 当前边界与验收

生产开关保持关闭；不调用服务动作、不启停进程、不改启动器和现有业务定时器。新增离线检查验证严格字段、start/stop 期望状态约束、completed 回执要求及原投影的 ready/ownership 约束。

真实接入前还需公开验证：幂等启停、陈旧 revision 拒绝、重复动作回执一致、启动/停止后状态读回、身份冲突、崩溃退避、MAH/主机重启恢复及 stopped 不复活。未完成这些验证，不宣称 MAH 已托管 Landi。
