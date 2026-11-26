/** Standalone review surface, outside the script-free email body and desktop workspace. */
export function emailReviewPage(nonce:string):string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Landi · Review your itinerary</title><style>
  :root{color-scheme:light dark}*{box-sizing:border-box}body{margin:0;background:#FAF8F4;color:#293D34;font:15px/1.6 -apple-system,BlinkMacSystemFont,Arial,sans-serif}main{max-width:430px;margin:auto;padding:26px 22px 40px}.brand{font:32px Georgia,serif;color:#203E35;margin-bottom:26px}h1{font:30px/1.25 Georgia,serif;margin:12px 0 18px}h2{font-size:17px;margin:0 0 14px}h3{font-size:15px;margin:16px 0 8px}p{margin:8px 0 18px}.status{padding:14px;border-radius:10px;background:#E8EEE8;color:#305544}.card{background:#fff;border:1px solid #E5E5DD;border-radius:12px;padding:18px;margin:18px 0;overflow-wrap:anywhere}ul{padding-left:18px;margin:10px 0}li{margin:8px 0}.subtle{font-size:12px;color:#6C7B72}.time{font-weight:700;margin-right:8px}.pill{font-size:11px;background:#F2EDE5;color:#98795D;padding:3px 6px;border-radius:4px;display:inline-block}button{width:100%;min-height:48px;padding:14px;border-radius:9px;border:1px solid #203E35;background:#203E35;color:white;font:600 15px/1.4 -apple-system,BlinkMacSystemFont,Arial,sans-serif;cursor:pointer;margin:8px 0}button.secondary{color:#203E35;background:transparent}button:disabled{opacity:.55;cursor:default}.notice{background:#FBF4EB;padding:14px;border-radius:9px}.error{color:#955E45}input{width:18px;height:18px;vertical-align:middle;margin:0 8px 0 0}label{display:block;padding:12px 0}a{color:inherit}@media(prefers-color-scheme:dark){body{background:#1E2924;color:#E8E9DF}.brand{color:#C4D3C5}.card{background:#26352D;border-color:#48564B}.status{background:#334E41;color:#E8E9DF}.subtle{color:#BCC6BA}.notice{background:#47382D}.pill{background:#47382D;color:#E8D0B4}button.secondary{border-color:#AFC4B4;color:#DCE9DC}}
  </style></head><body><main><div class="brand">Landi</div><p class="subtle">YOUR TRAVEL COMPANION</p><h1>Review the new arrangement.</h1><p id="status" class="status" role="status" aria-live="polite">Opening your itinerary review…</p><div id="content"></div><div id="actions" hidden><button id="confirm" disabled>Confirm updated itinerary</button><button id="keep" class="secondary">Keep the current itinerary for now</button><p class="subtle">Confirming updates your saved itinerary. Bookings, rides and payments remain in the original services.</p></div><button id="check" class="secondary" hidden>Check confirmation status</button><p id="error" class="error" role="alert"></p></main><script nonce="${nonce}">
  const token=new URLSearchParams(location.hash.slice(1)).get('token');history.replaceState(null,'',location.pathname);
  const status=document.getElementById('status'),content=document.getElementById('content'),actions=document.getElementById('actions'),confirm=document.getElementById('confirm'),error=document.getElementById('error'),check=document.getElementById('check');let review,inFlight=false,confirmationUnknown=false;
  const node=(tag,text,className)=>{const element=document.createElement(tag);if(text!==undefined)element.textContent=text;if(className)element.className=className;return element;};
  const request=async(path,body)=>{const response=await fetch('/api/email-review/'+path,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body||{})});if(!response.ok){const failure=new Error('Review request failed');failure.status=response.status;throw failure;}return response.json();};
  function renderPlan(title,plan,version,blueprintVersion){const section=node('section',undefined,'card');section.append(node('h2',title),node('p',plan.title),node('p','Version '+version+(blueprintVersion!==undefined?' · Blueprint version '+blueprintVersion:''),'subtle'));for(const day of plan.days){section.append(node('h3',day.date+' · '+day.city));const list=node('ul');for(const activity of day.activities){const item=node('li');item.append(node('span',activity.time||'Flexible','time'),node('span',activity.title),document.createTextNode(' '),node('span',({confirmed:'Confirmed time',planned:'Planned',estimated:'Estimated',unknown:'Time to check',recheck:'Time to recheck',flexible:'Flexible'})[activity.timeKind]||'Time to check','pill'));const detail=[activity.placeName&&activity.placeName!==activity.title?activity.placeName:'',activity.locationLabel||'',activity.durationMinutes?'Planned duration: '+activity.durationMinutes+' min':''].filter(Boolean);if(detail.length)item.append(node('p',detail.join(' · '),'subtle'));list.append(item);}section.append(list);}if(plan.assumptions.length){section.append(node('h3','Things to check'));const list=node('ul');for(const value of plan.assumptions)list.append(node('li',value));section.append(list);}return section;}
  function confirmed(data){confirmationUnknown=false;status.textContent='The new itinerary is confirmed and active.';actions.hidden=true;check.hidden=true;if(data.confirmedAt)status.append(node('p','Confirmed: '+new Date(data.confirmedAt).toLocaleString(),'subtle'));}
  const unavailable=failure=>[401,403,409,410].includes(failure.status);
  async function open(){
    if(inFlight)return;
    if(!token){status.textContent='Open the review link from your latest Landi email.';return;}
    inFlight=true;actions.hidden=true;confirm.disabled=true;check.disabled=true;error.textContent='';
    try{
      const data=await request('view');
      if(!['proposed','confirmed'].includes(data.status))throw new Error('Unrecognized review status');
      content.replaceChildren(renderPlan('Original itinerary',data.original,data.scope.baseVersion),renderPlan('Proposed complete itinerary',data.proposed,data.scope.draftVersion,data.scope.blueprintVersion));
      if(data.impact.length){const notice=node('div',undefined,'notice');notice.append(node('h2','What this changes'));for(const item of data.impact)notice.append(node('p',item));content.prepend(notice);}
      review=data;confirmationUnknown=false;check.hidden=true;
      if(review.status==='confirmed'){confirmed(review);}else{status.textContent='Your original itinerary is still active. Nothing has changed yet.';actions.hidden=false;confirm.disabled=false;}
    }catch(failure){
      review=undefined;
      if(unavailable(failure)){content.replaceChildren();status.textContent='This review has expired or is no longer available. Open the latest email or review the itinerary in Landi.';check.hidden=true;}
      else{status.textContent=confirmationUnknown?'We couldn’t confirm whether the updated itinerary is active. Check confirmation status before trying again.':'The itinerary review could not be loaded. Check your connection and try again.';check.hidden=false;}
    }finally{inFlight=false;check.disabled=false;}
  }
  confirm.addEventListener('click',async()=>{
    if(inFlight||!review||review.status!=='proposed')return;
    inFlight=true;confirm.disabled=true;check.hidden=true;error.textContent='';
    try{
      const result=await request('confirm',{confirmed:true,expectedPlanId:review.scope.draftPlanId,expectedVersion:review.scope.draftVersion,expectedBasePlanId:review.scope.basePlanId,expectedBaseVersion:review.scope.baseVersion,...(review.scope.blueprintVersion!==undefined?{expectedBlueprintVersion:review.scope.blueprintVersion}:{})});
      if(result.status!=='confirmed'||typeof result.confirmedAt!=='string')throw new Error('Unrecognized confirmation result');
      confirmed(result);
    }catch{
      confirmationUnknown=true;actions.hidden=true;status.textContent='The confirmation result is not yet verified.';
      error.textContent='We couldn’t confirm whether the updated itinerary is active. Check confirmation status before trying again.';check.hidden=false;
    }finally{inFlight=false;}
  });
  check.addEventListener('click',()=>open());
  document.getElementById('keep').addEventListener('click',()=>{if(inFlight)return;actions.hidden=true;status.textContent='No changes were applied from this page. You can review the proposal again later while the link remains valid.';});open();
  </script></body></html>`;
}
