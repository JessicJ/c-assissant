# Japan source policy

`official-source-registry.json` is the Japan Pack's HTTPS allowlist. Each entry records a stable `jp-` source ID, authority, original title, canonical URL, capability topics, language, and refresh interval in hours.

The registry and `reference-catalog.json` are not evidence. Runtime joins catalog items to immutable Plan-linked snapshots with snapshot ID, retrieval time, canonical URL, authority, and SHA-256 content hash. Policy evidence has a seven-day Skill freshness ceiling; catalog guidance has a thirty-day ceiling.

The connector rejects non-HTTPS pages, domains and redirects outside the matching entry, unknown IDs, and China Pack IDs. It retains only a bounded excerpt in storage and passes no full page text to Skills.
