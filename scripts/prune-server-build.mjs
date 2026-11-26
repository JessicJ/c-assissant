import { existsSync, readdirSync, unlinkSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Remove compiler outputs whose source was retired, before the next Server build. */
export function pruneServerBuild(sourceRoot, outputRoot) {
  const removed = [];
  function visit(directory) {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const output = join(directory, entry.name);
      if (entry.isDirectory()) { visit(output); continue; }
      const name = relative(outputRoot, output);
      const source = name.replace(/(?:\.d\.ts\.map|\.d\.ts|\.js\.map|\.js)$/, ".ts");
      if (source === name || existsSync(join(sourceRoot, source))) continue;
      unlinkSync(output);
      removed.push(name);
    }
  }
  visit(outputRoot);
  return removed;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const workspace = args.length === 0 ? "server" : args.length === 2 && args[0] === "--workspace" ? args[1] : undefined;
  if (workspace !== "server" && workspace !== "travel-support") throw new Error("Expected --workspace server or --workspace travel-support");
  const root = resolve(dirname(fileURLToPath(import.meta.url)), workspace === "server" ? "../apps/server" : "../packages/travel-support");
  pruneServerBuild(join(root, "src"), join(root, "lib"));
}
