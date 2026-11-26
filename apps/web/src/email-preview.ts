import { renderMorningEmail, renderTransferEmail, renderDiningEmail, renderChangeEmail } from "../../server/src/email-templates/index.js";
import { kyotoMorning, kyotoTransfer, kyotoDining, kyotoChange } from "../../server/src/email-templates/kyoto-example.js";
import type { EmailKind } from "../../server/src/email-templates/types.js";
import "./email-preview.css";
import { resolveEmailPreviewImages } from "../../server/src/email-templates/preview.js";

const root = document.getElementById("email-preview")!;
if (!import.meta.env.DEV) throw new Error("Email preview is available only in development.");
const templates = { morning: () => renderMorningEmail(kyotoMorning), transfer: () => renderTransferEmail(kyotoTransfer), dining: () => renderDiningEmail(kyotoDining), change: () => renderChangeEmail(kyotoChange) };
const names = { morning: "Morning", transfer: "Transfer", dining: "Dining", change: "Change" };
const params = new URLSearchParams(location.search);
let kind: EmailKind = params.get("mail") as EmailKind;
if (!Object.hasOwn(templates, kind)) kind = "morning";
let width = [375, 390, 430].includes(Number(params.get("width"))) ? Number(params.get("width")) : 390;
let theme = params.get("theme") ?? "system";
let noImages = params.get("images") === "off";
const bare = params.get("bare") === "1";
root.innerHTML = `<div class="preview-controls" ${bare ? "hidden" : ""}><div class="preview-title">Landi · Mobile email preview</div><div class="preview-row"><nav aria-label="Email templates">${Object.entries(names).map(([id, name]) => `<button type="button" data-mail="${id}">${name}</button>`).join("")}</nav><label>Width <select id="preview-width"><option>375</option><option>390</option><option>430</option></select></label><label>Theme <select id="preview-theme"><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label><label><input type="checkbox" id="preview-no-images">Hide images</label></div><p>Development preview · Illustrative details and images</p></div><iframe id="email-frame" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" title="Landi Email body"></iframe>`;
const frame = document.getElementById("email-frame") as HTMLIFrameElement;
const widthSelect = document.getElementById("preview-width") as HTMLSelectElement;
const themeSelect = document.getElementById("preview-theme") as HTMLSelectElement;
const imageCheck = document.getElementById("preview-no-images") as HTMLInputElement;
function render() {
  const email = templates[kind]();
  let html = resolveEmailPreviewImages(email).replace(/https:\/\/preview\.landi\.invalid\/(\w+)\.png/g, (_, name: string) => new URL(`/email-reference/${name}.png`, location.origin).href);
  if (theme !== "system") html = html.replace(/@media\s*\(prefers-color-scheme:\s*dark\)/g, theme === "dark" ? "@media all" : "@media not all");
  if (noImages) html = html.replace(/src="[^"]+"/g, 'src="https://preview.landi.invalid/missing.png"');
  frame.style.width = bare ? "100%" : `${width}px`;
  frame.srcdoc = html;
  frame.style.height = "1px";
  document.querySelectorAll<HTMLButtonElement>("[data-mail]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.mail === kind)));
  widthSelect.value = String(width); themeSelect.value = theme; imageCheck.checked = noImages;
  history.replaceState(null, "", `?${new URLSearchParams({ mail: kind, width: String(width), theme, images: noImages ? "off" : "on", ...(bare ? { bare: "1" } : {}) })}`);
}
// Measurement lives in the development shell. The email frame cannot run scripts.
let observer: ResizeObserver | undefined;
frame.addEventListener("load", () => {
  observer?.disconnect();
  const body = frame.contentDocument?.body;
  if (!body) return;
  const resize = () => { frame.style.height = `${Math.ceil(body.getBoundingClientRect().height)}px`; };
  observer = new ResizeObserver(resize);
  observer.observe(body);
  body.querySelectorAll("img").forEach(img => { img.addEventListener("load", resize); img.addEventListener("error", resize); });
  resize();
});
root.querySelectorAll<HTMLButtonElement>("[data-mail]").forEach(button => button.addEventListener("click", () => { kind = button.dataset.mail as EmailKind; render(); }));
widthSelect.addEventListener("change", () => { width = Number(widthSelect.value); render(); });
themeSelect.addEventListener("change", () => { theme = themeSelect.value; render(); });
imageCheck.addEventListener("change", () => { noImages = imageCheck.checked; render(); });
render();
