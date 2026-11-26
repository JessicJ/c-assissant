import type {ChangeEmailData,RenderedEmail,EmailLink} from './types.js';
import type {EmailInlineAttachment} from '@c-assistant/core';
import {rideAction,renderDocument,text,httpsUrl} from './shared.js';
import {transferTiming} from '../email-transfer-timing.js';
import {importantUpdateHero,renderChangePhoto} from './important-update-heroes.js';
import {importantUpdateAssets} from './important-update-kit/assets.js';

// Match the supplied email tables: automatic column sizing, never shared fixed-layout geometry.
const table=(content:string,style='',attrs='')=>`<table role="presentation" cellpadding="0" cellspacing="0" border="0" ${attrs.includes('width=')?'':'width="100%"'} style="${attrs.includes('width=')?'':'width:100%;'}${style}" ${attrs}>${content}</table>`;
const c={pine:'#173D33',paper:'#FAF8F4',muted:'#596E64',copper:'#AF7952',rust:'#A75739',line:'#E2E5DE',sage:'#EAF1EA',soft:'#F4ECE4'};
const views={
 attraction_closure:{icon:'map-pin-off',advice:'building',verification:'confirmed'},
 weather_impact:{icon:'cloud-rain',advice:'umbrella',verification:'forecast'},
 transport_disruption:{icon:'plane',advice:'clock-change',verification:'confirmed'},
 reservation_change:{icon:'calendar-x',advice:'search',verification:'confirmed'},
 arrival_conflict:{icon:'clock-alert',advice:'route',verification:'estimated'},
 opening_hours_change:{icon:'calendar-clock',advice:'calendar',verification:'confirmed'}
} as const;

/** Pure presentation: no detection, Plan writes, capability issuance or sending. */
export function renderChangeEmail(data:ChangeEmailData):RenderedEmail {
 const applied=data.status.kind==='applied',confirmed=data.status.kind==='confirmed'||applied,u=data.update;
 if(applied && data.status.kind==='applied' && !Number.isFinite(Date.parse(data.status.appliedAt)))throw Error('An applied update requires its saved application time.');
 if(confirmed && data.status.kind==='confirmed' && !data.status.confirmedAt.trim())throw Error('A confirmed change requires confirmation time.');
 const used=new Set<keyof typeof importantUpdateAssets>();
 const asset=(name:keyof typeof importantUpdateAssets,size:number)=>{
  if(!Object.hasOwn(importantUpdateAssets,name))throw Error('Unknown Important Update asset');
  used.add(name);
  return `<img class="update-icon" src="cid:landi-update-v1-${name}@landi.assets" alt="" width="${size}" style="vertical-align:middle;display:block;width:${size}px;height:${size}px;border:0" />`;
 };
 const paragraph=(value:string,extra='')=>value?`<p class="copy" style="font:14px/21px Arial,Helvetica,sans-serif;color:${c.muted};margin:0;overflow-wrap:anywhere;${extra}">${text(value)}</p>`:'';
 const row=(body:string,pad='16px 26px 0')=>`<tr><td class="update-pad" style="padding:${pad}">${body}</td></tr>`;
 let title=data.title,before=u?.before,after=u?.after,delta=u?.delta;
 if(u){
  if(!Object.hasOwn(views,u.kind))throw Error('Unsupported Important Update kind');
  const checked=Date.parse(u.verification.checkedAt),evaluated=Date.parse(u.evaluatedAt);
  if(u.verification.kind!==views[u.kind].verification||!u.verification.sourceName.trim()||!Number.isFinite(checked)||!Number.isFinite(evaluated)||checked>evaluated+300000||!/^\d{4}-\d{2}-\d{2}$/.test(u.tripDate))throw Error('Important Update evidence is incomplete');
  if(u.verification.sourceUrl)httpsUrl(u.verification.sourceUrl);
  if(!data.sample && (!u.verification.sourceUrl || !u.action))throw Error('Live Important Update needs source evidence and a working action');
  if(u.action){
   const url=new URL(u.action.url);httpsUrl(u.action.url);
   if(/(^|\.)(invalid|localhost|local|internal|test)$/.test(url.hostname)||!u.action.label.trim()||u.action.expiresAt && (!Number.isFinite(Date.parse(u.action.expiresAt))||Date.parse(u.action.expiresAt)<=evaluated))throw Error('Important Update action is unavailable or expired');
  }
  if(u.kind==='arrival_conflict'){
   const r=u.route;
   if(!r||r.date!==u.tripDate||r.departureZone!==r.destinationZone||evaluated-checked>60*60000)throw Error('Fresh, dated route estimate and matching zones required');
   const timing=transferTiming(r);
   if(!timing.lateMinutes||!timing.estimatedArrival)throw Error('No substantiated late arrival');
   title=`You may arrive ${timing.lateMinutes} min late`;
   before={label:'ACTIVITY START',value:r.scheduledStart};after={label:'EST. ARRIVAL',value:timing.estimatedArrival};delta=`+${timing.lateMinutes} min`;
  }
 }
 const city=u?.city??data.brandLabel.split('\n').slice(1).join(' ');
 // Reuse Landi's existing italic serif wordmark treatment; never bake text into scene art.
 const wordmark=`<span class="heading" style="font-family:Georgia,Times New Roman,serif;font-style:italic;font-weight:bold;font-size:35px;letter-spacing:-2px;color:${c.pine}">landi<span style="color:${c.copper};font-size:17px;vertical-align:top">✦</span></span>`;
 const header=table(`<tr><td class="update-pad" style="padding:22px 26px 12px">${table(`<tr><td valign="middle">${wordmark}</td><td align="right" valign="middle" style="font-size:10px;font-weight:bold;letter-spacing:2px;line-height:1.6;color:${c.copper}">IMPORTANT UPDATE${u?`<br><span class="secondary-copy" style="font-size:11px;color:#7A8B81;letter-spacing:1.4px">${text(city)}</span>`:''}</td></tr>`)}</td></tr>`);
 const view=u?views[u.kind]:undefined;
 const critical=u && ['attraction_closure','transport_disruption','reservation_change'].includes(u.kind);
 const chipBackground=critical?'#F9EDE9':c.soft,chipColor=critical?'#B14D3D':'#91602D';
 const chip=table(`<tr><td style="padding:7px 9px 7px 10px">${asset(view?.icon??(confirmed?'check-circle':'info-circle'),21)}</td><td class="update-chip" style="padding:7px 12px 7px 0;font-size:10px;letter-spacing:1.3px;font-weight:bold;white-space:nowrap;color:${chipColor}">${text(u?.tag??(applied?'UPDATE APPLIED':confirmed?'UPDATE CONFIRMED':'A SUGGESTED CHANGE'))}</td></tr>`,`border-collapse:separate;background:${chipBackground};border-radius:50px`,'width="auto" height="36" class="status update-status-chip"');
 const comparison=before&&after?table(`<tr><td valign="top" style="width:43%;padding:14px 10px 14px 15px"><div class="secondary-copy meta-cell" style="font-size:9px;font-weight:bold;letter-spacing:1.2px;color:#7A8B81">${text(before.label)}</div><div class="heading" style="font-weight:bold;font-size:16px;line-height:1.3;color:${c.pine};margin-top:7px;overflow-wrap:anywhere">${text(before.value)}</div></td><td style="width:11%;text-align:center;font:24px Arial;color:${c.copper}">→</td><td valign="top" style="width:46%;padding:14px 15px 14px 3px"><div class="warm-text meta-cell" style="font-size:9px;font-weight:bold;letter-spacing:1.2px;color:${c.rust}">${text(after.label)}</div><div class="warm-text" style="font-weight:bold;font-size:16px;line-height:1.3;color:${c.rust};margin-top:7px;overflow-wrap:anywhere">${text(after.value)}</div></td></tr>${delta?`<tr><td colspan="3" style="padding:0 15px 13px">${table(`<tr><td class="warm-text" style="color:${c.rust};padding:6px 10px;font-size:11px;font-weight:bold">${text(delta)}</td></tr>`,`background:${chipBackground};border-radius:7px`,'width="auto" class="notice"')}</td></tr>`:''}`,`width:100%;background:#FFFFFF;border:1px solid ${c.line};border-radius:13px;border-collapse:separate`,'class="surface"'):'';
 const review=data.links.find(l=>l.label==='Review itinerary');
 const action:EmailLink|undefined=u?.action??review;
 const actionLabel=action?.label??(data.sample?u?.previewActionLabel:undefined);
 const actionStyle=`display:block;box-sizing:border-box;min-height:48px;padding:15px 12px;background:${c.pine};border-radius:10px;font:700 15px/1.3 Arial,Helvetica,sans-serif;color:#FFFFFF;text-align:center;text-decoration:none;white-space:normal;overflow-wrap:anywhere`;
 const cta=action?`<a class="primary-button update-cta" href="${httpsUrl(action.url)}" target="_blank" rel="noopener noreferrer" style="${actionStyle}">${text(action.label)}  →</a>`:actionLabel?table(`<tr><td align="center" style="padding:15px 12px"><span class="cta-text" style="color:#FFFFFF;font-size:15px;line-height:1.3;font-weight:bold">${text(actionLabel)}  →</span></td></tr>`,`background:${c.pine};border-radius:10px`,'class="update-demo-cta"'):'';
 const confirmation=data.status.kind==='confirmed'?row(paragraph(`The new arrangement is confirmed. ${data.status.explanation} Confirmed: ${data.status.confirmedAt}`,'font-size:11px;line-height:17px'),'13px 26px 0'):'';
 const application=data.status.kind==='applied'?row(paragraph(`Landi applied the new arrangement. ${data.status.explanation} Applied: ${new Date(data.status.appliedAt).toLocaleString("en-GB", { timeZoneName: "short" })}`,'font-size:11px;line-height:17px'),'13px 26px 0'):'';
 const options=u?'':data.options.map(o=>`<div style="margin-top:12px"><strong class="heading" style="font:700 14px/20px Arial;color:${c.pine}">${text(o.title)}</strong>${paragraph(o.description,'margin-top:4px')}${o.requiresConfirmation&&!confirmed?paragraph('Your confirmation is required.','font-size:11px;color:'+c.rust+';margin-top:5px'):''}</div>`).join('');
 // Source/action validation is retained even though the decorative source footer is omitted.
 for(const link of data.links)httpsUrl(link.url);
 const footer='';
 const hero=data.hero??importantUpdateHero(u?.kind??data.visualKind);
 const body=table((hero?renderChangePhoto(hero,title,chip):'')+row((hero?'':chip)+(hero?'':`<h1 class="heading update-headline" style="font:400 32px/1.14 Georgia,'Times New Roman',serif;letter-spacing:-.9px;color:${c.pine};margin:12px 0 9px;overflow-wrap:anywhere">${text(title)}</h1>`)+paragraph(data.introduction),'20px 26px 0')+(comparison?row(comparison,'17px 26px 0'):'')+(data.impact?row(table(`<tr><td valign="top" width="25" style="padding-top:1px">${asset(view?.advice??'info-circle',19)}</td><td class="copy" style="font-size:13px;line-height:1.5;color:${c.muted};padding-left:8px;overflow-wrap:anywhere">${text(data.impact)}</td></tr>`),'14px 26px 0'):'')+(options?row(options):'')+(cta?row(cta):'')+(!confirmed?row(paragraph('Open Landi to review and confirm this change.','font-size:12px;line-height:18px')):'')+confirmation+application+(confirmed&&data.ride?row(rideAction(data.ride)):'')+'<tr><td style="height:24px;font-size:0;line-height:0">&nbsp;</td></tr>');
 const attachments:EmailInlineAttachment[]=[...used].map(name=>({cid:`landi-update-v1-${name}@landi.assets`,filename:`${name}.png`,contentType:'image/png',contentBase64:importantUpdateAssets[name]}));
 return {...renderDocument(data,body,{systemCopy: [data.status.explanation],maxWidth:560,paper:c.paper,chrome:{header,footer},extraCss:`body{padding:14px 0 24px!important;background:#F4F2ED!important;font-family:Arial,Helvetica,sans-serif!important;font-size:16px!important;line-height:normal!important;color:#173D33!important}.email-body{border-collapse:separate!important;table-layout:auto!important;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;text-size-adjust:100%}@media(max-width:460px){.update-badge-inset{width:18px!important}.update-cover-inner{height:204px!important}.update-cover-copy{padding:14px 0 14px 18px!important}.update-cover-title{font-size:28px!important;line-height:31px!important;letter-spacing:-.6px!important}.update-pad{padding-left:18px!important;padding-right:18px!important}.update-headline{font-size:27px!important;line-height:1.14!important}.meta-cell{font-size:12px!important}.cta-text{font-size:15px!important}}@media(max-width:390px){.update-cover-inner{height:181px!important}}@media(max-width:375px){.update-cover-inner{height:173px!important}.update-cover-title{font-size:25px!important;line-height:28px!important}}@media(max-width:340px){.update-cover-inner{height:142px!important}.update-cover-title{font-size:22px!important;line-height:25px!important}}@media(prefers-color-scheme:dark){.update-badge-paper{background:#1E2924!important}.update-badge-slot{background:linear-gradient(transparent 50%,#1E2924 50%)!important}.update-cover{background-color:#B4C7A4!important}.update-cover-title{color:#203E35!important}body{background:#1E2924!important}.update-icon{background:#EAF1EA;border-radius:50%}.update-chip{color:#E5B58D!important}.update-demo-cta{background:#173D33!important;color:#FFFFFF!important}.update-cta{background:#A9C2AE!important;color:#173D33!important}}`}),attachments};
}
