import {reminderEligible,reminderTiming} from "../shared/reminders";
import { z } from "zod";
import { planSchema, routeSchema } from "../shared/schema";
import { optimize } from "../shared/optimizer";
import { liveWindow } from "../shared/planning";
import { ApiError, budget, type Env } from "./env";
import { db, identity } from "./database";
import { createForecast, normalizeGeoapify, remote } from "./providers";
import { scheduledReminders, queueOccurrence } from "./notifications";
import { createGuestSession, verifyGuestSession } from "./guest";
import { countryCode, locationQuery, locationSearchSchema } from "../shared/location-search";
import { privateAccess, privateResponse, privateSessionId } from "./private-access";
export { BudgetLedger } from "./budget";
const security = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "geolocation=(self)",
  "X-Frame-Options": "DENY",
};
const reply = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: security });
async function body(req: Request) {
  if (Number(req.headers.get("content-length")) > 16000)
    throw new ApiError(413, "Request too large.");
  const s = await req.text();
  if (s.length > 16000) throw new ApiError(413, "Request too large.");
  try {
    return JSON.parse(s);
  } catch {
    throw new ApiError(400, "Invalid request.");
  }
}
async function verifyBot(env: Env, request: Request, token?: string) {
  if (!env.TURNSTILE_SECRET_KEY || !token)
    throw new ApiError(403, "Complete the verification before continuing.");
  const r = await remote(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret: env.TURNSTILE_SECRET_KEY,
        response: token,
        remoteip: request.headers.get("CF-Connecting-IP"),
      }),
    },
  );
  if (!r.success || r.hostname !== new URL(request.url).hostname)
    throw new ApiError(403, "Verification failed. Try again.");
}
async function api(request: Request, env: Env) {
  const url = new URL(request.url),
    path = url.pathname;
  if (
    request.headers.get("Origin") &&
    request.headers.get("Origin") !== url.origin
  )
    throw new ApiError(403, "This origin is not allowed.");
  if (path === "/api/config" && request.method === "GET")
    return reply({
      mode: env.APP_MODE === "live" ? "live" : "setup",
      authConfigured: Boolean(env.SUPABASE_URL && env.SUPABASE_PUBLISHABLE_KEY),
      googleAuthEnabled: env.GOOGLE_AUTH_ENABLED === "true",
      searchConfigured: Boolean(env.GEOAPIFY_API_KEY),
      trafficConfigured: Boolean(env.MAPBOX_SERVER_TOKEN),
      mapConfigured: Boolean(env.MAPBOX_PUBLIC_TOKEN),
      supabaseUrl: env.SUPABASE_URL,
      supabaseKey: env.SUPABASE_PUBLISHABLE_KEY,
      turnstileSiteKey: env.TURNSTILE_SITE_KEY,
      vapidPublicKey: env.VAPID_PUBLIC_KEY,
      publicBeta: env.PUBLIC_BETA === "true",
      privateAccess: env.PRIVATE_ACCESS_REQUIRED === "true",
      privateSessionId: privateSessionId(request),
      detectedCountry: countryCode(request.cf?.country),
    });
  if (path === "/api/health" && request.method === "GET")
    return reply({ ok: true, mode: env.APP_MODE ?? "setup", version: "0.1.0" });
  if (path === "/api/guest-session" && request.method === "GET") {
    if (env.PUBLIC_BETA !== "true") return reply({ verified: false });
    if (!env.TURNSTILE_SECRET_KEY || !env.GUEST_SESSION_SECRET)
      throw new ApiError(503, "Public access has not been enabled securely.");
    try {
      await verifyGuestSession(request, env);
      const expires = request.headers.get("Cookie")!.match(/(?:^|; )traffic_guest=([^;]+)/)![1].split(".")[0];
      return reply({ verified: true, expiresAt: Number(expires) * 1000 });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return reply({ verified: false });
      throw e;
    }
  }
  if (path === "/api/guest-session" && request.method === "POST") {
    if (env.PUBLIC_BETA !== "true")
      throw new ApiError(403, "Guest access is closed.");
    const input = z
      .object({ token: z.string().min(1).max(2048) })
      .parse(await body(request));
    const ip = request.headers.get("CF-Connecting-IP");
    if (!ip) throw new ApiError(403, "Guest verification is unavailable.");
    await budget(env, "/rate", { user: ip });
    await verifyBot(env, request, input.token);
    const token = await createGuestSession(env, ip);
    return Response.json(
      { ok: true, expiresAt: Number(token.split(".")[0]) * 1000 },
      {
        headers: {
          ...security,
          "Set-Cookie": `traffic_guest=${token}; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=3600`,
        },
      },
    );
  }
  const who = await identity(
    request,
    env,
    path.startsWith("/api/admin") ||
      path.startsWith("/api/routes") ||
      path.includes("preferences") ||
      path.includes("push") ||
      path.startsWith("/api/reminders") ||
      path.includes("trips"),
  );
  await budget(env, "/rate", { user: who.id });
  if (path === "/api/me") return reply({ id: who.id, role: who.role });
  if (path === "/api/analysis/allowance" && request.method === "GET")
    return reply(
      await budget(env, "/allowance", { user: who.id, role: who.role }),
    );
  if (path === "/api/map-token" && request.method === "GET") {
    if (!env.MAPBOX_PUBLIC_TOKEN)
      throw new ApiError(503, "The map is not configured yet.");
    await budget(env, "/reserve", { provider: "maps" });
    return reply({ token: env.MAPBOX_PUBLIC_TOKEN });
  }
  if (path.startsWith("/api/location/") && request.method === "POST") {
    const input = locationSearchSchema.parse(await body(request));
    let search;
    try { search = locationQuery(path, input, request.cf?.country); }
    catch (error) { throw new ApiError(400, (error as Error).message); }
    if (!env.GEOAPIFY_API_KEY)
      throw new ApiError(503, "Location search is not configured yet.");
    await budget(env, "/reserve", { provider: "geoapify" });
    const q = search.query, endpoint = search.endpoint;
    q.set("apiKey", env.GEOAPIFY_API_KEY);
    const res = await remote(
      `https://api.geoapify.com/v1/geocode/${endpoint}?${q}`,
    );
    return reply({ locations: normalizeGeoapify(res).filter(l => !search.country || l.countryCode === search.country) });
  }
  if (
    (path === "/api/analysis/day" || path === "/api/analysis/live") &&
    request.method === "POST"
  ) {
    const p = planSchema.parse(await body(request));
    if (p.demo) throw new ApiError(400, "Example forecasts run locally only.");
    if (env.APP_MODE !== "live")
      throw new ApiError(503, "Live forecasts are not activated yet.");
    if (path.endsWith("day")) {
      try {
        liveWindow(p);
      } catch (error) {
        throw new ApiError(400, (error as Error).message);
      }
    }
    await budget(env, "/analysis", { user: who.id, role: who.role });
    const forecast = await createForecast(
      env,
      p,
      who.role === "admin" || who.role === "family",
      path.endsWith("live"),
    );
    if (path.endsWith("live"))
      return reply({
        candidate: await forecast(new Date().toISOString()),
        checkedAt: new Date().toISOString(),
      });
    let providerError: unknown;
    const checkedForecast = async (time: string) => {
      try { return await forecast(time); }
      catch (error) { providerError ??= error; throw error; }
    };
    try {
      return reply(await optimize(p, checkedForecast, { maxCalls: 24 }));
    } catch (error) {
      // Preserve actionable provider failures when no samples succeeded.
      if (providerError instanceof ApiError) throw providerError;
      throw new ApiError(502, "No route forecasts are available. Check provider setup, coverage, or usage limits.");
    }
  }
  if (path.startsWith("/api/analysis/"))
    throw new ApiError(410, "Forecasts are not stored. Run a fresh analysis.");
  if (path === "/api/routes" && request.method === "GET")
    return reply(
      await db(env, `saved_routes?user_id=eq.${who.id}&order=created_at.desc`, {
        token: who.token,
      }),
    );
  if (path === "/api/routes" && request.method === "POST") {
    const input = routeSchema.parse(await body(request));
    if (
      input.plan.origin.source === "demo" ||
      input.plan.destination.source === "demo"
    )
      throw new ApiError(
        400,
        "Select real locations before saving to your account.",
      );
    const existing = (await db(
      env,
      `saved_routes?user_id=eq.${who.id}&select=id`,
      { token: who.token },
    )) as any[];
    const limit = who.role === "admin" ? 100 : who.role === "family" ? 20 : 3;
    if (existing.length >= limit)
      throw new ApiError(429, "Your saved-route allowance has been reached.");
    const { turnstileToken: _, demo: __, ...plan } = input.plan;
    return reply(
      await db(env, "saved_routes", {
        method: "POST",
        body: { ...input, plan, user_id: who.id },
        token: who.token,
      }),
      201,
    );
  }
  const route = path.match(/^\/api\/routes\/([0-9a-f-]{36})$/);
  if (route && request.method === "DELETE") {
    await db(env, `saved_routes?id=eq.${route[1]}&user_id=eq.${who.id}`, {
      method: "DELETE",
      token: who.token,
    });
    return reply({ ok: true });
  }
  if (route && request.method === "PATCH") {
    const input = z
      .object({
        name: z.string().trim().min(1).max(100).optional(),
        plan: planSchema.optional(),
        reminders: z.boolean().optional(),
        days: z.array(z.number().int().min(0).max(6)).min(1).optional(),
      })
      .parse(await body(request));
    if (input.plan) {
      if (input.plan.origin.source === "demo" || input.plan.destination.source === "demo") throw new ApiError(400, "Select real locations before saving to your account.");
      const {turnstileToken: _, demo: __, ...clean} = input.plan;
      input.plan = clean;
    }
    return reply(
      await db(env, `saved_routes?id=eq.${route[1]}&user_id=eq.${who.id}`, {
        method: "PATCH",
        body: input,
        token: who.token,
      }),
    );
  }
  if (path === "/api/preferences" && request.method === "GET")
    return reply(
      await db(env, `user_preferences?user_id=eq.${who.id}`, {
        token: who.token,
      }),
    );
  if (path === "/api/preferences" && request.method === "PATCH") {
    const input = z
      .object({
        locale: z.enum(["en", "ar"]),
        navigation: z.enum(["ask", "google", "waze"]),
        safety_buffer: z.number().int().min(0).max(60),
        measurement_opt_in: z.boolean(),
      })
      .parse(await body(request));
    return reply(
      await db(env, "user_preferences?on_conflict=user_id", {
        method: "POST",
        body: { ...input, user_id: who.id },
        token: who.token,
      }),
    );
  }
  const reminder=path.match(/^\/api\/reminders\/([0-9a-f-]{36})$/);
  if(path==="/api/reminders" && request.method==="GET")return reply(await db(env,`reminder_deliveries?user_id=eq.${who.id}&select=id,plan,candidate,locale,status,due_at,expires_at&order=due_at.desc&limit=30`,{token:who.token}));
  if(reminder && request.method==="GET") {
    const rows=await db(env,`reminder_deliveries?id=eq.${reminder[1]}&user_id=eq.${who.id}&select=id,plan,candidate,locale,status,expires_at,created_at`,{token:who.token}) as any[];
    if(!rows.length)throw new ApiError(404,"Reminder not available for this account.");
    return reply(rows[0]);
  }
  if(reminder && request.method==="DELETE") {
    await db(env,`reminder_deliveries?id=eq.${reminder[1]}&user_id=eq.${who.id}&status=eq.pending`,{method:'PATCH',service:true,body:{status:'cancelled'}});
    return reply({ok:true});
  }
  if(path==="/api/reminders" && request.method==="POST") {
    const input=z.object({plan:planSchema,candidate:z.object({departureAt:z.string().datetime(),arrivalAt:z.string().datetime(),durationSeconds:z.number().int().min(1).max(86400),distanceMeters:z.number().min(0),provider:z.enum(['mapbox','google']),trafficCoverage:z.enum(['available','partial','unknown'])}),locale:z.enum(['en','ar']),leadMinutes:z.number().int().min(15).max(120)}).parse(await body(request));
    if(!reminderEligible(input.plan,input.candidate))throw new ApiError(400,"This journey cannot receive a traffic reminder yet.");
    if(Math.abs(Date.parse(input.candidate.arrivalAt)-Date.parse(input.candidate.departureAt)-input.candidate.durationSeconds*1000)>2000)throw new ApiError(400,"Check the selected journey timing.");
    try {reminderTiming(input.candidate,input.leadMinutes);}catch {throw new ApiError(400,"Choose a future departure within seven days.");}
    const devices=await db(env,`push_devices?user_id=eq.${who.id}&select=id,subscription&limit=10`,{token:who.token}) as any[];
    if(!devices.length)throw new ApiError(400,"Enable notifications on a device first.");
    const pending=await db(env,`reminder_deliveries?user_id=eq.${who.id}&status=eq.pending&select=id&limit=101`,{token:who.token}) as any[];
    if(pending.length+devices.length>100)throw new ApiError(429,"Cancel an existing reminder before adding more.");
    const {turnstileToken:_,...clean}=input.plan;
    const key=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([clean.origin.latitude,clean.origin.longitude,clean.destination.latitude,clean.destination.longitude,input.candidate.departureAt])))),b=>b.toString(16).padStart(2,'0')).join('');
    await queueOccurrence(env,who.id,devices,clean,input.candidate,input.locale,input.leadMinutes,`selected:${key}`,undefined,true);
    return reply({ok:true},201);
  }
  if (path === "/api/push/status" && request.method === "POST") {
    const {endpoint} = z.object({endpoint: z.string().url().max(2048)}).parse(await body(request));
    const rows = await db(env, `push_devices?user_id=eq.${who.id}&subscription->>endpoint=eq.${encodeURIComponent(endpoint)}&select=subscription&limit=1`, {token: who.token}) as {subscription: {endpoint: string}}[];
    return reply({subscribed: rows.some(row => row.subscription.endpoint === endpoint)});
  }
  if (path === "/api/push" && request.method === "POST") {
    const input = z
      .object({
        endpoint: z.string().url().max(2048),
        keys: z.object({
          p256dh: z.string().max(200),
          auth: z.string().max(200),
        }),
      })
      .parse(await body(request));
    const host = new URL(input.endpoint).hostname;
    if (
      new URL(input.endpoint).protocol !== "https:" ||
      ![
        "fcm.googleapis.com",
        "updates.push.services.mozilla.com",
        "web.push.apple.com",
      ].some((h) => host === h || host.endsWith("." + h))
    )
      throw new ApiError(400, "This push service is not supported.");
    // An explicitly enabled browser endpoint belongs to the current account only.
    await db(env,`push_devices?user_id=neq.${who.id}&subscription->>endpoint=eq.${encodeURIComponent(input.endpoint)}`,{method:'DELETE',service:true});
    await db(env,`push_subscriptions?user_id=neq.${who.id}&subscription->>endpoint=eq.${encodeURIComponent(input.endpoint)}`,{method:'DELETE',service:true});
    const saved = await db(env, "push_devices?on_conflict=user_id,endpoint_key", {
      method: "POST", body: {user_id: who.id, subscription: input}, token: who.token,
    });
    await db(env, `notification_jobs?user_id=eq.${who.id}`, {method: "PATCH", body: {next_attempt_at: new Date().toISOString()}, service: true});
    return reply(saved, 201);
  }

  if (path === "/api/push" && request.method === "DELETE") {
    const {endpoint}=z.object({endpoint:z.string().url().max(2048)}).parse(await body(request));
    await db(env, `push_devices?user_id=eq.${who.id}&subscription->>endpoint=eq.${encodeURIComponent(endpoint)}`, {
      method: "DELETE",
      token: who.token,
    });
    await db(env,`push_subscriptions?user_id=eq.${who.id}&subscription->>endpoint=eq.${encodeURIComponent(endpoint)}`,{method:'DELETE',token:who.token});
    return reply({ ok: true });
  }
  if (path === "/api/trips" && request.method === "POST") {
    const prefs = (await db(
      env,
      `user_preferences?user_id=eq.${who.id}&select=measurement_opt_in`,
      { token: who.token },
    )) as any[];
    if (!prefs[0]?.measurement_opt_in)
      throw new ApiError(403, "Enable journey measurement first.");
    const input = z
      .object({
        actual_departure: z.string().datetime(),
        actual_arrival: z.string().datetime(),
      })
      .refine(
        (v) =>
          Date.parse(v.actual_arrival) > Date.parse(v.actual_departure) &&
          Date.parse(v.actual_arrival) - Date.parse(v.actual_departure) <
            24 * 3600000,
      )
      .parse(await body(request));
    return reply(
      await db(env, "actual_trip_samples", {
        method: "POST",
        body: {
          ...input,
          user_id: who.id,
          actual_duration_seconds: Math.round(
            (Date.parse(input.actual_arrival) -
              Date.parse(input.actual_departure)) /
              1000,
          ),
        },
        token: who.token,
      }),
      201,
    );
  }
  if (path.startsWith("/api/admin")) {
    if (who.role !== "admin")
      throw new ApiError(403, "Owner access is required.");
    if (path === "/api/admin/overview")
      return reply(await budget(env, "/status"));
    if (path === "/api/admin/config" && request.method === "PATCH") {
      const input = z
        .object({
          allowances:z.object({guest:z.number().int().min(0).max(1000),user:z.number().int().min(0).max(1000),family:z.number().int().min(0).max(1000),admin:z.number().int().min(0).max(1000)}).optional(),
          userAllowance:z.object({userId:z.string().uuid(),limit:z.number().int().min(0).max(1000).nullable()}).optional(),
          providers:z.object({mapbox:z.object({enabled:z.boolean(),hard:z.number().int().min(0).max(10000000)}),google:z.object({enabled:z.boolean(),hard:z.number().int().min(0).max(10000000)}),geoapify:z.object({enabled:z.boolean(),hard:z.number().int().min(0).max(10000000)}),maps:z.object({enabled:z.boolean(),hard:z.number().int().min(0).max(10000000)})}).optional(),
          countries:z.object({JO:z.enum(['mapbox','google']),LY:z.enum(['mapbox','google']),SA:z.enum(['mapbox','google'])}).optional(),
          paid: z.boolean().optional(),
          monthlyBudget: z.number().min(0).max(1000).optional(),
          provider: z.enum(["mapbox", "google", "geoapify", "maps"]).optional(),
          enabled: z.boolean().optional(),
          hard: z.number().int().min(0).max(10000000).optional(),
          country: z.enum(["JO", "LY", "SA"]).optional(),
          primary: z.enum(["mapbox", "google"]).optional(),
        })
        .parse(await body(request));
      return reply(await budget(env, "/update", { ...input, actor: who.id }));
    }
    if (path === "/api/admin/users")
      return reply(
        await db(env, "profiles?select=id,role,created_at&limit=100", {
          service: true,
        }),
      );
    if (path === "/api/admin/accuracy")
      return reply({
        status: "insufficient_data",
        message: "Provider accuracy has not been calibrated yet.",
      });
  }
  throw new ApiError(404, "Not found.");
}
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const privateGate = await privateAccess(request, env);
    if (privateGate) return privateGate;
    if (!new URL(request.url).pathname.startsWith("/api/"))
      return privateResponse(await env.ASSETS.fetch(request), env);
    const requestId = crypto.randomUUID();
    try {
      return privateResponse(await api(request, env), env);
    } catch (e) {
      const status =
        e instanceof ApiError ? e.status : e instanceof z.ZodError ? 400 : 500;
      const message =
        e instanceof ApiError
          ? e.message
          : e instanceof z.ZodError
            ? "Check the selected locations and travel settings."
            : "Something went wrong. Try again.";
      ctx.waitUntil(
        budget(env, "/error", { code: `http_${status}`, requestId }).catch(
          () => {},
        ),
      );
      const code = status === 429 ? /daily analysis/i.test(message) ? "DAILY_ALLOWANCE" : "USAGE_LIMIT" : status === 403 ? /verif|human/i.test(message) ? "VERIFICATION_REQUIRED" : "PERMISSION_DENIED" : status === 401 ? "ACCOUNT_REQUIRED" : status >= 500 ? "SERVICE_UNAVAILABLE" : "INVALID_INPUT";
      return reply({ error: message, requestId, code }, status);
    }
  },
  async scheduled(
    _event: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ) {
    ctx.waitUntil(scheduledReminders(env));
    ctx.waitUntil(budget(env, "/cleanup").catch(() => {}));
  },
} satisfies ExportedHandler<Env>;
