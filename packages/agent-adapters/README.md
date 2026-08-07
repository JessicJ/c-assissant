# Agent Adapters

Common boundary for local Agent runtimes.

Implemented local adapters are `CodexRuntimeAdapter` and `ClaudeCodeRuntimeAdapter`:

- check that the respective CLI is installed and logged in;
- run one bounded invocation in an isolated temporary directory;
- validate every final Plan draft against the same Landi contract;
- pass only the explicit request plus confirmed Profile planning context;
- strips Landi Connector secrets from the child environment;
- returns a validated draft to Core, which creates and stores the Plan.

Codex uses its JSON Schema output option. Claude Code uses Print mode with JSON wrapping, disables built-in tools and MCP configuration, then validates the returned `result` against the same Plan contract. The Adapter does not keep an Agent process alive, schedule reminders, access SQLite, or deliver messages. The Web workspace selects one runtime per instance and Core uses that choice for Web and Telegram Plan drafts.

The Claude Code Adapter has a simulated CLI integration test that verifies the installed/login checks, no-tools Print-mode arguments, temporary-directory cleanup, contract validation, and Connector-secret stripping without invoking a real Claude account. A real logged-in account still needs one deliberate end-to-end validation before Claude Code is declared supported for V1.
