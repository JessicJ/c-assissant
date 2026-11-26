import { createGrabRideHandoff, createUberRideHandoff } from "@c-assistant/connectors";
import type { PlanPlace } from "@c-assistant/core";
import type { ConnectorBundle } from "./connector-bundle.js";
import { resolveServiceCapabilities, type DestinationExecutionContext } from "./execution-service-catalog.js";
import type { EmailRideAction } from "./email-templates/types.js";

/** Coverage is for a planned origin; Uber/Grab owns actual pickup and the final request. */
export function createEmailRideBuilder(input: {maps:ConnectorBundle["maps"];clientId?:string | undefined;now?:Date;signal?:AbortSignal}) {
  const areas=new Map<string,Promise<DestinationExecutionContext|undefined>>();
  return async (origin:PlanPlace|undefined,destination:{name:string;address?:string;city?:string}):Promise<EmailRideAction|undefined>=>{
    if (!input.clientId?.trim() || !origin?.coordinates || !destination.name.trim() || input.signal?.aborted || typeof input.maps.reverseGeocode!=="function") return;
    const [latitude,longitude]=origin.coordinates;
    if (!Number.isFinite(latitude)||!Number.isFinite(longitude)||Math.abs(latitude)>90||Math.abs(longitude)>180) return;
    const key=`${longitude},${latitude}`;
    if (!areas.has(key)) areas.set(key,(async()=>{
      let timer:ReturnType<typeof setTimeout>|undefined;
      try {
        const result=await Promise.race([input.maps.reverseGeocode({location:key}),new Promise<undefined>(resolve=>{timer=setTimeout(()=>resolve(undefined),5000);timer.unref();})]);
        if (input.signal?.aborted || !result || result.status!=="available" || !result.data?.country || !result.data.city) return;
        return {country:result.data.country,city:result.data.city,area:result.data.district};
      } catch { return; } finally {if(timer)clearTimeout(timer);}
    })());
    const area=await areas.get(key);if(!area || input.signal?.aborted)return;
    const service=resolveServiceCapabilities({destination:area,option:"ride_hail_car",now:input.now??new Date()}).find(s=>s.coverageStatus==="supported"&&(s.serviceName==="Uber"||s.serviceName==="Grab"));
    if (!service?.evidenceUrl) return;
    const source=new URL(service.evidenceUrl),official=service.serviceName==="Uber"?"uber.com":"grab.com";
    if(source.protocol!=="https:" || !(source.hostname===official||source.hostname.endsWith('.'+official)))return;
    if(service.serviceName==="Uber")return {provider:"uber",destination:destination.name,link:{label:"Open Uber",url:createUberRideHandoff({destination:{name:destination.name,address:destination.address||[destination.name,destination.city].filter(Boolean).join(", ")},clientId:input.clientId}).url},note:"Confirm your actual pickup, destination and fare in Uber."};
    return {provider:"grab",destination:destination.name,link:{label:"Open Grab",url:createGrabRideHandoff().url},note:`Enter ${destination.name} in Grab and confirm your pickup and fare.`};
  };
}
