import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { SqliteWorkspaceStore } from '../packages/storage/src/index.js';
import { compileExecutionItinerary } from '../apps/server/src/execution-itinerary.js';
import { sightseeingAssistantCopy } from '../apps/server/src/sightseeing-assistant-copy.js';
const root=resolve(import.meta.dirname,'..');
if(existsSync(resolve(root,'.env')))process.loadEnvFile(resolve(root,'.env'));
const store=new SqliteWorkspaceStore(process.env.C_ASSISTANT_DATA_PATH||resolve(root,'data/c-assistant.sqlite'));
try {
 const plan=store.getExecutionPlan()!;
 const visits=compileExecutionItinerary(plan).activities.filter(a=>!a.isTransfer && a.placeId && /redwoods|hobbiton/i.test(a.title));
 console.log(JSON.stringify(visits.map(visit=>{const place=plan.presentation!.places.find(p=>p.id===visit.placeId)!;return {name:place.name,copy:sightseeingAssistantCopy(place,visit),sections:place.detailSections};}),null,2));
}finally{store.close();}
