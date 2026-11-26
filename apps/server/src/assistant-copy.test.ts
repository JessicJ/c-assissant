import assert from 'node:assert/strict';
import test from 'node:test';
import {createPlanFromDraft} from '@c-assistant/core';
import {dayGreeting,nextActivityCopy} from './assistant-copy.js';
test('greetings use the destination clock, not the server clock',()=>{
 assert.match(dayGreeting(new Date('2026-11-04T18:30:00Z'),'Pacific/Auckland'),/Good morning|Morning!/);
 assert.match(dayGreeting(new Date('2026-11-04T18:30:00Z'),'America/Los_Angeles'),/Good morning|Morning!/);
 assert.equal(dayGreeting(new Date('2026-11-04T18:30:00Z'),'Asia/Shanghai'),'');
});
test('base changes name the destination and remind about bags without inventing bookings',()=>{
 const plan=createPlanFromDraft({title:'NZ',location:'NZ',dates:'2026-11-05',stages:[],knownInformation:[],assumptions:[],nextAction:'Travel'});
 const text=nextActivityCopy(plan,{id:'transfer',dayId:'day',date:'2026-11-05',city:'Rotorua',title:'Hobbiton Movie Set',time:'08:00',needsMovement:true,isTransfer:true,role:'Base-change transfer',preparation:[]},true,true);
 assert.match(text,/heading to Hobbiton.*leave at 08:00.*all your bags/s);
 assert.doesNotMatch(text,/Next up:|Base-change transfer|confirmed booking/);
});


test('consecutive mornings vary and arrival never assumes sleep or landing', () => {
 const first = dayGreeting(new Date('2026-11-04T18:30:00Z'), 'Pacific/Auckland');
 const next = dayGreeting(new Date('2026-11-05T18:30:00Z'), 'Pacific/Auckland');
 assert.notEqual(first, next);
 assert.equal(first, dayGreeting(new Date('2026-11-04T18:30:00Z'), 'Pacific/Auckland'), 'Retries keep the same wording');
 assert.doesNotMatch(first + next, /slept well|sunny|rain/);
 const plan = createPlanFromDraft({title:'NZ',location:'NZ',dates:'2026-11-05',stages:[],knownInformation:[],assumptions:[],nextAction:'Travel'});
 const activity = {id:'arrival',dayId:'day',date:'2026-11-05',city:'Auckland',title:'Auckland Airport',needsMovement:false,isTransfer:false,role:'international arrival',preparation:[]};
 assert.equal(dayGreeting(new Date('2026-11-04T18:30:00Z'), 'Pacific/Auckland', {plan, activity}), '');
 assert.match(dayGreeting(new Date('2026-11-04T18:30:00Z'), 'Pacific/Auckland', {plan, activity:{...activity,role:'Base-change transfer',city:'Rotorua'}}), /heading to Rotorua/);
});
