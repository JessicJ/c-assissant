import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
const root=resolve(process.argv[2]??'');if(!process.argv[2])throw new Error('Provide the supplied kit directory');
const output=resolve('apps/server/src/email-templates/on-the-way-kit');await mkdir(output,{recursive:true});
const assets={},hashes={};for(const name of ['walk','car','bus','alert','location-pin','clock','map','info','sun']){const path=resolve(root,`assets/icons/png_2x/${name}.png`),bytes=await readFile(path);if(bytes.readUInt32BE(16)!==48||bytes.readUInt32BE(20)!==48)throw new Error('Expected original 48px PNG');await copyFile(path,resolve(output,name+'.png'));assets[name]=bytes.toString('base64');hashes[name]=createHash('sha256').update(bytes).digest('hex');}
await writeFile(resolve(output,'icon-data.ts'),'// Original supplied On the Way kit PNG bytes; regenerate with scripts/import-on-the-way-kit.mjs.\nexport const onTheWayIcons = '+JSON.stringify(assets,null,2)+' as const;\n');await writeFile(resolve(output,'manifest.json'),JSON.stringify({source:'User-supplied landi-on-the-way/assets/icons/png_2x',sha256:hashes},null,2)+'\n');console.log('Imported original 48px PNGs');
