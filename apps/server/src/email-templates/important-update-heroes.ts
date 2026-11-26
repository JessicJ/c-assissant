import type {ImportantUpdateData,EmailImage} from './types.js';
import {httpsUrl,text} from './shared.js';
/** User-supplied static artwork; event kind is explicit, never inferred from prose. */
export const importantUpdateHeroes={
  "attraction_closure": {
    "file": "attraction-closure.jpg",
    "alt": "Illustration of a traveler waiting outside a closed attraction."
  },
  "weather_impact": {
    "file": "weather-impact.jpg",
    "alt": "Illustration of a traveler sheltering from wind and rain."
  },
  "transport_disruption": {
    "file": "transport-disruption.jpg",
    "alt": "Illustration of a traveler resting at an airport."
  },
  "reservation_change": {
    "file": "reservation-change.jpg",
    "alt": "Illustration of a traveler checking a cancelled reservation at a cafe."
  },
  "arrival_conflict": {
    "file": "arrival-conflict.jpg",
    "alt": "Illustration of a traveler hurrying for a train."
  },
  "opening_hours_change": {
    "file": "opening-hours-change.jpg",
    "alt": "Illustration of a traveler checking a clock at a ticket office."
  }
} as const;
/** Immutable shared public artwork; deployment override is optional. */
export const DEFAULT_EMAIL_ASSET_BASE_URL="https://raw.githubusercontent.com/JessicJ/c-assissant/cec3eca9bfb58f54ff997d0b7c4e85fa3218825d/assets/email";
export function importantUpdateHero(kind:ImportantUpdateData['kind']|undefined,base=process.env.LANDI_EMAIL_ASSET_BASE_URL?.trim()||DEFAULT_EMAIL_ASSET_BASE_URL):EmailImage|undefined{
 if(!kind||!base?.trim())return undefined;
 if(!Object.hasOwn(importantUpdateHeroes,kind))throw Error('Unsupported Important Update hero kind');
 const url=new URL(base);httpsUrl(base);
 if(url.search||url.hash||url.pathname.includes('%'))throw Error('Email asset base must be a stable public HTTPS directory');
 url.pathname=url.pathname.replace(/\/$/,'')+'/important-update/v1/'+importantUpdateHeroes[kind].file;
 return {url:url.href,alt:importantUpdateHeroes[kind].alt};
}
export function renderChangePhoto(image:EmailImage,title:string,badge:string):string{
 const rail=`<table class="update-badge-rail" role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-collapse:collapse"><tr><td class="update-badge-inset update-cover-edge" width="24" height="18" style="width:24px;height:18px;font-size:0;line-height:0">&nbsp;</td><td class="update-badge-slot" rowspan="2" width="1" valign="middle" style="width:1px;padding:0;background:linear-gradient(transparent 50%,#FAF8F4 50%)">${badge}</td><td class="update-cover-edge" height="18" style="height:18px;font-size:0;line-height:0">&nbsp;</td></tr><tr><td class="update-badge-inset update-badge-paper" width="24" height="18" bgcolor="#FAF8F4" style="width:24px;height:18px;background:#FAF8F4;font-size:0;line-height:0">&nbsp;</td><td class="update-badge-paper" height="18" bgcolor="#FAF8F4" style="height:18px;background:#FAF8F4;font-size:0;line-height:0">&nbsp;</td></tr></table>`;
 const url=httpsUrl(image.url).replaceAll('&#39;','%27');
 return `<tr><td class="update-pad" style="padding:7px 26px 0"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-collapse:separate"><tr><td class="update-cover" background="${url}" bgcolor="#B4C7A4" style="padding:0;background-color:#B4C7A4;background-image:url('${url}');background-size:100% auto;background-position:right top;background-repeat:no-repeat;border-radius:14px;overflow:hidden"><!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false" arcsize="5%" style="width:508px;height:268px"><v:fill type="frame" aspect="atmost" src="${url}" color="#B4C7A4"/><v:textbox inset="0,0,0,0"><![endif]--><table class="update-cover-inner" role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" height="268" style="width:100%;height:268px;table-layout:fixed"><tr><td class="update-cover-copy" width="46%" valign="middle" style="width:46%;padding:18px 0 18px 24px"><h1 class="update-cover-title" style="font:400 38px/42px Georgia,'Times New Roman',serif;letter-spacing:-1px;color:#203E35;margin:0;overflow-wrap:anywhere">${text(title)}</h1></td><td width="54%" style="width:54%;font-size:0;line-height:0">&nbsp;</td></tr></table><!--[if mso]></v:textbox></v:roundrect><![endif]-->${rail}<img class="banner-img" src="${url}" alt="${text(image.alt)}" width="508" style="display:none;width:100%;height:auto;border:0;mso-hide:all"></td></tr></table></td></tr>`;
}
