# Agent Adapters

Common boundary for local Agent runtimes.

The first implementation is `CodexRuntimeAdapter`:

- checks that Codex CLI is installed and logged in;
- runs `codex exec` in an isolated temporary directory;
- uses a JSON Schema for the final Plan draft;
- passes only the explicit request plus confirmed Profile language and nationality;
- strips C-assistant Connector secrets from the child environment;
- returns a validated draft to Core, which creates and stores the Plan.

Claude Code remains a planned implementation of the same boundary. The Adapter does not keep an Agent process alive, schedule reminders, access SQLite, or deliver messages.
