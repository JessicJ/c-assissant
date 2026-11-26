import { safePlanError } from "./api-client.js";
import { useEffect, useState } from "react";
import "./EmailExecutionSettings.css";

interface Snapshot {
  senderConfigured: boolean;
  sender: {host:string;port:number;user:string;from:string;passwordSaved:boolean};
  timing: string;
  review?:{configured:boolean;baseUrl:string};
  settings: { recipient: string; verified: boolean; enabled: boolean; cityTimeZones: Record<string,string> };
  deliveries: Array<{ id: string; kind: string; date: string; dueAt: string; status: string; attempts: number; contentStatus?: "generated" | "saved_facts" | "pending" }>;
}
async function request<T>(path: string, body?: unknown, method = "POST"): Promise<T> {
  const response = await fetch(`/api/email-execution${path}`, body === undefined ? { method: "GET" } : { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json() as { error?: string } & T;
  if (!response.ok) throw new Error("Email settings could not be updated. Check the current settings before trying again.");
  return data;
}
const statuses: Record<string, string> = { pending: "Waiting", sending: "Sending", accepted: "Accepted by mail server", retry: "Will retry", uncertain: "Delivery unknown — automatic retry stopped", failed: "Could not send", cancelled: "Cancelled" };
export function EmailExecutionSettings() {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [recipient, setRecipient] = useState("");
  const [code, setCode] = useState("");
  const [sender, setSender] = useState({ host: "", port: 587, user: "", from: "", password: "" });
  const [cityTimeZones,setCityTimeZones]=useState<Record<string,string>>({});
  const [city,setCity]=useState("");const [zone,setZone]=useState("");
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  const apply = (data: Snapshot,loadSender=false) => { if(loadSender && data.sender)setSender({...data.sender,password:""}); setSnapshot(data);setRecipient(data.settings.recipient);setCityTimeZones(data.settings.cityTimeZones); };
  useEffect(() => { let active = true; void request<Snapshot>("").then(data => { if (active) apply(data,true); }).catch(() => { if (active) setMessage("Email settings are unavailable. Please try again."); }); return () => { active = false; }; }, []);
  async function perform(action: () => Promise<void>) { setBusy(true); setMessage(""); try { await action(); } catch (error) { setMessage(safePlanError(error, "The email request could not be completed. Check the current settings before trying again.")); } finally { setBusy(false); } }
  return <section id="travel-email-settings" className="settings-card email-execution-settings" aria-labelledby="email-execution-title">
    <header><h2 id="email-execution-title">Travel emails</h2></header>
    <p className="settings-description">Daily illustrated handbooks, route help, dining choices and important changes. Gmail and iCloud can receive your emails. No inbox access or routine check-ins are needed.</p>
    <h3>Sender</h3><p className="settings-description">The person running Landi configures sending once. Your sender and recipient can be the same address; inbox access is not needed. Use an app password or SMTP authorization, not your ordinary mailbox password.</p>
    <p className="email-sender-status">{!snapshot ? "Loading sender settings…" : snapshot.senderConfigured ? "Sender configured. Your password is saved; leave it blank to keep it." : "Sender not configured. Enter your sending service below, then save and check the connection."}</p>
    <div className="settings-form">
      <label>SMTP server<input autoComplete="off" value={sender.host} placeholder="smtp.gmail.com or smtp.mail.me.com" onChange={event => setSender({ ...sender, host: event.target.value })}/></label>
      <label>Secure connection<select value={sender.port} onChange={event => setSender({ ...sender, port: Number(event.target.value) })}><option value={587}>STARTTLS · 587</option><option value={465}>TLS · 465</option></select></label>
      <label>Sender account<input autoComplete="off" value={sender.user} onChange={event => setSender({ ...sender, user: event.target.value })}/></label>
      <label>From address<input type="email" autoComplete="off" value={sender.from} onChange={event => setSender({ ...sender, from: event.target.value })}/></label>
      <label>App password / SMTP credential<input type="password" autoComplete="new-password" value={sender.password} onChange={event => setSender({ ...sender, password: event.target.value })}/></label>
    </div>
    <button disabled={busy || !snapshot || !sender.host.trim() || !sender.user.trim() || !sender.from.trim() || (!sender.password.trim() && (!snapshot.sender?.passwordSaved || sender.user!==snapshot.sender.user))} className="save-button" onClick={() => void perform(async () => { apply(await request<Snapshot>("/sender", sender, "PUT"),true); setMessage("Sender saved. Password saved; no need to enter it again."); })}>Save sender</button>
    <button disabled={busy || !snapshot?.senderConfigured} className="text-action" onClick={() => void perform(async () => { await request("/sender/check", {}); setMessage("Sender connection verified. No email was sent."); })}>Check sender connection</button>
    <h3 style={{ marginTop: 24 }}>Recipient</h3>
    <div className="settings-form">
      <label>Receive at<input type="email" value={recipient} onChange={event => setRecipient(event.target.value)} placeholder="Your Gmail or iCloud address"/></label>
    </div>
    <details style={{marginTop:16}}><summary>Destination time zones (when automatic lookup is unavailable)</summary>
      <div className="settings-form" style={{marginTop:12}}><label>Destination city<input value={city} onChange={event=>setCity(event.target.value)} placeholder="Use the city name from your itinerary"/></label><label>Destination time zone<select aria-label="Destination time zone" value={zone} onChange={event=>setZone(event.target.value)}><option value="">Choose a time zone</option>{Intl.supportedValuesOf("timeZone").map(value=><option key={value} value={value}>{value.replaceAll("_"," ").replaceAll("/"," · ")}</option>)}</select></label></div>
      <button className="text-action" disabled={!city.trim() || !zone || busy} onClick={()=>{setCityTimeZones({...cityTimeZones,[city.trim().toLowerCase()]:zone});setCity("");setZone("");}}>Add destination time zone</button>
      {Object.entries(cityTimeZones).map(([name,value])=><p key={name}>{name} · {value.replaceAll("_"," ").replaceAll("/"," · ")} <button aria-label={`Remove time zone for ${name}`} onClick={()=>setCityTimeZones(Object.fromEntries(Object.entries(cityTimeZones).filter(([key])=>key!==name)))}>Remove</button></p>)}
    </details><p className="settings-description">Email timing follows your approved itinerary. Changing the recipient pauses emails until the new address is verified.</p>
    <button disabled={busy || !snapshot} className="save-button" onClick={() => void perform(async () => { apply(await request<Snapshot>("/settings", { recipient, cityTimeZones }, "PUT")); setMessage("Recipient saved."); })}>Save email settings</button>
    <button disabled={busy || !snapshot?.senderConfigured || !snapshot.settings.recipient || snapshot.settings.verified} className="text-action" onClick={() => void perform(async () => { await request("/verification", {}); setMessage("Mail server accepted your verification email. Enter the code when it arrives."); })}>Send verification email</button>
    {!snapshot?.settings.verified && <div className="settings-form" style={{ marginTop: 16 }}><label>Verification code<input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={event => setCode(event.target.value)}/></label><button disabled={busy || !/^\d{6}$/.test(code)} onClick={() => void perform(async () => { apply(await request<Snapshot>("/verify", { code })); setCode(""); setMessage("Recipient verified."); })}>Verify recipient</button></div>}
    <div style={{ marginTop: 20 }}><strong>{snapshot?.settings.enabled ? "Travel emails enabled" : "Travel emails paused"}</strong><p className="settings-description">{snapshot?.settings.verified ? "Recipient verified." : "Verify the recipient before enabling travel emails."}</p><button className="save-button" disabled={busy || !snapshot || (!snapshot.settings.enabled && (!snapshot.senderConfigured || !snapshot.settings.verified))} onClick={() => void perform(async () => { apply(await request<Snapshot>("/activation", { enabled: !snapshot?.settings.enabled })); setMessage(snapshot?.settings.enabled ? "Travel emails paused." : "Travel emails enabled. Activities remain unconfirmed unless you explicitly report them."); })}>{snapshot?.settings.enabled ? "Pause travel emails" : "Enable travel emails"}</button></div>
    <p className="settings-description">MAH will manage email research, timing and execution using the Agent configured in MAH. This integration is not ready for use yet.</p>
    <p className="email-sender-status">{snapshot?.timing==="ready"?"Email timing arranged from your itinerary.":snapshot?.timing==="failed"?"Email timing could not be arranged. MAH integration is not ready for use yet.":snapshot?.timing==="no_plan"?"Confirm an itinerary to arrange travel emails.":"Email timing requires an approved itinerary, email delivery setup and a ready MAH integration."}</p>
    {snapshot?.timing==="failed" && <button disabled={busy} className="text-action" onClick={()=>void perform(async()=>{apply(await request<Snapshot>("/timing/retry",{}));setMessage("Email timing requested again.");})}>Arrange emails again</button>}
    <p className="settings-description">Review and confirm itinerary changes in your Landi workspace. Emails only provide reminders and travel information.</p>
    <p role="status" aria-live="polite">{message}</p>
    {Boolean(snapshot?.deliveries.length) && <details><summary>Recent email delivery</summary><ul>{snapshot?.deliveries.map(delivery => <li key={delivery.id}>{delivery.date} · {delivery.kind} · {statuses[delivery.status] ?? "Waiting"}{delivery.contentStatus === "saved_facts" ? " · Prepared from saved travel information" : delivery.contentStatus === "generated" ? " · Researched for this itinerary" : ""}</li>)}</ul></details>}
  </section>;
}
