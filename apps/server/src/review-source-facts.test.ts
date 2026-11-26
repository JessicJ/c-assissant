import assert from 'node:assert/strict';
import test from 'node:test';
import type { TravelAdjustmentCandidate,TravelAdjustmentObservation } from '@c-assistant/core';
import {reviewSourceFacts} from './review-source-facts.js';
const project=(candidate?:TravelAdjustmentCandidate)=>reviewSourceFacts({sourceKind:candidate?.kind??'venue',candidate,provider:'private-provider',reason:'private-reason',evidenceRefs:['private-ref']} as TravelAdjustmentObservation);
test('公开候选只展示事实，不按闭馆或天气数值判定影响',()=>{
 const venue=JSON.stringify(project({kind:'venue',name:'虚构美术馆',city:'虚构城',queryObservedAt:null,matches:[{placeId:'private-place',name:'虚构美术馆',city:'虚构城',status:'temporarily_closed'}]}));
 assert.match(venue,/虚构美术馆.*Temporarily closed/);assert.ok(!venue.includes('private-'));assert.ok(!venue.includes('重大'));
 const weather=JSON.stringify(project({kind:'weather_current',locationName:'虚构城',condition:'暴雨',conditionCode:'502',observedAt:null,temperatureC:19,precipitationMm:80}));
 for(const text of ['Current weather','This does not establish weather on the travel date.','暴雨','80 mm','19 °C'])assert.ok(weather.includes(text),text);
 assert.ok(!weather.includes('502'));
 const forecast=project({kind:'weather_forecast',locationName:'虚构城',date:'2026-12-01',conditionDay:'小雨',conditionNight:'阴',highC:23,lowC:14,uvIndex:2});
 assert.ok(forecast.some(f=>f.date==='2026-12-01'));assert.match(JSON.stringify(forecast),/Actual conditions may change./);
});
test('保存预订展示取消、约束和当地分段时刻，不回显内部标识或自由状态',()=>{
 const facts=project({kind:'saved_booking',bookingId:'private-booking',segmentId:'private-segment',status:'cancelled',segmentStatus:'private-status',bookingConstraintStrength:'hard',segmentConstraintStrength:'soft',fixedCommitment:true,startAtLocal:'2026-12-01T10:30',endAtLocal:'2026-12-01T11:30',startTimeZone:'private-zone'});
 const rendered=JSON.stringify(facts);for(const text of ['Cancelled','Required constraint','Flexible constraint','Fixed commitment','This is not a live update from the provider.'])assert.ok(rendered.includes(text),text);
 assert.ok(facts.some(f=>f.localDateTime==='2026-12-01T10:30'));assert.ok(!rendered.includes('private-'));
 assert.deepEqual(project(),[]);
});
