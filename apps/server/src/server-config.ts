import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function loadServerConfig(entryModuleUrl: string) {
  const sourceProjectRoot = fileURLToPath(new URL("../../../", entryModuleUrl));
  const localPackage = process.env.LANDI_LOCAL_PACKAGE === "1";
  const projectRoot = process.env.LANDI_APP_ROOT || sourceProjectRoot;
  const envPath = process.env.C_ASSISTANT_ENV_PATH || resolve(projectRoot, ".env");
  const webDistPath = resolve(projectRoot, "apps", "web", "dist");
  if ((!localPackage || process.env.C_ASSISTANT_ENV_PATH) && existsSync(envPath)) process.loadEnvFile(envPath);
  const semanticShadowSampleRate = Number(process.env.LANDI_SEMANTIC_SHADOW_SAMPLE_RATE ?? 1);
  const semanticShadowTimeoutMs = Number(process.env.LANDI_SEMANTIC_SHADOW_TIMEOUT_MS ?? 10 * 60_000);
  const host = process.env.C_ASSISTANT_HOST ?? "127.0.0.1";
  const semanticDraftCanarySessionIds = (process.env.LANDI_SEMANTIC_DRAFT_CANARY_SESSION_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return {
    projectRoot,
    envPath,
    databasePath: process.env.C_ASSISTANT_DATA_PATH || resolve(projectRoot, "data", "c-assistant.sqlite"),
    blueprintGenerationEnabled: process.env.LANDI_BLUEPRINT_GENERATION !== "0",
    semanticShadow: {
      enabled: process.env.LANDI_SEMANTIC_SHADOW === "1",
      sampleRate: Number.isFinite(semanticShadowSampleRate) ? Math.min(1, Math.max(0, semanticShadowSampleRate)) : 0,
      timeoutMs: Number.isFinite(semanticShadowTimeoutMs) && semanticShadowTimeoutMs > 0 ? semanticShadowTimeoutMs : 10 * 60_000
    },
    semanticDraftCanary: {
      enabled: process.env.LANDI_SEMANTIC_DRAFT_CANARY === "1",
      localEnvironment: ["127.0.0.1", "localhost", "::1"].includes(host),
      allowedSessionIds: semanticDraftCanarySessionIds
    },
    webAssetsPath: resolve(webDistPath, "assets"),
    webTripMapPath: resolve(webDistPath, "trip-map"),
    webIndexPath: resolve(webDistPath, "index.html"),
    port: Number(process.env.C_ASSISTANT_PORT ?? 8787),
    host,
    instanceHealth: process.env.LANDI_INSTANCE_TOKEN ? {
      service: "landi-local-workspace",
      protocolVersion: process.env.LANDI_INSTANCE_PROTOCOL ?? "1",
      proof: createHash("sha256").update(`landi-local-workspace\0${process.env.LANDI_INSTANCE_TOKEN}`).digest("hex")
    } : undefined
  };
}
