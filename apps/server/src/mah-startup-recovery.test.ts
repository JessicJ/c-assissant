import assert from "node:assert/strict";
import test from "node:test";
import { startServerLifecycle } from "./server-lifecycle.js";

test("服务启动在定时工作前自动执行主 Storage 的 MAH carrier 恢复", async () => {
  const order: string[] = [];
  const handles: object[] = [];
  const lifecycle = await startServerLifecycle({
    server: {
      listen: async () => { order.push("listen"); },
      close: async () => { order.push("close"); },
      log: { warn: () => undefined }
    } as never,
    store: {
      recoverInterruptedPlanGenerations: () => { order.push("storage-recovery"); return { runs: 0, sessions: 0 }; },
      close: () => { order.push("storage-close"); }
    } as never,
    port: 0,
    host: "127.0.0.1",
    activePlanMonitoring: {
      startActivePlanMonitoring: () => undefined,
      runItineraryDepartureReminders: async () => undefined,
      runPlanWeatherMonitor: async () => undefined,
      runPlanVenueMonitor: async () => undefined,
    },
    abortGenerationJobs: async () => { order.push("abort"); await Promise.resolve(); order.push("abort-finished"); },
    recoverMahGenerations: async () => { order.push("mah-recovery"); },
    scheduler: {
      setInterval: () => { const handle = {}; handles.push(handle); return handle; },
      clearInterval: () => undefined
    },
    installSignalHandlers: false
  });
  assert.deepEqual(order.slice(0, 3), ["listen", "storage-recovery", "mah-recovery"]);
  assert.equal(handles.length, 3);
  await lifecycle.stop();
  assert.ok(order.includes("abort"));
  assert.ok(order.indexOf("abort-finished") < order.indexOf("storage-close"));
  assert.ok(order.includes("storage-close"));
});
