import type {Candidate, Plan} from './types';
import {feasible} from './optimizer';
import {recommendationAllowed} from './forecast-reliability';
export function reminderTiming(candidate: Pick<Candidate,'departureAt'>, leadMinutes:number, now=Date.now()) {
  const departure=Date.parse(candidate.departureAt);
  if(!Number.isFinite(departure)||departure<=now||departure>now+7*86400000||!Number.isInteger(leadMinutes)||leadMinutes<15||leadMinutes>120)throw new Error('Choose a future departure within seven days and a lead of 15–120 minutes.');
  return {dueAt:new Date(Math.max(now,departure-leadMinutes*60000)).toISOString(),expiresAt:new Date(departure).toISOString()};
}
export function reminderEligible(plan:Plan,candidate:Candidate) {
  return !plan.demo && candidate.provider!=='demo' && recommendationAllowed(plan) && feasible(candidate,plan);
}
export function retryAt(attempts:number,now:number,expires:string) {
  const next=now+Math.min(30,5*2**(attempts-1))*60000;
  return attempts>=3||next>=Date.parse(expires)?null:new Date(next).toISOString();
}
export function pushEndpointAllowed(endpoint:string) {
  try {const u=new URL(endpoint);return u.protocol==='https:'&&!u.username&&!u.password&&(!u.port||u.port==='443')&&['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com'].some(h=>u.hostname===h||u.hostname.endsWith('.'+h));}catch{return false;}
}
