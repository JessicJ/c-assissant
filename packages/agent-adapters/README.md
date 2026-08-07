# Agent Adapters

Common boundary for local Agent runtimes.

Implemented local adapters are `CodexRuntimeAdapter` and `ClaudeCodeRuntimeAdapter`:

- check that the respective CLI is installed and logged in;
- run one bounded invocation in an isolated temporary directory;
- validate every final Plan draft against the same C-assistant contract;
- pass only the explicit request plus confirmed Profile planning context;
- strips C-assistant Connector secrets from the child environment;
- returns a validated draft to Core, which creates and stores the Plan.

Codex uses its JSON Schema output option. Claude Code uses Print mode with JSON wrapping, disables built-in tools and MCP configuration, then validates the returned `result` against the same Plan contract. The Adapter does not keep an Agent process alive, schedule reminders, access SQLite, or deliver messages. Runtime selection in the Web workspace is the next implementation step.
