import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {SqliteWorkspaceStore} from '../packages/storage/src/index.js';
const root=resolve(import.meta.dirname,'..');
if(existsSync(resolve(root,'.env')))process.loadEnvFile(resolve(root,'.env'));
const store=new SqliteWorkspaceStore(process.env.C_ASSISTANT_DATA_PATH||resolve(root,'data/c-assistant.sqlite'));
try {
 const plan=store.getExecutionPlan()!;
 const days=plan.presentation?.days.filter(d=>d.date===process.argv[2])??[];
 console.log(JSON.stringify({version:plan.version,days:days.map(d=>({...d,blocks:d.blocks?.map(b=>({...b,place:plan.presentation?.places.find(p=>p.id===b.placeId)?.name}))}))},null,2));
}finally{store.close();}
