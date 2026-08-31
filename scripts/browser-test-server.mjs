import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const databasePath = join(tmpdir(), "landi-playwright-e2e.sqlite");
function removeTestDatabase() {
  for (const suffix of ["", "-shm", "-wal"]) rmSync(`${databasePath}${suffix}`, { force: true });
}
removeTestDatabase();

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    removeTestDatabase();
    process.exit(0);
  });
}
process.once("exit", removeTestDatabase);

process.env.C_ASSISTANT_HOST = "127.0.0.1";
process.env.C_ASSISTANT_PORT = "8765";
process.env.C_ASSISTANT_DATA_PATH = databasePath;

await import("../apps/server/lib/index.js");
