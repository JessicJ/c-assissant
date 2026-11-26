// Select the branch before loading .env, normal storage, runtimes, or background services.
const mode = process.env.LANDI_SERVER_MODE;
if (mode === 'maintenance-bootstrap') {
  const { startMaintenanceBootstrap } = await import('./maintenance-bootstrap-startup.js');
  await startMaintenanceBootstrap(process.env);
} else if (mode === 'guarded-workbench') {
  const { startGuardedWorkbench } = await import('./guarded-workbench-startup.js');
  await startGuardedWorkbench(process.env);
} else if (mode === 'readonly-diagnostics') {
  const { startReadonlyDiagnostics } = await import('./readonly-diagnostic-startup.js');
  await startReadonlyDiagnostics(process.env);
} else if (mode === undefined || mode === 'standard') {
  const { startStandardServer } = await import('./standard-server-startup.js');
  await startStandardServer(import.meta.url);
} else {
  throw new Error('Unsupported LANDI_SERVER_MODE; no service was started.');
}
export {};
