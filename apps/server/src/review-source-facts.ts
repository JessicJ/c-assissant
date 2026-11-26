import type { TravelAdjustmentObservation } from '@c-assistant/core';

export interface ReviewSourceFact { label:string; value?:string; date?:string; localDateTime?:string }

/** 展示已归一化候选事实；不解释来源是否构成重大影响。 */
export function reviewSourceFacts(observation:TravelAdjustmentObservation):ReviewSourceFact[] {
  const candidate=observation.candidate;
  if(!candidate || candidate.kind!==observation.sourceKind)return [];
  const facts:ReviewSourceFact[]=[];
  const add=(label:string,value:string|number|undefined,unit='')=>{if(value!==undefined)facts.push({label,value:`${value}${unit}`});};
  const number=(label:string,value:number|undefined,unit:string)=>{if(value!==undefined&&Number.isFinite(value))add(label,value,unit);};
  switch(candidate.kind){
    case 'venue': {
      add('Venue searched',candidate.name);add('City searched',candidate.city);
      const status={operational:'Open',temporarily_closed:'Temporarily closed',permanently_closed:'Permanently closed',unknown:'Status unknown'};
      candidate.matches.forEach(match=>add('Venue record',`${match.name} · ${match.city} · ${status[match.status]??'Status unknown'}`));
      if(!candidate.matches.length)add('Venue record','No matching venue was found. Opening status is unknown.');
      break;
    }
    case 'weather_current':
      add('Source type','Current weather. This does not establish weather on the travel date.');add('Location',candidate.locationName);add('Conditions',candidate.condition);
      number('Temperature',candidate.temperatureC,' °C');number('Feels like',candidate.feelsLikeC,' °C');number('Humidity',candidate.humidityPercent,' %');number('Precipitation',candidate.precipitationMm,' mm');add('Wind direction',candidate.windDirection);add('Wind scale',candidate.windScale);break;
    case 'weather_forecast':
      add('Source type','Forecast for the travel date. Actual conditions may change.');add('Location',candidate.locationName);facts.push({label:'Forecast date',date:candidate.date});add('Daytime conditions',candidate.conditionDay);add('Nighttime conditions',candidate.conditionNight);
      number('High temperature',candidate.highC,' °C');number('Low temperature',candidate.lowC,' °C');number('Forecast precipitation',candidate.precipitationMm,' mm');number('UV index',candidate.uvIndex,'');break;
    case 'saved_booking': {
      const status:Record<string,string>={confirmed:'Confirmed',cancelled:'Cancelled',canceled:'Cancelled',pending:'Pending',unknown:'Unknown',needs_review:'Needs review',draft:'Draft',completed:'Completed'};
      const strength={hard:'Required constraint',soft:'Flexible constraint',ignored:'Ignored constraint'};
      add('Source type','Saved booking. This is not a live update from the provider.');add('Booking status',status[candidate.status]??'Unknown');add('Segment status',status[candidate.segmentStatus]??'Unknown');add('Booking constraint',strength[candidate.bookingConstraintStrength]);add('Segment constraint',strength[candidate.segmentConstraintStrength]);add('Fixed commitment',candidate.fixedCommitment?'Yes':'No');
      for(const [label,value] of [['Segment start',candidate.startAtLocal],['Segment end',candidate.endAtLocal]] as const){
        // 仅接受已保存的日历时刻；时区标识和内部引用不进入产品投影。
        if(value && /^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?$/.test(value)&&Number.isFinite(Date.parse(value)))facts.push({label:`${label} (booking local time)`,localDateTime:value});
        else add(label,'Time unknown');
      }
      break;
    }
  }
  return facts;
}
