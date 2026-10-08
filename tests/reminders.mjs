import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFileSync,writeFileSync} from 'node:fs';
import {generateKeyPairSync,randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
const key=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),pub=key.publicKey.export({format:'jwk'}),priv=key.privateKey.export({format:'jwk'});
const raw=Buffer.concat([Buffer.from([4]),Buffer.from(pub.x,'base64url'),Buffer.from(pub.y,'base64url')]).toString('base64url');
writeFileSync('artifacts/worker/reminder-entry.js',readFileSync('artifacts/worker/index.js','utf8')+`\nimport {WorkerEntrypoint} from 'cloudflare:workers';\nexport class SchedulerTest extends WorkerEntrypoint {async fetch(){await scheduledReminders(this.env);return new Response('ok');}}`);
const now=Date.now(),plan={origin:{displayName:'Origin'},destination:{displayName:'Destination'},timezone:'Asia/Amman'},candidate={departureAt:new Date(now+3600000).toISOString(),arrivalAt:new Date(now+4800000).toISOString(),durationSeconds:1200};
const device=id=>({id,subscription:{endpoint:`https://fcm.googleapis.com/${id}`,keys:{p256dh:raw,auth:randomBytes(16).toString('base64url')}}});
const devices=[device('device-a'),device('device-b')],deliveries=devices.map((d,i)=>({id:`delivery-${i}`,user_id:'owner',subscription_id:d.id,status:'pending',attempts:0,lease_until:new Date(0).toISOString(),next_attempt_at:new Date(now-10000).toISOString(),expires_at:candidate.departureAt,plan,candidate,locale:i?'ar':'en',push_devices:d}));
let failFirst=true;const sends=[];
const mf=new Miniflare(convertV4MiniflareOptions({telemetry:{enabled:false},workers:[{name:'reminders',modules:true,scriptPath:'artifacts/worker/reminder-entry.js',compatibilityDate:'2026-10-05',compatibilityFlags:['nodejs_compat'],durableObjects:{BUDGET:{className:'BudgetLedger',useSQLite:true}},bindings:{APP_MODE:'live',SUPABASE_URL:'https://db.test',SUPABASE_PUBLISHABLE_KEY:'public-test',SUPABASE_SECRET_KEY:'secret-test',VAPID_PUBLIC_KEY:raw,VAPID_PRIVATE_KEY:priv.d,VAPID_SUBJECT:'mailto:test@example.test'},serviceBindings:{ASSETS:()=>new Response('test'),SCHEDULER:{name:'reminders',entrypoint:'SchedulerTest'}},outboundService:async request=>{
 const u=new URL(request.url);
 if(u.hostname==='fcm.googleapis.com'){sends.push(u.pathname);assert.equal(request.headers.get('TTL')!==null,true);if(failFirst&&u.pathname==='/device-a'){failFirst=false;return new Response('temporary',{status:503});}if(u.pathname==='/device-b')return new Response('gone',{status:410});return new Response('accepted',{status:201});}
 assert.equal(u.hostname,'db.test');assert.equal(request.headers.get('apikey'),'secret-test');
 const table=u.pathname.split('/').at(-1),method=request.method;
 if(table==='notification_jobs')return Response.json([]);
 const fits=row=>[...u.searchParams].every(([key,value])=>{
  if(['select','order','limit'].includes(key))return true;
  const split=value.indexOf('.'),op=value.slice(0,split),expected=value.slice(split+1),actual=row[key];
  if(op==='eq')return String(actual)===expected;if(op==='neq')return String(actual)!==expected;
  const numeric=typeof actual==='number',left=numeric?actual:Date.parse(actual),right=numeric?Number(expected):Date.parse(expected);
  if(op==='lt')return left<right;if(op==='lte')return left<=right;if(op==='gt')return left>right;if(op==='gte')return left>=right;return true;
 });
 if(table==='push_devices'&&method==='DELETE'){const id=u.searchParams.get('id').slice(3);const index=devices.findIndex(d=>d.id===id);devices.splice(index,1);for(let i=deliveries.length-1;i>=0;i--)if(deliveries[i].subscription_id===id)deliveries.splice(i,1);return Response.json([]);}
 if(table==='reminder_deliveries'){
  const matched=deliveries.filter(fits);if(method==='PATCH'){const body=await request.json();matched.forEach(row=>Object.assign(row,body));}
  return Response.json(matched.map(r=>({...r})));
 }
 throw new Error('Unexpected DB table '+table);
 }}]}));
try {const bindings=await mf.getBindings('reminders');const run=()=>bindings.SCHEDULER.fetch('https://test/run');
 await run();assert.equal(deliveries.length,1);assert.equal(devices[0].id,'device-a');assert.equal(deliveries[0].status,'pending');assert.equal(deliveries[0].attempts,1);assert.ok(Date.parse(deliveries[0].next_attempt_at)>now);
 deliveries[0].next_attempt_at=new Date(0).toISOString();await Promise.all([run(),run()]);assert.equal(deliveries[0].status,'sent');assert.equal(deliveries[0].attempts,2);assert.equal(sends.filter(s=>s==='/device-a').length,2);
 await run();assert.equal(sends.filter(s=>s==='/device-a').length,2);
 deliveries[0].status='pending';deliveries[0].expires_at=new Date(0).toISOString();await run();assert.equal(deliveries[0].status,'expired');assert.equal(sends.length,3);
 deliveries[0].status='pending';deliveries[0].expires_at=candidate.departureAt;deliveries[0].attempts=3;deliveries[0].lease_until=new Date(0).toISOString();await run();assert.equal(deliveries[0].status,'failed');assert.equal(sends.length,3);
 console.log('PASS: encrypted push delivery, transient retry, atomic overlapping claims, success deduplication, expired suppression, crashed-final-attempt recovery, and 410 removal of only one device.');
}finally{await mf.dispose();}
