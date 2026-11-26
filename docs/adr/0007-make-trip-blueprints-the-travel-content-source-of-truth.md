# Make Trip Blueprints the travel-content source of truth

地点优先级、日程位置、顺序、Tip 与独立准备项状态的确认修改，以及保存后直接编辑撤销，都经新 Blueprint 版本表达。Storage 在同一事务保存规范版本、编译替代草稿、lineage 与修订审计，不独立修改 Plan 的旅行内容副本。具体状态与版本语义由 `../blueprint-workspace-generation-requirements.md` 统一定义。

## Consequences

The Web workspace sends Blueprint revisions rather than direct Plan-presentation mutations. Existing execution continues from the approved Execution Plan until the traveler approves the newly compiled replacement.
