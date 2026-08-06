import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GeneratedPlanDraft } from "@c-assistant/core";

export interface RuntimeCheck {
  kind: "codex";
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
  };
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
        planDraftPrompt(input)
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
                dueLabel: { type: "string", minLength: 1, maxLength: 160 }
              }
            }
          }
        }
      }
    }
  }
} as const;

function planDraftPrompt(input: CodexPlanRequest): string {
  return `You create a complete first-draft C-assistant Plan for a foreigner adapting to China. Return only data that matches the requested JSON Schema.

User request: ${input.request.trim()}
Confirmed Profile fields:
- preferred language: ${input.profile.preferredLanguage}
- nationality: ${input.profile.nationality}

Rules:
- Use English because the end user reads English.
- Make a useful but conservative Plan with 2-4 stages.
- Place every unknown that could materially change execution in assumptions; do not invent visa, policy, booking, location, dates, prices, or provider availability.
- Do not claim a policy requirement or cite an unofficial source. Official-source research happens in another Skill.
- Include user-owned Tasks for real-world choices and external-owned Tasks for actions inside another application.
- Do not say that C-assistant has booked, paid, hailed a ride, or completed any action.
- The Plan must be readable as a complete draft before a user confirms it.`;
}

function isPlanDraft(value: unknown): value is GeneratedPlanDraft {
  if (!isRecord(value) || !isString(value.title) || !isString(value.location) || !isString(value.dates) || !isString(value.nextAction) || !isStringArray(value.knownInformation) || !isStringArray(value.assumptions) || !Array.isArray(value.stages) || value.stages.length === 0) return false;
  return value.stages.every((stage) => isRecord(stage) && isString(stage.title) && isString(stage.description) && Array.isArray(stage.tasks) && stage.tasks.length > 0 && stage.tasks.every((task) => isRecord(task) && isString(task.title) && isString(task.dueLabel) && (task.owner === "assistant" || task.owner === "user" || task.owner === "external")));
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
  return Object.fromEntries(Object.entries(environment).filter(([key]) => !/(?:AMAP_API_KEY|TELEGRAM_BOT_TOKEN|OPENAI_API_KEY|CODEX_API_KEY|CODEX_ACCESS_TOKEN)$/i.test(key)));
}

function runProcess(command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}): Promise<{ code: number; stdout: string; stderr: string }> {
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
}
