# Agent Runtime Adapter

C-assistant may run on either Codex or Claude Code. Core treats them as replaceable execution runtimes behind one contract.

## Ownership boundary

Core owns:

- Profile and Plan memory;
- scheduling, event processing, and retries;
- permission and confirmation checks;
- Connector credentials;
- persistence and audit records;
- delivery to Telegram and Web.

The selected Agent runtime owns one bounded reasoning run. It does not stay alive as C-assistant's memory, scheduler, gateway, or notification service.

## Adapter contract

```ts
interface AgentRuntimeAdapter {
  kind: "codex" | "claude-code";
  checkInstalled(): Promise<RuntimeCheck>;
  checkAuthenticated(): Promise<RuntimeCheck>;
  capabilities(): Promise<RuntimeCapabilities>;
  run(request: AgentRunRequest): Promise<AgentRunResult>;
  cancel(runId: string): Promise<void>;
}

interface AgentRunRequest {
  run_id: string;
  purpose: string;
  instructions: string;
  context: unknown;
  output_schema: unknown;
  allowed_tools: string[];
  deadline_at?: string;
}
```

All outputs must pass the declared schema. Core may ask the same runtime for one format repair. A second invalid result ends the Run as failed.

## Runtime isolation

Every Run starts from an explicit context package. The runtime must not be trusted to remember a previous conversation. The package contains only the Profile and Plan fields declared by the relevant Skill contract.

The Agent can call only a local C-assistant MCP Tool Gateway with an allowlist for that Run. It cannot access:

- the raw SQLite database;
- Telegram bot tokens;
- Amap credentials;
- arbitrary local files;
- message-delivery methods unless Core explicitly exposes a narrow capability.

## Login and selection

Setup in the Web workspace should:

1. detect installed runtimes;
2. let the user select Codex or Claude Code;
3. guide the user through that runtime's official login flow;
4. verify authentication with a harmless check;
5. save only the selected runtime type; health is checked live and is not treated as a credential record.

C-assistant does not collect or store the user's Codex or Claude Code credentials. The current Web workspace detects both CLIs, lets the user select one, and reports its live availability; users complete the runtime's own official login flow outside C-assistant. One runtime is active per instance. If it fails, Core reports the failure and does not silently switch accounts or runtimes.

Implementation references:

- Codex supports non-interactive runs and structured output with `codex exec --output-schema`: [Codex developer commands](https://learn.chatgpt.com/docs/developer-commands#codex-exec)
- Codex login and headless-device authentication: [Codex login](https://learn.chatgpt.com/docs/developer-commands#codex-login) and [authentication](https://learn.chatgpt.com/docs/auth#login-on-headless-devices)
- Claude Code supports non-interactive `claude -p`, JSON output, and a non-destructive `claude auth status` login check: [Claude Code CLI usage](https://code.claude.com/docs/en/cli-usage)
- Claude Code setup: [Claude Code getting started](https://docs.anthropic.com/en/docs/claude-code/getting-started)

The Codex adapter has a real structured-output proof of concept. The Claude Code adapter now has the same bounded local implementation and contract tests, but still needs a real logged-in end-to-end validation before Claude Code is declared supported for V1.

## Scheduling and concurrency

V1 executes one Agent Run at a time. Core queues work by priority:

1. critical planned event;
2. direct user request;
3. normal reminder;
4. background source refresh.

Critical deterministic operations should not require an Agent Run when Core can execute them safely from validated data.

## Health and lifecycle

Startup diagnostics check:

- executable presence and supported version range;
- authentication state;
- Tool Gateway reachability;
- a minimal structured-output Run;
- writable local storage and scheduler health.

Runtime upgrades are never automatic in V1. The Web workspace tells the user when an installed version is unsupported and links to the official update path.

## Run audit

The current Plan-generation Run record stores the runtime kind, trigger surface, start/finish time, outcome, resulting Plan id when applicable, and a sanitized failure classification. It intentionally stores no prompt, tool result, raw model output, account state, or credential. Future broader Runs may add purpose, Skill version, minimized input/output hashes, and allowed-tool metadata only after a clear retention policy exists.

The shared Plan draft schema also permits an optional Task reminder proposal. It must contain an exact local `YYYY-MM-DDTHH:mm` value, an IANA time zone, and a short purpose. The prompt forbids inventing missing dates or departure time zones. A proposal remains inert until the complete Plan is reviewed and confirmed, and scheduling is a separate Core responsibility.
