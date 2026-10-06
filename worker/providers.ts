import type { Candidate, Location, Plan } from "../shared/types";
import { ApiError, budget, type Env } from "./env";
export async function remote(url: string, init?: RequestInit): Promise<any> {
  const r = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(12000),
    redirect: "manual",
  });
  if (!r.ok)
    throw new ApiError(
      502,
      "The location or traffic provider could not complete this request.",
    );
  return r.json();
}
export function normalizeGeoapify(res: any): Location[] {
  return res.features?.map((f: any) => ({
    // Routing uses coordinates; unused opaque provider IDs can exceed our ID limit.
    displayName: f.properties.formatted,
    latitude: f.properties.lat,
    longitude: f.properties.lon,
    countryCode: f.properties.country_code?.toUpperCase(),
    timezone: f.properties.timezone?.name,
    source: "geoapify",
  })) ?? [];
}
export function normalizeMapbox(route: any, departureAt: string): Candidate {
  if (!route || typeof route.duration !== "number" || route.duration <= 0)
    throw new ApiError(502, "No road route found.");
  const annotations =
    route.legs?.flatMap((l: any) => l.annotation?.congestion ?? []) ?? [];
  return {
    departureAt,
    arrivalAt: new Date(
      Date.parse(departureAt) + route.duration * 1000,
    ).toISOString(),
    durationSeconds: route.duration,
    typicalDurationSeconds: route.duration_typical,
    distanceMeters: route.distance,
    provider: "mapbox",
    geometry: route.geometry,
    trafficCoverage: annotations.some((c: string) => c !== "unknown")
      ? "available"
      : "unknown",
  };
}
export function normalizeGoogle(route: any, departureAt: string): Candidate {
  const seconds = Number.parseFloat(route?.duration);
  if (!Number.isFinite(seconds) || seconds <= 0)
    throw new ApiError(502, "No road route found.");
  const staticSeconds = Number.parseFloat(route.staticDuration);
  // No Google geometry is requested or returned: Google forecasts are rendered without a Mapbox map.
  return {
    departureAt,
    arrivalAt: new Date(Date.parse(departureAt) + seconds * 1000).toISOString(),
    durationSeconds: seconds,
    staticDurationSeconds: Number.isFinite(staticSeconds)
      ? staticSeconds
      : undefined,
    distanceMeters: route.distanceMeters,
    provider: "google",
    trafficCoverage: "unknown",
  };
}
async function mapbox(env: Env, p: Plan, departureAt: string) {
  if (!env.MAPBOX_SERVER_TOKEN)
    throw new ApiError(503, "Traffic forecasting is not configured yet.");
  await budget(env, "/reserve", { provider: "mapbox" });
  const coords = `${p.origin.longitude},${p.origin.latitude};${p.destination.longitude},${p.destination.latitude}`;
  const q = new URLSearchParams({
    access_token: env.MAPBOX_SERVER_TOKEN,
    depart_at: departureAt,
    geometries: "geojson",
    overview: "full",
    annotations: "congestion",
    steps: "false",
  });
  const res = await remote(
    `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${coords}?${q}`,
  );
  return normalizeMapbox(res.routes?.[0], departureAt);
}
async function google(env: Env, p: Plan, departureAt: string) {
  if (env.GOOGLE_ENABLED !== "true" || !env.GOOGLE_ROUTES_API_KEY)
    throw new ApiError(503, "Google fallback is not enabled.");
  await budget(env, "/reserve", { provider: "google" });
  const point = (l: Plan["origin"]) => ({
    location: { latLng: { latitude: l.latitude, longitude: l.longitude } },
  });
  const res = await remote(
    "https://routes.googleapis.com/directions/v2:computeRoutes",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": env.GOOGLE_ROUTES_API_KEY,
        "X-Goog-FieldMask":
          "routes.duration,routes.staticDuration,routes.distanceMeters",
      },
      body: JSON.stringify({
        origin: point(p.origin),
        destination: point(p.destination),
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_AWARE_OPTIMAL",
        departureTime: departureAt,
      }),
    },
  );
  return normalizeGoogle(res.routes?.[0], departureAt);
}
export async function createForecast(
  env: Env,
  p: Plan,
  allowFallback: boolean,
) {
  const config = await budget(env, "/config");
  let provider = config.countries[p.origin.countryCode ?? ""] ?? "mapbox";
  // Switch once per analysis after a provider error; never spend two calls for every candidate.
  let fallbackUsed = false;
  return async (time: string) => {
    try {
      return provider === "google"
        ? await google(env, p, time)
        : await mapbox(env, p, time);
    } catch (e) {
      if (
        provider === "mapbox" &&
        allowFallback &&
        !fallbackUsed &&
        config.providers.google.enabled &&
        env.GOOGLE_ENABLED === "true"
      ) {
        provider = "google";
        fallbackUsed = true;
        return google(env, p, time);
      }
      throw e;
    }
  };
}
