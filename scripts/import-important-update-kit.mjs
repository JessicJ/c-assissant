import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {resolve} from 'node:path';import {createHash} from 'node:crypto';
if(!process.argv[2])throw Error('Supply the Important Update kit directory');
const root=resolve(process.argv[2]),out=resolve('apps/server/src/email-templates/important-update-kit');await mkdir(out,{recursive:true});
const specs=[...['map-pin-off','cloud-rain','plane','calendar-x','clock-alert','calendar-clock','building','umbrella','clock-change','search','route','calendar','info-circle','check-circle'].map(n=>[n,`icons/png_2x/${n}.png`])];
const assets={},sha256={};for(const [name,source]of specs){const b=await readFile(resolve(root,'assets',source));if(b.subarray(1,4).toString()!=='PNG')throw Error('Expected PNG');assets[name]=b.toString('base64');sha256[name]=createHash('sha256').update(b).digest('hex');await copyFile(resolve(root,'assets',source),resolve(out,name+'.png'));}
await writeFile(resolve(out,'assets.ts'),'// Original user-supplied Important Update kit PNGs. Regenerate with scripts/import-important-update-kit.mjs.\nexport const importantUpdateAssets = '+JSON.stringify(assets,null,2)+' as const;\n');
await writeFile(resolve(out,'manifest.json'),JSON.stringify({source:'User-supplied landi_important_update_kit_v1/assets',sha256},null,2)+'\n');console.log('Imported14 original icon PNG assets.');
