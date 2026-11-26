import { useEffect, useState } from "react";
import "./booking-relationship-review.css";
import type { BlueprintBookingConstraint,BlueprintBookingSegment,Plan, TripBlueprint } from "@c-assistant/core";
import {isProtectedBookingSourceConstraint,type BookingSourceLegacyBinding} from "@c-assistant/core/booking-source-selection";
import type { BookingRelationship, BookingRelationshipAssessment, BookingRelationshipUnit } from "@c-assistant/core/booking-relationship";
import { canonicalBookingRelationshipJson } from "@c-assistant/core/booking-relationship";
import { getBookingRelationshipReview, safePlanError, type DirectBlueprintRevisionInput } from "./api-client.js";
import { bookingTargetLabel, readableBookingEvidence, invalidRelationTargets, bookingWallTimeLabel,bookingTimeZoneLabel,bookingNeedsLegacyBinding,initialLegacySourceBindings,checkedLegacySourceBindings,type BookingSourceChoice,type BookingRelationshipReviewContext } from "./booking-relationship-review.js";

export function BookingRelationshipReviewPanel({ plan, blueprint, busy, onSave, onError, onClose,onReplan }: { plan: Plan; blueprint: TripBlueprint; busy: boolean; onSave: (revision: DirectBlueprintRevisionInput) => Promise<void>; onError: (message: string) => void; onClose: () => void;onReplan?:()=>void }) {
  const [context, setContext] = useState<BookingRelationshipReviewContext | null>(null);
  const [units, setUnits] = useState<BookingRelationshipUnit[]>([]);
  const [reviewed, setReviewed] = useState<Set<number>>(new Set());
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [legacyBindings,setLegacyBindings]=useState<BookingSourceLegacyBinding[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [rationale, setRationale] = useState("");
  const [source, setSource] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true; setLoading(true); setFailed(false);
    void getBookingRelationshipReview(plan, blueprint).then((value) => {
      if (!current) return;
      setContext(value); setReviewed(new Set());setLegacyBindings(initialLegacySourceBindings(value.constraints));setSelectedSources([...new Set(value.constraints.flatMap(booking=>booking.sourceBookingId&&value.sourceCandidates.some(source=>source.bookingId===booking.sourceBookingId)?[booking.sourceBookingId]:[]))]);
      setUnits(value.units.map((unit) => {
        const prior = value.assessment?.units.find((item) => item.bookingConstraintId === unit.bookingConstraintId && item.segmentId === unit.segmentId);
        return { ...unit, coverage: prior?.coverage ?? "unknown", relations: structuredClone(prior?.relations ?? []).map((relation) => ({ ...relation, evidenceRefs: readableBookingEvidence(relation.evidenceRefs, blueprint) })), rationale: prior?.rationale ?? "", evidenceRefs: readableBookingEvidence(prior?.evidenceRefs ?? [], blueprint) };
      }));
    }).catch(() => { if (current) { setFailed(true); onError("Booking relationships could not be checked. Your pending edits are kept. Try loading them again."); } }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [plan.id, plan.version, blueprint.id, blueprint.version, attempt]);
  function update(index: number, patch: Partial<BookingRelationshipUnit>) { setUnits((items) => items.map((item, i) => i === index ? { ...item, ...patch } : item)); setReviewed((items) => { const next = new Set(items); next.delete(index); return next; }); }
  function relation(index: number, relationIndex: number, patch: Partial<BookingRelationship>) { update(index, { relations: units[index]!.relations.map((item, i) => i === relationIndex ? { ...item, ...patch } : item) }); }
  function legacyBinding(id:string,patch:Partial<BookingSourceLegacyBinding>){setLegacyBindings(values=>values.map(value=>value.bookingConstraintId===id?{...value,...patch}:value));}
  const checkedBindings=context?checkedLegacySourceBindings(context,legacyBindings,selectedSources):null;
  async function saveSources(){if(!context||!checkedBindings||!selectedSources.length)return;try{await onSave({kind:"select_booking_sources",sourceBookingIds:selectedSources,expectedSourceSetDigest:context.sourceSetDigest,legacyBindings:checkedBindings});setAttempt(value=>value+1);}catch(caught){onError(safePlanError(caught));}}
  async function save() {
    if (!context || reviewed.size !== units.length || !rationale.trim() || !source.trim() || context.sourceIssues.length) return;
    const assessment: BookingRelationshipAssessment = { schemaVersion: 1, blueprintId: context.blueprintId, blueprintVersion: context.blueprintVersion, universeDigest: context.universeDigest, status: "reviewed", units, decision: { source: "traveler", actorId: "local-traveler", decidedAt: new Date().toISOString(), rationale: rationale.trim(), evidenceRefs: [source.trim()], obligations: [units.some((unit) => unit.coverage === "complete") ? "我已明确核对声明完整的各预订单元、全部目标及直接、间接和跨日依赖。" : "我确认仍有尚未核对内容，本次不作完整无影响排除。"] } };
    try { await onSave({ kind: "review_booking_relationships", assessment, expectedSourceSetDigest: context.sourceSetDigest }); onClose(); }
    catch (caught) { onError(safePlanError(caught)); }
  }
  return <section className="blueprint-relationship-review" aria-label="审阅预订关联">
    <h3>审阅预订关联</h3><p>逐项核对预订与全部行程位置、交通和跨日依赖。保存审阅会建立新草稿；批准生成与批准执行仍需分别确认。</p>
    {loading ? <p role="status">Loading current bookings and itinerary…</p> : null}
    {failed ? <button type="button" onClick={() => setAttempt((value) => value + 1)}>重新读取关联资料</button> : null}
    {context ? <fieldset disabled={busy || loading}>
      {context.sourceIssues.length ? <section><h4>先恢复原预订来源</h4><p>Some older records have no verified source booking. Select and save the records used for this trip, then review their relationships again. Your pending edits are kept for review.</p>
        <p role="alert">{context.sourceIssues.length} booking source {context.sourceIssues.length === 1 ? "issue needs" : "issues need"} review. Compare the original booking records below.</p>
        <p>If the source history cannot be verified, keep this draft and replan using booking details you have confirmed. Your draft and pending edits are kept while planning is unavailable.</p>{onReplan?<button type="button" onClick={onReplan}>保留此草稿，重新核对并规划</button>:null}
        <h5>原行程采用的预订快照</h5>{context.constraints.map(item=>{
          const draft=legacyBindings.find(value=>value.bookingConstraintId===item.id);const needsBinding=bookingNeedsLegacyBinding(item);const selected=context.sourceCandidates.find(source=>source.bookingId===draft?.sourceBookingId);
          return <article className="booking-source-binding" key={item.id}><h5>{item.title}</h5>
            <div className="booking-source-comparison"><section><h6>原行程保存的结构</h6><SourceStructure booking={item} historical /></section><section><h6>明确选择的真实资料</h6>{selected?<SourceStructure booking={selected}/>:<p>Select the source booking explicitly. Matching names or dates do not establish its identity.</p>}</section></div>
            {needsBinding&&draft?<fieldset><legend>{isProtectedBookingSourceConstraint(item)?"固定承诺：必须明确完整对应":"旧记录身份对应（如声明恢复原记录）"}</legend>
              <label>为「{item.title}」选择真实预订<select value={draft.sourceBookingId} disabled={Boolean(item.sourceBookingId)} onChange={event=>{const id=event.target.value;legacyBinding(item.id,{sourceBookingId:id,segments:item.segments.map(segment=>({segmentId:segment.id,sourceSegmentId:segment.sourceSegmentId??""})),rationale:"",evidenceRefs:[]});if(id)setSelectedSources(values=>values.includes(id)?values:[...values,id]);}}><option value="">请选择，不自动匹配</option>{context.sourceCandidates.map(source=><option key={source.bookingId} value={source.bookingId}>{source.title} · {source.sourceLabel}</option>)}</select></label>
              {item.segments.map((segment,index)=><label key={segment.id}>为原分段 {index+1}「{segment.title??"预订分段"}」选择真实分段<select disabled={!selected||Boolean(segment.sourceSegmentId)} value={draft.segments.find(pair=>pair.segmentId===segment.id)?.sourceSegmentId??""} onChange={event=>legacyBinding(item.id,{segments:draft.segments.map(pair=>pair.segmentId===segment.id?{...pair,sourceSegmentId:event.target.value}:pair)})}><option value="">请选择具体分段</option>{selected?.segments.map((source,sourceIndex)=><option key={source.id} value={source.sourceSegmentId}>{sourceIndex+1} · {source.title??"预订分段"} · {bookingWallTimeLabel(source.startAtLocal)} — {bookingWallTimeLabel(source.endAtLocal)}</option>)}</select></label>)}
              {!item.segments.length?<p>This record has no segments. The selected source must also have no segments to establish a complete match.</p>:null}
              <label>为何认定「{item.title}」对应所选资料<textarea value={draft.rationale} onChange={event=>legacyBinding(item.id,{rationale:event.target.value})}/></label>
              <label>「{item.title}」的对应依据<input value={draft.evidenceRefs.join("；")} onChange={event=>legacyBinding(item.id,{evidenceRefs:event.target.value.split("；").map(value=>value.trim()).filter(Boolean)})} placeholder="例如：本人逐项核对原始预订材料的声明"/></label>
            </fieldset>:<p>The source identity is already established. Preserve the complete fixed booking structure when reviewing it.</p>}
          </article>;
        })}
        <h5>请选择实际采用的原始记录</h5>{context.sourceCandidates.map(item=>{const adopted=context.constraints.some(booking=>booking.sourceBookingId===item.bookingId);return <article key={item.bookingId}><label><input type="checkbox" disabled={adopted} checked={selectedSources.includes(item.bookingId)} onChange={event=>{setSelectedSources(values=>event.target.checked?[...values,item.bookingId]:values.filter(id=>id!==item.bookingId));if(!event.target.checked)setLegacyBindings(values=>values.map(value=>value.sourceBookingId===item.bookingId?{...value,sourceBookingId:"",segments:value.segments.map(pair=>({...pair,sourceSegmentId:""})),rationale:"",evidenceRefs:[]}:value));}}/>{item.title} · {item.sourceLabel}</label><p>{adopted?"Used by this version":context.pendingSourceBookingIds.includes(item.bookingId)?"Saved and awaiting review":"Historical candidate, awaiting explicit selection"}</p><SourceStructure booking={item}/></article>;})}
        {!context.sourceCandidates.length ? <p>No source bookings are available. Add or correct the booking details before reviewing again.</p> : null}
        {!checkedBindings?<p>Match each fixed booking and all of its segments, with reasons and evidence. Each source booking or segment can be used only once.</p>:null}
        <p>After saving the sources, review their relationships separately. If a fixed structure differs, check the booking details or ask Landi to replan. Your pending edits are kept.</p>
        <button type="button" disabled={!selectedSources.length||!checkedBindings} onClick={()=>void saveSources()}>保存所选原预订并重新核对</button>
      </section> : null}
      <section className="booking-review-inventory"><h4>本次须核对的完整日程与交通清单</h4><p>即使声明没有关联，也请逐项核对以下位置、交通及其直接、间接和跨日依赖。</p><ul>{context.targets.map((target) => <li key={canonicalBookingRelationshipJson(target)}>{bookingTargetLabel(target, blueprint)}</li>)}</ul>{!context.targets.length ? <p>This itinerary has no available relationship targets.</p> : null}</section>
      {units.map((unit, index) => { const booking = context.constraints.find((item) => item.id === unit.bookingConstraintId); const segment = booking?.segments.find((item) => item.id === unit.segmentId); return <section className="booking-review-unit" key={canonicalBookingRelationshipJson([unit.bookingConstraintId, unit.segmentId])}>
        <h4>{booking?.title ?? "Booking details need review"}{segment ? ` · ${segment.title ?? "预订分段"}` : ""}</h4>
        <p>请检查下方全部可选位置与交通，包括间接和跨日依赖。没有关联时保留空列表，并明确完整审阅。</p>
        {unit.relations.map((item, relationIndex) => <fieldset key={item.id}><legend>关联 {relationIndex + 1}</legend>
          {invalidRelationTargets(item, context.targets).length ? <p role="alert">A stop or journey in this relationship has changed. Remove the old relationship and create a new one.</p> : null}
          <label>关系范围<select value={item.scope} onChange={(event) => relation(index, relationIndex, { scope: event.target.value as BookingRelationship["scope"], targets: [], ...(event.target.value === "dependency" ? { direction: "booking_depends_on_targets" as const } : {}) })}><option value="occurrence">具体出现位置</option><option value="place_global">地点的全部出现位置</option><option value="dependency">明确依赖（可跨日或交通）</option></select></label>
          {item.scope === "dependency" ? <p>This booking depends on every selected target. Review the relationship when any target changes.</p> : null}
          <label>业务作用<select value={item.role} onChange={(event) => relation(index, relationIndex, { role: event.target.value as BookingRelationship["role"] })}><option value="direct_commitment">直接承诺</option><option value="resource_dependency">资源依赖</option><option value="itinerary_context">行程上下文</option></select></label>
          <div className="booking-review-targets">{context.targets.filter((target) => item.scope === "dependency" || target.kind === item.scope).map((target) => { const key = canonicalBookingRelationshipJson(target); return <label key={key}><input type="checkbox" checked={item.targets.some((value) => canonicalBookingRelationshipJson(value) === key)} onChange={(event) => relation(index, relationIndex, { targets: event.target.checked ? [...item.targets, target] : item.targets.filter((value) => canonicalBookingRelationshipJson(value) !== key) })} />{bookingTargetLabel(target, blueprint)}</label>; })}</div>
          <div>{([['remove', '删除'], ['move', '移动或重排'], ['add', '添加'], ['priority', '优先级']] as const).map(([operation, label]) => <label key={operation}><input type="checkbox" checked={item.operations.includes(operation)} onChange={(event) => relation(index, relationIndex, { operations: event.target.checked ? [...item.operations, operation] : item.operations.filter((value) => value !== operation) })} />{label}需复核</label>)}</div>
          <label>关联理由<textarea value={item.rationale} onChange={(event) => relation(index, relationIndex, { rationale: event.target.value })} /></label><label>关联来源<input value={item.evidenceRefs.join("；")} onChange={(event) => relation(index, relationIndex, { evidenceRefs: event.target.value.split("；").filter(Boolean) })} /></label>
          <button type="button" onClick={() => update(index, { relations: unit.relations.filter((_, i) => i !== relationIndex) })}>移除此关联</button>
        </fieldset>)}
        <button type="button" onClick={() => update(index, { relations: [...unit.relations, { id: crypto.randomUUID(), scope: "occurrence", targets: [], role: "itinerary_context", operations: ["remove", "move", "add", "priority"], rationale: "", evidenceRefs: [] }] })}>建立关联</button>
        <label>审阅范围<select value={unit.coverage} onChange={(event) => update(index, { coverage: event.target.value as BookingRelationshipUnit["coverage"] })}><option value="unknown">尚未核对</option><option value="partial">只核对部分</option><option value="complete">已核对全部目标及直接、间接和跨日依赖</option></select></label>
        <label>本项判断理由<textarea value={unit.rationale} onChange={(event) => update(index, { rationale: event.target.value })} /></label><label>本项来源<input value={unit.evidenceRefs.join("；")} onChange={(event) => update(index, { evidenceRefs: event.target.value.split("；").filter(Boolean) })} /></label>
        <label><input type="checkbox" checked={reviewed.has(index)} disabled={!unit.rationale.trim() || !unit.evidenceRefs.length || unit.relations.some((item) => invalidRelationTargets(item, context.targets).length > 0 || !item.targets.length || !item.operations.length || !item.rationale.trim() || !item.evidenceRefs.length)} onChange={(event) => setReviewed((values) => { const next = new Set(values); if (event.target.checked) next.add(index); else next.delete(index); return next; })} />{unit.coverage !== "complete" ? "我确认本项仍有尚未核对的内容，不将其视为完整排除" : unit.relations.length ? "我已核对本项关联、全部目标及直接、间接和跨日依赖" : "我已核对全部目标及直接、间接和跨日依赖，明确没有关联"}</label>
      </section>; })}
      <label>整体审阅理由<textarea value={rationale} onChange={(event) => setRationale(event.target.value)} /></label><label>整体审阅来源<input value={source} onChange={(event) => setSource(event.target.value)} placeholder="例如：本人预订记录与逐日行程核对" /></label>
      <button type="button" disabled={Boolean(context.sourceIssues.length) || reviewed.size !== units.length || !rationale.trim() || !source.trim()} onClick={() => void save()}>单独保存关联审阅</button>
    </fieldset> : null}<button type="button" disabled={busy} onClick={onClose}>返回待确认草稿</button>
  </section>;
}

const sourceTypeLabels:Record<string,string>={accommodation:"住宿",flight:"航班",train:"火车",rental_car:"租车",event:"活动",tour:"行程服务",ticket:"门票",restaurant:"餐饮",other:"其他预订"};
const segmentTypeLabels:Record<string,string>={flight_leg:"航班分段",train_leg:"火车分段",hotel_stay:"住宿期间",rental_pickup:"取车",rental_return:"还车",event_window:"活动时段",other:"其他分段"};
const statusLabel=(value:string|undefined)=>value==="confirmed"?"已保存为确认":value==="cancelled"?"已取消":value==="pending"?"尚待确认":"Needs review";
const strengthLabel=(value:string|undefined)=>value==="hard"?"硬约束":value==="soft"?"软约束":value==="ignored"?"已忽略":"Constraint strength needs review";
function SourceStructure({booking,historical=false}:{booking:BlueprintBookingConstraint|BookingSourceChoice;historical?:boolean}) {
  return <div className="booking-source-structure"><strong>{booking.title}</strong><dl><dt>预订类型</dt><dd>{sourceTypeLabels[booking.type]??"Type needs review"}</dd><dt>保存状态</dt><dd>{statusLabel(booking.status)}</dd><dt>预订整体约束</dt><dd>{strengthLabel(booking.constraintStrength)}</dd><dt>资料来源</dt><dd>{booking.sourceLabel||"Source needs review"}</dd></dl>
    {booking.segments.map((segment,index)=><section key={segment.id}><h6>分段 {index+1}：{segment.title??"预订分段"}</h6><dl><dt>分段类型</dt><dd>{segmentTypeLabels[segment.segmentType]??"Type needs review"}</dd><dt>分段状态</dt><dd>{segment.status===undefined&&historical?`历史未单独记录；本次保护核对按原预订的${statusLabel(booking.status)}处理`:statusLabel(segment.status)}</dd><dt>开始当地时间</dt><dd>{bookingWallTimeLabel(segment.startAtLocal)} · {bookingTimeZoneLabel(segment.startTimeZone)}</dd><dt>结束当地时间</dt><dd>{bookingWallTimeLabel(segment.endAtLocal)} · {bookingTimeZoneLabel(segment.endTimeZone)}</dd><dt>出发位置</dt><dd>{segment.origin||"未记录"}</dd><dt>到达位置</dt><dd>{segment.destination||"未记录"}</dd><dt>场所或住宿位置</dt><dd>{segment.location||"未记录"}</dd><dt>分段约束</dt><dd>{strengthLabel(segment.constraintStrength)}</dd><dt>固定承诺</dt><dd>{segment.fixedCommitment?"是":"未标记为固定承诺"}</dd><dt>已记录的复核原因</dt><dd>{segment.needsReviewReasons?.length?segment.needsReviewReasons.join("；"):"未记录"}</dd></dl></section>)}
    {!booking.segments.length?<p>No booking segments are recorded.</p>:null}
  </div>;
}
