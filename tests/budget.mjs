import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { writeFileSync, readFileSync } from "node:fs";
import assert from "node:assert/strict";
import {pbkdf2Sync,createHmac} from "node:crypto";
const privateFixture={username:"fixture user",salt:"a1".repeat(16),hash:pbkdf2Sync("fixture-password",Buffer.from("a1".repeat(16),"hex"),100000,32,"sha256").toString("hex"),signingKey:"b2".repeat(32)};
const guestFixture={username:"invited guest",salt:"c3".repeat(16),hash:pbkdf2Sync("guest-fixture-password",Buffer.from("c3".repeat(16),"hex"),100000,32,"sha256").toString("hex")};
let privateAssetReads=0;
writeFileSync(
  "artifacts/worker/test-entry.js",
  readFileSync("artifacts/worker/index.js", "utf8") +
    `import { WorkerEntrypoint } from 'cloudflare:workers';
    export class TestProvider extends WorkerEntrypoint {
      async fetch(request) {
        try {
          if (['/forecast','/forecast-live'].includes(new URL(request.url).pathname)) {
            const p = await request.json();
            const immediate = new URL(request.url).pathname === '/forecast-live';
            const forecast = await createForecast(this.env, p, false, immediate);
            return Response.json(await forecast(immediate ? new Date().toISOString() : '2026-10-07T05:30:00.000Z'));
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
      {name:"private",modules:true,scriptPath:"artifacts/worker/index.js",compatibilityDate:"2026-10-05",compatibilityFlags:["nodejs_compat"],durableObjects:{BUDGET:{className:"BudgetLedger",useSQLite:true}},bindings:{PRIVATE_ACCESS_REQUIRED:"true",PRIVATE_ACCESS_CREDENTIALS:JSON.stringify(privateFixture),PRIVATE_GUEST_ACCESS_CREDENTIALS:JSON.stringify(guestFixture),PUBLIC_BETA:"false"},serviceBindings:{ASSETS:request=>{if(new URL(request.url).pathname === "/sw.js") return new Response(readFileSync("public/sw.js","utf8"));privateAssetReads++;return new Response("fixture app asset");}}},
      {name:"private-missing",modules:true,scriptPath:"artifacts/worker/index.js",compatibilityDate:"2026-10-05",compatibilityFlags:["nodejs_compat"],bindings:{PRIVATE_ACCESS_REQUIRED:"true"},serviceBindings:{ASSETS:()=>new Response("must not leak")}},
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
            assert.ok(["now", "2026-10-07T05:30:00Z"].includes(new URL(request.url).searchParams.get("depart_at")));
            upstreamRequests.push(new URL(request.url).searchParams.get("depart_at"));
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
  {
  const locked = await mf.getWorker("private"), missing = await mf.getWorker("private-missing");
  for(const path of ["/","/plan","/settings","/admin","/assets/app.js","/mapbox-rtl-text-v0.2.3.js","/api/config","/api/routes"]) {
    const result=await locked.fetch("https://localhost"+path,{headers:{Accept:path.startsWith("/api/")?"application/json":"text/html"}});
    assert.equal(result.status,401,path);
    assert.match(result.headers.get("Cache-Control"),/no-store/);
    const text=await result.text();assert.ok(!text.includes("fixture app asset"));assert.ok(!text.includes(privateFixture.hash));
  }
  assert.equal(privateAssetReads,0);
  assert.equal((await missing.fetch("https://localhost/")).status,503);
  const cleanup=await locked.fetch("https://localhost/sw.js");
  assert.equal(cleanup.status,200);assert.match(await cleanup.text(),/caches.delete/);assert.equal(privateAssetReads,0);
  async function unlock(values={},ip="203.0.113.80",origin="https://localhost") {
    return locked.fetch("https://localhost/private/unlock",{method:"POST",headers:{Origin:origin,"Content-Type":"application/x-www-form-urlencoded","CF-Connecting-IP":ip},body:new URLSearchParams({username:privateFixture.username,password:"fixture-password",next:"/plan",...values}).toString(),redirect:"manual"});
  }
  assert.equal((await unlock({},"203.0.113.90","https://127.0.0.1")).status,403);
  const wrongLogin=await unlock({password:"wrong"},"203.0.113.91");assert.equal(wrongLogin.status,401,await wrongLogin.text());
  const login=await unlock();assert.equal(login.status,303);assert.equal(login.headers.get("Location"),"/plan");
  const setCookie=login.headers.get("Set-Cookie");assert.match(setCookie,/__Host-traffic_private=/);assert.match(setCookie,/Secure; HttpOnly; SameSite=Lax; Path=\//);assert.ok(!setCookie.split(",")[0].includes("Max-Age"));
  const cookie=setCookie.split(";")[0];
  assert.match(cookie,/=v2\.[a-f0-9]{32}\.\d{13}\.owner\./);
  const opened=await locked.fetch("https://localhost/plan",{headers:{Cookie:cookie}});assert.equal(await opened.text(),"fixture app asset");assert.match(opened.headers.get("Cache-Control"),/no-store/);
  assert.equal((await locked.fetch("https://localhost/api/health",{headers:{Cookie:cookie}})).status,200);
  const account=await locked.fetch("https://localhost/api/routes",{headers:{Cookie:cookie}});assert.equal(account.status,401);assert.notEqual((await account.json()).privateAccess,true);
  assert.equal((await locked.fetch("https://localhost/api/config",{headers:{Authorization:"Bearer unrelated-user-token"}})).status,401);
  assert.equal((await locked.fetch("https://other.test/api/config",{headers:{Cookie:cookie}})).status,401);
  assert.equal((await locked.fetch("https://localhost/api/config",{headers:{Cookie:cookie.slice(0,-1)+(cookie.endsWith("a")?"b":"a")}})).status,401);
  const parts=cookie.slice(cookie.indexOf("=")+1).split("."), expired=String(Date.now()-1000);
  const signature=createHmac("sha256",Buffer.from(privateFixture.signingKey,"hex")).update(`v2:${parts[1]}:${expired}:owner:localhost:${privateFixture.hash}`).digest("hex");
  assert.equal((await locked.fetch("https://localhost/api/config",{headers:{Cookie:`__Host-traffic_private=v2.${parts[1]}.${expired}.owner.${signature}`}})).status,401);
  const remembered=await unlock({remember:"yes",next:"/settings?test=return#callback"},"203.0.113.94");
  assert.match(remembered.headers.get("Set-Cookie"),/Max-Age=604800/);assert.equal(remembered.headers.get("Location"),"/settings?test=return#callback");
  const guestLogin=await unlock({username:guestFixture.username,password:"guest-fixture-password"},"203.0.113.95");
  assert.equal(guestLogin.status,303);const guestCookie=guestLogin.headers.get("Set-Cookie").split(";")[0];assert.match(guestCookie,/\.guest\./);
  const guestConfig=await locked.fetch("https://localhost/api/config",{headers:{Cookie:guestCookie}});assert.equal(guestConfig.status,200);assert.match((await guestConfig.json()).privateSessionId,/^[a-f0-9]{32}$/);
  assert.equal((await locked.fetch("https://localhost/api/admin",{headers:{Cookie:guestCookie}})).status,401);
  const arabic=await locked.fetch("https://localhost/plan?case=1",{headers:{Accept:"text/html",Cookie:"__Host-traffic_language=ar"}});const arabicPage=await arabic.text();assert.match(arabicPage,/<html lang="ar" dir="rtl">/);assert.ok(!arabicPage.includes("Welcome back"));assert.match(arabic.headers.get("Content-Security-Policy"),/script-src 'nonce-/);assert.match(arabicPage,/name="next" value="\/plan\?case=1"/);
  const language=await locked.fetch("https://localhost/private/language",{method:"POST",headers:{Origin:"https://localhost","Content-Type":"application/x-www-form-urlencoded"},body:"language=ar&next=%2Fplan%3Fcase%3D1",redirect:"manual"});assert.equal(language.status,303);assert.match(language.headers.get("Set-Cookie"),/__Host-traffic_language=ar/);assert.equal(language.headers.get("Location"),"/plan?case=1");
  assert.equal((await unlock({next:"https://foreign.test"},"203.0.113.92")).headers.get("Location"),"/");
  for(let i=0;i<5;i++) assert.equal((await unlock({password:"wrong"},"203.0.113.93")).status,401);
  assert.equal((await unlock({},"203.0.113.93")).status,429);
  const logout=await locked.fetch("https://localhost/private/lock",{method:"POST",headers:{Origin:"https://localhost",Cookie:cookie},redirect:"manual"});assert.equal(logout.status,303);assert.match(logout.headers.get("Set-Cookie"),/Max-Age=0/);
  assert.equal((await locked.fetch("https://localhost/api/config",{headers:{Cookie:cookie}})).status,401,"Locked session replay must fail");
  assert.equal((await locked.fetch("https://localhost/api/config",{headers:{Cookie:guestCookie}})).status,200,"Other session remains unlocked");
  const jsonLock=await locked.fetch("https://localhost/private/lock",{method:"POST",headers:{Origin:"https://localhost",Cookie:guestCookie,Accept:"application/json"}});assert.equal(jsonLock.status,200);assert.equal((await jsonLock.json()).locked,true);
  assert.equal((await locked.fetch("https://localhost/api/config",{headers:{Cookie:guestCookie}})).status,401);
  console.log("Private website gate passed: deep links/assets/APIs denied, missing secret fails closed, signed session/expiry/host/origin checks, throttle and logout.");
  }
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
  const immediate = await bindings.PROVIDER_CHECK.fetch("https://check/forecast-live", {
    method:"POST",body:JSON.stringify({origin:{latitude:31.95,longitude:35.91,countryCode:"JO"},destination:{latitude:32,longitude:35.83}}),
  });
  assert.equal(immediate.status,200);
  const immediateCandidate = await immediate.json();
  assert.ok(Math.abs(Date.parse(immediateCandidate.departureAt)-Date.now())<10000);
  assert.equal(Date.parse(immediateCandidate.arrivalAt)-Date.parse(immediateCandidate.departureAt),1200000);
  assert.deepEqual(upstreamRequests.slice(-2),["2026-10-07T05:30:00Z","now"]);
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
  await call('/update',{allowances:{user:2},userAllowance:{userId:'user-x',limit:3}});
  assert.equal((await call('/allowance',{user:'user-x',role:'user'})).body.limit,3);
  assert.equal((await call('/allowance',{user:'user-y',role:'user'})).body.limit,2);
  await call('/update',{userAllowance:{userId:'user-x',limit:null}});
  assert.equal((await call('/allowance',{user:'user-x',role:'user'})).body.limit,2);
  await call('/update',{allowances:{user:0}});
  assert.equal((await call('/analysis',{user:'blocked-user',role:'user'})).status,429);
  assert.equal((await call('/config')).body.paid,false);
  assert.equal((await call('/config')).body.providers.mapbox.hard,5);
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
