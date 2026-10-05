import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { writeFileSync, readFileSync } from "node:fs";
import assert from "node:assert/strict";
writeFileSync(
  "artifacts/worker/test-entry.js",
  readFileSync("artifacts/worker/index.js", "utf8") +
    `export class TestBudgetLedger extends BudgetLedger{constructor(ctx,env){super(ctx,env);ctx.blockConcurrencyWhile(async()=>{await ctx.storage.put('config',{paid:false,monthlyBudget:0,providers:{mapbox:{enabled:true,soft:4,hard:5,free:5,pricePerThousand:1,period:'month',rpm:100},google:{enabled:false,soft:4,hard:5,free:5,pricePerThousand:10,period:'month',rpm:10}},countries:{JO:'mapbox'}});});}}`,
);
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
        serviceBindings: { ASSETS: () => new Response("static") },
      },
    ],
  }),
);
try {
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
    "PASS: real Durable Object concurrent reservations, free cap, paid budget, disabled provider, guest quota, health, owner access, cross-origin denial.",
  );
} finally {
  await mf.dispose();
}
