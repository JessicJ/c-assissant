import type { RenderedEmail } from "./types.js";
/** Display copy only. This HTML must never be passed to the delivery worker. */
export function resolveEmailPreviewImages(email: RenderedEmail): string {
  let html = email.html;
  for (const asset of email.attachments ?? []) html=html.split(`cid:${asset.cid}`).join(`data:${asset.contentType};base64,${asset.contentBase64}`);
  return html;
}
