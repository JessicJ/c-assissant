import { randomUUID } from "node:crypto";

export type PlanStatus = "draft" | "active" | "completed" | "cancelled";
export type TaskStatus = "scheduled" | "ready" | "running" | "waiting_user" | "blocked" | "completed" | "skipped" | "failed" | "cancelled";

export interface Task {
  id: string;
  title: string;
  owner: "assistant" | "user" | "external";
  status: TaskStatus;
  dueLabel: string;
}

export interface Stage {
  id: string;
  title: string;
  description: string;
  tasks: Task[];
}

export interface SourceReference {
  title: string;
  authority: string;
  url: string;
  retrievedAt: string;
}

export interface Plan {
  id: string;
  version: number;
  title: string;
  location: string;
  dates: string;
  status: PlanStatus;
  knownInformation: string[];
  assumptions: string[];
  nextAction: string;
  stages: Stage[];
  sources: SourceReference[];
  createdAt: string;
}

export interface InboxItem {
  id: string;
  tone: "notice" | "attention" | "ready";
  title: string;
  body: string;
  timestamp: string;
}

export interface WorkspaceSnapshot {
  profile: {
    displayName: string;
    preferredLanguage: string;
    nationality: string;
    status: "incomplete" | "ready";
  };
  activePlan: Plan;
  inbox: InboxItem[];
  system: {
    core: "ready";
    storage: "local";
    runtime: "not_configured";
    telegram: "not_configured";
    amap: "not_configured";
  };
}

export interface CreatePlanInput {
  request: string;
}

export interface ProfileUpdate {
  displayName: string;
  preferredLanguage: string;
  nationality: string;
}

export interface GeneratedPlanDraft {
  title: string;
  location: string;
  dates: string;
  knownInformation: string[];
  assumptions: string[];
  nextAction: string;
  stages: Array<{
    title: string;
    description: string;
    tasks: Array<{
      title: string;
      owner: Task["owner"];
      dueLabel: string;
    }>;
  }>;
}

export function createInitialWorkspace(): WorkspaceSnapshot {
  const activePlan = createPlanFromRequest({
    request: "I will attend an exhibition in Shanghai in September 2026."
  });

  return {
    profile: {
      displayName: "New explorer",
      preferredLanguage: "English",
      nationality: "To be confirmed",
      status: "incomplete"
    },
    activePlan: {
      ...activePlan,
      title: "Attend an exhibition in Shanghai",
      location: "Shanghai, China",
      dates: "September 2026",
      knownInformation: [
        "Purpose: attend an exhibition",
        "Destination: Shanghai, China",
        "Expected period: September 2026"
      ],
      assumptions: ["Arrival airport and accommodation are not confirmed yet.", "Transport preferences will be kept inside this Plan."],
      nextAction: "Review and confirm this Plan to activate its reminder scope."
    },
    inbox: [
      {
        id: "welcome",
        tone: "notice",
        title: "Your first Plan is ready to review",
        body: "This initial Plan is stored locally. No messages, reminders, or external actions have been sent.",
        timestamp: "Now"
      },
      {
        id: "setup",
        tone: "attention",
        title: "Profile details are still incomplete",
        body: "Nationality and relevant travel status are needed before policy guidance can be reliable.",
        timestamp: "Before plan activation"
      }
    ],
    system: {
      core: "ready",
      storage: "local",
      runtime: "not_configured",
      telegram: "not_configured",
      amap: "not_configured"
    }
  };
}

export function createPlanFromRequest({ request }: CreatePlanInput): Plan {
  const normalizedRequest = request.trim();
  if (!normalizedRequest) throw new Error("A request is needed to create a Plan.");

  const title = normalizedRequest.length > 88 ? `${normalizedRequest.slice(0, 85).trimEnd()}…` : normalizedRequest;
  const location = inferLocation(normalizedRequest);
  const dates = inferDates(normalizedRequest);

  return {
    id: `plan-${randomUUID()}`,
    version: 1,
    title,
    location,
    dates,
    status: "draft",
    knownInformation: [
      `Your request: ${normalizedRequest}`,
      `Destination: ${location}`,
      `Time: ${dates}`
    ],
    assumptions: [
      "This initial template does not yet use Codex or Claude Code to interpret the request.",
      "Confirm the destination, dates, and purpose before automated guidance is enabled."
    ],
    nextAction: "Review and confirm this Plan to save its current reminder scope.",
    stages: [
      {
        id: `stage-${randomUUID()}`,
        title: "Clarify essentials",
        description: "Confirm the details that make local guidance reliable.",
        tasks: [
          {
            id: `task-${randomUUID()}`,
            title: "Confirm destination, dates, and purpose",
            owner: "user",
            status: "waiting_user",
            dueLabel: "Before Plan activation"
          }
        ]
      },
      {
        id: `stage-${randomUUID()}`,
        title: "Before departure",
        description: "Prepare information and local-life decisions for this Plan.",
        tasks: [
          {
            id: `task-${randomUUID()}`,
            title: "Prepare a source-backed arrival checklist",
            owner: "assistant",
            status: "scheduled",
            dueLabel: "When the Agent Runtime is connected"
          }
        ]
      },
      {
        id: `stage-${randomUUID()}`,
        title: "Arrival",
        description: "Hand off the planned route when location services are connected.",
        tasks: [
          {
            id: `task-${randomUUID()}`,
            title: "Open the arrival route in Amap",
            owner: "external",
            status: "scheduled",
            dueLabel: "At expected arrival time"
          }
        ]
      }
    ],
    sources: [],
    createdAt: new Date().toISOString()
  };
}

export function createPlanFromDraft(draft: GeneratedPlanDraft): Plan {
  return {
    id: `plan-${randomUUID()}`,
    version: 1,
    title: draft.title,
    location: draft.location,
    dates: draft.dates,
    status: "draft",
    knownInformation: draft.knownInformation,
    assumptions: draft.assumptions,
    nextAction: draft.nextAction,
    stages: draft.stages.map((stage) => ({
      id: `stage-${randomUUID()}`,
      title: stage.title,
      description: stage.description,
      tasks: stage.tasks.map((task) => ({
        id: `task-${randomUUID()}`,
        title: task.title,
        owner: task.owner,
        status: task.owner === "user" ? "waiting_user" : "scheduled",
        dueLabel: task.dueLabel
      }))
    })),
    sources: [],
    createdAt: new Date().toISOString()
  };
}

export function confirmPlan(snapshot: WorkspaceSnapshot, planId: string): WorkspaceSnapshot {
  if (snapshot.activePlan.id !== planId) {
    throw new Error(`Plan ${planId} was not found.`);
  }

  return {
    ...snapshot,
    activePlan: {
      ...snapshot.activePlan,
      status: "active",
      nextAction: "Complete the missing profile facts before policy-related tasks run."
    },
    inbox: [
      {
        id: `plan-confirmed-${snapshot.activePlan.version}`,
        tone: "ready",
        title: "Plan activated",
        body: "The Plan is active. Scheduler, Telegram, and external connectors are not connected yet.",
        timestamp: "Just now"
      },
      ...snapshot.inbox
    ]
  };
}

function inferLocation(request: string): string {
  const knownCities = ["Shanghai", "Beijing", "Guangzhou", "Shenzhen", "Hangzhou", "Chengdu", "上海", "北京", "广州", "深圳", "杭州", "成都"];
  const matchedCity = knownCities.find((city) => request.toLocaleLowerCase().includes(city.toLocaleLowerCase()));
  if (matchedCity) return `${matchedCity}, China`;

  const englishLocation = request.match(/\b(?:in|to|at)\s+([A-Z][A-Za-z -]{1,40})(?:[,.]|\s+(?:in|on|for)|$)/);
  return englishLocation?.[1]?.trim() ?? "Location to be confirmed";
}

function inferDates(request: string): string {
  const monthDate = request.match(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December)(?:\s+\d{1,2})?(?:,?\s+20\d{2})?/i);
  if (monthDate?.[0]) return monthDate[0];

  const year = request.match(/\b20\d{2}\b/);
  return year?.[0] ?? "Dates to be confirmed";
}
