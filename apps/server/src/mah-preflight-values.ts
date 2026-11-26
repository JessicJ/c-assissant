/** Pure validation primitives. No I/O and no execution authorization. */
import { createHash } from "node:crypto";
export type Row = Record<string, unknown>;
export function reject(code: string): never { throw new Error(code); }
export function row(v: unknown): Row { if (!v || typeof v !== "object" || Array.isArray(v)) reject("invalid_object"); return v as Row; }
export function keys(v: unknown, required: string[], optional: string[] = []): Row {
  const r = row(v); if (required.some(k => !Object.hasOwn(r,k)) || Object.keys(r).some(k => !required.includes(k) && !optional.includes(k))) reject("invalid_fields"); return r;
}
export function text(v: unknown): string { if (typeof v !== "string" || !v.trim() || v.length > 4096) reject("invalid_string"); return v; }
export function int(v: unknown, min = 0): number { if (!Number.isSafeInteger(v) || Number(v) < min) reject("invalid_integer"); return Number(v); }
export function time(v: unknown): number { const s=text(v); if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(s) || !Number.isFinite(Date.parse(s)) || new Date(s).toISOString().slice(0,19)!==s.slice(0,19)) reject("invalid_time"); return Date.parse(s); }
export function one(v: unknown, values: readonly unknown[]): void { if (!values.includes(v)) reject("invalid_enum"); }
export function same(a: unknown,b: unknown,code="identity_mismatch"): void { if (canonical(a)!==canonical(b)) reject(code); }
export function canonical(v: unknown): string {
  if (v === null || typeof v === "string" || typeof v === "boolean" || typeof v === "number" && Number.isFinite(v)) return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  const r=row(v);return `{${Object.keys(r).sort().map(k=>JSON.stringify(k)+':'+canonical(r[k])).join(',')}}`;
}
export function hash(v: unknown): string { return createHash("sha256").update(canonical(v)).digest("hex"); }
export function parse(raw: string): unknown { if(Buffer.byteLength(raw)>16*1024*1024) reject("readback_too_large"); return JSON.parse(raw); }
export function scope(v: unknown): Row { const r=keys(v,['planId','planVersion','recipientConfigRevision']);text(r.planId);int(r.planVersion,1);int(r.recipientConfigRevision);return r; }
export function zone(v: unknown): void { try { new Intl.DateTimeFormat('en',{timeZone:text(v)}); } catch { reject('invalid_timezone'); } }
export const blocked = (code: string) => ({ consistent: true as const, executable: false as const, blocker: code });
