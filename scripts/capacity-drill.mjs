import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const directory=await mkdtemp(join(tmpdir(),'traffic-capacity-'));
let outbound=0, assets=0;
const options=()=>convertV4MiniflareOptions({telemetry:{enabled:false},resourcePersistencePath:directory,workers:[{
  name:'capacity-fixture',modules:true,scriptPath:'artifacts/worker/index.js',compatibilityDate:'2026-10-05',compatibilityFlags:['nodejs_compat'],
  durableObjects:{BUDGET:{className:'BudgetLedger',useSQLite:true}},bindings:{PRIVATE_ACCESS_REQUIRED:'true'},
  serviceBindings:{ASSETS:()=>{assets++;return new Response('must not be read');}},
  outboundService:()=>{outbound++;throw new Error('Capacity fixture must never contact providers.');},
}]});
const record={kind:'local-workerd-fixture',at:new Date().toISOString(),checks:[]};
let mf;
async function ledger() {const ns=await mf.getDurableObjectNamespace('BUDGET','capacity-fixture');return ns.get(ns.idFromName('capacity'));}
async function call(stub,path,body={}) {const r=await stub.fetch('https://ledger'+path,{method:'POST',body:JSON.stringify(body)});return {status:r.status,body:await r.json()};}
async function burst(name,count,action,accepted,denied,acceptedStatus=200,deniedStatus=429) {
  const started=performance.now();
  const results=await Promise.all(Array.from({length:count},action));
  assert.equal(results.filter(r=>r.status===acceptedStatus).length,accepted);
  assert.equal(results.filter(r=>r.status===deniedStatus).length,denied);
  record.checks.push({name,count,accepted,denied,wallMilliseconds:Math.round(performance.now()-started)});
}
try {
  mf=new Miniflare(options());
  const worker=await mf.getWorker('capacity-fixture');
  await burst('locked requests with missing verifier fail closed',100,()=>worker.fetch('https://localhost/api/routes'),0,100,200,503);
  assert.equal(assets,0);
  let stub=await ledger();
  await call(stub,'/update',{providers:{mapbox:{hard:20,free:20,rpm:100,soft:15}},paid:false,monthlyBudget:0,actor:'local-fixture'});
  await burst('atomic provider reservation cap',100,()=>call(stub,'/reserve',{provider:'mapbox'}),20,80);
  await burst('atomic same-account analysis allowance',50,()=>call(stub,'/analysis',{user:'synthetic-a',role:'user'}),10,40);
  assert.equal((await call(stub,'/reserve',{provider:'google'})).status,503);
  const before=(await call(stub,'/status')).body;
  assert.equal(before.config.paid,false);assert.equal(before.config.monthlyBudget,0);
  await mf.dispose();mf=new Miniflare(options());stub=await ledger();
  assert.equal((await call(stub,'/reserve',{provider:'mapbox'})).status,429);
  assert.deepEqual((await call(stub,'/allowance',{user:'synthetic-a',role:'user'})).body,{used:10,limit:10,remaining:0});
  const after=(await call(stub,'/status')).body;
  assert.deepEqual(after.config,before.config);assert.deepEqual(after.usage,before.usage);
  assert.equal(outbound,0);assert.equal(assets,0);
  record.restartPreserved={providerUsage:true,accountUsage:true,zeroBudgetConfig:true};
  record.outboundRequests=outbound;record.status='pass';
  await mkdir('artifacts/operations',{recursive:true});
  await writeFile('artifacts/operations/capacity.json',JSON.stringify(record,null,2)+'\n');
  console.log(JSON.stringify(record,null,2));
} finally {await mf?.dispose();await rm(directory,{recursive:true,force:true});}
