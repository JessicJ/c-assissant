# Landi Design Documents

These documents describe the Landi project itself: the travel experience it provides, the system that supports it, and the path from planning to long-running travel assistance.

## Primary reading path

1. [Product Baseline](landi-product-baseline.md) — The product purpose, traveler experience, scope, and non-negotiable behavior.

2. [Long-Term Travel Assistant Roadmap](travel-assistant-development-roadmap.md) — The product capability path from conversational planning to long-running, cross-border travel assistance.

3. [System Architecture](architecture.md) — The runtime components, ownership boundaries, data flow, and deployment model.

4. [Core Data Model](core-data-model.md) — The persistent objects that represent the traveler, Plan, execution state, evidence, and future monitoring work.

5. [Travel Planning and Execution Flow](travel-planning-and-execution-flow.md) — The complete project flow from initial travel intent through monitoring, adjustment, in-trip assistance, and completion.

6. [Regional Capability Design: China V1](china-pack-v1.md) — The China-specific source-backed preparation workflow and its contribution to a Landi Plan.

7. [Regional Capability Design: Japan V1](japan-pack-v1.md) — The Japan-specific source-backed preparation workflow and Tokyo demonstration path.

8. [Blueprint Workspace Generation Requirements](blueprint-workspace-generation-requirements.md) — The next-generation modular travel blueprint and Web workspace presentation requirements.

## Contributor references

These contracts support implementation and extension work. They are not part of the primary product-design reading path.

- [Skill Contract](skill-contract.md)
- [Connector Contract](connector-contract.md)
- [Agent Runtime Adapter Contract](agent-runtime-adapter.md)

## Project records

These documents preserve earlier implementation decisions, release evidence, or interface detail. They are useful for maintenance but are not current top-level product design.

- [Legacy Web Workspace Notes](web-workspace.md)
- [Legacy Conversational Workspace Plan](conversational-plan-workspace.md)
- [V1 Release Checklist](v1-release-checklist.md)
- [Decisions and Open Items](decisions-and-open-items.md)

## Source-of-truth rule

When documents disagree:

1. the Product Baseline defines product behavior and scope;
2. the Core Data Model and System Architecture define current structural boundaries;
3. the Roadmap describes intended future development, not already shipped behavior;
4. contributor contracts define extension and integration rules;
5. project records provide history only.

Implementation drift must be resolved explicitly. Existing code behavior does not silently become a new product decision.
