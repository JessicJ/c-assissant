import type { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { bookingRelationshipDigest, type TravelAdjustmentDecision, type TravelAdjustmentInput, type TravelAdjustmentContext, type TravelAdjustmentEvent, type TravelAdjustmentHandoff, type TravelAdjustmentObservation, type TravelAdjustmentReceipt, type TravelPhase } from '@c-assistant/core';
import type { EmailPlanConfirmation } from './email-store.js';

export interface TravelAdjustmentEmailConsumption {
  receipt: TravelAdjustmentReceipt;
  context: TravelAdjustmentContext;
  observations: TravelAdjustmentObservation[];
  decision: TravelAdjustmentDecision|null;
  arrangement: TravelAdjustmentHandoff['arrangement'];
  confirmation?: EmailPlanConfirmation;
}
export const TRAVEL_ADJUSTMENT_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS travel_adjustment_drafts(plan_id TEXT PRIMARY KEY NOT NULL, plan_version INTEGER NOT NULL, base_json TEXT NOT NULL, observation_digest TEXT NOT NULL, proposal_digest TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS travel_phases(trip_id TEXT PRIMARY KEY NOT NULL, revision INTEGER NOT NULL, content_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS travel_observations(plan_id TEXT NOT NULL, plan_version INTEGER NOT NULL, observation_key TEXT NOT NULL, content_json TEXT NOT NULL, reliable_json TEXT, PRIMARY KEY(plan_id,plan_version,observation_key));
CREATE TABLE IF NOT EXISTS travel_episodes(trip_id TEXT NOT NULL, observation_key TEXT NOT NULL, episode INTEGER NOT NULL, fingerprint TEXT, status TEXT NOT NULL, event_id TEXT NOT NULL, applied_request_id TEXT, PRIMARY KEY(trip_id,observation_key));
CREATE TABLE IF NOT EXISTS travel_adjustment_receipts(request_id TEXT PRIMARY KEY NOT NULL, request_digest TEXT NOT NULL, context_json TEXT NOT NULL, observations_json TEXT NOT NULL, decision_json TEXT, result_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS travel_adjustment_handoffs(intent_id TEXT PRIMARY KEY NOT NULL, request_id TEXT NOT NULL UNIQUE REFERENCES travel_adjustment_receipts(request_id), content_json TEXT NOT NULL);
`;
export const TRAVEL_ADJUSTMENT_MIGRATION_NAME='旅行变化原子观察与版本交接';
export class TravelAdjustmentPersistence {
  constructor(private readonly db: DatabaseSync) {}
  /** 仅供规范领域边界校验原始持久事实，不代表已授权邮件消费。 */
  storedRequest(requestId:string) {
    const row=this.db.prepare('SELECT * FROM travel_adjustment_receipts WHERE request_id=?').get(requestId);
    const handoff=this.db.prepare('SELECT intent_id,request_id,content_json FROM travel_adjustment_handoffs WHERE request_id=?').get(requestId);
    if(!row||!handoff)return undefined;
    return {requestId:String(row.request_id),digest:String(row.request_digest),
      context:JSON.parse(String(row.context_json)) as TravelAdjustmentContext,
      observations:JSON.parse(String(row.observations_json)) as TravelAdjustmentObservation[],
      decision:row.decision_json===null?null:JSON.parse(String(row.decision_json)) as TravelAdjustmentDecision,
      receipt:JSON.parse(String(row.result_json)) as TravelAdjustmentReceipt,
      handoff:JSON.parse(String(handoff.content_json)) as TravelAdjustmentHandoff,
      intentId:String(handoff.intent_id),handoffRequestId:String(handoff.request_id)};
  }
  hasUniqueAppliedHandoff(requestId:string,planId:string,version:number):boolean {
    const rows=this.db.prepare(`SELECT h.request_id FROM travel_adjustment_handoffs h
      JOIN travel_adjustment_receipts r ON r.request_id=h.request_id
      WHERE json_extract(r.result_json,'$.status')='applied'
      AND json_extract(h.content_json,'$.replacement.plan.id')=?
      AND json_extract(h.content_json,'$.replacement.plan.version')=? LIMIT 2`).all(planId,version);
    return rows.length===1&&rows[0]!.request_id===requestId;
  }
  emailJobRequests(planId:string,version:number,jobId:string,recipientRevision:number):string[] {
    return this.db.prepare("SELECT request_id,intent_id FROM travel_adjustment_handoffs WHERE json_extract(content_json,'$.replacement.plan.id')=? AND json_extract(content_json,'$.replacement.plan.version')=?").all(planId,version)
      .filter(row=>createHash('sha256').update(JSON.stringify(['travel-adjustment',String(row.intent_id),recipientRevision])).digest('hex')===jobId)
      .map(row=>String(row.request_id));
  }
  bindDraft(planId:string,version:number,base:TravelAdjustmentContext,observations:TravelAdjustmentObservation[],proposalDigest:string):void {
    this.db.prepare('INSERT INTO travel_adjustment_drafts VALUES(?,?,?,?,?)').run(planId,version,JSON.stringify(base),bookingRelationshipDigest(observations),proposalDigest);
  }
  matchesDraft(planId:string,version:number,base:TravelAdjustmentContext,observations:TravelAdjustmentObservation[],proposalDigest:string):boolean {
    const row=this.db.prepare('SELECT * FROM travel_adjustment_drafts WHERE plan_id=? AND plan_version=?').get(planId,version);
    return Boolean(row&&row.base_json===JSON.stringify({...base,draft:null,draftBlueprint:null})&&row.observation_digest===bookingRelationshipDigest(observations)&&row.proposal_digest===proposalDigest);
  }
  phase(tripId: string): TravelPhase {
    const row=this.db.prepare('SELECT content_json FROM travel_phases WHERE trip_id=?').get(tripId);
    return row ? JSON.parse(String(row.content_json)) : {value:'unknown',revision:0,basis:'unresolved',recordedAt:'1970-01-01T00:00:00.000Z',evidenceRefs:[]};
  }
  savePhase(tripId: string, phase: TravelPhase): void {
    this.db.prepare('INSERT INTO travel_phases VALUES(?,?,?) ON CONFLICT(trip_id) DO UPDATE SET revision=excluded.revision,content_json=excluded.content_json').run(tripId,phase.revision,JSON.stringify(phase));
  }
  observations(planId: string, version: number): Array<{observation:TravelAdjustmentObservation;lastReliable:TravelAdjustmentObservation|null}> {
    return this.db.prepare('SELECT content_json,reliable_json FROM travel_observations WHERE plan_id=? AND plan_version=? ORDER BY observation_key').all(planId,version).map(row=>({observation:JSON.parse(String(row.content_json)),lastReliable:row.reliable_json ? JSON.parse(String(row.reliable_json)):null}));
  }
  observationDigest(planId: string, version: number): string { return bookingRelationshipDigest(this.observations(planId,version)); }
  observe(context: TravelAdjustmentContext, observations: TravelAdjustmentObservation[], trusted: boolean, recover: boolean): TravelAdjustmentEvent[] {
    const events: TravelAdjustmentEvent[]=[]; const plan=context.execution!; const trip=context.blueprint?.id??plan.id;
    for(const o of observations) {
      const identity=bookingRelationshipDigest({sourceKind:o.sourceKind,objectRef:o.objectRef,targetDate:o.targetDate,timeZone:o.timeZone});
      const hasIdentity=typeof o.fingerprint==='string'&&o.fingerprint.trim().length>0;
      const reliable=trusted&&(o.status==='unchanged'||o.status==='changed'&&hasIdentity);
      this.db.prepare(`INSERT INTO travel_observations VALUES(?,?,?,?,?) ON CONFLICT(plan_id,plan_version,observation_key) DO UPDATE SET content_json=excluded.content_json,reliable_json=COALESCE(excluded.reliable_json,travel_observations.reliable_json)`).run(plan.id,plan.version,o.key,JSON.stringify(o),reliable?JSON.stringify(o):null);
      const old=this.db.prepare('SELECT episode,fingerprint,status,event_id FROM travel_episodes WHERE trip_id=? AND observation_key=?').get(trip,identity) as {episode:number;fingerprint:string|null;status:TravelAdjustmentEvent['status'];event_id:string}|undefined;
      let event:TravelAdjustmentEvent|undefined;
      if (trusted && o.status==='changed' && hasIdentity) {
        const episode=old && old.status!=='recovered' ? old.episode : (old?.episode??0)+1;
        event={key:o.key,eventId:old && old.status!=='recovered'?old.event_id:bookingRelationshipDigest({trip,identity,episode}),episode,fingerprint:o.fingerprint,status:'open'};
      } else if (old && trusted && ((o.status==='unchanged' && recover))) event={key:o.key,eventId:old.event_id,episode:old.episode,fingerprint:null,status:'recovered'};
      else if (old) event={key:o.key,eventId:old.event_id,episode:old.episode,fingerprint:old.fingerprint,status:old.status};
      if(event){events.push(event);this.db.prepare('INSERT INTO travel_episodes VALUES(?,?,?,?,?,?,NULL) ON CONFLICT(trip_id,observation_key) DO UPDATE SET episode=excluded.episode,fingerprint=excluded.fingerprint,status=excluded.status,event_id=excluded.event_id,applied_request_id=CASE WHEN travel_episodes.episode=excluded.episode THEN travel_episodes.applied_request_id ELSE NULL END').run(trip,identity,event.episode,event.fingerprint,event.status,event.eventId);}
    }
    return events;
  }
  consumed(events:TravelAdjustmentEvent[]):boolean {return events.some(event=>Boolean(this.db.prepare('SELECT applied_request_id FROM travel_episodes WHERE event_id=? AND applied_request_id IS NOT NULL').get(event.eventId)));}
  coversChanges(observations:TravelAdjustmentObservation[],events:TravelAdjustmentEvent[]):boolean {
    const changed=observations.filter(o=>o.status==='changed');
    return changed.length>0&&events.length===changed.length&&new Set(events.map(e=>e.eventId)).size===events.length&&changed.every(o=>
      typeof o.fingerprint==='string'&&o.fingerprint.trim().length>0&&events.some(e=>e.key===o.key&&e.fingerprint===o.fingerprint&&e.status==='open'&&Boolean(this.db.prepare("SELECT 1 FROM travel_episodes WHERE event_id=? AND episode=? AND status='open' AND fingerprint=?").get(e.eventId,e.episode,e.fingerprint))));
  }
  consume(events:TravelAdjustmentEvent[],requestId:string):void {
    if(!events.length||new Set(events.map(e=>e.eventId)).size!==events.length)throw new Error('旅行变化缺少唯一可消费事件。');
    for(const event of events){
      if(event.status!=='open'||typeof event.fingerprint!=='string'||!event.fingerprint.trim())throw new Error('旅行事件尚不可消费。');
      const result=this.db.prepare("UPDATE travel_episodes SET applied_request_id=? WHERE event_id=? AND episode=? AND fingerprint=? AND status='open' AND applied_request_id IS NULL").run(requestId,event.eventId,event.episode,event.fingerprint);
      if(Number(result.changes)!==1)throw new Error('旅行事件消费失败，请重新核实当前安排。');
    }
  }
  receipt(requestId: string): TravelAdjustmentReceipt|undefined {
    const row=this.db.prepare('SELECT result_json FROM travel_adjustment_receipts WHERE request_id=?').get(requestId);
    if(!row)return undefined;
    const result=JSON.parse(String(row.result_json)) as TravelAdjustmentReceipt;
    const handoff=this.db.prepare('SELECT content_json FROM travel_adjustment_handoffs WHERE request_id=?').get(requestId);
    if(handoff)result.handoff=JSON.parse(String(handoff.content_json));
    return result;
  }
  receiptForPlan(planId:string,version:number):TravelAdjustmentReceipt|undefined {
    const row=this.db.prepare("SELECT request_id FROM travel_adjustment_handoffs WHERE json_extract(content_json,'$.replacement.plan.id')=? AND json_extract(content_json,'$.replacement.plan.version')=? ORDER BY rowid DESC LIMIT 1").get(planId,version);
    return row?this.receipt(String(row.request_id)):undefined;
  }
  appliedInput(input:TravelAdjustmentInput):TravelAdjustmentReceipt|undefined {
    const row=this.db.prepare("SELECT request_id FROM travel_adjustment_receipts WHERE context_json=? AND observations_json=? AND json_extract(result_json,'$.status')='applied' ORDER BY rowid LIMIT 1").get(JSON.stringify(input.context),JSON.stringify(input.observations));
    return row?this.receipt(String(row.request_id)):undefined;
  }
  requestDigest(requestId: string): string|undefined { const row=this.db.prepare('SELECT request_digest FROM travel_adjustment_receipts WHERE request_id=?').get(requestId);return row?String(row.request_digest):undefined; }
  save(requestId:string,digest:string,context:TravelAdjustmentContext,observations:TravelAdjustmentObservation[],decision:unknown,receipt:TravelAdjustmentReceipt):void {
    this.db.prepare('INSERT INTO travel_adjustment_receipts VALUES(?,?,?,?,?,?)').run(requestId,digest,JSON.stringify(context),JSON.stringify(observations),decision?JSON.stringify(decision):null,JSON.stringify(receipt));
    if(receipt.handoff)this.db.prepare('INSERT INTO travel_adjustment_handoffs VALUES(?,?,?)').run(receipt.handoff.intentId,requestId,JSON.stringify(receipt.handoff));
  }
  pending():TravelAdjustmentHandoff[]{ return this.db.prepare("SELECT content_json FROM travel_adjustment_handoffs WHERE json_extract(content_json,'$.status')='pending' ORDER BY rowid").all().map(row=>JSON.parse(String(row.content_json))); }
  acknowledge(intentId:string,readbackRef:string):TravelAdjustmentHandoff {
    if(!readbackRef.trim())throw new Error('交接缺少持久消费读回。');
    const row=this.db.prepare('SELECT content_json FROM travel_adjustment_handoffs WHERE intent_id=?').get(intentId);
    if(!row)throw new Error('旅行交接不存在。');
    const handoff=JSON.parse(String(row.content_json)) as TravelAdjustmentHandoff;
    if(handoff.status==='acknowledged' && handoff.readbackRef!==readbackRef)throw new Error('旅行交接读回身份冲突。');
    handoff.status='acknowledged';handoff.readbackRef=readbackRef;
    this.db.prepare('UPDATE travel_adjustment_handoffs SET content_json=? WHERE intent_id=?').run(JSON.stringify(handoff),intentId);
    return handoff;
  }
}
