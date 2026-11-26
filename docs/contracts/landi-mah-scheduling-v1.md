# MAH 业务调度合同 v1（待公开接口对接）

MAH 拥有定时与执行，选择其配置的 Agent；Landi 提供旅行规则、校验、数据和受限业务执行能力。本合同不创建调度、不连接 CLI、不改表结构、不停用现有定时器。字段为 Landi 的拟议合同，不能直接作为 MAH 参数。Schema：`landi-mah-scheduling.v1.schema.json`。

## 最小身份与策略

- 定义身份：稳定 scheduleId、单调 revision、计划 ID/版本、收件配置修订。更新需比较旧 revision；同一注册请求重试复用身份，响应未明先查询，不重新创建。
- 触发：interval/cron/once，IANA 时区、validFrom、expiresAt。过期不执行；漏触发只合并为最新仍有效的一次，不补发历史邮件。夏令时跳过不存在时间，重复时刻只执行一次。当前 MAH 是否支持这些策略待核实，不能静默替换为默认行为。
- 每次运行：scheduleId + scheduleRevision + occurrenceId 唯一关联 requestId、原定时刻、期限及业务 scope。同一 occurrence 的重试复用原请求和业务时间；不能用每次重试的当前时间生成新身份。执行前验证 validFrom <= scheduledFor < expiresAt，当前时间未过期，运行期限不超出定义期限。
- 重叠：同一业务 scope/operation 不并发；暂停/退役后禁止新触发。公开 stop 对在途实例的含义必须明确，在途结果导入及发送前仍核实最新计划/配置版本；不能仅靠停止命令防止迟到结果。
- 结果：权威公开回执关联 request/task/结果摘要，禁止从 Agent 文本推断执行事实。成功 Schema 只要求回执结构存在，真实性、请求摘要、结果摘要和版本比较由未来适配器验证。queued/running 不代表物化成功，uncertain 不自动重提。

## 研究与发送分权

travel_attention、email_research、email_timing 只允许 artifact_only。AI 请求沿用 `landi-mah-business-v1.md` 的身份、MAH 选 Agent 和结果校验合同；调度本身不提升权限。

email_delivery 是独立的 approved_email_delivery 操作，必须由已激活计划、用户启用且已验证的邮件配置授权。Schema 字段不构成授权。执行前复用 Landi 已有的版本核对、租约、防重复发送及过期检查；SMTP 凭据不进入调度或 Agent 请求。发送已开始但回执未明时标为 uncertain，只核对，禁止自动再发。保留原有邮件模板、历史记录和用户数据。

## 公共接口验收与切换

需公开证明：幂等注册/版本更新、精确查询、触发实例与 task/result 关联、重叠和漏触发策略、时区/DST、停止在途语义、MAH 重启后的定义与实例恢复、可信物化/执行/工件回执及作用域受限执行。

现有 `task schedule` 命令存在仅证明入口，尚不满足这些全部要求。原生产开关关闭。未来接通后，逐 scope 确认 MAH 所有权再关闭本地触发，保证单一调度者；不能直接添加 MAH 调度与旧定时器并行。计划确认后的立即监测也必须迁移。表结构/持久化设计、真实切换及运行时验收另行实施。

新增离线验收只验证虚构样例的严格字段、权限分离、成功回执约束；不调用 MAH、不发送邮件、不访问业务数据库。跨记录一致性、真实 DST、恢复及发送幂等仍需后续独立验收。
