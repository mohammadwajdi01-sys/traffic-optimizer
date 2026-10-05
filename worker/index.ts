import { z } from "zod";
import { planSchema, routeSchema } from "../shared/schema";
import { optimize } from "../shared/optimizer";
import { liveWindow } from "../shared/planning";
import { ApiError, budget, type Env } from "./env";
import { db, identity } from "./database";
import { createForecast, remote } from "./providers";
import { scheduledReminders } from "./notifications";
import { createGuestSession } from "./guest";
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
    });
  if (path === "/api/health" && request.method === "GET")
    return reply({ ok: true, mode: env.APP_MODE ?? "setup", version: "0.1.0" });
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
      { ok: true },
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
    const input = z
      .object({
        text: z.string().min(3).max(200).optional(),
        latitude: z.number().min(-90).max(90).optional(),
        longitude: z.number().min(-180).max(180).optional(),
        language: z.enum(["en", "ar"]).default("en"),
        turnstileToken: z.string().optional(),
      })
      .parse(await body(request));
    if (!env.GEOAPIFY_API_KEY)
      throw new ApiError(503, "Location search is not configured yet.");
    await budget(env, "/reserve", { provider: "geoapify" });
    const q = new URLSearchParams({
      apiKey: env.GEOAPIFY_API_KEY,
      lang: input.language,
      limit: "5",
    });
    let endpoint = "autocomplete";
    if (path.endsWith("reverse")) {
      if (input.latitude === undefined || input.longitude === undefined)
        throw new ApiError(400, "Coordinates are required.");
      endpoint = "reverse";
      q.set("lat", String(input.latitude));
      q.set("lon", String(input.longitude));
    } else {
      if (!input.text) throw new ApiError(400, "Type a location.");
      q.set("text", input.text);
      if (input.latitude !== undefined && input.longitude !== undefined)
        q.set("bias", `proximity:${input.longitude},${input.latitude}`);
    }
    const res = await remote(
      `https://api.geoapify.com/v1/geocode/${endpoint}?${q}`,
    );
    return reply({
      locations:
        res.features?.map((f: any) => ({
          id: f.properties.place_id,
          displayName: f.properties.formatted,
          latitude: f.properties.lat,
          longitude: f.properties.lon,
          countryCode: f.properties.country_code?.toUpperCase(),
          timezone: f.properties.timezone?.name,
          source: "geoapify",
        })) ?? [],
    });
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
    );
    if (path.endsWith("live"))
      return reply({
        candidate: await forecast(new Date(Date.now() + 60000).toISOString()),
      });
    const result = await optimize(p, forecast, { maxCalls: 24 });
    return reply(result);
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
        reminders: z.boolean().optional(),
        days: z.array(z.number().int().min(0).max(6)).min(1).optional(),
      })
      .parse(await body(request));
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
    return reply(
      await db(env, "push_subscriptions?on_conflict=user_id", {
        method: "POST",
        body: { user_id: who.id, subscription: input },
        token: who.token,
      }),
      201,
    );
  }
  if (path === "/api/push" && request.method === "DELETE") {
    await db(env, `push_subscriptions?user_id=eq.${who.id}`, {
      method: "DELETE",
      token: who.token,
    });
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
    if (!new URL(request.url).pathname.startsWith("/api/"))
      return env.ASSETS.fetch(request);
    const requestId = crypto.randomUUID();
    try {
      return await api(request, env);
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
      return reply({ error: message, requestId }, status);
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
