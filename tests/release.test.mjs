import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertCompatible, assertProtected, guardedRelease } from '../scripts/release/guards.mjs';

function version(id='old') {
  return {id,resources:{
    bindings:[
      ...Object.entries({PRIVATE_ACCESS_REQUIRED:'true',APP_MODE:'live',GOOGLE_ENABLED:'false',GOOGLE_AUTH_ENABLED:'true',ADMIN_USER_IDS:'b63e6c45-eb60-47a1-8c1a-ab5d43c91d37',SUPABASE_URL:'https://bdxwyehnqwylvgoxyhhx.supabase.co'}).map(([name,text]) => ({name,text,type:'plain_text'})),
      ...['PRIVATE_ACCESS_CREDENTIALS','PRIVATE_GUEST_ACCESS_CREDENTIALS','VAPID_PRIVATE_KEY','MAPBOX_SERVER_TOKEN','GUEST_SESSION_SECRET','SUPABASE_SERVICE_ROLE_KEY'].map(name => ({name,type:'secret_text'})),
      {name:'BUDGET',type:'durable_object_namespace',class_name:'BudgetLedger',namespace_id:'2332bf33ad63463ba531f7b510695668'},
      {name:'ASSETS',type:'assets'},
    ],
    script:{handlers:['fetch','scheduled'],named_handlers:[{name:'BudgetLedger',handlers:['class']}]},
    script_runtime:{migration_tag:'v1',compatibility_date:'2026-10-05',compatibility_flags:['nodejs_compat'],usage_model:'standard',assets:{raw_run_worker_first:true,serve_directly:false,raw_headers:"Content-Security-Policy: frame-ancestors 'none'"}},
  }};
}
function harness(change=()=>{}) {
  const before=version(), staged=version('new');
  let active=before, snapshots=0, activations=0, mainChecks=0;
  const settings={bindings:before.resources.bindings,observability:{enabled:true,redact_query_string:true}};
  const io={
    async assertMain(){mainChecks++;},
    async snapshot(){snapshots++;return {version:structuredClone(active),settings:structuredClone(settings),deployments:{deployments:[{versions:[{version_id:active.id,percentage:100}]}]}};},
    async stage(){change(staged);return staged;},
    async activate(id){activations++;assert.equal(id,staged.id);active=staged;return {id:'deployment'};},
    async smoke(){return [{path:'/',status:401}];},
  };
  return {io,before,settings,get activations(){return activations;},get mainChecks(){return mainChecks;},get snapshots(){return snapshots;}};
}
test('staged release checks source twice, preserves settings and confirms 100% activation',async()=>{
  const h=harness(staged=>staged.resources.bindings.reverse());
  const result=await guardedRelease(h.io);
  assert.equal(result.previousVersion,'old');assert.equal(result.version,'new');assert.equal(h.activations,1);assert.equal(h.mainChecks,2);assert.equal(h.snapshots,3);
});
for(const [label,mutate] of [
  ['public access',v=>v.resources.bindings.find(b=>b.name==='PRIVATE_ACCESS_REQUIRED').text='false'],
  ['paid Google routing',v=>v.resources.bindings.find(b=>b.name==='GOOGLE_ENABLED').text='true'],
  ['changed owner',v=>v.resources.bindings.find(b=>b.name==='ADMIN_USER_IDS').text='another-user'],
  ['changed ledger storage',v=>v.resources.bindings.find(b=>b.name==='BUDGET').namespace_id='new-storage'],
  ['missing secret',v=>v.resources.bindings=v.resources.bindings.filter(b=>b.name!=='PRIVATE_ACCESS_CREDENTIALS')],
  ['asset bypass',v=>v.resources.script_runtime.assets.raw_run_worker_first=false],
  ['changed headers',v=>v.resources.script_runtime.assets.raw_headers+="; connect-src *"],
  ['changed runtime',v=>v.resources.script_runtime.compatibility_date='2027-01-01'],
  ['new migration',v=>v.resources.script_runtime.migration_tag='v2'],
  ['lost scheduled handler',v=>v.resources.script.handlers=['fetch']],
]) test(`refuses ${label} before activation`,async()=>{
  const h=harness(mutate);await assert.rejects(guardedRelease(h.io));assert.equal(h.activations,0);
});
test('main advancing while staging prevents activation',async()=>{
  const h=harness();let calls=0;h.io.assertMain=async()=>{if(++calls===2)throw new Error('Main advanced');};
  await assert.rejects(guardedRelease(h.io),/Main advanced/);assert.equal(h.activations,0);
});
test('a concurrent deployment prevents activation',async()=>{
  const h=harness(), original=h.io.snapshot;let calls=0;
  h.io.snapshot=async()=>{const r=await original();if(++calls===2)r.deployments.deployments[0].versions[0].version_id='other';return r;};
  await assert.rejects(guardedRelease(h.io),/changed while staging/);assert.equal(h.activations,0);
});
test('settings drift while staging prevents activation',async()=>{
  const h=harness();h.io.stage=async()=>{h.settings.observability.enabled=false;return version('new');};
  await assert.rejects(guardedRelease(h.io),/settings changed/);assert.equal(h.activations,0);
});
test('split traffic cannot be treated as a single rollback candidate',async()=>{
  const h=harness(), original=h.io.snapshot;
  h.io.snapshot=async()=>{const r=await original();r.deployments.deployments[0].versions=[{version_id:'old',percentage:50},{version_id:'other',percentage:50}];return r;};
  await assert.rejects(guardedRelease(h.io),/one active version/);assert.equal(h.activations,0);
});
test('failed smoke is reported after activation without automatic rollback',async()=>{
  const h=harness();h.io.smoke=async()=>{throw new Error('Smoke failed');};
  await assert.rejects(guardedRelease(h.io),/Smoke failed/);assert.equal(h.activations,1);
});
test('incompatible database binding and lost owner Google auth fail preflight',()=>{
  const v=version();v.resources.bindings.find(b=>b.name==='SUPABASE_URL').text='https://wrong.test';assert.throws(()=>assertProtected(v));
  const s=version();s.resources.bindings.find(b=>b.name==='GOOGLE_AUTH_ENABLED').text='false';assert.throws(()=>assertCompatible(version(),s));
});
