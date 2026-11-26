import { isolateBrowserTestServer } from "./browser-test-isolation.mjs";

const { cleanup } = isolateBrowserTestServer();
// Let the server lifecycle close the database before the exit cleanup runs.
process.once("exit", cleanup);
await import("../apps/server/lib/index.js");
