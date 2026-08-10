import assert from "node:assert/strict";
import test from "node:test";

import { createLaunchAgentPlist, serviceLabel, servicePaths } from "./macos-service.mjs";

test("macOS service paths keep runtime files inside the project and the plist in LaunchAgents", () => {
  const paths = servicePaths({ projectRoot: "/Users/example/Landi", homeDirectory: "/Users/example" });
  assert.equal(paths.plistPath, `/Users/example/Library/LaunchAgents/${serviceLabel}.plist`);
  assert.equal(paths.serverEntry, "/Users/example/Landi/apps/server/lib/index.js");
  assert.equal(paths.webEntry, "/Users/example/Landi/apps/web/dist/index.html");
  assert.equal(paths.logPath, "/Users/example/Landi/data/landi-service.log");
});

test("macOS service plist starts one production process and contains no Connector credentials", () => {
  const plist = createLaunchAgentPlist({ projectRoot: "/Users/example/Landi & Pack", nodePath: "/opt/homebrew/bin/node", executablePath: "/opt/homebrew/bin:/usr/bin" });
  assert.match(plist, /io\.landi\.local/);
  assert.match(plist, /apps\/server\/lib\/index\.js/);
  assert.match(plist, /Landi &amp; Pack/);
  assert.match(plist, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.match(plist, /<key>KeepAlive<\/key>\s*<true\/>/);
  assert.doesNotMatch(plist, /AMAP_API_KEY|QWEATHER_API_KEY|TELEGRAM_BOT_TOKEN|ANTHROPIC_API_KEY/);
});
