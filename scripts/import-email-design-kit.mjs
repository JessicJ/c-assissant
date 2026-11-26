import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const source=resolve(process.argv[2] ?? '');
if(!process.argv[2])throw new Error('Supply the original design kit directory');
const names=['camera','leaf','clock','car','calendar','suitcase','arrow','forest','pace','map','link','cloud-sun','utensils','pin','hotel','check','info'];
const target=resolve(root,'apps/server/src/email-templates/design-kit');
await mkdir(target+'/png',{recursive:true});await mkdir(target+'/svg',{recursive:true});
const data={};const hashes={};
for(const name of names){const bytes=await readFile(source+'/assets/icons/png/'+name+'.png');if(!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw new Error('Invalid source PNG');data[name]=bytes.toString('base64');hashes[name]=createHash('sha256').update(bytes).digest('hex');await copyFile(source+'/assets/icons/png/'+name+'.png',target+'/png/'+name+'.png');await copyFile(source+'/assets/icons/svg/'+name+'.svg',target+'/svg/'+name+'.svg');}
await writeFile(target+'/icon-data.ts','// Generated from original Design Kit v1 PNG files by scripts/import-email-design-kit.mjs.\nexport const iconPngBase64 = '+JSON.stringify(data,null,2)+' as const;\n');
await writeFile(target+'/manifest.json',JSON.stringify({source:'User-supplied Landi Email Design Kit v1 original icons',sha256:hashes},null,2)+'\n');
console.log('Imported 17 original PNG/SVG icon pairs; generated canonical byte projection.');
