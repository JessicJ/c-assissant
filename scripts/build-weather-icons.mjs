import {chromium} from '@playwright/test';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

// Original Landi geometry; deterministic SVG masters and transparent email PNGs.
const root=fileURLToPath(new URL('../',import.meta.url));
const folder=resolve(root,'assets/weather/v1');
const color={ink:'#285347',cloud:'#DFE8E1',shade:'#BED0C4',sun:'#DFC38A',sunStroke:'#B88C4D',rain:'#6D9694',paper:'#FAF8F4'};
const path=(d,extra='')=>`<path d="${d}" ${extra}/>`;
const circle=(cx,cy,r,extra='')=>`<circle cx="${cx}" cy="${cy}" r="${r}" ${extra}/>`;
function sun(cx=32,cy=29,r=10){return `<g stroke="${color.sunStroke}" fill="${color.sun}">${circle(cx,cy,r)}<g fill="none">${Array.from({length:8},(_,i)=>{const a=i*Math.PI/4;const p=n=>[cx+Math.cos(a)*n,cy+Math.sin(a)*n].map(x=>x.toFixed(2)).join(' ');return path(`M${p(r+5)} L${p(r+9)}`);}).join('')}</g></g>`;}
const moon=()=>path('M37 12a18 18 0 1 0 15 27A19 19 0 0 1 37 12Z',`fill="#E1D5B2" stroke="${color.ink}"`);
const cloud=(shade=false)=>path('M17 43C10 43 7 39 7 34c0-5 4-9 9-9h2c1-8 7-13 14-13 8 0 14 5 15 13h1c6 0 10 4 10 9s-4 9-10 9Z',`fill="${shade?color.shade:color.cloud}"`);
const smallCloud=()=>path('M26 34c0-5 4-9 9-9 2-5 6-8 12-7 6 1 9 5 9 10 4 1 6 4 6 8H36c-6 0-10-1-10-2Z',`fill="${color.shade}" stroke="${color.ink}"`);
const drops=(count=3,heavy=false)=>`<g stroke="${color.rain}" stroke-width="${heavy?3.4:2.5}">${Array.from({length:count},(_,i)=>{const x=count===2?25+i*16:19+i*(27/(count-1));return path(`M${x.toFixed(1)} 49l-3 ${heavy?9:6}`);}).join('')}</g>`;
const snowflake=(x,y)=>`<g stroke="${color.rain}" stroke-width="1.8">${path(`M${x} ${y-4}v8M${x-3.5} ${y-2}l7 4M${x-3.5} ${y+2}l7-4`)}</g>`;
const entries=[
 ['clear-day','Sunny','晴朗',sun(32,31,11)],
 ['clear-night','Clear night','晴夜',moon()+circle(51,15,1.5,`fill="${color.sun}" stroke="none"`)+path('M21 9v6m-3-3h6',`stroke="${color.sunStroke}"`)],
 ['partly-cloudy-day','Partly cloudy','局部多云',sun(24,22,9)+`<g transform="translate(0 10) scale(1 .84)">${cloud()}</g>`],
 ['partly-cloudy-night','Cloudy night','夜间多云',`<g transform="translate(-4 -2) scale(.85)">${moon()}</g><g transform="translate(0 11) scale(1 .84)">${cloud()}</g>`],
 ['cloudy','Cloudy','多云',smallCloud()+`<g transform="translate(-1 9) scale(.91 .87)">${cloud()}</g>`],
 ['overcast','Overcast','阴天',`<g transform="translate(0 4)">${cloud(true)}</g>`+path('M18 54h28',`stroke="${color.shade}"`)],
 ['light-rain','Light rain','小雨',cloud()+drops(2)],
 ['moderate-rain','Moderate rain','中雨',cloud()+drops(3)],
 ['heavy-rain','Heavy rain','大雨',cloud(true)+drops(4,true)],
 ['showers','Showers','阵雨',`<g transform="translate(0 -1)">${sun(22,20,8)}</g>`+cloud()+drops(2)],
 ['thunderstorm','Thunderstorm','雷雨',cloud(true)+path('M33 42l-7 10h7l-3 10 13-15h-9l4-5',`fill="${color.sun}" stroke="${color.sunStroke}" stroke-width="2"`)+path('M17 49l-3 6M49 49l-3 6',`stroke="${color.rain}"`)],
 ['snow','Snow','下雪',cloud()+snowflake(21,53)+snowflake(42,53)],
 ['sleet','Sleet','雨夹雪',cloud()+path('M23 49l-3 8',`stroke="${color.rain}"`)+snowflake(43,53)],
 ['fog','Fog','雾',`<g transform="translate(3 1) scale(.9 .83)">${cloud()}</g>`+path('M10 43h44M16 50h32M11 57h42',`stroke="${color.rain}"`)],
 ['wind','Windy','大风',path('M9 25h32c11 0 11-15 2-15-5 0-7 3-7 6M9 35h43c9 0 9-12 2-12M14 45h22c10 0 10 13 2 13-4 0-6-3-6-5',`fill="none" stroke="${color.rain}"`)],
 ['unavailable','Unavailable','暂不可用',`<g opacity=".8">${cloud()}</g>`+path('M29 25a4 4 0 0 1 8 1c0 4-5 4-5 8',`fill="none"`)+circle(32,39,1,`fill="${color.ink}" stroke="none"`)]
];
await Promise.all(['svg','png'].map(dir=>mkdir(resolve(folder,dir),{recursive:true})));
const icons=[];const browser=await chromium.launch();
try{
 const page=await browser.newPage({viewport:{width:192,height:192},deviceScaleFactor:1});
 for(const [id,label,labelZh,geometry] of entries){
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" fill="none" stroke="${color.ink}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" role="img" aria-labelledby="title"><title id="title">${label}</title>${geometry}</svg>`;
  await writeFile(resolve(folder,'svg',id+'.svg'),svg+'\n');
  const files={svg:{path:`svg/${id}.svg`,sha256:createHash('sha256').update(svg+'\n').digest('hex')},png:{}};
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:100%;height:100%}</style>${svg}`);
  for(const size of [48,96,192]){
   await page.setViewportSize({width:size,height:size});
   const bytes=await page.screenshot({omitBackground:true});
   const path=`png/${id}-${size}.png`;await writeFile(resolve(folder,path),bytes);
   files.png[size]={path,sha256:createHash('sha256').update(bytes).digest('hex')};
  }
  icons.push({id,label,labelZh,cid:`landi-weather-v1-${id}@landi.assets`,...files});
 }
 await page.close();
 const manifest={version:1,license:'Apache-2.0',originalArtwork:true,viewBox:'0 0 64 64',colors:color,icons};
 await writeFile(resolve(folder,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 const registry=`// Generated by scripts/build-weather-icons.mjs. No weather inference or network access.\nexport const weatherIcons = Object.freeze({\n${icons.map(i=>`  '${i.id}': Object.freeze({id:'${i.id}',label:'${i.label}',labelZh:'${i.labelZh}',cid:'${i.cid}',svgUrl:new URL('./${i.svg.path}',import.meta.url).href,png48Url:new URL('./${i.png[48].path}',import.meta.url).href,png96Url:new URL('./${i.png[96].path}',import.meta.url).href,png192Url:new URL('./${i.png[192].path}',import.meta.url).href})`).join(',\n')}\n});\nexport function getWeatherIcon(id) { return Object.hasOwn(weatherIcons,id) ? weatherIcons[id] : weatherIcons.unavailable; }\n`;
 await writeFile(resolve(folder,'index.mjs'),registry);
 const cards=icons.map(i=>`<article><div class="art"><img src="${i.png[192].path}" width="72" height="72" alt="${i.label}"></div><h2>${i.label}</h2><p>${i.labelZh}</p><div class="sizes">${[24,32,48].map(n=>`<img src="${i.png[96].path}" width="${n}" height="${n}" alt="">`).join('')}</div><code>${i.id}</code></article>`).join('');
 const catalog=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Landi Weather Icons</title><style>*{box-sizing:border-box}body{margin:0;background:#FAF8F4;color:#203E35;font:14px/1.6 Arial,sans-serif}.wrap{max-width:1040px;margin:auto;padding:44px 32px}.brand{font:bold italic 32px Georgia}.eyebrow{font-size:10px;letter-spacing:2.6px;text-transform:uppercase;color:#7E9185}h1{font:42px/1.12 Georgia;margin:16px 0}.intro{color:#71847B;max-width:550px;margin-bottom:28px}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}article{background:#fff;border:1px solid #E4E9E2;border-radius:16px;padding:18px;text-align:center}.art{height:78px;display:grid;place-items:center}h2{font-size:13px;margin:10px 0 0}p{margin:2px 0;color:#7E9185;font-size:12px}.sizes{height:64px;display:flex;align-items:center;justify-content:center;gap:12px}code{color:#8B9D93;font:10px Arial}.dark{background:#203E35;border-radius:16px;margin-top:25px;padding:20px;display:flex;flex-wrap:wrap;gap:12px;align-items:center}.tile{background:#FAF8F4;border-radius:10px;padding:7px;display:flex}.dark span{color:#DCE6DF;font-size:12px;margin-right:auto}.example{display:flex;align-items:center;gap:12px;margin-top:20px;padding:16px 20px;background:#EAF0E9;border-radius:12px}.example strong{font-size:20px}.example small{color:#7E9185;margin-left:auto}footer{margin-top:24px;color:#8B9D93;font-size:11px}@media(max-width:600px){.wrap{padding:24px 16px}.grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}article{padding:12px 6px}h1{font-size:34px}.sizes{gap:7px}.example small{max-width:64px;text-align:right}}</style><main class="wrap"><div class="brand">landi<span style="color:#B68052">✦</span></div><div class="eyebrow" style="margin-top:24px">Shared visual assets · Volume 01</div><h1>A little sky,<br>wherever you go.</h1><div class="intro">Weather icons for Landi.<br>16 conditions · SVG + transparent PNG · 24 / 32 / 48px display sizes</div><section class="grid">${cards}</section><section class="dark"><span>On forest backgrounds</span>${['clear-day','cloudy','heavy-rain','snow'].map(id=>`<div class="tile"><img src="png/${id}-96.png" width="40" height="40" alt="${id}"></div>`).join('')}</section><section class="example"><img src="png/partly-cloudy-day-96.png" width="40" height="40" alt=""><div><strong>18°C</strong><br><span>Partly cloudy</span></div><small>Simulated<br>display only</small></section><footer>Original Landi artwork · Cream, sage, forest & muted gold · PNG for email / SVG for Web<br>Artwork represents condition labels only; no forecast or provider mapping is inferred.</footer></main></html>`;
 await writeFile(resolve(folder,'preview.html'),catalog);
 const review=await browser.newPage({viewport:{width:1040,height:900},deviceScaleFactor:1});
 await review.goto(new URL('../assets/weather/v1/preview.html',import.meta.url).href);
 await review.screenshot({path:resolve(folder,'contact-sheet.png'),fullPage:true});
 await review.setViewportSize({width:375,height:844});
 await review.screenshot({path:resolve(folder,'preview-375.png'),fullPage:true});
 const overflow=await review.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
 if(overflow)throw new Error('Mobile catalog overflow');
 await review.close();
}finally{await browser.close();}
// Integrity checks include every exported asset and actual PNG IHDR dimensions.
for(const icon of icons){for(const file of [icon.svg,...Object.values(icon.png)]){
 const bytes=await readFile(resolve(folder,file.path));
 if(createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw new Error('Asset hash mismatch');
}for(const [size,file]of Object.entries(icon.png)){const bytes=await readFile(resolve(folder,file.path));if(bytes.readUInt32BE(16)!==Number(size)||bytes.readUInt32BE(20)!==Number(size)||bytes[25]!==6)throw new Error('PNG dimensions/transparency mismatch');}}
console.log(`Created and verified ${icons.length} SVGs and ${icons.length*3} transparent PNGs; mobile catalog has no overflow.`);
