import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  confirmPlan,
  createInitialWorkspace,
  createPlanFromDraft,
  createPlanFromRequest,
  createDefaultPlanConfiguration,
  type CreatePlanInput,
  type GeneratedPlanDraft,
  type InboxItem,
  type Plan,
  type PlanAccommodationInput,
  type PlanConfiguration,
  type ProfileUpdate,
  type SourceReference,
  type Stage,
  type Task,
  type WorkspaceSnapshot
} from "@c-assistant/core";

interface ProfileRow {
  display_name: string;
  preferred_language: string;
  nationality: string;
  status: "incomplete" | "ready";
}

interface PlanRow {
  id: string;
  version: number;
  title: string;
  location: string;
  dates: string;
  status: Plan["status"];
  known_information_json: string;
  assumptions_json: string;
  next_action: string;
  configuration_json: string;
  sources_json: string;
  created_at: string;
}

interface StageRow {
  id: string;
  title: string;
  description: string;
}

interface TaskRow {
  id: string;
  title: string;
  owner: Task["owner"];
  status: Task["status"];
  due_label: string;
}

interface InboxRow {
  id: string;
  tone: InboxItem["tone"];
  title: string;
  body: string;
  timestamp: string;
}

export class SqliteWorkspaceStore {
  private readonly database: DatabaseSync;

  constructor(databasePath: string) {
    if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new DatabaseSync(databasePath);
    this.database.exec("PRAGMA foreign_keys = ON;");
    this.migrate();
    this.seedIfEmpty();
  }

  close(): void {
    this.database.close();
  }

  getWorkspace(): WorkspaceSnapshot {
    const profile = this.database.prepare("SELECT display_name, preferred_language, nationality, status FROM profiles WHERE id = 1").get() as ProfileRow | undefined;
    const activePlan = this.getCurrentPlan();
    if (!profile || !activePlan) throw new Error("The local workspace is not initialized.");

    return {
      profile: {
        displayName: profile.display_name,
        preferredLanguage: profile.preferred_language,
        nationality: profile.nationality,
        status: profile.status
      },
      activePlan,
      inbox: (this.database.prepare("SELECT id, tone, title, body, timestamp FROM inbox_items ORDER BY created_at DESC, rowid DESC").all() as unknown as InboxRow[]).map((row) => ({
        id: row.id,
        tone: row.tone,
        title: row.title,
        body: row.body,
        timestamp: row.timestamp
      })),
      system: {
        core: "ready",
        storage: "local",
        runtime: "not_configured",
        telegram: "not_configured",
        amap: "not_configured"
      }
    };
  }

  createPlan(input: CreatePlanInput): WorkspaceSnapshot {
    const plan = createPlanFromRequest(input);
    this.savePlan(plan);
    this.addInbox({
      id: `plan-created-${plan.id}`,
      tone: "notice",
      title: "New Plan saved locally",
      body: "Review its assumptions, then confirm it when the details are correct.",
      timestamp: "Just now"
    });
    return this.getWorkspace();
  }

  createGeneratedPlan(draft: GeneratedPlanDraft): WorkspaceSnapshot {
    const plan = createPlanFromDraft(draft);
    this.savePlan(plan);
    this.addInbox({
      id: `plan-generated-${plan.id}`,
      tone: "notice",
      title: "Codex Plan draft saved locally",
      body: "Review the generated assumptions and the complete Plan before activation.",
      timestamp: "Just now"
    });
    return this.getWorkspace();
  }

  confirmPlan(planId: string): WorkspaceSnapshot {
    const workspace = this.getWorkspace();
    const confirmed = confirmPlan(workspace, planId);
    this.database.prepare("UPDATE plans SET status = ?, next_action = ? WHERE id = ?").run(
      confirmed.activePlan.status,
      confirmed.activePlan.nextAction,
      planId
    );
    this.addInbox(confirmed.inbox[0]!);
    return this.getWorkspace();
  }

  updateProfile(input: ProfileUpdate): WorkspaceSnapshot {
    const displayName = input.displayName.trim();
    const preferredLanguage = input.preferredLanguage.trim();
    const nationality = input.nationality.trim();
    if (!displayName || !preferredLanguage || !nationality) throw new Error("Name, preferred language, and nationality are required.");

    this.database.prepare("UPDATE profiles SET display_name = ?, preferred_language = ?, nationality = ?, status = 'ready', updated_at = ? WHERE id = 1").run(
      displayName,
      preferredLanguage,
      nationality,
      new Date().toISOString()
    );
    this.addInbox({
      id: `profile-updated-${Date.now()}`,
      tone: "ready",
      title: "Profile saved locally",
      body: "Only confirmed long-term information is stored in the Profile.",
      timestamp: "Just now"
    });
    return this.getWorkspace();
  }

  updatePlanAccommodation(planId: string, input: PlanAccommodationInput): WorkspaceSnapshot {
    const workspace = this.getWorkspace();
    if (workspace.activePlan.id !== planId) throw new Error(`Plan ${planId} was not found.`);
    const name = input.name.trim();
    const address = input.address.trim();
    const location = input.location.trim();
    if (!name || !address || !location) throw new Error("A saved accommodation candidate needs a name, address, and location.");

    const configuration: PlanConfiguration = {
      ...workspace.activePlan.configuration,
      accommodation: {
        status: input.status,
        ...(input.id?.trim() ? { id: input.id.trim() } : {}),
        name,
        address,
        location,
        source: input.source,
        updatedAt: new Date().toISOString()
      }
    };
    this.database.prepare("UPDATE plans SET configuration_json = ?, version = version + 1 WHERE id = ?").run(JSON.stringify(configuration), planId);
    this.addInbox({
      id: `accommodation-candidate-${planId}-${Date.now()}`,
      tone: "notice",
      title: input.status === "confirmed" ? "Accommodation confirmed in this Plan" : "Accommodation candidate saved in this Plan",
      body: input.status === "confirmed" ? `${name} is marked as booked after your confirmation.` : `${name} is saved as a candidate. It is not marked as booked.`,
      timestamp: "Just now"
    });
    return this.getWorkspace();
  }

  private migrate(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS profiles (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        display_name TEXT NOT NULL,
        preferred_language TEXT NOT NULL,
        nationality TEXT NOT NULL,
        status TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS plans (
        id TEXT PRIMARY KEY,
        version INTEGER NOT NULL,
        title TEXT NOT NULL,
        location TEXT NOT NULL,
        dates TEXT NOT NULL,
        status TEXT NOT NULL,
        known_information_json TEXT NOT NULL,
        assumptions_json TEXT NOT NULL,
        next_action TEXT NOT NULL,
        configuration_json TEXT NOT NULL,
        sources_json TEXT NOT NULL,
        is_current INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS stages (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        sort_order INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        stage_id TEXT NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        owner TEXT NOT NULL,
        status TEXT NOT NULL,
        due_label TEXT NOT NULL,
        sort_order INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS inbox_items (
        id TEXT PRIMARY KEY,
        tone TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_plans_current ON plans(is_current, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_stages_plan_order ON stages(plan_id, sort_order);
      CREATE INDEX IF NOT EXISTS idx_tasks_stage_order ON tasks(stage_id, sort_order);
      CREATE INDEX IF NOT EXISTS idx_inbox_created_at ON inbox_items(created_at DESC);
      PRAGMA optimize;
    `);
    const planColumns = this.database.prepare("PRAGMA table_info(plans)").all() as unknown as Array<{ name: string }>;
    if (!planColumns.some((column) => column.name === "configuration_json")) {
      this.database.exec("ALTER TABLE plans ADD COLUMN configuration_json TEXT NOT NULL DEFAULT '{\"accommodation\":{\"status\":\"not_set\"}}'");
    }
  }

  private seedIfEmpty(): void {
    const profile = this.database.prepare("SELECT id FROM profiles WHERE id = 1").get();
    if (profile) return;

    const workspace = createInitialWorkspace();
    this.database.prepare("INSERT INTO profiles (id, display_name, preferred_language, nationality, status, updated_at) VALUES (1, ?, ?, ?, ?, ?)").run(
      workspace.profile.displayName,
      workspace.profile.preferredLanguage,
      workspace.profile.nationality,
      workspace.profile.status,
      new Date().toISOString()
    );
    this.savePlan(workspace.activePlan);
    workspace.inbox.forEach((item) => this.addInbox(item));
  }

  private savePlan(plan: Plan): void {
    this.database.exec("BEGIN");
    try {
      this.database.prepare("UPDATE plans SET is_current = 0 WHERE is_current = 1").run();
      this.database.prepare(`INSERT INTO plans (id, version, title, location, dates, status, known_information_json, assumptions_json, next_action, configuration_json, sources_json, is_current, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`).run(
        plan.id,
        plan.version,
        plan.title,
        plan.location,
        plan.dates,
        plan.status,
        JSON.stringify(plan.knownInformation),
        JSON.stringify(plan.assumptions),
        plan.nextAction,
        JSON.stringify(plan.configuration),
        JSON.stringify(plan.sources),
        plan.createdAt
      );
      plan.stages.forEach((stage, stageIndex) => {
        this.database.prepare("INSERT INTO stages (id, plan_id, title, description, sort_order) VALUES (?, ?, ?, ?, ?)").run(
          stage.id,
          plan.id,
          stage.title,
          stage.description,
          stageIndex
        );
        stage.tasks.forEach((task, taskIndex) => {
          this.database.prepare("INSERT INTO tasks (id, stage_id, title, owner, status, due_label, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
            task.id,
            stage.id,
            task.title,
            task.owner,
            task.status,
            task.dueLabel,
            taskIndex
          );
        });
      });
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  private getCurrentPlan(): Plan | undefined {
    const plan = this.database.prepare(`SELECT id, version, title, location, dates, status, known_information_json, assumptions_json, next_action, configuration_json, sources_json, created_at
      FROM plans WHERE is_current = 1 ORDER BY created_at DESC LIMIT 1`).get() as PlanRow | undefined;
    if (!plan) return undefined;

    const stageRows = this.database.prepare("SELECT id, title, description FROM stages WHERE plan_id = ? ORDER BY sort_order").all(plan.id) as unknown as StageRow[];
    const stages: Stage[] = stageRows.map((stage) => ({
      id: stage.id,
      title: stage.title,
      description: stage.description,
      tasks: (this.database.prepare("SELECT id, title, owner, status, due_label FROM tasks WHERE stage_id = ? ORDER BY sort_order").all(stage.id) as unknown as TaskRow[]).map((task) => ({
        id: task.id,
        title: task.title,
        owner: task.owner,
        status: task.status,
        dueLabel: task.due_label
      }))
    }));

    return {
      id: plan.id,
      version: plan.version,
      title: plan.title,
      location: plan.location,
      dates: plan.dates,
      status: plan.status,
      knownInformation: JSON.parse(plan.known_information_json) as string[],
      assumptions: JSON.parse(plan.assumptions_json) as string[],
      nextAction: plan.next_action,
      configuration: parsePlanConfiguration(plan.configuration_json),
      stages,
      sources: JSON.parse(plan.sources_json) as SourceReference[],
      createdAt: plan.created_at
    };
  }

  private addInbox(item: InboxItem): void {
    this.database.prepare("INSERT OR IGNORE INTO inbox_items (id, tone, title, body, timestamp, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
      item.id,
      item.tone,
      item.title,
      item.body,
      item.timestamp,
      new Date().toISOString()
    );
  }
}

function parsePlanConfiguration(value: string): PlanConfiguration {
  try {
    const parsed = JSON.parse(value) as Partial<PlanConfiguration>;
    if (parsed.accommodation && ["not_set", "candidate", "confirmed"].includes(parsed.accommodation.status)) {
      return { accommodation: parsed.accommodation } as PlanConfiguration;
    }
  } catch {
    // Old local data can safely fall back to an empty Plan configuration.
  }
  return createDefaultPlanConfiguration();
}
