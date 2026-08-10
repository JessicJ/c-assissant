# China official-source registry

This registry is the approved starting-point allowlist for regulated China Country Pack research. It contains official authority home pages and permitted domains, not policy conclusions.

The `OfficialSourceConnector` may fetch a URL only when it is HTTPS and remains inside the matching entry's `allowedDomains`. A retrieved page must become a timestamped snapshot with its original title, canonical URL, content hash, and bounded excerpt before a regulated Skill can use it.

The policy-applicability Skill must fail closed when it lacks a current, directly relevant snapshot. It may not turn a registry entry, a domain match, or model memory into a visa, residence, legal, banking, or medical conclusion.

The registry starts with national immigration and State Council entry points. It also contains reviewed, capability-specific pages for the first digital-life catalog: the State Council's English working-and-living guide, China Mobile's bilingual foreign-customer SIM guide, Amap's official mobile download page, and WeChat's official English download page. Local exit-entry, city, embassy, education, tax, banking, health, and business sources are added only after their authority, language, relevant scope, and URL stability are reviewed.

`digital-life-catalog.json` contains bounded English setup steps and preserved Chinese product names, but it is not evidence by itself. Runtime joins each item to the newest matching immutable snapshot; missing or stale snapshots remain unresolved in `digital-life-setup`. Page excerpts, passwords, verification codes, payment credentials, and account state never enter this catalog.

`local-food-catalog.json` is city-scoped and follows the same evidence rule. The first entries cover Shanghai, Beijing, and Guangzhou with five bilingual references per city from their respective official English city portals. A city alias match and a current immutable snapshot are both required; otherwise `local-food-guide` degrades without inventing local specialties. The catalog never selects a restaurant or claims availability.
