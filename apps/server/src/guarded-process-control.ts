import { createReadStream, createWriteStream, fstatSync, lstatSync, realpathSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import type { Readable, Writable } from 'node:stream';

export interface GuardedProcessControlConfig {
  commandFd: number; eventFd: number; lockFd: number; parentPid: number;
  deploymentId: string; nonce: string;
}
/** Validate inherited capabilities before constructing business storage. No file opens. */
export function guardedProcessControlConfig(env: NodeJS.ProcessEnv, required = false): GuardedProcessControlConfig | undefined {
  const names = ['LANDI_DEPLOY_COMMAND_FD','LANDI_DEPLOY_EVENT_FD','LANDI_DEPLOY_LOCK_FD','LANDI_DEPLOY_PARENT_PID','LANDI_DEPLOY_ID','LANDI_DEPLOY_NONCE','LANDI_DEPLOY_LOCK_PATH'];
  if (!names.some(k => env[k] !== undefined)) {
    if (required) throw new Error('guarded_process_control_required');
    return undefined;
  }
  if (env.LANDI_SERVER_MODE !== 'guarded-workbench' || !names.every(k => env[k])) throw new Error('guarded_control_configuration_invalid');
  const fd = (key: string) => { const n = Number(env[key]); if (!/^\d+$/.test(env[key]!) || !Number.isSafeInteger(n) || n < 3) throw new Error('guarded_control_fd_invalid'); return n; };
  const commandFd = fd(names[0]!), eventFd = fd(names[1]!), lockFd = fd(names[2]!);
  if (new Set([commandFd,eventFd,lockFd]).size !== 3 || !fstatSync(commandFd).isFIFO() || !fstatSync(eventFd).isFIFO()) throw new Error('guarded_private_pipes_required');
  const lockPath = env.LANDI_DEPLOY_LOCK_PATH!;
  if (!isAbsolute(lockPath) || realpathSync(lockPath) !== lockPath) throw new Error('guarded_lock_path_invalid');
  const lock = lstatSync(lockPath), inherited = fstatSync(lockFd);
  if (!lock.isFile() || lock.isSymbolicLink() || lock.nlink !== 1 || lock.dev !== inherited.dev || lock.ino !== inherited.ino || (lock.mode & 0o077) !== 0 || lock.uid !== process.getuid?.()) throw new Error('guarded_lock_identity_mismatch');
  const parentPid = Number(env.LANDI_DEPLOY_PARENT_PID);
  if (!Number.isSafeInteger(parentPid) || parentPid <= 1 || parentPid !== process.ppid || !/^[a-f0-9]{32}$/.test(env.LANDI_DEPLOY_ID!) || !/^[a-f0-9]{64}$/.test(env.LANDI_DEPLOY_NONCE!)) throw new Error('guarded_parent_identity_mismatch');
  return { commandFd,eventFd,lockFd,parentPid,deploymentId:env.LANDI_DEPLOY_ID!,nonce:env.LANDI_DEPLOY_NONCE! };
}

interface Identity { pid: number; parentPid: number; manifestSha256: string; databasePath: string; origin: string }
/** Injectable protocol core: only the owning pipe may request closure; no signals or CLI. */
export function createGuardedProcessControl(options: {
  commands: Readable; events: Writable; deploymentId: string; nonce: string;
  identity: Identity; stop: () => Promise<void>; exit: (code: number) => void;
}) {
  let state: 'running'|'closing'|'closed'|'failed' = 'running';
  let buffered = ''; let closePromise: Promise<void> | undefined;
  const emit = (event: string, detail?: string) => new Promise<void>((resolve,reject) => {
    const payload = {version:1,deploymentId:options.deploymentId,nonce:options.nonce,event,...options.identity,...(detail ? {detail} : {})};
    options.events.write(JSON.stringify(payload)+'\n', error => error ? reject(error) : resolve());
  });
  // Pipe failures are uncertainty. Never turn them into a successful close or retry.
  options.events.on('error', () => { if (state !== 'closed') state = 'failed'; });
  async function failure(code: string) {
    state = 'failed';
    try { await emit('shutdown_failed',code); } catch { /* no success claim on a lost pipe */ }
  }
  function requestClose(reason: string): Promise<void> {
    if (closePromise) return closePromise;
    if (state !== 'running') return Promise.resolve();
    state = 'closing';
    closePromise = (async () => {
      try {
        await options.stop();
        await emit('closed',reason);
        state = 'closed'; options.exit(0);
      } catch { await failure('owned_resources_close_unverified'); }
    })();
    return closePromise;
  }
  const data = (chunk: Buffer|string) => {
    if (state !== 'running') return;
    buffered += chunk.toString();
    if (Buffer.byteLength(buffered) > 4096) { void failure('control_frame_too_large'); return; }
    let end: number;
    while ((end = buffered.indexOf('\n')) >= 0 && state === 'running') {
      const line = buffered.slice(0,end); buffered = buffered.slice(end+1);
      try {
        const message = JSON.parse(line);
        if (message.version !== 1 || message.deploymentId !== options.deploymentId || message.nonce !== options.nonce || message.op !== 'shutdown' || Object.keys(message).some(k => !['version','deploymentId','nonce','op'].includes(k))) throw new Error('invalid');
        void requestClose('controller_request');
      } catch { void failure('control_identity_or_frame_invalid'); }
    }
  };
  const end = () => { if (state === 'running') void requestClose('controller_disconnected'); };
  options.commands.on('data',data); options.commands.on('end',end);
  options.commands.on('error', () => { void failure('command_pipe_unverified'); });
  return {
    state: () => state,
    ready: async () => { if (state !== 'running') throw new Error('guarded_controller_unavailable'); await emit('ready'); },
    requestClose,
    dispose: () => { options.commands.off('data',data); options.commands.off('end',end); options.commands.destroy(); options.events.end(); }
  };
}

export function attachGuardedProcessControl(config: GuardedProcessControlConfig, identity: Omit<Identity,'pid'|'parentPid'>, stop: () => Promise<void>) {
  if (process.ppid !== config.parentPid) throw new Error('guarded_controller_lost_before_start');
  const commands = createReadStream('',{fd:config.commandFd,autoClose:true});
  const events = createWriteStream('',{fd:config.eventFd,autoClose:true});
  const control = createGuardedProcessControl({ commands,events,deploymentId:config.deploymentId,nonce:config.nonce,identity:{...identity,pid:process.pid,parentPid:process.ppid},stop,exit:code => process.exit(code) });
  const handlers = new Map<NodeJS.Signals,() => void>();
  for (const signal of ['SIGINT','SIGTERM'] as const) {
    const handler = () => { void control.requestClose('owned_process_signal'); };
    handlers.set(signal,handler); process.on(signal,handler);
  }
  return { ...control, dispose: () => { for (const [signal,handler] of handlers) process.off(signal,handler); control.dispose(); } };
}
