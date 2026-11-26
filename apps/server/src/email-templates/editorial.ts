/** Hallmark · pre-emit critique: P4 H5 E4 S5 R5 V4
 * Supporting emails follow the supplied Landi kit; inline literals support email clients.
 */
import { httpsUrl, serif, table, text } from './shared.js';
import type { EmailLink } from './types.js';
export const editorial = { deep:'#204237', ink:'#23463B', sage:'#85A28F', muted:'#708078', cream:'#F8F6F1', light:'#EDF2EC', white:'#FFFFFF', line:'#E7E9E2', ochre:'#B48A5F' };
export const presentation = {maxWidth:600,paper:editorial.cream,editorialBrand:true,extraCss:`.editorial-copy{font-family:Arial,Helvetica,sans-serif}.editorial-copy h1,.editorial-copy h2{font-family:Georgia,'Times New Roman',serif}@media(prefers-color-scheme:dark){.editorial-rule{border-color:#435345!important}.editorial-label{color:#C7B797!important}}`};
export const heading = (value:string,size=30) => `<h1 class="heading" style="font-family:${serif};font-weight:400;font-size:${size}px;line-height:1.15;letter-spacing:-.6px;margin:10px 0 16px;color:${editorial.deep};overflow-wrap:anywhere">${text(value)}</h1>`;
export const label = (value:string) => `<div class="editorial-label" style="font:700 10px/16px Arial;letter-spacing:1.5px;color:${editorial.ochre}">${text(value)}</div>`;
export const copy = (value:string,extra='') => value ? `<p class="copy" style="font:13px/20px Arial,Helvetica,sans-serif;color:${editorial.muted};margin:0;${extra}">${text(value)}</p>` : '';
export const note = (value:string) => value ? `<div class="info" style="padding:15px 16px;background:${editorial.light};border-radius:10px;margin-top:20px">${copy(value)}</div>` : '';
export function sourceLinks(links:EmailLink[],showLabel=true):string {
 const unique=links.filter((l,i)=>links.findIndex(other=>other.url===l.url)===i);
 return unique.length ? `<div class="editorial-rule" style="border-top:1px solid ${editorial.line};margin-top:24px;padding-top:12px">${showLabel?label('USEFUL LINKS'):''}${unique.map(l=>`<a class="secondary-copy" href="${httpsUrl(l.url)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;max-width:100%;box-sizing:border-box;padding:14px 12px 14px 0;font:12px/18px Arial;color:${editorial.deep};text-decoration:underline;overflow-wrap:anywhere">${text(l.label)} &rarr;</a>`).join('')}</div>` : '';
}
export const iconRow=(icon:string,body:string)=>table(`<tr><td valign="top" style="width:44px;padding-top:2px">${icon}</td><td valign="top">${body}</td></tr>`);
