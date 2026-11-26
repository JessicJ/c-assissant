import { localDateTimeInstant } from './arrival-reminder.js';

/** Dated, route-local estimates; never infers departure from a reminder or activity start. */
export function transferTiming(input: { date:string; departure?:string; durationMinutes?:number; departureZone?:string|undefined; destinationZone?:string|undefined; scheduledStart?:string|undefined }) : {estimatedArrival?:string; lateMinutes?:number} {
 const {date,departure,durationMinutes,departureZone,destinationZone,scheduledStart}=input;
 if(!departure || !departureZone || !destinationZone || !durationMinutes || !Number.isFinite(durationMinutes) || durationMinutes<=0) return {};
 const start=localDateTimeInstant(`${date}T${departure}`,departureZone);
 if(!start)return {};
 try {
  const arrival=new Date(start.getTime()+Math.ceil(durationMinutes)*60_000);
  const format=new Intl.DateTimeFormat('en-GB',{timeZone:destinationZone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  const arrivalDate=new Intl.DateTimeFormat('en-CA',{timeZone:destinationZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(arrival);
  const days=Math.round((Date.parse(arrivalDate+'T00:00:00Z')-Date.parse(date+'T00:00:00Z'))/86_400_000);
  const estimatedArrival=format.format(arrival)+(days?` (${days>0?'+':''}${days} day${Math.abs(days)===1?'':'s'})`:'');
  const scheduled=scheduledStart?localDateTimeInstant(`${date}T${scheduledStart}`,destinationZone):undefined;
  const lateMinutes=scheduled?Math.ceil((arrival.getTime()-scheduled.getTime())/60_000):0;
  return {estimatedArrival,...(lateMinutes>0?{lateMinutes}:{})};
 }catch{return {};}
}
