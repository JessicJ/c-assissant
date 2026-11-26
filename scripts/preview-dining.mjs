import {chromium} from '@playwright/test';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {renderDiningEmail} from '../apps/server/lib/email-templates/dining.js';
import {resolveEmailPreviewImages} from '../apps/server/lib/email-templates/preview.js';

if(!process.argv[2]||!process.argv[3])throw new Error('Usage: node scripts/preview-dining.mjs <input.json> <output-directory>');
const input=JSON.parse(await readFile(resolve(process.argv[2]),'utf8')),folder=resolve(process.argv[3]);
await mkdir(folder,{recursive:true,mode:0o700});
const current=renderDiningEmail(input);
assert.ok(Buffer.byteLength(current.html)<95000);
assert.doesNotMatch(current.html,/<script\b|data:image\/|file:\/\//i);
await writeFile(resolve(folder,'content.json'),JSON.stringify(current),{mode:0o600});
await writeFile(resolve(folder,'current.html'),resolveEmailPreviewImages(current),{mode:0o600});
const browser=await chromium.launch(),results=[];
try{
 const context=await browser.newContext({deviceScaleFactor:2});
 const capture=async(name,data,width,{dark=false,blocked=false}={})=>{
  const email=renderDiningEmail(data);const page=await context.newPage();await page.setViewportSize({width,height:844});await page.emulateMedia({colorScheme:dark?'dark':'light'});
  if(blocked)await page.route('**/*',r=>r.abort());
  await page.setContent(resolveEmailPreviewImages(email),{waitUntil:'load',timeout:45000});
  const state=await page.evaluate(()=>({width:innerWidth,height:document.documentElement.scrollHeight,overflow:document.documentElement.scrollWidth>innerWidth,photos:[...document.images].map(i=>({loaded:i.naturalWidth>0,alt:!!i.alt})),anchors:[...document.querySelectorAll('a')].map(a=>({https:a.href.startsWith('https:'),height:a.getBoundingClientRect().height,fits:a.scrollWidth<=a.clientWidth+1})),photoCells:[...document.querySelectorAll('.dining-image-cell')].map(e=>({height:e.getBoundingClientRect().height,rowHeight:e.parentElement.getBoundingClientRect().height,image:getComputedStyle(e).backgroundImage,size:getComputedStyle(e).backgroundSize,padding:getComputedStyle(e).padding})),names:[...document.querySelectorAll('.dining-name')].map(n=>n.textContent)}));
  for(const [i,cell]of state.photoCells.entries()){assert.ok(Math.abs(cell.height-cell.rowHeight)<=1,`${name} photo column is shorter than row`);assert.equal(cell.padding,'0px');if(data.restaurants[i].image){assert.notEqual(cell.image,'none');assert.equal(cell.size,'cover');}}
  assert.equal(state.overflow,false,`${name} overflow`);assert.deepEqual(state.names,data.restaurants.map(r=>r.name));
  assert.ok(state.anchors.every(a=>a.https&&a.height>=44&&a.fits),`${name} invalid link or small tap target`);
  if(!blocked)assert.ok(state.photos.every(i=>i.loaded&&i.alt),`${name} photo failed`);
  await page.screenshot({path:resolve(folder,`${name}-${width}.png`),fullPage:true});
  results.push({name,...state});await page.close();
 };
 for(const width of [320,375,390,420,600])await capture('current',input,width);
 await capture('dark',input,375,{dark:true});
 await capture('images-off',input,320,{blocked:true});
 const missing=structuredClone(input);missing.reminder='';for(const r of missing.restaurants){delete r.image;delete r.distanceMeters;r.transport='';r.priceNote='';r.links=[];}
 await capture('missing-data',missing,320);
 const long=structuredClone(input);for(const r of long.restaurants){r.name+=' Restaurant ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890';r.description+=' A long saved description must wrap without hiding the place name or map action.';}
 await capture('long-names',long,320);
 const ride=structuredClone(input);if(ride.restaurants[0])ride.restaurants[0].ride={provider:'uber',destination:ride.restaurants[0].name,link:{label:'Open Uber',url:'https://m.uber.com/looking?pickup=my_location'},note:'Preview only; confirm your pickup and fare in Uber.'};
 await capture('ride-example',ride,320);
 const menu=structuredClone(input);if(menu.restaurants[0]){menu.restaurants[0].links.push({label:'Menu',url:'https://example.org/illustrative-menu'});menu.restaurants[0].estimatedDurationMinutes=8;menu.restaurants[0].topPick=true;menu.restaurants[0].price='$$';}menu.sample=true;await capture('explicit-data-example',menu,390);
 await capture('empty',{...missing,restaurants:[],fallbackLinks:[{label:'Nearby restaurants',url:'https://www.google.com/maps/search/?api=1&query=restaurants'}]},320);
}finally{await browser.close();}
await writeFile(resolve(folder,'verification.json'),JSON.stringify({results,mailSent:false,realMailClientsTested:false},null,2),{mode:0o600});
console.log(JSON.stringify({passed:results.length,current390Height:results.find(r=>r.name==='current'&&r.width===390).height,mailSent:false}));
