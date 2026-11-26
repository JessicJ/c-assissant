/** Same browser, viewport, assets and fixture facts: compare implementation with supplied HTML. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';import {resolve,dirname} from 'node:path';import {chromium} from '@playwright/test';
if(!process.argv[2]||!process.argv[3])throw Error('Usage: node scripts/compare-important-update.mjs <kit-directory> <preview-directory>');
const kit=resolve(process.argv[2]),folder=resolve(process.argv[3]);await mkdir(resolve(folder,'comparison'),{recursive:true});
const fixtures=JSON.parse(await readFile(new URL('./fixtures/important-update-events.json',import.meta.url),'utf8')).cases;
const browser=await chromium.launch(),results=[];
try{const page=await browser.newPage({viewport:{width:390,height:600},deviceScaleFactor:1});await page.emulateMedia({colorScheme:'light'});
 for(const item of fixtures){
  let source=await readFile(resolve(kit,'examples/html',item.id+'.html'),'utf8');const refs=[...source.matchAll(/src="([^"]+)"/g)];
  for(const m of refs){const file=resolve(kit,'examples/html',m[1]);if(!file.startsWith(kit+'/assets/'))throw Error('Unexpected reference resource');source=source.replace(m[0],'src="data:image/png;base64,'+(await readFile(file)).toString('base64')+'"');}
  await writeFile(resolve(folder,'comparison',item.id+'-reference.html'),source);
  const pair={};
  for(const [name,html]of [['reference',source],['current',await readFile(resolve(folder,item.id+'.html'),'utf8')]]){
   await page.setContent(html,{waitUntil:'load'});pair[name]=await page.evaluate(()=>{
    const box=e=>{if(!e)return null;const b=e.getBoundingClientRect(),s=getComputedStyle(e);return {x:b.x,y:b.y,w:b.width,h:b.height,font:s.fontSize,line:s.lineHeight,color:s.color,bg:s.backgroundColor,fontFamily:s.fontFamily,fontWeight:s.fontWeight}};
    const h=document.querySelector('h1');return {height:document.documentElement.scrollHeight,hero:box(document.querySelector('.banner-img')),title:box(h),chip:box(h.previousElementSibling),comparison:box(document.querySelector('table[style*="border:1px"]')),cta:box(document.querySelector('.cta-text')?.closest('table')??document.querySelector('.update-cta')),status:box(document.querySelector('table[style*="background:#EAF1EA"]')),source:box(document.querySelector('div[style*="border-top:"]')),logo:box(document.querySelector('span[style*="font-size:35px"]'))};
   });await page.screenshot({path:resolve(folder,'comparison',`${item.id}-${name}-390.png`),fullPage:true});
  }
  const differences=[];for(const k of ['hero','title','chip','comparison','cta','status','source','logo']){const a=pair.reference[k],b=pair.current[k];if(!a||!b){differences.push({landmark:k,missing:true});continue;}for(const key of ['x','y','w','h'])if(Math.abs(a[key]-b[key])>.5)differences.push({landmark:k,property:key,reference:a[key],current:b[key],delta:b[key]-a[key]});for(const key of ['font','line','color','fontFamily','fontWeight'])if(a[key]!==b[key])differences.push({landmark:k,property:key,reference:a[key],current:b[key]});}
  results.push({id:item.id,...pair,differences});
 }
}finally{await browser.close();}
await writeFile(resolve(folder,'comparison/metrics.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results.map(r=>({id:r.id,referenceHeight:r.reference.height,currentHeight:r.current.height,differences:r.differences})),null,2));
