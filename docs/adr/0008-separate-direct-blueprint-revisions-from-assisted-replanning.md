# Separate direct Blueprint revisions from assisted replanning

Landi applies precise workspace operations such as priority, day-assignment, and ordering changes as deterministic Direct Blueprint Revisions. It invokes the travel-planning Skill only for Assisted Replanning requests that require judgment, preventing simple edits from incurring Agent latency or introducing unrelated itinerary changes.

## Consequences

一次明确确认的直接修订批次只产生一个新 Blueprint 版本；来源区分确定性操作与 Skill 辅助修改。保存后撤销是绑定原修订与精确当前版本的新修订，不复活旧版本、不撤销已批准执行 Plan。must 删除先展示精确影响，预订、预约及固定约束继续走辅助重规划；详情遵循 `../blueprint-workspace-generation-requirements.md`。直接修订测试断言精确变化及原子性，辅助重规划证明保留无关内容。
