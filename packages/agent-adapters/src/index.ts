import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GeneratedPlanDraft, ImmigrationStatus, ProfileGender } from "@c-assistant/core";

export type RuntimeKind = "codex" | "claude-code";

export interface RuntimeCheck {
  kind: RuntimeKind;
  installed: boolean;
  authenticated: boolean;
  version?: string | undefined;
  message?: string | undefined;
}

export interface CodexPlanRequest {
  request: string;
  profile: {
    preferredLanguage: string;
    nationality: string;
    gender: ProfileGender;
    immigrationStatus: ImmigrationStatus;
  };
}

export type ClaudeCodePlanRequest = CodexPlanRequest;

export interface RuntimeProcessResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type RuntimeProcess = (command: string, args: string[], options?: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number }) => Promise<RuntimeProcessResult>;

export interface ClaudeCodeRuntimeAdapterOptions {
  /** Test seam only; production uses the local Claude Code executable. */
  run?: RuntimeProcess;
  /** Test seam only; production uses the current process environment. */
  environment?: NodeJS.ProcessEnv;
}

export class CodexRuntimeAdapter {
  async check(): Promise<RuntimeCheck> {
    const version = await runProcess("codex", ["--version"]);
    if (version.code !== 0) return { kind: "codex", installed: false, authenticated: false, message: "Codex CLI is not available on this machine." };

    const login = await runProcess("codex", ["login", "status"]);
    return {
      kind: "codex",
      installed: true,
      authenticated: login.code === 0,
      version: version.stdout.trim() || undefined,
      ...(login.code === 0 ? {} : { message: "Codex is installed but needs login before it can generate a Plan." })
    };
  }

  async generatePlanDraft(input: CodexPlanRequest): Promise<GeneratedPlanDraft> {
    if (!input.request.trim()) throw new RuntimeAdapterError("invalid_request", "Describe what you need before asking Codex to create a Plan.");
    const health = await this.check();
    if (!health.installed) throw new RuntimeAdapterError("not_installed", health.message ?? "Codex CLI is not available.");
    if (!health.authenticated) throw new RuntimeAdapterError("not_authenticated", health.message ?? "Codex login is required.");

    const runDirectory = await mkdtemp(join(tmpdir(), "c-assistant-codex-"));
    const schemaPath = join(runDirectory, "plan-draft.schema.json");
    const outputPath = join(runDirectory, "plan-draft.json");
    try {
      await writeFile(schemaPath, JSON.stringify(planDraftSchema), "utf8");
      const command = await runProcess("codex", [
        "exec",
        "--ephemeral",
        "--ignore-user-config",
        "--skip-git-repo-check",
        "--sandbox",
        "read-only",
        "--output-schema",
        schemaPath,
        "--output-last-message",
        outputPath,
        buildPlanDraftPrompt(input)
      ], { cwd: runDirectory, env: scrubbedEnvironment(process.env), timeoutMs: 120_000 });
      if (command.code !== 0) throw new RuntimeAdapterError("run_failed", "Codex could not generate a Plan draft right now.");

      const output = await readFile(outputPath, "utf8");
      return parsePlanDraft(output);
    } catch (error) {
      if (error instanceof RuntimeAdapterError) throw error;
      throw new RuntimeAdapterError("run_failed", "Codex could not generate a Plan draft right now.");
    } finally {
      await rm(runDirectory, { recursive: true, force: true });
    }
  }
}

/**
 * Executes one bounded Claude Code Print-mode run. Claude Code is deliberately
 * given no built-in tools or MCP configuration, so it only receives the prompt
 * and returns a structured Plan draft through stdout.
 */
export class ClaudeCodeRuntimeAdapter {
  private readonly run: RuntimeProcess;
  private readonly environment: NodeJS.ProcessEnv;

  constructor(options: ClaudeCodeRuntimeAdapterOptions = {}) {
    this.run = options.run ?? runProcess;
    this.environment = options.environment ?? process.env;
  }

  async check(): Promise<RuntimeCheck> {
    const version = await this.run("claude", ["--version"]);
    if (version.code !== 0) return { kind: "claude-code", installed: false, authenticated: false, message: "Claude Code CLI is not available on this machine." };

    const login = await this.run("claude", ["auth", "status"]);
    return {
      kind: "claude-code",
      installed: true,
      authenticated: login.code === 0,
      version: version.stdout.trim() || undefined,
      ...(login.code === 0 ? {} : { message: "Claude Code is installed but needs login before it can generate a Plan." })
    };
  }

  async generatePlanDraft(input: ClaudeCodePlanRequest): Promise<GeneratedPlanDraft> {
    if (!input.request.trim()) throw new RuntimeAdapterError("invalid_request", "Describe what you need before asking Claude Code to create a Plan.");
    const health = await this.check();
    if (!health.installed) throw new RuntimeAdapterError("not_installed", health.message ?? "Claude Code CLI is not available.");
    if (!health.authenticated) throw new RuntimeAdapterError("not_authenticated", health.message ?? "Claude Code login is required.");

    const runDirectory = await mkdtemp(join(tmpdir(), "c-assistant-claude-"));
    try {
      const command = await this.run("claude", [
        "-p",
        "--output-format",
        "json",
        "--max-turns",
        "1",
        "--tools",
        "",
        "--strict-mcp-config",
        buildPlanDraftPrompt(input)
      ], { cwd: runDirectory, env: scrubbedEnvironment(this.environment), timeoutMs: 120_000 });
      if (command.code !== 0) throw new RuntimeAdapterError("run_failed", "Claude Code could not generate a Plan draft right now.");

      return parsePlanDraft(parseClaudePrintResult(command.stdout));
    } catch (error) {
      if (error instanceof RuntimeAdapterError) throw error;
      throw new RuntimeAdapterError("run_failed", "Claude Code could not generate a Plan draft right now.");
    } finally {
      await rm(runDirectory, { recursive: true, force: true });
    }
  }
}

export class RuntimeAdapterError extends Error {
  constructor(readonly code: "invalid_request" | "not_installed" | "not_authenticated" | "run_failed" | "invalid_output", message: string) {
    super(message);
  }
}

export function parsePlanDraft(value: string): GeneratedPlanDraft {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new RuntimeAdapterError("invalid_output", "Codex returned a Plan draft in an unexpected format.");
  }
  if (!isPlanDraft(parsed)) throw new RuntimeAdapterError("invalid_output", "Codex returned a Plan draft that does not match C-assistant's contract.");
  return parsed;
}

export function parseClaudePrintResult(value: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new RuntimeAdapterError("invalid_output", "Claude Code returned an invalid Print-mode response.");
  }
  if (!isRecord(parsed) || !isString(parsed.result)) {
    throw new RuntimeAdapterError("invalid_output", "Claude Code did not return a Plan draft result.");
  }
  return parsed.result;
}

const planDraftSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "location", "dates", "knownInformation", "assumptions", "nextAction", "stages"],
  properties: {
    title: { type: "string", minLength: 1, maxLength: 120 },
    location: { type: "string", minLength: 1, maxLength: 120 },
    dates: { type: "string", minLength: 1, maxLength: 120 },
    knownInformation: { type: "array", minItems: 1, maxItems: 8, items: { type: "string", minLength: 1, maxLength: 300 } },
    assumptions: { type: "array", maxItems: 8, items: { type: "string", minLength: 1, maxLength: 300 } },
    nextAction: { type: "string", minLength: 1, maxLength: 300 },
    stages: {
      type: "array",
      minItems: 1,
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "description", "tasks"],
        properties: {
          title: { type: "string", minLength: 1, maxLength: 120 },
          description: { type: "string", minLength: 1, maxLength: 300 },
          tasks: {
            type: "array",
            minItems: 1,
            maxItems: 8,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["title", "owner", "dueLabel"],
              properties: {
                title: { type: "string", minLength: 1, maxLength: 200 },
                owner: { type: "string", enum: ["assistant", "user", "external"] },
                dueLabel: { type: "string", minLength: 1, maxLength: 160 },
                activationTrigger: { type: "string", enum: ["arrival"] },
                reminder: {
                  type: "object",
                  additionalProperties: false,
                  required: ["scheduledAtLocal", "timeZone", "purpose", "refreshFacts"],
                  properties: {
                    scheduledAtLocal: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}$" },
                    timeZone: { type: "string", minLength: 3, maxLength: 80 },
                    purpose: { type: "string", minLength: 1, maxLength: 500 },
                    refreshFacts: { type: "array", maxItems: 1, uniqueItems: true, items: { type: "string", enum: ["weather"] } }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
} as const;

export function buildPlanDraftPrompt(input: CodexPlanRequest): string {
  return `You create a complete first-draft C-assistant Plan for a foreigner adapting to China. Return only data that matches the requested JSON Schema.

User request: ${input.request.trim()}
Confirmed Profile fields:
- preferred language: ${input.profile.preferredLanguage}
- nationality: ${input.profile.nationality}
- gender: ${input.profile.gender}
- China entry or residence status: ${input.profile.immigrationStatus}

Rules:
- Use English because the end user reads English.
- Make a useful but conservative Plan with 2-4 stages.
- Place every unknown that could materially change execution in assumptions; do not invent visa, policy, booking, location, dates, prices, or provider availability.
- Treat Profile identity fields as user-provided planning context, not as proof of a policy entitlement or requirement.
- Do not claim a policy requirement or cite an unofficial source. Official-source research happens in another Skill.
- Include user-owned Tasks for real-world choices and external-owned Tasks for actions inside another application.
- When one task is specifically intended to begin at the expected arrival time, set its activationTrigger to "arrival". Do not add that marker to any other task.
- Add a reminder only when the user supplied enough facts for a concrete local date, time, and IANA time zone, or when that moment follows safely from an explicit dated event. Never invent a date, time, or departure time zone. Use YYYY-MM-DDTHH:mm and a short English purpose that explains why the reminder should run; do not freeze final notification copy.
- Every reminder must include refreshFacts. Use ["weather"] only when current destination weather can materially change this Task's immediate packing, departure, outdoor, or transport decision. Use [] for documents, apps, payments, policy checks, and all other Tasks. Do not infer or request unsupported dynamic facts.
- A reminder in the draft is only a proposal. It will not run until the user reviews and confirms the complete Plan.
- Do not say that C-assistant has booked, paid, hailed a ride, or completed any action.
- The Plan must be readable as a complete draft before a user confirms it.`;
}

function isPlanDraft(value: unknown): value is GeneratedPlanDraft {
  if (!isRecord(value) || !isString(value.title) || !isString(value.location) || !isString(value.dates) || !isString(value.nextAction) || !isStringArray(value.knownInformation) || !isStringArray(value.assumptions) || !Array.isArray(value.stages) || value.stages.length === 0) return false;
  return value.stages.every((stage) => isRecord(stage) && isString(stage.title) && isString(stage.description) && Array.isArray(stage.tasks) && stage.tasks.length > 0 && stage.tasks.every((task) => isRecord(task) && isString(task.title) && isString(task.dueLabel) && (task.owner === "assistant" || task.owner === "user" || task.owner === "external") && (task.activationTrigger === undefined || task.activationTrigger === "arrival") && (task.reminder === undefined || isTaskReminder(task.reminder))));
}

function isTaskReminder(value: unknown): boolean {
  return isRecord(value)
    && typeof value.scheduledAtLocal === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value.scheduledAtLocal)
    && Number.isFinite(Date.parse(`${value.scheduledAtLocal}:00Z`))
    && typeof value.timeZone === "string"
    && isIanaTimeZone(value.timeZone)
    && isString(value.purpose)
    && value.purpose.length <= 500
    && Array.isArray(value.refreshFacts)
    && value.refreshFacts.length <= 1
    && value.refreshFacts.every((fact) => fact === "weather");
}

function isIanaTimeZone(value: string): boolean {
  if (!/^[A-Za-z_]+(?:\/[A-Za-z_+-]+)+$/.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

function scrubbedEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(environment).filter(([key]) => !/(?:AMAP_API_KEY|QWEATHER_API_KEY|TELEGRAM_BOT_TOKEN|OPENAI_API_KEY|CODEX_API_KEY|CODEX_ACCESS_TOKEN|ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|CLAUDE_CODE_OAUTH_TOKEN)$/i.test(key)));
}

const runProcess: RuntimeProcess = (command, args, options = {}) => {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = options.timeoutMs ? setTimeout(() => child.kill("SIGTERM"), options.timeoutMs) : undefined;
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", () => resolve({ code: 1, stdout, stderr }));
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
};
