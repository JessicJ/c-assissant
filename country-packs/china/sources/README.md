# China official-source registry

This registry is the approved starting-point allowlist for regulated China Country Pack research. It contains official authority home pages and permitted domains, not policy conclusions.

The `OfficialSourceConnector` may fetch a URL only when it is HTTPS and remains inside the matching entry's `allowedDomains`. A retrieved page must become a timestamped snapshot with its original title, canonical URL, content hash, and bounded excerpt before a regulated Skill can use it.

The policy-applicability Skill must fail closed when it lacks a current, directly relevant snapshot. It may not turn a registry entry, a domain match, or model memory into a visa, residence, legal, banking, or medical conclusion.

The initial list intentionally contains two English-language, national-level starting points. Local exit-entry, city, embassy, education, tax, banking, health, and business sources are added only after their authority, language, relevant scope, and URL stability are reviewed.
