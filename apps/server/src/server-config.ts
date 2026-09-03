import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function loadServerConfig(entryModuleUrl: string) {
  const projectRoot = fileURLToPath(new URL("../../../", entryModuleUrl));
  const envPath = fileURLToPath(new URL("../../../.env", entryModuleUrl));
  const webDistPath = resolve(projectRoot, "apps", "web", "dist");
  if (existsSync(envPath)) process.loadEnvFile(envPath);
  return {
    projectRoot,
    envPath,
    databasePath: process.env.C_ASSISTANT_DATA_PATH || resolve(projectRoot, "data", "c-assistant.sqlite"),
    blueprintGenerationEnabled: process.env.LANDI_BLUEPRINT_GENERATION !== "0",
    webAssetsPath: resolve(webDistPath, "assets"),
    webTripMapPath: resolve(webDistPath, "trip-map"),
    webIndexPath: resolve(webDistPath, "index.html"),
    port: Number(process.env.C_ASSISTANT_PORT ?? 8787),
    host: process.env.C_ASSISTANT_HOST ?? "127.0.0.1"
  };
}
