import type { RuntimeCheck, RuntimeKind } from "@c-assistant/agent-adapters";
import { runtimeName } from "./runtime-display.js";

export type SetupReadinessItemId = "profile" | "runtime" | "google" | "telegram";

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
  googleConfigured: boolean;
  telegramConfigured: boolean;
  telegramPaired: boolean;
}): SetupReadiness {
  const selectedRuntime = input.runtimeChecks.find((runtime) => runtime.kind === input.selectedRuntime);
  const selectedRuntimeName = runtimeName(input.selectedRuntime);
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
      label: `${selectedRuntimeName} runtime`,
      status: runtimeReady ? "ready" : "needs_attention",
      detail: runtimeReady
        ? `${selectedRuntimeName} is installed and logged in.`
        : selectedRuntime?.installed
          ? `${selectedRuntimeName} is installed but needs login on this computer.`
          : `${selectedRuntimeName} is not installed on this computer.`
    },
    {
      id: "google",
      label: "Google Maps Platform",
      status: input.googleConfigured ? "ready" : "needs_attention",
      detail: input.googleConfigured ? "Global place and route facts are configured; weather is available where Google Weather has coverage." : "Add a restricted Google Maps Platform key with Places, Routes, and Weather APIs enabled."
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
