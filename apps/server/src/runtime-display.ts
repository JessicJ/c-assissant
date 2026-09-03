import type { RuntimeKind } from "@c-assistant/agent-adapters";

export function runtimeName(kind: RuntimeKind): string {
  return kind === "claude-code" ? "Claude Code" : "Codex";
}
