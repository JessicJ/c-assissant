import {chromium} from '@playwright/test';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {renderMorningEmail} from '../apps/server/src/email-templates/morning.ts';
import {kyotoMorning} from '../apps/server/src/email-templates/kyoto-example.ts';
import {resolveEmailPreviewImages} from '../apps/server/src/email-templates/preview.ts';
const output=resolve(process.argv[2]??'/private/tmp/landi-kit-boundaries');await mkdir(output,{recursive:true});
const browser=await chromium.launch();const results=[];
try{
 const page=await browser.newPage({viewport:{width:390,height:844}});
 await page.route('**/*',r=>r.abort());
 for(const width of [375,390,430,600])for(const count of [0,1,5,10]){
  const data=structuredClone(kyotoMorning);delete data.hero;data.places=data.places.map(({image,...place})=>place);data.routes=[];data.booking='No confirmed booking is recorded for this day.';data.weather.text='Weather data is unavailable.';
  data.itinerary=Array.from({length:count},(_,i)=>({...data.itinerary[0],title:`A long destination name ${i+1}: ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890`,time:{kind:'planned',label:`${String(8+i).padStart(2,'0')}:00`},iconKind:i%2?'forest':'car'}));
  data.summary[0].value=`${count} stops`;const email=renderMorningEmail(data);await page.setViewportSize({width,height:844});await page.setContent(resolveEmailPreviewImages(email));
  assert.equal(await page.locator('.timeline-dot').count(),count);assert.equal(await page.locator('body').evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.ok(email.html.length<95000);assert.doesNotMatch(email.html,/src="(?:data:|assets\/|file:)/);
  const refs=[...email.html.matchAll(/src="cid:([^"]+)"/g)].map(m=>m[1]);assert.ok(refs.every(cid=>email.attachments.some(a=>a.cid===cid)));
  await page.screenshot({path:`${output}/boundary-${width}-${count}.png`,fullPage:true});results.push({width,count,passed:true});
 }
 if(process.argv[3]){
  const kit=resolve(process.argv[3]);let html=await readFile(kit+'/email-preview.html','utf8');const assets=[...new Set([...html.matchAll(/src="(assets\/[a-z0-9/-]+\.(?:png|jpg))"/g)].map(m=>m[1]))];
  for(const path of assets){const bytes=await readFile(kit+'/'+path);html=html.split(`src="${path}"`).join(`src="data:image/${path.endsWith('.png')?'png':'jpeg'};base64,${bytes.toString('base64')}"`);}
  for(const width of [375,390,430,640]){await page.setViewportSize({width,height:844});await page.setContent(html);await page.screenshot({path:`${output}/reference-${width}.png`,fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);results.push({width,reference:true,passed:true});}
 }
}finally{await browser.close()}
await writeFile(output+'/report.json',JSON.stringify({realEmailClientsTested:false,results},null,2));console.log(`Passed ${results.length} kit boundary/reference scenarios`);
