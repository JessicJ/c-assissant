import assert from "node:assert/strict";
import { test } from "node:test";
import { renderMorningEmail, renderTransferEmail, renderDiningEmail, renderChangeEmail } from "./index.js";
import { kyotoMorning, kyotoTransfer, kyotoDining, kyotoChange } from "./kyoto-example.js";

test("all four emails have static presentation layout, HTTPS images, alt and plain text", () => {
  const emails = [renderMorningEmail(kyotoMorning), renderTransferEmail(kyotoTransfer), renderDiningEmail(kyotoDining), renderChangeEmail({...kyotoChange,links:[{label:"Review itinerary",url:"https://review.example.org/itinerary"}]})];
  for (const email of emails) {
    assert.doesNotMatch(email.html, /<script|<iframe|<input|<button|\son\w+=|data:image|display:flex|display:grid|var\(--/i);
    assert.match(email.html, /role="presentation"/);
    for (const img of email.html.matchAll(/<img\b[^>]*>/g)) {
      assert.match(img[0], /src="(?:https:\/\/|cid:landi-(?:kit-v1|way-v2|update-v1)-)/);
      assert.match(img[0], /alt="[^"]*"/);
    }
    assert.ok(Buffer.byteLength(email.html) < 100_000);
    assert.match(email.text,/Illustrative/i);
    assert.ok(email.text.includes("https://"));
    assert.ok(!email.text.includes("<table"));
    assert.ok(email.subject);
  }
});

test("traveler and place text cannot insert tags, attributes or executable links", () => {
  const email = renderTransferEmail({ ...kyotoTransfer, origin: '<img src=x onerror="alert(1)">', destination: 'River & "Street"' });
  assert.match(email.html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.match(email.html, /River &amp; &quot;Street&quot;/);
  for (const url of ['javascript:alert(1)', 'http://example.com', 'data:image/png;base64,a', 'https://name:secret@example.com']) {
    assert.throws(() => renderTransferEmail({ ...kyotoTransfer, hero: { url, alt: "图片" } }));
    assert.throws(() => renderTransferEmail({ ...kyotoTransfer, routeLink: { url, label: "路线" } }));
  }
});

test("planned, flexible and confirmed times remain distinct without inferring completion", () => {
  const data = structuredClone(kyotoMorning);
  data.itinerary[0]!.time.kind = "confirmed";
  const rendered = renderMorningEmail(data);
  assert.match(rendered.html, /Reserved/);
  assert.doesNotMatch(rendered.html, />Planned</);
  assert.match(rendered.html, /At your own pace/);
  assert.doesNotMatch(rendered.html, /你已经到达|你已完成|确认到达按钮/);
  assert.match(renderTransferEmail(kyotoTransfer).text, /Your location is not tracked/);
  assert.ok(renderDiningEmail(kyotoDining).text.includes(kyotoDining.plannedTime));
});

test("proposed and confirmed changes require different status and explicit confirmation time", () => {
  const proposed = renderChangeEmail(kyotoChange);
  assert.doesNotMatch(proposed.text, /original plan is unchanged/);
  assert.match(proposed.text, /confirmation is required/);
  assert.match(proposed.text, /Open Landi to review and confirm this change\./);
  assert.match(proposed.html, /Open Landi to review and confirm this change\./);
  const confirmed = renderChangeEmail({ ...kyotoChange, status: { kind: "confirmed", confirmedAt: "15 Oct 2026, 16:20", explanation: "You confirmed a street walk." } });
  assert.match(confirmed.text, /new arrangement is confirmed/);
  assert.match(confirmed.text, /15 Oct 2026, 16:20/);
  assert.doesNotMatch(confirmed.text, /original plan is unchanged|confirmation is required|Open Landi to review and confirm this change/);
  assert.doesNotMatch(confirmed.html, /Open Landi to review and confirm this change/);
  assert.throws(() => renderChangeEmail({ ...kyotoChange, status: { kind: "confirmed", confirmedAt: "", explanation: "" } }));
  assert.equal(renderChangeEmail(kyotoChange).html, proposed.html);
});

test("production calls reject sample image identifiers and preserve caller-provided HTTPS assets", () => {
  assert.throws(() => renderTransferEmail({ ...kyotoTransfer, sample: false }), /hosted images/);
  const email = renderTransferEmail({ ...kyotoTransfer, sample: false, hero: { url: 'https://cdn.example.org/kyoto.png', alt: "Kyoto" } });
  assert.match(email.html, /src="https:\/\/cdn.example.org\/kyoto.png"/);
  assert.doesNotMatch(email.html, /\/email-reference\//);
});

test("editorial handbook preserves input facts and readable cover without photographs", () => {
  const data = structuredClone(kyotoMorning);
  delete data.hero;
  for (const place of data.places) delete place.image;
  data.title = 'A long travel title with <untrusted> text & a quiet afternoon';
  const rendered = renderMorningEmail(data);
  assert.doesNotMatch(rendered.html, /src="https:|url\('https/);
  assert.match(rendered.html, /background:#204237/);
  assert.match(rendered.html, /&lt;untrusted&gt; text &amp;/);
  for (const stop of data.itinerary) {
    assert.ok(rendered.text.includes(stop.title));
    if (stop.time.kind === "flexible") assert.ok(rendered.text.includes(stop.detail));
    if (stop.time.kind !== 'flexible') assert.ok(rendered.text.includes(stop.time.label));
  }
  for (const link of data.links) assert.ok(rendered.text.includes(link.url));
  assert.match(rendered.html, /aria-label="Timed itinerary"/);
  assert.match(rendered.html, /Today's map/);
  assert.match(rendered.html, /At your own pace/);
});


test("design kit icons use original PNG bytes, bound CID references and deduplicated attachments", async () => {
  const { readFile } = await import("node:fs/promises");
  const rendered = renderMorningEmail(kyotoMorning);
  const attachments = rendered.attachments!;
  assert.equal(new Set(attachments.map(a => a.cid)).size, attachments.length);
  for (const asset of attachments) {
    assert.ok(rendered.html.includes(`src="cid:${asset.cid}"`));
    assert.deepEqual(Buffer.from(asset.contentBase64,"base64"), await readFile(new URL(`./design-kit/png/${asset.filename}`,import.meta.url)));
  }
  assert.doesNotMatch(rendered.html, /data:image|<svg|↗|✧|automatic emails remain off/);
});


test("presentation icon names cannot inject HTML or CID resource paths", () => {
  const data=structuredClone(kyotoMorning);
  data.itinerary[0]!.iconKind='camera" onerror="alert(1)' as NonNullable<typeof data.itinerary[0]['iconKind']>;
  assert.throws(()=>renderMorningEmail(data),/Unknown design-kit icon/);
});


test("morning rail hides descriptions, retains explicit reminders and conditionally renders poetic copy", () => {
  const data = structuredClone(kyotoMorning);
  data.itinerary = [
    { time: {label:"09:00",kind:"planned"}, title:"Garden visit", detail:"A long scenic description." },
    { time: {label:"11:00",kind:"confirmed"}, title:"Guided visit", detail:"Explore the collection.", reminder:"Bring your booking confirmation." },
    { time: {label:"13:00",kind:"planned"}, title:"Transfer", detail:"A scenic road.", reminder:"Meet at the booked departure point." }
  ];
  const plain = renderMorningEmail(data);
  assert.doesNotMatch(plain.html, /A long scenic description|Explore the collection|A scenic road|A little wonder|data-icon="leaf"/);
  assert.match(plain.text,/Bring your booking confirmation/);
  assert.match(plain.text,/Meet at the booked departure point/);
  assert.match(plain.text,/Reserved/);
  for (const stop of data.itinerary) { assert.ok(plain.text.includes(stop.time.label)); assert.ok(plain.text.includes(stop.title)); }
  const poetic=renderMorningEmail({...data,poeticLine:"Between the garden & the river, quiet moments unfold."});
  assert.match(poetic.html,/garden &amp; the river/);
  assert.match(poetic.html,/data-icon="leaf"/);
  assert.doesNotMatch(renderMorningEmail({...data,poeticLine:"   "}).html,/data-icon="leaf"/);
});

test("all email formats render optional ride buttons; unconfirmed changes cannot promote a replacement ride",()=>{
 const ride={provider:"uber" as const,link:{label:"Open Uber",url:"https://m.uber.com/looking?pickup=my_location"},destination:"Museum",note:"Confirm your actual pickup, destination and fare in Uber."};
 const morning=structuredClone(kyotoMorning);morning.places[0]!.ride=ride;
 const dining=structuredClone(kyotoDining);dining.restaurants[0]!.ride=ride;
 for(const email of [renderMorningEmail(morning),renderDiningEmail(dining),renderTransferEmail({...kyotoTransfer,ride}),renderChangeEmail({...kyotoChange,ride,status:{kind:"confirmed",confirmedAt:"15 Oct 2026",explanation:"The new itinerary was confirmed."}})]){
  assert.match(email.html,/class="ride-action"/);assert.match(email.html,/href="https:\/\/m.uber.com\/looking/);assert.match(email.text,/Confirm your actual pickup/);
 }
 assert.doesNotMatch(renderChangeEmail({...kyotoChange,ride}).html,/class="ride-action"/);
 assert.throws(()=>renderTransferEmail({...kyotoTransfer,ride:{...ride,link:{...ride.link,url:"https://evil.example.org/request"}}}),/Invalid email ride service/);
});

test('supporting editorial templates preserve facts, sources and original CID assets without repeated boilerplate',()=>{
 const inputs=[kyotoTransfer,kyotoDining,kyotoChange];
 const outputs=[renderTransferEmail(kyotoTransfer),renderDiningEmail(kyotoDining),renderChangeEmail(kyotoChange)];
 for(const [index,email] of outputs.entries()){
  assert.match(email.html,index===2?/max-width:560px/:/max-width:600px/);
  if(index!==1)assert.ok(email.attachments?.length);
  const cids=[...email.html.matchAll(/src="cid:([^"]+)"/g)].map(m=>m[1]);
  assert.deepEqual([...new Set(cids)].sort(),email.attachments!.map(a=>a.cid).sort());
  const input=inputs[index]!;
  for(const link of (index===1 && 'links' in input ? input.links : index===2?kyotoChange.links.filter(l=>l.label==='Review itinerary'):[])) assert.ok(email.text.includes(link.url));
 }
 const dining=structuredClone(kyotoDining);
 for(const r of dining.restaurants) r.priceNote='No table reservation has been confirmed.';
 const result=renderDiningEmail(dining);
 assert.equal(result.text.split('No table reservation has been confirmed.').length-1,0);
 for(const r of dining.restaurants){assert.ok(result.text.includes(r.name));assert.ok(result.text.includes(r.transport));for(const l of r.links.filter(l=>l.label.toLowerCase()==='map'))assert.ok(result.text.includes(l.url));}
 assert.ok(outputs[0]!.text.includes(kyotoTransfer.origin));
 assert.ok(outputs[0]!.text.includes(kyotoTransfer.plannedTime));
 assert.ok(outputs[2]!.text.includes(kyotoChange.impact));
});

test('compact Dining preserves numeric distances, optional ride, sources and unknown data without inventing status',()=>{
 const data=structuredClone(kyotoDining);
 for(const [i,r]of data.restaurants.entries())r.distanceMeters=[504,2646,2755][i]!;
 const email=renderDiningEmail(data);
 assert.match(email.text,/≈ 504 m/);assert.match(email.text,/≈ 2\.6 km/);assert.match(email.text,/≈ 2\.8 km/);
 assert.match(email.html,/class="dining-image-cell"/);
 assert.equal((email.html.match(/class="[^"]*\bdining-map\b/g)??[]).length,data.restaurants.length);
 for(const r of data.restaurants){for(const l of r.links.filter(l=>l.label.toLowerCase()==='map'))assert.ok(email.text.includes(l.url));const detail=r.links.find(l=>['website','menu'].includes(l.label.toLowerCase()))??r.links.find(l=>l.label.toLowerCase()!=='map');if(detail)assert.ok(email.text.includes(detail.url));}
 assert.doesNotMatch(email.html,/dining-sources/);
 const missing=structuredClone(data);
 missing.reminder='';
 for(const r of missing.restaurants){delete r.image;delete r.distanceMeters;r.transport='';r.priceNote='';r.links=[];}
 const fallback=renderDiningEmail(missing);
 assert.match(fallback.text,/Photo unavailable/);assert.match(fallback.text,/Check Maps/);
 assert.doesNotMatch(fallback.text,/No (?:table )?reservation|reservation confirmed|≈/i);
 for(const r of missing.restaurants)assert.ok(fallback.text.includes(encodeURIComponent(r.name)));
 const empty=renderDiningEmail({...missing,restaurants:[],fallbackLinks:[{label:'Nearby restaurants',url:'https://www.google.com/maps/search/?api=1&query=restaurants'}]});
 assert.match(empty.text,/Nearby restaurants/);
 assert.throws(()=>renderDiningEmail({...data,restaurants:[{...data.restaurants[0]!,links:[{label:'Map',url:'javascript:alert(1)'}]}]}));
});

test('Dining guide preserves supplied timing and recommendation while omitting price and Tip',()=>{
 const data=structuredClone(kyotoDining);
 const before=renderDiningEmail(data);
 assert.doesNotMatch(before.text,/Top pick|≈ \d+ min/);
 const first=data.restaurants[0]!;first.estimatedDurationMinutes=8;first.price='$$';first.topPick=true;
 data.reminder='TIP-OMISSION-CHECK';first.priceNote='PRICE-NOTE-OMISSION-CHECK';first.cuisine='CATEGORY-OMISSION-CHECK';
 const supplied=renderDiningEmail(data);
 for(const body of [supplied.html,supplied.text])assert.doesNotMatch(body,/TIP-OMISSION-CHECK|PRICE-NOTE-OMISSION-CHECK|CATEGORY-OMISSION-CHECK|Price range|Price unverified|>Tip</);
 assert.match(supplied.text,/≈ 8 min/);assert.match(supplied.text,/Top pick/);assert.doesNotMatch(supplied.text,/\$\$/);assert.match(supplied.text,/See menu/);
 assert.match(supplied.html,/dining-cover/);assert.match(supplied.text,/Planned dining time/);
 first.links=first.links.filter(l=>l.label==='Map'||l.label==='Website');
 const site=renderDiningEmail({...data,restaurants:[first]});assert.match(site.text,/Website/);assert.doesNotMatch(site.text,/See menu/);
 first.links=first.links.filter(l=>l.label==='Map');delete first.estimatedDurationMinutes;first.price='Price unverified';delete first.topPick;
 const unavailable=renderDiningEmail({...data,restaurants:[first]});assert.doesNotMatch(unavailable.text,/See menu|Top pick|≈ 8 min|\$\$/);assert.doesNotMatch(unavailable.text,/Price unverified|Price range/);
});

test('On the Way target composition has one numeric warning only for complete conflict data and no inactive ride',()=>{
 const base={...kyotoTransfer,destination:'Destination',estimatedArrival:'09:25',scheduledArrival:'09:00',plannedTime:'08:30',lateMinutes:25};
 const late=renderTransferEmail(base);assert.match(late.text,/May arrive 25 min late/);assert.match(late.text,/Activity starts at 09:00/);
 for(const data of [{...base,estimatedArrival:'08:55',lateMinutes:undefined},{...base,estimatedArrival:undefined,lateMinutes:undefined},{...base,scheduledArrival:undefined},{...base,lateMinutes:0}]){
  const email=renderTransferEmail(data as typeof base);assert.doesNotMatch(email.text,/May arrive|Ride unavailable|Connect Uber/);
 }
 assert.doesNotMatch(late.text,/Explore the wooden|Kyoto Travel/);
 assert.equal((late.html.match(/class="primary-button"/g)??[]).length,1);
 for(const asset of late.attachments!) assert.ok(Buffer.from(asset.contentBase64,'base64').readUInt32BE(16)===48);
});

test('On the Way embeds the supplied original PNG bytes and preserves the photograph identity in a sized rendition',async()=>{
 const {readFile}=await import('node:fs/promises');
 const rendered=renderTransferEmail({...kyotoTransfer,hero:{url:'https://commons.wikimedia.org/wiki/Special:Redirect/file/Example.jpg',alt:'Destination'},estimatedArrival:'09:25',scheduledArrival:'09:00',lateMinutes:25});
 assert.match(rendered.html,/Special:Redirect\/file\/Example\.jpg\?width=1280/);
 for(const a of rendered.attachments!)assert.deepEqual(Buffer.from(a.contentBase64,'base64'),await readFile(new URL(`./on-the-way-kit/${a.filename.replace(/^way-/,'')}`,import.meta.url)));
 const other=renderTransferEmail({...kyotoTransfer,hero:{url:'https://images.example.org/destination.jpg',alt:'Destination'}});
 assert.match(other.html,/src="https:\/\/images.example.org\/destination.jpg"/);
 assert.doesNotMatch(other.html,/images.example.org\/destination.jpg\?/);
});


test("English notification text preserves Japanese place names and rejects non-English system status", () => {
  const transfer = renderTransferEmail({ ...kyotoTransfer, origin: "京都駅", destination: "清水寺", title: "Next: 清水寺" });
  assert.match(transfer.html, /<html lang="en">/);
  assert.ok(transfer.text.includes("京都駅"));
  assert.ok(transfer.text.includes("清水寺"));
  assert.ok(transfer.text.includes("Your location is not tracked"));
  const change = renderChangeEmail({ ...kyotoChange, title: "Your itinerary is updated", options: [{ title: "おかべ家", description: "Dinner at the saved restaurant.", requiresConfirmation: false }], status: { kind: "applied", appliedAt: "2026-11-24T08:00:00.000Z", explanation: "The updated arrangement is saved." } });
  assert.match(change.html, /<html lang="en">/);
  assert.ok(change.text.includes("おかべ家"));
  assert.ok(change.text.includes("UPDATE APPLIED"));
  assert.ok(change.text.includes(new Date("2026-11-24T08:00:00.000Z").toLocaleString("en-GB", { timeZoneName: "short" })));
  assert.throws(() => renderChangeEmail({ ...kyotoChange, status: { kind: "applied", appliedAt: "2026-11-24T08:00:00.000Z", explanation: "系统提示" } }), /system copy must be English/);
});
