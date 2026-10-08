import assert from 'node:assert/strict';

export const target = Object.freeze({
  account: '8021bdc634228f81e497bdcd8fcbd153',
  worker: 'traffic-optimizer',
  repository: 'mohammadwajdi01-sys/traffic-optimizer',
  url: 'https://traffic-optimizer.mohammadwajdi01.workers.dev',
});
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
export function bindings(version) {
  return [...version.resources.bindings].sort((a,b) => a.name.localeCompare(b.name)).map(canonical);
}
export function activeId(deployments) {
  const active = deployments.deployments[0];
  assert.ok(active && active.versions.length === 1 && active.versions[0].percentage === 100, 'Release requires one active version at 100%; inspect a split deployment separately.');
  return active.versions[0].version_id;
}
export function assertProtected(version) {
  const entries = version.resources.bindings;
  const text = name => entries.find(b => b.name === name)?.text;
  assert.equal(text('PRIVATE_ACCESS_REQUIRED'), 'true', 'Private access must stay required.');
  assert.equal(text('APP_MODE'), 'live', 'Production must remain live.');
  assert.equal(text('GOOGLE_ENABLED'), 'false', 'Google routing must remain disabled.');
  assert.equal(text('GOOGLE_AUTH_ENABLED'), 'true', 'Existing Google sign-in must stay enabled.');
  assert.equal(text('ADMIN_USER_IDS'), 'b63e6c45-eb60-47a1-8c1a-ab5d43c91d37', 'Owner identity changed.');
  assert.equal(text('SUPABASE_URL'), 'https://bdxwyehnqwylvgoxyhhx.supabase.co', 'Wrong account database.');
  for (const name of ['PRIVATE_ACCESS_CREDENTIALS', 'PRIVATE_GUEST_ACCESS_CREDENTIALS', 'VAPID_PRIVATE_KEY', 'MAPBOX_SERVER_TOKEN', 'GUEST_SESSION_SECRET']) {
    assert.equal(entries.find(b => b.name === name)?.type, 'secret_text', `Required secret binding missing: ${name}`);
  }
  assert.ok(entries.some(b => ['SUPABASE_SERVICE_ROLE_KEY','SUPABASE_SECRET_KEY'].includes(b.name) && b.type === 'secret_text'), 'Server database binding missing.');
  const ledger = entries.find(b => b.name === 'BUDGET');
  assert.equal(ledger?.namespace_id, '2332bf33ad63463ba531f7b510695668', 'BudgetLedger storage must be retained.');
  assert.equal(ledger?.class_name, 'BudgetLedger');
  const runtime = version.resources.script_runtime;
  assert.equal(runtime.migration_tag, 'v1', 'Durable Object migration needs a separate reviewed release.');
  assert.equal(runtime.assets?.raw_run_worker_first, true, 'Worker must protect assets first.');
  assert.equal(runtime.assets?.serve_directly, false, 'Assets must not bypass the Worker.');
  assert.ok(runtime.assets?.raw_headers?.includes("frame-ancestors 'none'"), 'Static CSP is missing.');
  assert.deepEqual([...version.resources.script.handlers].sort(), ['fetch','scheduled']);
  assert.ok(version.resources.script.named_handlers.some(h => h.name === 'BudgetLedger'), 'BudgetLedger export missing.');
}
export function assertCompatible(before, staged) {
  assertProtected(before); assertProtected(staged);
  assert.deepEqual(bindings(staged), bindings(before), 'Staged bindings differ; do not activate.');
  assert.deepEqual(canonical(staged.resources.script_runtime), canonical(before.resources.script_runtime), 'Runtime/assets/security settings differ; do not activate.');
}
export function settingsFingerprint(settings) {
  const {annotations, ...config} = settings;
  return canonical({...config, bindings:[...settings.bindings].sort((a,b) => a.name.localeCompare(b.name))});
}
export async function guardedRelease(io) {
  await io.assertMain();
  const before = await io.snapshot();
  assertProtected(before.version);
  assert.equal(activeId(before.deployments), before.version.id);
  const staged = await io.stage();
  assertCompatible(before.version, staged);
  await io.assertMain();
  const fresh = await io.snapshot();
  assert.equal(activeId(fresh.deployments), before.version.id, 'Active deployment changed while staging.');
  assertCompatible(before.version, fresh.version);
  assert.deepEqual(settingsFingerprint(fresh.settings), settingsFingerprint(before.settings), 'Live settings changed while staging.');
  const deployment = await io.activate(staged.id);
  const after = await io.snapshot();
  assert.equal(activeId(after.deployments), staged.id, 'Requested version is not active at 100%.');
  assertCompatible(before.version, after.version);
  assert.deepEqual(settingsFingerprint(after.settings), settingsFingerprint(before.settings), 'Live settings changed after activation.');
  const smoke = await io.smoke();
  return {previousVersion:before.version.id, version:staged.id, deployment:deployment.id, bindingCount:bindings(staged).length, smoke};
}
