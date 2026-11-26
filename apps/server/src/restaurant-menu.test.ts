import assert from 'node:assert/strict';
import test from 'node:test';
import {extractSavorMenu,menuCopy,restaurantMenu} from './restaurant-menu.js';
const item=(name:string,ingredients:string)=>`<li class="uppercase font-maison-semibold">${name}</li><div><li><span class="max-w-450">${ingredients}</span><span>25</span></li></div>`;
const html=`<li data-tab-type="menu" data-tab="breakfast">Breakfast</li><li data-tab-type="menu" data-tab="lunch">Lunch &amp; Dinner</li><div class="tab-content" data-tab-type="menu" data-tab="breakfast"><ul>${item('Eggs','toast')}</ul></div><div class="tab-content" data-tab-type="menu" data-tab="lunch"><ul><span class="font-gt-light">Pasta</span>${item('Ravioli','pumpkin &amp; sage')}${item('Spaghetti','tomato &amp; basil')}${item('Risotto','mushroom')}</ul><ul><span class="font-gt-light">Wine</span>${item('Red wine','glass')}</ul></div>`;
test('menu extraction keeps the meal section, food names and source status',()=>{
 const dishes=extractSavorMenu(html,'Lunch');
 assert.deepEqual(dishes.map(d=>d.name),['Ravioli','Spaghetti','Risotto']);
 assert.equal(dishes[0]!.description,'pumpkin & sage');
 assert.ok(dishes.every(d=>d.kind==='menu_item'));
 assert.deepEqual(extractSavorMenu(html,'Breakfast').map(d=>d.name),['Eggs']);
 assert.deepEqual(extractSavorMenu(html.replace('Lunch &amp; Dinner','Dinner'),'Lunch'),[]);
 assert.match(menuCopy({sourceUrl:'https://savor.co.nz/amano',checkedAt:new Date().toISOString(),dishes}),/You might like/);
 assert.doesNotMatch(menuCopy({sourceUrl:'https://savor.co.nz/amano',checkedAt:new Date().toISOString(),dishes}),/Signature dishes/);
});
test('official menu identity checks and failures never invent dishes',async()=>{
 const venue={id:'am',name:'Amano',address:'Auckland, New Zealand',location:'174,-36',city:'Auckland',district:'',type:'restaurant',distanceMeters:100,dining:{websiteUrl:'https://savor.co.nz/amano'}};
 let calls=0;
 const fetcher=(async(url:unknown)=>{calls++;assert.equal(url,'https://savor.co.nz/amano');return new Response(html,{headers:{'content-type':'text/html'}});}) as typeof fetch;
 const menu=await restaurantMenu(venue,'Lunch',fetcher);
 assert.equal(menu?.dishes.length,3);
 assert.equal(menu?.sourceUrl,'https://savor.co.nz/amano');
 assert.equal(await restaurantMenu({...venue,address:'Paris',city:'Paris'},'Lunch',fetcher),undefined);
 assert.equal(await restaurantMenu({...venue,dining:{websiteUrl:'http://localhost/menu'}},'Lunch',fetcher),undefined);
 assert.equal(calls,1);
 assert.equal(await restaurantMenu(venue,'Lunch',(async()=>new Response('no menu',{status:403})) as typeof fetch),undefined);
 assert.equal(menuCopy(undefined),'');
});
