import { lookup } from "node:dns/promises";
import { probeRemoteImageUrl } from "./planned-place-image-pipeline.js";

/** Preserve source-backed photos on a known synthetic-DNS proxy, never probe private addresses. */
export async function probeEmailPhoto(url: string, signal?: AbortSignal, dependencies: { probe?: typeof probeRemoteImageUrl; resolveHost?: (host: string) => Promise<Array<{address:string}>> } = {}): Promise<boolean | undefined> {
  const result=await (dependencies.probe ?? probeRemoteImageUrl)(url, { ...(signal ? {signal} : {}) });
  if (result !== undefined || signal?.aborted) return result ?? false;
  try {
    const addresses=await Promise.race([dependencies.resolveHost ? dependencies.resolveHost(new URL(url).hostname) : lookup(new URL(url).hostname,{all:true}), new Promise<Array<{address:string}>>(resolve=>{const timer=setTimeout(()=>resolve([]),500);timer.unref();})]);
    // This is only an unknown/recheck presentation fallback, not a bypass of
    // the network probe or permission to connect to these synthetic addresses.
    return addresses.length && addresses.every(({address})=>/^198\.(?:18|19)\.\d{1,3}\.\d{1,3}$/.test(address)) ? undefined : false;
  } catch { return false; }
}
