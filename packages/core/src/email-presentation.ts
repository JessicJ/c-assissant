/** Serializable public image bytes frozen together with an assembled email. */
export interface EmailInlineAttachment {
  cid: string;
  filename: string;
  contentType: "image/png" | "image/jpeg";
  contentBase64: string;
}
