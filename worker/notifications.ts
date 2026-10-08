import {buildPushPayload} from '@block65/webcrypto-web-push';
import {db} from './database';
import {budget,serverKey,type Env} from './env';
import {createForecast} from './providers';
import {optimize} from '../shared/optimizer';
import {addDays,clock,localDate,localInstant} from '../shared/time';
import type {Candidate,Plan,SavedRoute} from '../shared/types';
import {recurringPlan,selectedWindow} from '../shared/windows';
import {planSchema} from '../shared/schema';
import {reminderEligible,reminderTiming,retryAt,pushEndpointAllowed} from '../shared/reminders';
export type Device={id:string;subscription:{endpoint:string;keys:{auth:string;p256dh:string}}};
export async function queueOccurrence(env:Env,user:string,devices:Device[],plan:Plan,candidate:Candidate,locale:'en'|'ar',lead:number,key:string,routeId?:string,replacePending=false) {
 const timing=reminderTiming(candidate,lead);
 const compact={departureAt:candidate.departureAt,arrivalAt:candidate.arrivalAt,durationSeconds:candidate.durationSeconds,distanceMeters:candidate.distanceMeters,provider:candidate.provider,trafficCoverage:candidate.trafficCoverage};
 // Ignore an existing occurrence instead of resetting a successful delivery.
 // Bulk writes bound database requests regardless of the number of devices.
 if(replacePending)await db(env,`reminder_deliveries?user_id=eq.${user}&occurrence_key=eq.${encodeURIComponent(key)}&status=eq.pending&lease_until=lt.${new Date().toISOString()}`,{method:'PATCH',service:true,body:{plan,candidate:compact,locale,due_at:timing.dueAt,expires_at:timing.expiresAt,next_attempt_at:timing.dueAt}});
 await db(env,'reminder_deliveries?on_conflict=subscription_id,occurrence_key',{method:'POST',service:true,ignoreDuplicates:true,body:devices.map(device=>({user_id:user,subscription_id:device.id,route_id:routeId??null,occurrence_key:key,plan,candidate:compact,locale,due_at:timing.dueAt,expires_at:timing.expiresAt,next_attempt_at:timing.dueAt}))});

}
export async function scheduledReminders(env:Env) {
 if(env.APP_MODE!=='live'||!serverKey(env)||!env.VAPID_PRIVATE_KEY||!env.VAPID_PUBLIC_KEY||!env.VAPID_SUBJECT)return;
 const now=Date.now(),iso=new Date(now).toISOString();
 // Terminal records are removed after 30 days. Ownership cascade handles account deletion.
 await db(env,`reminder_deliveries?status=neq.pending&created_at=lt.${new Date(now-30*86400000).toISOString()}`,{method:'DELETE',service:true});
 await db(env,`reminder_deliveries?status=eq.pending&expires_at=lte.${iso}`,{method:'PATCH',service:true,body:{status:'expired'}});
 // A crashed final attempt must not leave an unclaimable row blocking the queue.
 await db(env,`reminder_deliveries?status=eq.pending&attempts=gte.3&lease_until=lt.${iso}`,{method:'PATCH',service:true,body:{status:'failed'}});
 const jobs=await db(env,`notification_jobs?next_attempt_at=lte.${iso}&select=id,user_id,route_id,saved_routes(*)&order=next_attempt_at&limit=1`,{service:true}) as any[];
 for(const job of jobs) {
  let next=now+3600000;
  const claim=await db(env,`notification_jobs?id=eq.${job.id}&next_attempt_at=lte.${iso}`,{method:'PATCH',service:true,body:{next_attempt_at:new Date(next).toISOString()}}) as any[];
  if(!claim.length)continue;
  try {
   const route=job.saved_routes as SavedRoute;
   if(!route?.reminders)continue;
   const date=localDate(now,route.plan.timezone),weekday=new Date(date+'T12:00Z').getUTCDay();
   next=localInstant(addDays(date,1),'00:05',route.plan.timezone);
   if(!route.days.includes(weekday)||route.plan.origin.source==='gps')continue;
   const p=planSchema.parse({...recurringPlan(route.plan,date),demo:false});
   const [start,end]=selectedWindow(p);
   if(now>=end)continue;
   // No unattended forecasting all day. Arrival estimates can require departures
   // before the arrival window; check at most six hours before its start.
   if(now<start-6*3600000){next=start-6*3600000;continue;}
   const devices=await db(env,`push_devices?user_id=eq.${job.user_id}&select=id,subscription&limit=10`,{service:true}) as Device[];
   if(!devices.length)continue;
   const forecast=await createForecast(env,p,false),analysis=await optimize(p,forecast,{maxCalls:6});
   const best=analysis.best;
   if(!best||!reminderEligible(p,best)||Date.parse(best.departureAt)<=now)continue;
   const preferences=await db(env,`user_preferences?user_id=eq.${job.user_id}&select=locale&limit=1`,{service:true}) as any[];
   await queueOccurrence(env,job.user_id,devices,p,best,preferences[0]?.locale==='ar'?'ar':'en',20,`recurring:${job.route_id}:${date}`,job.route_id);
  } catch {next=now+3600000;await budget(env,'/error',{code:'reminder_planning_failed',requestId:crypto.randomUUID()}).catch(()=>{});}
  finally {await db(env,`notification_jobs?id=eq.${job.id}`,{method:'PATCH',body:{next_attempt_at:new Date(next).toISOString()},service:true}).catch(()=>{});}
 }
 const deliveries=await db(env,`reminder_deliveries?status=eq.pending&attempts=lt.3&next_attempt_at=lte.${iso}&lease_until=lt.${iso}&expires_at=gt.${iso}&select=*,push_devices(id,subscription)&order=next_attempt_at&limit=4`,{service:true}) as any[];
 for(const delivery of deliveries) {
  const lease=crypto.randomUUID(),attempts=delivery.attempts+1;
  const claimed=await db(env,`reminder_deliveries?id=eq.${delivery.id}&status=eq.pending&lease_until=lt.${iso}`,{method:'PATCH',service:true,body:{lease_token:lease,lease_until:new Date(now+5*60000).toISOString(),attempts}}) as any[];
  if(!claimed.length)continue;
  let state:any={status:'sent'};
  try {
   const device=delivery.push_devices as Device;
   if(!device?.subscription)throw new Error('Device removed');
   if(!pushEndpointAllowed(device.subscription.endpoint)){state={status:'failed'};continue;}
   const p=delivery.plan as Plan,best=delivery.candidate as Candidate,arabic=delivery.locale==='ar';
   const payload=await buildPushPayload({data:{title:arabic?'تذكير الرحلة':'Journey reminder',body:arabic?`المغادرة المختارة ${clock(best.departureAt,p.timezone,'ar')} · الوصول ${clock(best.arrivalAt,p.timezone,'ar')} · ${Math.round(best.durationSeconds/60)} دقيقة. افتح الرحلة وراجع التقدير.`:`Selected departure ${clock(best.departureAt,p.timezone)} · arrival ${clock(best.arrivalAt,p.timezone)} · ${Math.round(best.durationSeconds/60)} min. Open your journey to review the estimate.`,url:`/plan?reminder=${delivery.id}`,tag:`journey-${delivery.id}`,expiresAt:delivery.expires_at},options:{ttl:Math.max(1,Math.min(600,Math.floor((Date.parse(delivery.expires_at)-Date.now())/1000))) }},{...device.subscription,expirationTime:null},{subject:env.VAPID_SUBJECT,publicKey:env.VAPID_PUBLIC_KEY,privateKey:env.VAPID_PRIVATE_KEY});
   if(Date.now()>=Date.parse(delivery.expires_at)){state={status:'expired'};continue;}
   const result=await fetch(device.subscription.endpoint,{...payload,signal:AbortSignal.timeout(10000),redirect:'manual'});
   if(result.status===404||result.status===410){await db(env,`push_devices?id=eq.${device.id}&user_id=eq.${delivery.user_id}`,{method:'DELETE',service:true});continue;}
   if(!result.ok){if(result.status>=400&&result.status<500&&result.status!==429){state={status:'failed'};}else throw new Error('Transient push failure');}
  } catch {const next=retryAt(attempts,Date.now(),delivery.expires_at);state=next?{next_attempt_at:next,status:'pending'}:{status:'failed'};await budget(env,'/error',{code:'reminder_delivery_failed',requestId:crypto.randomUUID()}).catch(()=>{});}
  finally {await db(env,`reminder_deliveries?id=eq.${delivery.id}&lease_token=eq.${lease}&status=eq.pending`,{method:'PATCH',service:true,body:{...state,lease_until:new Date(0).toISOString()}}).catch(()=>{});}
 }
}
