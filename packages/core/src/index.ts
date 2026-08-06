export type PlanStatus = "draft" | "active" | "completed" | "cancelled";
export type TaskStatus = "scheduled" | "ready" | "waiting_user" | "completed";

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
    storage: "demo";
    runtime: "not_configured";
    telegram: "not_configured";
    amap: "not_configured";
  };
}

export function createDemoWorkspace(): WorkspaceSnapshot {
  return {
    profile: {
      displayName: "New explorer",
      preferredLanguage: "English",
      nationality: "To be confirmed",
      status: "incomplete"
    },
    activePlan: {
      id: "plan-shanghai-exhibition",
      version: 1,
      title: "Attend an exhibition in Shanghai",
      location: "Shanghai, China",
      dates: "September 2026",
      status: "draft",
      knownInformation: [
        "Purpose: attend an exhibition",
        "Destination: Shanghai, China",
        "Expected period: September 2026"
      ],
      assumptions: [
        "Arrival airport and accommodation are not confirmed yet.",
        "Transport preferences will be kept inside this Plan."
      ],
      nextAction: "Review and confirm this Plan to activate its reminder scope.",
      stages: [
        {
          id: "pre-departure",
          title: "Before departure",
          description: "Prepare documents, digital tools, and accommodation decisions.",
          tasks: [
            {
              id: "check-entry-materials",
              title: "Check entry materials against official sources",
              owner: "assistant",
              status: "scheduled",
              dueLabel: "After profile details are confirmed"
            },
            {
              id: "choose-accommodation-area",
              title: "Choose an accommodation area near the exhibition",
              owner: "user",
              status: "waiting_user",
              dueLabel: "Before departure"
            }
          ]
        },
        {
          id: "arrival",
          title: "Arrival in Shanghai",
          description: "Refresh route facts and hand off the selected journey to Amap.",
          tasks: [
            {
              id: "airport-to-stay",
              title: "Open the planned airport-to-accommodation route",
              owner: "external",
              status: "scheduled",
              dueLabel: "At expected arrival time"
            }
          ]
        }
      ],
      sources: [
        {
          title: "Source registry is not connected in this demo",
          authority: "C-assistant demo data",
          url: "https://github.com/JessicJ/c-assissant",
          retrievedAt: "Not retrieved"
        }
      ]
    },
    inbox: [
      {
        id: "welcome",
        tone: "notice",
        title: "Your first Plan is ready to review",
        body: "This is local demonstration data. No messages, reminders, or external actions have been sent.",
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
      storage: "demo",
      runtime: "not_configured",
      telegram: "not_configured",
      amap: "not_configured"
    }
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
        body: "The Plan is active in this demo. Scheduler, Telegram, and external connectors are not connected yet.",
        timestamp: "Just now"
      },
      ...snapshot.inbox
    ]
  };
}
