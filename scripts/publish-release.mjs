import { mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import { target, activeId, guardedRelease } from './release/guards.mjs';

const run = promisify(execFile);
const sha = process.env.GITHUB_SHA;
const record = {startedAt:new Date().toISOString(), source:sha, status:'not-activated'};
await mkdir('artifacts/release', {recursive:true});
const output = 'artifacts/release/wrangler-output.jsonl';
async function api(host, path, token, body) {
  const response = await fetch(host + path, {
    method:body ? 'POST' : 'GET', redirect:'error', signal:AbortSignal.timeout(30000),
    headers:{Authorization:`Bearer ${token}`, Accept:'application/json', ...(body ? {'Content-Type':'application/json'} : {})},
    ...(body ? {body:JSON.stringify(body)} : {}),
  });
  assert.ok(response.ok, `Release API request failed (${response.status}); inspect permissions without sharing credentials.`);
  const data = await response.json();
  assert.notEqual(data.success, false, 'Release API declined the request.');
  return data.result ?? data;
}
const root = `/accounts/${target.account}/workers/scripts/${target.worker}`;
const cf = (path, body) => api('https://api.cloudflare.com/client/v4', root + path, process.env.CLOUDFLARE_API_TOKEN, body);
async function assertMain() {
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Publish from the protected GitHub workflow.');
  assert.equal(process.env.GITHUB_WORKFLOW, 'Publish Cloudflare');
  assert.equal(process.env.GITHUB_REF, 'refs/heads/main');
  assert.equal(process.env.GITHUB_REPOSITORY, target.repository);
  assert.equal(process.env.CLOUDFLARE_ACCOUNT_ID, target.account);
  assert.match(sha ?? '', /^[a-f0-9]{40}$/);
  for (const name of ['CLOUDFLARE_API_TOKEN','GH_TOKEN']) assert.ok(process.env[name], `Missing ${name}; configure the production environment.`);
  assert.equal((await run('git',['rev-parse','HEAD'])).stdout.trim(), sha, 'Checkout differs from workflow source.');
  const main = await api('https://api.github.com', `/repos/${target.repository}/git/ref/heads/main`, process.env.GH_TOKEN);
  assert.equal(main.object.sha, sha, 'Main advanced; rerun verification for the current main.');
}
async function snapshot() {
  const [settings,deployments] = await Promise.all([cf('/settings'),cf('/deployments')]);
  const versionId = activeId(deployments);
  record.previousVersion ??= versionId;
  return {settings,deployments,version:await cf('/versions/' + versionId)};
}
try {
  await assertMain();
  const approved = JSON.parse(await readFile('docs/approved-migrations.json','utf8'));
  const actual = {};
  for (const name of (await readdir('supabase/migrations')).filter(n => n.endsWith('.sql')).sort()) {
    actual[name] = createHash('sha256').update(await readFile('supabase/migrations/' + name)).digest('hex');
  }
  assert.deepEqual(actual, approved, 'Database source changed; apply/verify its migration and review the approved manifest before deployment.');
  record.workerBuildSha256 = createHash('sha256').update(await readFile('artifacts/worker/index.js')).digest('hex');
  Object.assign(record, await guardedRelease({
    assertMain, snapshot,
    async stage() {
      await rm(output,{force:true});
      // Upload only. No immediate deployment, trigger mutation or new DO migration.
      await run('npx',['--no-install','wrangler','versions','upload','--keep-vars','--strict','--tag',sha.slice(0,12),'--message',`Verified main ${sha}`], {
        env:{...process.env,WRANGLER_OUTPUT_FILE_PATH:output,WRANGLER_SEND_METRICS:'false'}, maxBuffer:4*1024*1024,
      });
      const rows = (await readFile(output,'utf8')).trim().split('\n').map(line => JSON.parse(line));
      const upload = rows.findLast(r => r.type === 'version-upload' && r.worker_name === target.worker);
      assert.match(upload?.version_id ?? '', /^[a-f0-9-]{36}$/);
      record.stagedVersion = upload.version_id;
      return cf('/versions/' + upload.version_id);
    },
    async activate(id) {
      record.status = 'activation-outcome-unknown';
      record.activationAttempted = true;
      const deployment = await cf('/deployments', {strategy:'percentage',versions:[{version_id:id,percentage:100}],annotations:{'workers/message':`Verified main ${sha}; private settings and bindings matched before activation.`}});
      record.status = 'activated-verification-pending';
      record.deployment = deployment.id;
      return deployment;
    },
    async smoke() {
      const checks = [];
      const html = await readFile('dist/index.html','utf8');
      const mainAsset = html.match(/<script[^>]+src="(\/assets\/[^"?]+\.js)"/)?.[1];
      assert.ok(mainAsset, 'Built main asset not found.');
      for (const path of ['/','/plan?reminder=00000000-0000-0000-0000-000000000000',mainAsset,'/api/config','/api/routes','/api/reminders','/api/push/status']) {
        const response = await fetch(target.url + path, {redirect:'manual',signal:AbortSignal.timeout(15000)});
        assert.equal(response.status,401,`Locked request failed at ${path}`);
        assert.match(response.headers.get('Cache-Control') ?? '', /no-store/);
        assert.ok(response.headers.get('Content-Security-Policy'));
        await response.body?.cancel(); checks.push({path,status:response.status});
      }
      const response = await fetch(target.url + '/sw.js', {redirect:'manual',signal:AbortSignal.timeout(15000)});
      assert.equal(response.status,200);
      assert.match(response.headers.get('Cache-Control') ?? '', /no-store/);
      assert.equal(await response.text(),await readFile('public/sw.js','utf8'), 'Cleanup service worker differs from tested source.');
      checks.push({path:'/sw.js',status:200});
      return checks;
    },
  }));
  record.status = 'verified';
  console.log('Private release activated and configuration/smoke checks passed.');
} catch (error) {
  // No raw subprocess/API errors: they can contain credentials or headers.
  record.failure = error instanceof assert.AssertionError ? error.message.split('\n')[0] : 'Release operation failed; inspect the failing stage privately.';
  console.error(record.failure);
  console.error('No automatic rollback. Inspect activation state and follow docs/OPERATIONS.md.');
  process.exitCode = 1;
} finally {
  record.finishedAt = new Date().toISOString();
  await writeFile('artifacts/release/record.json',JSON.stringify(record,null,2)+'\n');
  await rm(output,{force:true});
}
