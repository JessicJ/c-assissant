import { iconPngBase64 } from "./design-kit/icon-data.js";
import type { EmailInlineAttachment } from "@c-assistant/core";
export type ItineraryIconKind = "car" | "camera" | "utensils" | "forest" | "suitcase" | "hotel" | "pin";
export function createEmailIcons() {
  const used = new Set<keyof typeof iconPngBase64>();
  return {
    image(name: keyof typeof iconPngBase64, size = 33) {
      if (!Object.hasOwn(iconPngBase64,name)) throw new Error("Unknown design-kit icon.");
      used.add(name);
      return `<img class="kit-icon" data-icon="${name}" src="cid:landi-kit-v1-${name}@landi.assets" width="${size}" height="${size}" alt="${name === "utensils" ? "Dining" : name.charAt(0).toUpperCase()+name.slice(1)}" style="display:block;width:${size}px;height:${size}px;border:0;font:8px Arial;color:#23463B">`;
    },
    attachments(): EmailInlineAttachment[] { return [...used].map(name => ({ cid: `landi-kit-v1-${name}@landi.assets`, filename: `${name}.png`, contentType: "image/png", contentBase64: iconPngBase64[name] })); }
  };
}
