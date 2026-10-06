import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { writeFileSync, readFileSync } from "node:fs";
import assert from "node:assert/strict";
writeFileSync(
  "artifacts/worker/test-entry.js",
  readFileSync("artifacts/worker/index.js", "utf8") +
    `import { WorkerEntrypoint } from 'cloudflare:workers';
    export class TestProvider extends WorkerEntrypoint {
      async fetch(request) {
        try {
          if (new URL(request.url).pathname === '/forecast') {
            const p = await request.json();
            const forecast = await createForecast(this.env, p, false);
            return Response.json(await forecast('2026-10-07T05:30:00.000Z'));
          }
          return Response.json(await remote('https://upstream.test'+new URL(request.url).pathname, {headers:{Authorization:'Bearer private-test-value'}}));
        }
        catch(e) { return Response.json({error:e.message}, {status:e.status ?? 500}); }
      }
    }
    export class TestBudgetLedger extends BudgetLedger{constructor(ctx,env){super(ctx,env);ctx.blockConcurrencyWhile(async()=>{await ctx.storage.put('config',{paid:false,monthlyBudget:0,providers:{mapbox:{enabled:true,soft:4,hard:5,free:5,pricePerThousand:1,period:'month',rpm:100},geoapify:{enabled:true,soft:100,hard:100,free:100,pricePerThousand:1,period:'month',rpm:100},google:{enabled:false,soft:4,hard:5,free:5,pricePerThousand:10,period:'month',rpm:10}},countries:{JO:'mapbox'}});});}}`,
);
const upstreamRequests = [], locationRequests = [];
const usedChallenges = new Set(); let verificationRequests = 0;
const mf = new Miniflare(
  convertV4MiniflareOptions({
    telemetry: { enabled: false },
    workers: [
      {
        name: "verification",
        modules: true,
        scriptPath: "artifacts/worker/index.js",
        compatibilityDate: "2026-10-05",
        compatibilityFlags: ["nodejs_compat"],
        durableObjects: {BUDGET:{className:"BudgetLedger",useSQLite:true}},
        bindings: {PUBLIC_BETA:"true",TURNSTILE_SECRET_KEY:"test-verification-secret",GUEST_SESSION_SECRET:"test-signing-secret"},
        serviceBindings: {ASSETS:()=>new Response("static")},
        outboundService: async(request)=>{
          assert.equal(request.url,"https://challenges.cloudflare.com/turnstile/v0/siteverify");
          verificationRequests++;
          const input=await request.json();
          assert.equal(input.secret,"test-verification-secret");
          assert.equal(input.remoteip,"203.0.113.10");
          const repeated=usedChallenges.has(input.response); usedChallenges.add(input.response);
          return Response.json({success: input.response!=="rejected" && !repeated,hostname:input.response==="wrong-host" ? "foreign.test" : "app.test"});
        }
      },
      {
        name: "traffic",
        modules: true,
        scriptPath: "artifacts/worker/test-entry.js",
        compatibilityDate: "2026-10-05",
        compatibilityFlags: ["nodejs_compat"],
        durableObjects: {
          BUDGET: { className: "TestBudgetLedger", useSQLite: true },
        },
        bindings: { APP_MODE: "setup", PUBLIC_BETA: "false", MAPBOX_SERVER_TOKEN: "private-test-value", SUPABASE_URL:"https://account.test", SUPABASE_PUBLISHABLE_KEY:"test-publishable", GEOAPIFY_API_KEY:"test-only" },
        serviceBindings: {
          ASSETS: () => new Response("static"),
          PROVIDER_CHECK: { name: "traffic", entrypoint: "TestProvider" },
        },
        outboundService: (request) => {
          if (new URL(request.url).hostname === "api.mapbox.com") {
            assert.equal(new URL(request.url).searchParams.get("depart_at"), "2026-10-07T05:30:00Z");
            return Response.json({routes:[{duration:1200,distance:15000,legs:[]}]});
          }
          if (new URL(request.url).hostname === "account.test") return Response.json(new URL(request.url).pathname.startsWith("/auth") ? {id:"test-location-user"} : [{role:"user"}]);
          if (new URL(request.url).hostname === "api.geoapify.com") {
            locationRequests.push(request.url);
            return Response.json({features:[{properties:{formatted:"Jordan Museum",lat:31.95,lon:35.91,country_code:"jo"}},{properties:{formatted:"Foreign Museum",lat:24,lon:46,country_code:"sa"}}]});
          }
          upstreamRequests.push(request.url);
          assert.equal(new URL(request.url).hostname, "upstream.test");
          if (new URL(request.url).pathname === "/unauthorized") return new Response(null, {status:401});
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
  const mainWorker = await mf.getWorker("traffic");
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
  const denied = await bindings.PROVIDER_CHECK.fetch("https://check/unauthorized");
  assert.equal(denied.status, 503);
  assert.match((await denied.json()).error, /HTTP 401/);
  assert.deepEqual(upstreamRequests, [
    "https://upstream.test/ok",
    "https://upstream.test/redirect",
    "https://upstream.test/unauthorized",
  ]);
  const forecast = await bindings.PROVIDER_CHECK.fetch("https://check/forecast", {
    method: "POST", body: JSON.stringify({origin:{latitude:31.95,longitude:35.91,countryCode:"JO"},destination:{latitude:32,longitude:35.83}}),
  });
  assert.equal(forecast.status, 200);
  assert.equal((await forecast.json()).durationSeconds, 1200);
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
  async function location(body) { return mainWorker.fetch("http://local/api/location/suggest",{method:"POST",headers:{Authorization:"Bearer test-session","Content-Type":"application/json"},body:JSON.stringify(body)}); }
  const localSuggestions = await location({text:"Museum",countryCode:"JO",latitude:31.95,longitude:35.91});
  assert.equal(localSuggestions.status,200);
  assert.deepEqual((await localSuggestions.json()).locations.map(l=>l.countryCode),["JO"]);
  assert.equal(new URL(locationRequests[0]).searchParams.get("filter"),"countrycode:jo");
  assert.equal(new URL(locationRequests[0]).searchParams.get("bias"),"proximity:35.91,31.95");
  assert.equal((await location({text:"Museum",countryCode:"XX"})).status,400);
  assert.equal((await location({text:"Museum",countryCode:"JO",latitude:31.95})).status,400);
  const missingCountry = await mainWorker.fetch("http://local/api/location/suggest",{method:"POST",headers:{Authorization:"Bearer test-session"},body:JSON.stringify({text:"Museum"}),cf:{country:"XX"}});
  assert.equal(missingCountry.status,400);
  assert.equal(locationRequests.length,1);
  const inferredCountry = await mainWorker.fetch("http://local/api/location/suggest",{method:"POST",headers:{Authorization:"Bearer test-session"},body:JSON.stringify({text:"Museum"}),cf:{country:"LY"}});
  assert.equal(inferredCountry.status,200);
  assert.equal(new URL(locationRequests[1]).searchParams.get("filter"),"countrycode:ly");
  assert.deepEqual((await inferredCountry.json()).locations,[]);
  const configCountry = await mainWorker.fetch("http://local/api/config",{cf:{country:"JO"}});
  assert.equal((await configCountry.json()).detectedCountry,"JO");
  const health = await mainWorker.fetch("http://local/api/health");
  assert.equal(health.status, 200);
  const admin = await mainWorker.fetch("http://local/api/admin/overview");
  assert.equal(admin.status, 401);
  const cors = await mainWorker.fetch("http://local/api/config", {
    headers: { Origin: "https://evil.invalid" },
  });
  assert.equal(cors.status, 403);
  const verification = await mf.getWorker("verification");
  const guestHeaders={"CF-Connecting-IP":"203.0.113.10"};
  async function guestStatus(cookie,ip="203.0.113.10") {
    return verification.fetch("https://app.test/api/guest-session",{headers:{"CF-Connecting-IP":ip,...(cookie?{Cookie:cookie}:{})}});
  }
  assert.deepEqual(await (await guestStatus()).json(),{verified:false});
  assert.deepEqual(await (await guestStatus("traffic_guest=invalid.cookie")).json(),{verified:false});
  assert.equal(verificationRequests,0);
  async function verifyChallenge(token) {
    return verification.fetch("https://app.test/api/guest-session",{method:"POST",headers:{...guestHeaders,"Content-Type":"application/json"},body:JSON.stringify({token})});
  }
  assert.equal((await verifyChallenge("rejected")).status,403);
  assert.equal((await verifyChallenge("wrong-host")).status,403);
  const verified = await verifyChallenge("valid-test-challenge");
  assert.equal(verified.status,200,JSON.stringify({body:await verified.clone().text(),verificationRequests}));
  const verifiedBody=await verified.json();
  assert.equal(verifiedBody.ok,true);
  assert.ok(verifiedBody.expiresAt>Date.now());
  const cookieHeader=verified.headers.get("Set-Cookie");
  assert.match(cookieHeader,/HttpOnly; Secure; SameSite=Strict; Path=\/api; Max-Age=3600/);
  const cookie=cookieHeader.split(";")[0];
  const restored=await guestStatus(cookie);
  assert.match(restored.headers.get("Cache-Control"),/no-store/);
  assert.deepEqual(await restored.json(),{verified:true,expiresAt:verifiedBody.expiresAt});
  assert.deepEqual(await (await guestStatus(cookie,"203.0.113.11")).json(),{verified:false});
  assert.deepEqual(await (await guestStatus(cookie+"tampered")).json(),{verified:false});
  assert.deepEqual(await (await guestStatus("traffic_guest=1.expired")).json(),{verified:false});
  assert.equal((await verifyChallenge("valid-test-challenge")).status,403);
  assert.equal(verificationRequests,4);
  console.log("PASS: guest challenge rejection, strict hostname, replay refusal, secure cookie, server-only restoration, tampered/expired/IP-changed session rejection; no provider calls during restoration.");
  console.log(
    "PASS: real Worker provider fetch and redirect refusal; Durable Object concurrent reservations, free cap, paid budget, disabled provider, guest quota, country filter/proximity/unknown-country rejection before provider use, health, owner access, cross-origin denial.",
  );
} finally {
  await mf.dispose();
}
