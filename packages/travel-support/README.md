# Landi travel support

Internal travel functions for nearby food, lodging comparisons, route/transport suggestions and weather/packing advice. Inputs are provider-normalized facts; results do not mutate Plans or send messages. The implementation is extracted from the former country bundles without changing these travel rules.

`data/china/official-source-registry.json` 与 `data/japan/official-source-registry.json` 是现役的普通官方来源注册表，保留既有来源 ID；它们是旅行事实数据，不是可安装的国家产品或功能注册表。参考目录及其读取器、测试已退役，原始内容以摘要索引的惰性历史档案保存在 `scripts/historical/travel-catalogs/`，不进入包导出或运行时调用链。没有国家包 manifest、动态 Skill 注册表或目的地专属规划器；未知目的地仅表示已审阅官方来源覆盖不足。

包的唯一导出入口 `.` 提供共享旅行函数，不再导出两个参考目录读取器。包物料声明包含 `lib/` 与 `data/`；Server 经安装包入口定位上述两个官方来源注册表，不读取退役参考目录。来源刷新、快照与研究候选的责任和未验证限制由 [Connector 合同](../../docs/connector-contract.md#目的地研究能力与差距t4-1-design) 统一定义；物料声明本身不证明安装包运行已验收。
