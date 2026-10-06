import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { writeFileSync, readFileSync } from "node:fs";
import assert from "node:assert/strict";
writeFileSync(
  "artifacts/worker/test-entry.js",
  readFileSync("artifacts/worker/index.js", "utf8") +
    `import { WorkerEntrypoint } from 'cloudflare:workers';
    export class TestProvider extends WorkerEntrypoint {
      async fetch(request) {
        try { return Response.json(await remote('https://upstream.test'+new URL(request.url).pathname, {headers:{Authorization:'Bearer private-test-value'}})); }
        catch(e) { return Response.json({error:e.message}, {status:e.status ?? 500}); }
      }
    }
    export class TestBudgetLedger extends BudgetLedger{constructor(ctx,env){super(ctx,env);ctx.blockConcurrencyWhile(async()=>{await ctx.storage.put('config',{paid:false,monthlyBudget:0,providers:{mapbox:{enabled:true,soft:4,hard:5,free:5,pricePerThousand:1,period:'month',rpm:100},google:{enabled:false,soft:4,hard:5,free:5,pricePerThousand:10,period:'month',rpm:10}},countries:{JO:'mapbox'}});});}}`,
);
const upstreamRequests = [];
const mf = new Miniflare(
  convertV4MiniflareOptions({
    telemetry: { enabled: false },
    workers: [
      {
        name: "traffic",
        modules: true,
        scriptPath: "artifacts/worker/test-entry.js",
        compatibilityDate: "2026-10-05",
        compatibilityFlags: ["nodejs_compat"],
        durableObjects: {
          BUDGET: { className: "TestBudgetLedger", useSQLite: true },
        },
        bindings: { APP_MODE: "setup", PUBLIC_BETA: "false" },
        serviceBindings: {
          ASSETS: () => new Response("static"),
          PROVIDER_CHECK: { name: "traffic", entrypoint: "TestProvider" },
        },
        outboundService: (request) => {
          upstreamRequests.push(request.url);
          assert.equal(new URL(request.url).hostname, "upstream.test");
          return new URL(request.url).pathname === "/redirect"
            ? new Response(null, {
                status: 302,
                headers: { Location: "https://other.test/secret-sink" },
              })
            : Response.json({
                locations: [{ displayName: "Public landmark" }],
              });
        },
      },
    ],
  }),
);
try {
  const bindings = await mf.getBindings("traffic");
  const normal = await bindings.PROVIDER_CHECK.fetch("https://check/ok");
  assert.equal(normal.status, 200);
  assert.equal(
    (await normal.json()).locations[0].displayName,
    "Public landmark",
  );
  const redirected = await bindings.PROVIDER_CHECK.fetch(
    "https://check/redirect",
  );
  assert.equal(redirected.status, 502);
  assert.deepEqual(upstreamRequests, [
    "https://upstream.test/ok",
    "https://upstream.test/redirect",
  ]);
  const ns = await mf.getDurableObjectNamespace("BUDGET", "traffic"),
    stub = ns.get(ns.idFromName("test"));
  async function call(path, body = {}) {
    const r = await stub.fetch("https://ledger" + path, {
      method: "POST",
      body: JSON.stringify(body),
    });
    return { status: r.status, body: await r.json() };
  }
  await call("/update", { provider: "mapbox", hard: 5, actor: "test" });
  const results = await Promise.all(
    Array.from({ length: 20 }, () => call("/reserve", { provider: "mapbox" })),
  );
  assert.equal(results.filter((r) => r.status === 200).length, 5);
  assert.equal(results.filter((r) => r.status === 429).length, 15);
  assert.equal((await call("/reserve", { provider: "google" })).status, 503);
  assert.equal(
    (await call("/analysis", { user: "guest-x", role: "guest" })).status,
    200,
  );
  assert.equal(
    (await call("/analysis", { user: "guest-x", role: "guest" })).status,
    429,
  );
  const allowance = await call("/allowance", {
    user: "guest-x",
    role: "guest",
  });
  assert.deepEqual(allowance.body, { used: 1, limit: 1, remaining: 0 });
  for (let i = 0; i < 3; i++) {
    assert.deepEqual(
      (await call("/allowance", { user: "user-x", role: "user" })).body,
      { used: 0, limit: 10, remaining: 10 },
    );
  }
  await call("/analysis", { user: "user-x", role: "user" });
  assert.equal(
    (await call("/allowance", { user: "user-x", role: "user" })).body.remaining,
    9,
  );
  await call("/update", { provider: "mapbox", hard: 6, paid: false });
  assert.equal((await call("/reserve", { provider: "mapbox" })).status, 429);
  await call("/update", { paid: true, monthlyBudget: 0 });
  assert.equal((await call("/reserve", { provider: "mapbox" })).status, 429);
  await call("/update", { monthlyBudget: 1 });
  assert.equal((await call("/reserve", { provider: "mapbox" })).status, 200);
  assert.equal((await call("/reserve", { provider: "mapbox" })).status, 429);
  const health = await mf.dispatchFetch("http://local/api/health");
  assert.equal(health.status, 200);
  const admin = await mf.dispatchFetch("http://local/api/admin/overview");
  assert.equal(admin.status, 401);
  const cors = await mf.dispatchFetch("http://local/api/config", {
    headers: { Origin: "https://evil.invalid" },
  });
  assert.equal(cors.status, 403);
  console.log(
    "PASS: real Worker provider fetch and redirect refusal; Durable Object concurrent reservations, free cap, paid budget, disabled provider, guest quota, health, owner access, cross-origin denial.",
  );
} finally {
  await mf.dispose();
}
