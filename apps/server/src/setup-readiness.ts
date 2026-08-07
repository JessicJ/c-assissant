import type { RuntimeCheck, RuntimeKind } from "@c-assistant/agent-adapters";

export type SetupReadinessItemId = "profile" | "runtime" | "amap" | "qweather" | "telegram";

export interface SetupReadinessItem {
  id: SetupReadinessItemId;
  label: string;
  status: "ready" | "needs_attention";
  detail: string;
}

export interface SetupReadiness {
  status: "ready" | "needs_attention";
  readyCount: number;
  totalCount: number;
  nextAction: string;
  items: SetupReadinessItem[];
}

export function assessSetupReadiness(input: {
  profileStatus: "incomplete" | "ready";
  selectedRuntime: RuntimeKind;
  runtimeChecks: RuntimeCheck[];
  amapConfigured: boolean;
  qweatherConfigured: boolean;
  telegramConfigured: boolean;
  telegramPaired: boolean;
}): SetupReadiness {
  const selectedRuntime = input.runtimeChecks.find((runtime) => runtime.kind === input.selectedRuntime);
  const runtimeName = input.selectedRuntime === "claude-code" ? "Claude Code" : "Codex";
  const runtimeReady = Boolean(selectedRuntime?.installed && selectedRuntime.authenticated);
  const items: SetupReadinessItem[] = [
    {
      id: "profile",
      label: "Basic Profile",
      status: input.profileStatus === "ready" ? "ready" : "needs_attention",
      detail: input.profileStatus === "ready" ? "Your confirmed long-term basics are saved." : "Add the basic details you want Landi to reuse across Plans."
    },
    {
      id: "runtime",
      label: `${runtimeName} runtime`,
      status: runtimeReady ? "ready" : "needs_attention",
      detail: runtimeReady
        ? `${runtimeName} is installed and logged in.`
        : selectedRuntime?.installed
          ? `${runtimeName} is installed but needs login on this computer.`
          : `${runtimeName} is not installed on this computer.`
    },
    {
      id: "amap",
      label: "Amap",
      status: input.amapConfigured ? "ready" : "needs_attention",
      detail: input.amapConfigured ? "Location and route facts are configured." : "Add an Amap Web service key for location and route facts."
    },
    {
      id: "qweather",
      label: "QWeather",
      status: input.qweatherConfigured ? "ready" : "needs_attention",
      detail: input.qweatherConfigured ? "Weather facts are configured." : "Add a QWeather key and API host for weather facts."
    },
    {
      id: "telegram",
      label: "Telegram",
      status: input.telegramConfigured && input.telegramPaired ? "ready" : "needs_attention",
      detail: !input.telegramConfigured
        ? "Add your Telegram bot token."
        : input.telegramPaired
          ? "Your private Telegram account is paired."
          : "The bot is configured; pair your private Telegram account."
    }
  ];

  const nextAction = items.find((item) => item.status === "needs_attention")?.detail
    ?? "Setup is ready. Create a Plan from Today when you need help.";
  const readyCount = items.filter((item) => item.status === "ready").length;
  return {
    status: readyCount === items.length ? "ready" : "needs_attention",
    readyCount,
    totalCount: items.length,
    nextAction,
    items
  };
}
