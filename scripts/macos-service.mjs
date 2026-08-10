import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const serviceLabel = "io.landi.local";

export function servicePaths({ projectRoot, homeDirectory = homedir() }) {
  return {
    plistPath: resolve(homeDirectory, "Library", "LaunchAgents", `${serviceLabel}.plist`),
    serverEntry: resolve(projectRoot, "apps", "server", "lib", "index.js"),
    webEntry: resolve(projectRoot, "apps", "web", "dist", "index.html"),
    logPath: resolve(projectRoot, "data", "landi-service.log"),
    errorLogPath: resolve(projectRoot, "data", "landi-service.error.log")
  };
}

export function createLaunchAgentPlist({ projectRoot, nodePath, executablePath = process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin" }) {
  const paths = servicePaths({ projectRoot });
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${serviceLabel}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(nodePath)}</string>
    <string>${xml(paths.serverEntry)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xml(projectRoot)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${xml(executablePath)}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>${xml(paths.logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(paths.errorLogPath)}</string>
</dict>
</plist>
`;
}

function install({ dryRun }) {
  requireMacOS();
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const nodePath = process.execPath;
  const paths = servicePaths({ projectRoot });
  for (const requiredPath of [paths.serverEntry, paths.webEntry]) {
    if (!existsSync(requiredPath)) throw new Error(`Missing production build: ${requiredPath}. Run pnpm build first.`);
  }
  const plist = createLaunchAgentPlist({ projectRoot, nodePath });
  if (dryRun) {
    process.stdout.write(`Would install ${paths.plistPath}\nWould run ${nodePath} ${paths.serverEntry}\n`);
    return;
  }

  mkdirSync(dirname(paths.plistPath), { recursive: true });
  mkdirSync(dirname(paths.logPath), { recursive: true, mode: 0o700 });
  writeFileSync(paths.plistPath, plist, { encoding: "utf8", mode: 0o600 });
  chmodSync(paths.plistPath, 0o600);
  const domain = `gui/${process.getuid()}`;
  spawnSync("launchctl", ["bootout", domain, paths.plistPath], { stdio: "ignore" });
  execFileSync("launchctl", ["bootstrap", domain, paths.plistPath], { stdio: "inherit" });
  execFileSync("launchctl", ["kickstart", "-k", `${domain}/${serviceLabel}`], { stdio: "inherit" });
  process.stdout.write(`Landi service installed. Open http://127.0.0.1:8787/\nLogs: ${paths.logPath}\n`);
}

function uninstall({ dryRun }) {
  requireMacOS();
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const paths = servicePaths({ projectRoot });
  if (dryRun) {
    process.stdout.write(`Would unload and remove ${paths.plistPath}\n`);
    return;
  }
  const domain = `gui/${process.getuid()}`;
  spawnSync("launchctl", ["bootout", domain, paths.plistPath], { stdio: "ignore" });
  rmSync(paths.plistPath, { force: true });
  process.stdout.write("Landi service removed. Local Plans, Profile, configuration, and logs were kept.\n");
}

function requireMacOS() {
  if (process.platform !== "darwin") throw new Error("This service installer supports macOS only.");
}

function xml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const operation = process.argv[2];
  const dryRun = process.argv.includes("--dry-run");
  try {
    if (operation === "install") install({ dryRun });
    else if (operation === "uninstall") uninstall({ dryRun });
    else throw new Error("Use: node scripts/macos-service.mjs <install|uninstall> [--dry-run]");
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
