import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { MahCarrierError } from "./mah-generation-contract.js";

export function resolveMahProjectRoot(componentRoot: string, environment: NodeJS.ProcessEnv = process.env): string {
  const configured = environment.LANDI_MAH_PROJECT_ROOT?.trim();
  if (configured && !isAbsolute(configured)) throw invalidProjectRoot();

  let canonicalComponentRoot: string;
  let canonicalProjectRoot: string;
  try {
    canonicalComponentRoot = realpathSync(componentRoot);
    canonicalProjectRoot = realpathSync(configured || resolve(canonicalComponentRoot, "../.."));
  } catch {
    throw invalidProjectRoot();
  }

  if (canonicalProjectRoot === canonicalComponentRoot
    || !existsSync(join(canonicalProjectRoot, ".git"))
    || !existsSync(join(canonicalProjectRoot, ".mah-project", "project.json"))) {
    throw invalidProjectRoot();
  }
  return canonicalProjectRoot;
}

function invalidProjectRoot(): MahCarrierError {
  return new MahCarrierError("mah_project_root_invalid", "MAH Project Git 根无效；请配置包含 Git 与 MAH 项目标记的规范项目根后重试。");
}
