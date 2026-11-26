import type { EmailRideAction, EmailContext, EmailImage, EmailLink, RenderedEmail } from "./types.js";

export const colors = { pine: "#203E35", text: "#293D34", cream: "#FAF8F4", muted: "#6C7B72", line: "#E9E6DF", rust: "#AE7158" };
export const sans = "-apple-system,BlinkMacSystemFont,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',Arial,sans-serif";
export const serif = "Georgia,'STSong','Songti SC',SimSun,serif";
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
export function httpsUrl(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || !parsed.hostname.includes(".") || parsed.hostname.endsWith(".local") || /^(?:\d+\.){3}\d+$/.test(parsed.hostname) || parsed.hostname.startsWith("[")) throw new Error("Email resources require a public HTTPS URL without credentials.");
  return escapeHtml(parsed.href);
}
export function table(content: string, style = "", attrs = ""): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" ${attrs.includes('width="') ? "" : 'width="100%"'} style="width:100%;table-layout:fixed;border-collapse:collapse;${style}" ${attrs}>${content}</table>`;
}
export function row(content: string, style = "", className = ""): string {
  return `<tr><td${className ? ` class="${className}"` : ""} style="${style}">${content}</td></tr>`;
}
export const text = (value: string) => escapeHtml(value).replace(/\n/g, "<br>");
export function paragraph(value: string, size = 12.5, extra = ""): string {
  return `<p class="copy" style="margin:0;font-size:${size}px;line-height:1.9;color:#667469;${extra}">${text(value)}</p>`;
}
export function title(value: string, size = 29): string {
  return `<h1 class="heading${size === 29 ? " heading-mobile" : ""}" style="font-family:${serif};font-size:${size}px;font-weight:450;line-height:1.34;letter-spacing:-.6px;color:${colors.pine};margin:13px 0 12px">${text(value)}</h1>`;
}
export function eyebrow(value: string): string {
  return `<div class="warm-text" style="color:${colors.rust};font-size:10px;font-weight:700;letter-spacing:1.8px">${text(value)}</div>`;
}
export function sectionTitle(value: string, english = ""): string {
  return table(`<tr><td class="heading" style="font-size:12px;color:#28473C;font-weight:750;letter-spacing:.5px;padding-bottom:15px">${text(value)}</td><td style="font:500 9px Arial;letter-spacing:1.7px;color:#B2A48B;text-align:right;padding-bottom:15px">${text(english)}</td></tr>`);
}
export function image(data: EmailImage | undefined, height: number, extra = ""): string {
  if (!data) return "";
  return `<img src="${httpsUrl(data.url)}" alt="${escapeHtml(data.alt)}" width="430" height="${height}" style="display:block;width:100%;height:${height}px;object-fit:cover;border:0;background:#D5DED4;color:${colors.text};font:12px ${sans};${extra}">`;
}
export function button(link: EmailLink, primary = false, full = false, extraStyle = ""): string {
  return `<a class="${primary ? "primary-button" : "secondary-button"}" href="${httpsUrl(link.url)}" aria-label="${escapeHtml(link.accessibleLabel ?? link.label)}" target="_blank" rel="noopener noreferrer" style="box-sizing:border-box;display:${full ? "block" : "inline-block"};${full ? "width:100%;" : ""}border:1px solid ${primary ? colors.pine : "#D9E0D9"};padding:14px 14px;border-radius:8px;background:${primary ? colors.pine : "#FFFFFF"};color:${primary ? "#FFFFFF" : "#355447"};font-size:11px;line-height:16px;font-weight:700;text-decoration:none;text-align:center;word-wrap:break-word;${extraStyle}">${text(link.label)}</a>`;
}
export function buttons(links: EmailLink[], primaryFirst = false): string {
  return `<div style="margin-top:12px">${links.map((link, i) => `<span style="display:inline-block;margin:0 8px 8px 0">${button(link, primaryFirst && i === 0)}</span>`).join("")}</div>`;
}
export function notice(value: string): string {
  return `<div class="notice" style="border-left:3px solid #DBB69A;background:#F7EFE6;padding:12px 13px;margin:20px 0 0;color:#86755F;font-size:10.5px;line-height:1.85">${text(value)}</div>`;
}
export function info(value: string): string {
  return `<div class="info" style="background:#EEF2ED;border-radius:10px;padding:14px 15px;line-height:1.8;color:#647468;font-size:11px;margin-top:19px">${value}</div>`;
}
export function padded(content: string, extra = ""): string {
  return table(row(content, `padding:24px 27px;${extra}`, "gutter"));
}
export function section(content: string): string { return `<div style="margin-top:25px">${content}</div>`; }

export function renderDocument(data: EmailContext, content: string, presentation: { systemCopy?: readonly string[]; extraCss?: string; maxWidth?: number; paper?: string; editorialBrand?: boolean; compact?: boolean; brandedFooter?: boolean; chrome?: {header:string;footer:string} } = {}): RenderedEmail {
  if (!data.sample && content.includes("https://preview.landi.invalid/")) throw new Error("Production emails require hosted images, not development sample identifiers.");
  const header = table(`<tr><td style="padding:${presentation.compact ? "14px 0" : presentation.editorialBrand ? "18px 0 18px" : "22px 0 18px"};font:bold italic ${presentation.compact ? 33 : presentation.editorialBrand ? 37 : 30}px Georgia,'Times New Roman',serif;letter-spacing:-1.3px;color:${colors.pine}" class="heading">landi<span style="font-size:12px;vertical-align:top;letter-spacing:0;padding-left:3px;color:#BC8361">✦</span></td><td style="font-size:9px;letter-spacing:2.1px;color:#89988B;text-align:right;font-weight:650;line-height:1.7">${text(data.brandLabel)}</td></tr>`);
  const footer = presentation.compact ? `<div style="padding:18px 20px 24px;font:11px/18px Arial;text-align:center;color:#586F65" class="secondary-copy">${presentation.brandedFooter?`<div style="border-top:1px solid #E0E4DE;padding-top:22px;margin:10px 0 10px;font:bold italic 28px Georgia;color:#739084">landi<span style="color:#B68052;font-size:12px;vertical-align:top">✦</span></div><div style="font:12px/19px Arial;margin-bottom:8px">Your travel companion</div>`:""}${data.sample ? "Illustrative route · " : ""}Based on your planned itinerary · Your location is not tracked.</div>` : `<div style="margin:6px 27px 0;padding:18px 0;border-top:1px solid #E5E7DF;font-size:9px;line-height:1.9;text-align:center;color:#7A897C"><span style="display:block;color:#6B8172;font:${presentation.editorialBrand ? "bold italic 26px" : "italic 18px"} Georgia;margin-bottom:3px">${presentation.editorialBrand ? 'landi<span style="color:#BC8361;font-size:12px;vertical-align:top">✦</span>' : "landi."}</span>${text(data.footer)}<br>${data.sample ? "Illustrative itinerary and images; verify current details." : text(data.disclosure)}</div>`;
  const msoWidth = presentation.maxWidth === 600 || presentation.maxWidth === 560 || presentation.maxWidth === 420 ? presentation.maxWidth : undefined;
  const msoOpen = msoWidth ? `<!--[if mso]><table role="presentation" align="center" width="${msoWidth}" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->` : "";
  const msoClose = msoWidth ? "<!--[if mso]></td></tr></table><![endif]-->" : "";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${escapeHtml(data.subject)}</title><style>
body{margin:0;padding:0;-webkit-text-size-adjust:100%}table{mso-table-lspace:0;mso-table-rspace:0}img{border:0}a{color:inherit}
@media screen and (max-width:375px){.gutter{padding-left:20px!important;padding-right:20px!important}.heading-mobile{font-size:27px!important}}
@media (prefers-color-scheme:dark){body,.email-body{background:#1E2924!important;color:#DFE8DF!important}.surface{background:#26362E!important;border-color:#435345!important}.heading{color:#EEF3E9!important}.copy,.secondary-copy{color:#B1C1B5!important}.info,.status,.recommendation{background:#334337!important;color:#D8E4D9!important}.notice,.alert{background:#493C30!important;color:#EFD4B6!important}.warm-text{color:#DEA78A!important}.secondary-button{background:#31463A!important;color:#E0EEE1!important;border-color:#597162!important}.primary-button{background:#B2C6B4!important;color:#1E3025!important;border-color:#B2C6B4!important}}
${presentation.extraCss ?? ""}
</style></head><body style="margin:0;padding:0;background:${colors.cream};color:${colors.text};font-family:${sans}"><div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all">${escapeHtml(data.preheader)}</div>${msoOpen}${table(row(table(row(presentation.chrome?.header ?? header, presentation.chrome ? "padding:0" : `padding:0 ${presentation.compact ? 20 : 27}px;background:${presentation.compact ? "#FAF8F4" : "#FFFFFF"}`, presentation.chrome ? "surface" : "surface gutter") + row(content) + row(presentation.chrome?.footer ?? footer, presentation.chrome ? "padding:0" : "padding-bottom:25px")), "padding:0"), `max-width:${presentation.maxWidth ?? 430}px;margin:0 auto;background:${presentation.paper ?? colors.cream};table-layout:fixed;word-wrap:break-word`, 'class="email-body"')}${msoClose}</body></html>`;
  const plain = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<head>[\s\S]*?<\/head>/, "").replace(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g, "$2 ($1)").replace(/<(?:br|\/p|\/div|\/tr|\/h1)\b[^>]*>/g, "\n").replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\n{3,}/g, "\n\n").trim();
  if ([data.footer, data.disclosure, ...(presentation.systemCopy ?? [])].some(value => /\p{Script=Han}/u.test(value))) throw new Error("Travel email system copy must be English.");
  return { subject: data.subject, html, text: plain };
}

/** Shared email-safe, user-confirmed ride handoff, never an automatic request. */
export function rideAction(ride: EmailRideAction | undefined): string {
  if (!ride) return "";
  const url=new URL(httpsUrl(ride.link.url));
  if (!((ride.provider==="uber" && url.origin==="https://m.uber.com" && url.pathname==="/looking") || (ride.provider==="grab" && url.origin==="https://grab.onelink.me" && url.pathname==="/2695613898"))) throw new Error("Invalid email ride service");
  return `<div class="ride-action" style="margin-top:12px">${button({...ride.link,accessibleLabel:`${ride.link.label} to ${ride.destination}`},false,true)}<p class="secondary-copy" style="font:10px Arial;line-height:16px;color:#708078;margin:7px 0 0">${text(ride.note)}</p></div>`;
}
