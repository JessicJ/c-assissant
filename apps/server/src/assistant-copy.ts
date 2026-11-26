import type { Plan } from '@c-assistant/core';
import type { ExecutionActivity } from './execution-itinerary.js';

export function dayGreeting(now: Date, timeZone: string, context?: { plan: Plan; activity: ExecutionActivity }): string {
  const clock = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const part = (name: string) => clock.find(value => value.type === name)!.value;
  const hour = Number(part('hour'));
  // Arrival cards already ask about the flight. Do not assume the traveller slept or has landed.
  if (context?.activity.role?.toLowerCase() === 'international arrival' || hour < 5) return '';
  const localDate = `${part('year')}-${part('month')}-${part('day')}`;
  const day = Math.floor(Date.parse(localDate) / 86_400_000);
  const choose = (phrases: string[]) => phrases[((day % phrases.length) + phrases.length) % phrases.length]!;
  const city = context?.activity.city.trim();
  let greeting = hour < 12 ? choose([
    'Good morning! Lovely to have another day ahead.',
    'Morning! A new day of your trip is here.',
    'Good morning! Let’s see what today has in store.',
    'Morning! I’m here whenever you’re ready to get going.'
  ]) : hour < 18 ? choose(['Good afternoon! How’s your day going?', 'Hello! Hope your afternoon is going well.', 'Good afternoon! Here’s what’s coming up.'])
    : choose(['Good evening! How has your day been?', 'Evening! Hope today has treated you well.', 'Good evening! Here’s what’s coming up.']);
  if (hour < 12 && context?.activity.role === 'Base-change transfer') greeting = `Good morning! We’re heading${city ? ` to ${city}` : ' to a new base'} today.`;
  else if (hour < 12 && context?.plan.presentation?.startDate === localDate) greeting = 'Good morning! Your trip starts today.';
  else if (hour < 12 && context?.plan.presentation?.endDate === localDate) greeting = 'Good morning! It’s the last day of your trip. I’m here to help with today’s arrangements.';
  return greeting + '\n\n';
}
export function nextActivityCopy(plan: Plan, activity: ExecutionActivity, previousFinished: boolean, simulated: boolean): string {
  const place = plan.presentation?.places.find(place=>place.id===activity.placeId);
  const name = place?.name ?? activity.title;
  const uncertain = activity.timeStatus==='recheck'||activity.timeStatus==='estimated';
  const time = activity.time ? `${uncertain?'around':'at'} ${activity.time}` : undefined;
  const timing = time ? activity.isTransfer ? `Let's get ready to leave ${time}.` : `We're planning to visit ${time}.` : "There's no rush to a fixed start time; go when you're ready.";
  const travel = activity.travelMinutes ? `The journey is about ${activity.travelMinutes} minutes. Give yourself another 10 minutes to get ready.` : '';
  const movingBase = activity.role === 'Base-change transfer';
  const preparation = movingBase ? 'We’re changing bases today, so bring all your bags. Before leaving your room, have a quick look for your charger, passport and anything in the safe.' : activity.preparation.join('\n');
  const help = activity.needsMovement ? plan.configuration.transport.preference==='driving' ? 'Your driving directions are below.' : plan.configuration.transport.preference==='taxi' ? simulated ? 'When you’re ready, I’ll help with the ride from your simulated pickup.' : 'When you’re ready, I’ll check where to pick you up and help with the ride.' : 'When you’re ready, I’ll help you work out how to get there.' : '';
  const introduction = activity.isTransfer ? `Today we're heading to ${name}.` : `Let's make some time for ${name}.`;
  return [introduction,timing,uncertain?'Please check the time on your ticket before setting off.':'',travel,preparation,help,!previousFinished?'If you’re still at the previous stop, take a moment and let me know before heading out.':''].filter(Boolean).join('\n\n');
}
