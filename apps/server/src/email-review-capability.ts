import { createHmac, timingSafeEqual } from "node:crypto";

import type { EmailReviewScope } from "@c-assistant/storage";
export type { EmailReviewScope } from "@c-assistant/storage";
export interface EmailReviewConfiguration { baseUrl: string; signingKey: string }
interface Claims extends EmailReviewScope { purpose: "review_replacement"; audience: string; expiresAt: number }
export const EMAIL_REVIEW_LINK = "https://review.landi.invalid/pending";

export function publicReviewOrigin(value: string): string | undefined {
  try {
    const url = new URL(value);
    if(url.protocol!=="https:" || url.username || url.password || url.search || url.hash || url.pathname!=="/" || !url.hostname.includes(".") || url.hostname.endsWith(".local") || /^(?:\d+\.){3}\d+$/.test(url.hostname) || url.hostname.startsWith("[")) return;
    return url.origin;
  } catch { return; }
}
/** Narrow environment boundary. Never return this object through an API. */
export function emailReviewConfiguration(): EmailReviewConfiguration | undefined {
  const baseUrl=publicReviewOrigin(process.env.LANDI_EMAIL_REVIEW_BASE_URL ?? "");
  const signingKey=process.env.LANDI_EMAIL_ACTION_SECRET;
  return baseUrl && signingKey && /^[a-f0-9]{64}$/i.test(signingKey) ? {baseUrl,signingKey} : undefined;
}
export function issueReviewCapability(scope: EmailReviewScope, config: EmailReviewConfiguration, expiresAt: number): string {
  const claims:Claims={...scope,purpose:"review_replacement",audience:config.baseUrl,expiresAt};
  const encoded=Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature=createHmac("sha256",Buffer.from(config.signingKey,"hex")).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}
export function readReviewCapability(token: string, config: EmailReviewConfiguration, now: Date): Claims | undefined {
  try {
    if(token.length>2048) return;
    const [encoded,signature,extra]=token.split(".");if(!encoded || !signature || extra || !/^[\w-]+$/.test(encoded) || !/^[\w-]+$/.test(signature))return;
    const expected=createHmac("sha256",Buffer.from(config.signingKey,"hex")).update(encoded).digest();
    const provided=Buffer.from(signature,"base64url");if(provided.length!==expected.length || !timingSafeEqual(provided,expected))return;
    const claim=JSON.parse(Buffer.from(encoded,"base64url").toString("utf8")) as Partial<Claims>;
    if(claim.purpose!=="review_replacement" || claim.audience!==config.baseUrl || !Number.isFinite(claim.expiresAt) || claim.expiresAt!<=now.getTime() || claim.expiresAt!>now.getTime()+48*60*60_000 || typeof claim.basePlanId!=="string" || typeof claim.draftPlanId!=="string" || !Number.isSafeInteger(claim.baseVersion) || !Number.isSafeInteger(claim.draftVersion) || !Number.isSafeInteger(claim.recipientRevision) || claim.baseVersion!<1 || claim.draftVersion!<1 || claim.recipientRevision!<0 || claim.blueprintVersion!==undefined && (!Number.isSafeInteger(claim.blueprintVersion) || claim.blueprintVersion<1))return;
    return claim as Claims;
  } catch { return; }
}
export function isEmailReviewPath(url: string): boolean {
  return ["/email-review","/api/email-review/view","/api/email-review/confirm"].includes(url.split("?")[0]!);
}
