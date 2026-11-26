import type { PlanPlace } from '@c-assistant/core';
import type { ExecutionActivity } from './execution-itinerary.js';

const concise = (value: string | undefined, limit = 420): string => {
  const text = (value ?? '').replace(/\s+/g, ' ').trim();
  if (text.length <= limit) return text;
  const sentences = text.match(/[^.!?。！？]+[.!?。！？]/g);
  const first = sentences?.[0]?.trim();
  return first && first.length <= limit ? first : `${text.slice(0, limit - 1).trim()}…`;
};

/** Use the saved guide, without inventing highlights, ticket rules or opening hours. */
export function sightseeingAssistantCopy(place: PlanPlace, visit: ExecutionActivity): string {
  const parts: string[] = [];
  const introduction = concise(place.whyWorthIt);
  if (introduction && !/^(visit|pending|needs? verification|待核实)$/i.test(introduction)) parts.push(introduction);
  const evening = Boolean(visit.time && Number(visit.time.split(':')[0]) >= 18);
  const highlights = place.detailSections
    .filter(section => /highlight|what to see|what to do|don't miss|must.see|tour format|看点|亮点|必看|游览重点/i.test(section.title)
      || (evening ? /^(nightlights|evening|夜游)$/i.test(section.title) : /^(daytime|日间)$/i.test(section.title)))
    .flatMap(section => /tour format|daytime|nightlights|evening|日间|夜游/i.test(section.title)
      ? section.body ? [section.body] : []
      : section.items?.length ? section.items : section.body ? [section.body] : [])
    .map(item => concise(item, 160)).filter(Boolean);
  const unique = [...new Set(highlights)].filter(item => item !== introduction).slice(0, 3);
  if (unique.length) parts.push(`While you're there, look out for:\n${unique.map(item => `• ${item}`).join('\n')}`);
  const tip = concise(place.tip, 240);
  // Advice about choosing between products is not an instruction for this confirmed visit.
  if (tip && tip !== introduction && !unique.includes(tip) && !/schedule both|after deciding|product chosen|coherent.*addition|规划|编排/i.test(tip)) parts.push(tip);
  if (place.reservation?.requirement === 'required' || place.reservation?.requirement === 'recommended') {
    parts.push(place.reservation.verification === 'verified'
      ? place.reservation.requirement === 'required' ? 'Remember to have your reservation and entry time handy.' : 'It’s worth checking your reservation before setting off.'
      : 'Before setting off, check the venue’s latest booking requirements and your entry time.');
  }
  const link = place.officialUrl;
  if (link && /^https?:\/\//i.test(link)) parts.push(`More about the visit: ${link}`);
  return parts.join('\n\n');
}
