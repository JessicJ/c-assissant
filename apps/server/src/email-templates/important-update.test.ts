import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {renderChangeEmail} from './change.js';
import type {ChangeEmailData,ImportantUpdateData} from './types.js';
const event=():ChangeEmailData=>({subject:'Test update',preheader:'Test only',brandLabel:'IMPORTANT UPDATE\nRotorua',footer:'',disclosure:'',sample:true,title:'A change to your visit',introduction:'A verified source affects the scheduled visit.',impact:'Review your options.',options:[],status:{kind:'proposed',explanation:'Your saved itinerary has not been updated.'},links:[],note:'',update:{kind:'arrival_conflict',city:'Rotorua',tripDate:'2026-11-06',verification:{kind:'estimated',sourceName:'Illustrative route estimate',checkedAt:'2026-11-06T00:00:00Z'},evaluatedAt:'2026-11-06T00:10:00Z',tag:'POSSIBLE LATE ARRIVAL',before:{label:'START',value:'wrong'},after:{label:'ARRIVAL',value:'wrong'},previewActionLabel:'Review route options',route:{date:'2026-11-06',departure:'13:30',durationMinutes:55,departureZone:'Pacific/Auckland',destinationZone:'Pacific/Auckland',scheduledStart:'14:00'}}});
test('ETA uses dated route evidence rather than supplied title or arbitrary comparison values',()=>{
 const d=event(),r=renderChangeEmail(d);assert.match(r.text,/You may arrive 25 min late/);assert.match(r.text,/14:00/);assert.match(r.text,/14:25/);assert.match(r.text,/\+25 min/);assert.doesNotMatch(r.text,/wrong/);assert.doesNotMatch(r.text,/ILLUSTRATIVE EXAMPLE|Source:/);assert.doesNotMatch(r.html,/href=/);
 for(const alter of [(u:ImportantUpdateData)=>{u.route!.durationMinutes=20;},(u:ImportantUpdateData)=>{delete u.route;},(u:ImportantUpdateData)=>{u.route!.destinationZone='Europe/London';},(u:ImportantUpdateData)=>{u.verification.checkedAt='2026-11-05T00:00:00Z';},(u:ImportantUpdateData)=>{u.route!.date='2026-11-07';}]){const bad=event();alter(bad.update!);assert.throws(()=>renderChangeEmail(bad));}
});
test('ETA is correct across midnight and daylight-saving boundaries',()=>{
 const d=event();d.update!.route={date:'2026-11-06',departure:'23:40',durationMinutes:90,departureZone:'Pacific/Auckland',destinationZone:'Pacific/Auckland',scheduledStart:'23:50'};const r=renderChangeEmail(d);assert.match(r.text,/01:10 \(\+1 day\)/);assert.match(r.text,/\+80 min/);
 const spring=event();spring.update!.tripDate='2026-03-08';spring.update!.route={date:'2026-03-08',departure:'01:30',durationMinutes:90,departureZone:'America/New_York',destinationZone:'America/New_York',scheduledStart:'03:30'};assert.match(renderChangeEmail(spring).text,/\+30 min/);
});
test('six kinds preserve independent external facts and Plan state',()=>{
 const cases=[['attraction_closure','confirmed','Temporarily closed'],['weather_impact','forecast','Heavy rain forecast'],['transport_disruption','confirmed','Cancelled'],['reservation_change','confirmed','Booking cancelled'],['opening_hours_change','confirmed','10:30 · Opens']] as const;
 for(const[kind,v,value]of cases){const d=event();d.update!.kind=kind;d.update!.verification.kind=v;d.update!.after.value=value;d.update!.tag=v.toUpperCase();delete d.update!.route;delete d.update!.delta;const r=renderChangeEmail(d);assert.ok(r.text.includes(value));assert.doesNotMatch(r.text,/saved itinerary has not been updated/);assert.doesNotMatch(r.text,/14:25|\+25 min/);assert.match(r.text,new RegExp(v,'i'));}
 const delayed=event();delayed.update!.kind='transport_disruption';delayed.update!.verification.kind='confirmed';delayed.update!.after.value='12:30 · Flight';delete delayed.update!.route;assert.match(renderChangeEmail(delayed).text,/12:30 · Flight/);
});
test('live structured events reject absent/expired/unsafe actions and incomplete evidence',()=>{
 const d=event();d.sample=false;assert.throws(()=>renderChangeEmail(d));d.update!.verification.sourceUrl='https://maps.google.com/';assert.throws(()=>renderChangeEmail(d));d.update!.action={label:'Review route',url:'https://review.example.org/event',expiresAt:'2026-11-06T01:00:00Z'};assert.match(renderChangeEmail(d).html,/href="https:\/\/review.example.org\/event"/);assert.doesNotMatch(renderChangeEmail(d).text,/ILLUSTRATIVE/);
 for(const url of ['javascript:alert(1)','https://review.landi.invalid/x','https://user:password@example.org/']){const bad=structuredClone(d);bad.update!.action!.url=url;assert.throws(()=>renderChangeEmail(bad));}
 const expired=structuredClone(d);expired.update!.action!.expiresAt='2026-11-06T00:09:00Z';assert.throws(()=>renderChangeEmail(expired));
 for(const alter of [(u:ImportantUpdateData)=>{u.verification.kind='confirmed';},(u:ImportantUpdateData)=>{u.verification.checkedAt='invalid';},(u:ImportantUpdateData)=>{u.verification.sourceName='';}]){const bad=structuredClone(d);alter(bad.update!);assert.throws(()=>renderChangeEmail(bad));}
});
test('original kit PNG bytes are deduplicated CID attachments and dynamic facts remain text',async()=>{
 const d=event();d.title='<unsafe>';d.update!.before.value='<script>';const r=renderChangeEmail(d);assert.doesNotMatch(r.html,/<script|data:image|file:\/\/|<svg|display:flex|display:grid/);assert.deepEqual([...new Set([...r.html.matchAll(/src="cid:([^"]+)"/g)].map(m=>m[1]))].sort(),r.attachments!.map(a=>a.cid).sort());
 for(const a of r.attachments!){assert.deepEqual(Buffer.from(a.contentBase64,'base64'),await readFile(new URL('./important-update-kit/'+a.filename,import.meta.url)));}assert.ok(r.html.includes('alt=""'));assert.match(r.text,/25 min/);
});
