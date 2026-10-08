import { liveWindow, weeklyPlans } from "../shared/planning";
import { db } from "../worker/database";
import type { Env } from "../worker/env";
import { forecastWarning } from "../src/i18n";
import { describe, it, expect, vi } from "vitest";
import {
  feasible,
  optimize,
  score,
  summarize,
  windowFor,
} from "../shared/optimizer";
import { localInstant, addDays } from "../shared/time";
import { defaultPlan, demoForecast } from "../shared/demo";
import { normalizeGeoapify, normalizeGoogle, normalizeMapbox } from "../worker/providers";
import { planSchema } from "../shared/schema";
import type { Candidate, Plan } from "../shared/types";
const p: Plan = { ...defaultPlan(), mode: "arrive_by", safetyBufferMinutes: 10, date: "2026-10-06", time: "09:00" };
const now = localInstant(p.date, "04:00", p.timezone);
it("preserves provider seconds and distinguishes partial segment coverage from full coverage",()=>{
  const at="2026-10-07T05:00:00Z";
  const c=normalizeMapbox({duration:75,distance:900,legs:[{annotation:{congestion:["low","unknown","severe"]}}]},at);
  expect(c.durationSeconds).toBe(75);expect(c.arrivalAt).toBe("2026-10-07T05:01:15.000Z");
  expect(c.trafficCoverage).toBe("partial");expect(c.trafficSegments).toEqual({known:2,total:3});
  expect(normalizeMapbox({duration:75,distance:900,legs:[{annotation:{congestion:["low","moderate"]}}]},at).trafficCoverage).toBe("available");
  for(const duration of [NaN,Infinity,0,-1]) expect(()=>normalizeMapbox({duration,distance:1},at)).toThrow();
});
it("allows provider search results with long opaque place IDs to be planned", () => {
  const [origin] = normalizeGeoapify({features: [{properties: {
    place_id: "a".repeat(2048), formatted: "Public Amman landmark",
    lat: 31.95, lon: 35.91, country_code: "jo", timezone: {name: "Asia/Amman"},
  }}]});
  expect(planSchema.safeParse({...p, origin}).success).toBe(true);
  expect(origin).toMatchObject({latitude: 31.95, longitude: 35.91, countryCode: "JO", source: "geoapify"});
  expect(origin.id).toBeUndefined();
});
function candidate(
  time: string,
  minutes: number,
  overrides: Partial<Candidate> = {},
): Candidate {
  const departureAt = new Date(
    localInstant(p.date, time, p.timezone),
  ).toISOString();
  return {
    departureAt,
    arrivalAt: new Date(
      Date.parse(departureAt) + minutes * 60000,
    ).toISOString(),
    durationSeconds: minutes * 60,
    distanceMeters: 15000,
    provider: "mapbox",
    trafficCoverage: "available",
    ...overrides,
  };
}
describe("Arrival decisions", () => {
  it("never selects a departure arriving after the deadline minus the buffer", () => {
    const late = candidate("08:30", 35),
      onTime = candidate("08:00", 35);
    expect(feasible(late, p)).toBe(false);
    expect(score(late, p)).toBe(Infinity);
    expect(summarize([late, onTime], p).best).toEqual(onTime);
  });
  it("treats the deadline minus buffer as an inclusive boundary", () =>
    expect(feasible(candidate("08:20", 30), p)).toBe(true));
  it("does not give a later latest-tested departure when the safety buffer increases", () => {
    const samples = [
      candidate("07:50", 30),
      candidate("08:10", 30),
      candidate("08:20", 30),
      candidate("08:30", 30),
    ];
    for (let a = 0; a <= 40; a += 5) {
      const x = summarize(samples, { ...p, safetyBufferMinutes: a }).latest,
        y = summarize(samples, { ...p, safetyBufferMinutes: a + 5 }).latest;
      if (x && y)
        expect(Date.parse(y.departureAt)).toBeLessThanOrEqual(
          Date.parse(x.departureAt),
        );
    }
  });
  it("rejects arrival before the earliest acceptable time", () =>
    expect(
      feasible(candidate("06:00", 20), { ...p, earliestArrival: "07:00" }),
    ).toBe(false));
  it("does not leave three hours earlier for a tiny driving-time saving", () =>
    expect(score(candidate("06:00", 21), p)).toBeGreaterThan(
      score(candidate("08:15", 23), p),
    ));
  it("returns explicit null recommendations when no sample is feasible", () => {
    const s = summarize([candidate("08:45", 20)], p);
    expect(s.best).toBeNull();
    expect(s.latest).toBeNull();
  });
  it("does not create a latest-on-time label without an arrival deadline", () =>
    expect(
      summarize([candidate("08:00", 30)], { ...p, mode: "leave_around" })
        .latest,
    ).toBeNull());
});
describe("Adaptive sampling", () => {
  it("enforces the request budget and does not repeat a sampled departure", async () => {
    const queried: string[] = [];
    const a = await optimize(
      p,
      async (time) => {
        queried.push(time);
        return demoForecast(p, time);
      },
      { maxCalls: 18, now },
    );
    expect(queried.length).toBeLessThanOrEqual(18);
    expect(new Set(queried).size).toBe(queried.length);
    expect(a.samples.length).toBeGreaterThan(5);
    expect(a.best).not.toBeNull();
  });
  it("keeps every actual provider departure at five-minute resolution", async () => {
    const a = await optimize(p, (time) => demoForecast(p, time), { now });
    for (const c of a.samples)
      expect(Date.parse(c.departureAt) % 300000).toBe(0);
  });
  it("can return partial useful results after provider failures", async () => {
    let i = 0;
    const a = await optimize(
      p,
      (time) =>
        ++i % 3 === 0
          ? Promise.reject(new Error("provider"))
          : demoForecast(p, time),
      { now },
    );
    expect(a.partial).toBe(true);
    expect(a.best).not.toBeNull();
  });
  it("reports no data when all provider calls fail", async () => {
    await expect(
      optimize(p, () => Promise.reject(new Error("outage")), { now }),
    ).rejects.toThrow("No route forecasts");
  });
  it("rejects past and reversed windows", () => {
    expect(() =>
      windowFor(p, localInstant(p.date, "11:00", p.timezone)),
    ).toThrow("passed");
    expect(() =>
      windowFor(
        {
          ...p,
          mode: "avoid_traffic",
          earliestTime: "11:00",
          latestTime: "07:00",
        },
        now,
      ),
    ).toThrow();
  });
  it("rejects more than six hours of exploration", () =>
    expect(() =>
      windowFor(
        {
          ...p,
          mode: "avoid_traffic",
          earliestTime: "01:00",
          latestTime: "20:00",
        },
        now,
      ),
    ).toThrow());
});
describe("Provider normalization and honest metrics", () => {
  it("does not mislabel Mapbox typical traffic as a no-traffic baseline", () => {
    const c = normalizeMapbox(
      { duration: 1800, duration_typical: 1500, distance: 20000, legs: [] },
      candidate("08:00", 30).departureAt,
    );
    expect(c.staticDurationSeconds).toBeUndefined();
    expect(c.typicalDurationSeconds).toBe(1500);
    expect(summarize([c], p).lowestMetric).toBe("duration");
  });
  it("accepts Google static duration but does not return Google route geometry", () => {
    const c = normalizeGoogle(
      {
        duration: "1800s",
        staticDuration: "1200s",
        distanceMeters: 15000,
        polyline: { encodedPolyline: "not-used" },
      },
      candidate("08:00", 30).departureAt,
    );
    expect(c.staticDurationSeconds).toBe(1200);
    expect(c.geometry).toBeUndefined();
    expect(summarize([c], p).lowestMetric).toBe("congestion");
  });
  it("rejects malformed provider route durations", () =>
    expect(() =>
      normalizeGoogle({ duration: "broken" }, new Date(now).toISOString()),
    ).toThrow());
});
describe("Timezone and input validation", () => {
  it("uses Amman local time rather than browser timezone", () =>
    expect(
      new Date(localInstant("2026-10-06", "09:00", "Asia/Amman")).toISOString(),
    ).toBe("2026-10-06T06:00:00.000Z"));
  it("rejects nonexistent and ambiguous daylight-saving local times", () => {
    expect(() =>
      localInstant("2026-03-08", "02:30", "America/New_York"),
    ).toThrow();
    expect(() =>
      localInstant("2026-11-01", "01:30", "America/New_York"),
    ).toThrow();
  });
  it("handles month boundaries", () =>
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01"));
  it("rejects invalid coordinates, wrong origin timezone, and identical points", () => {
    expect(
      planSchema.safeParse({ ...p, origin: { ...p.origin, latitude: 100 } })
        .success,
    ).toBe(false);
    expect(planSchema.safeParse({ ...p, timezone: "UTC" }).success).toBe(false);
    expect(planSchema.safeParse({ ...p, destination: p.origin }).success).toBe(
      false,
    );
  });
});

describe("Live weekly horizon", () => {
  it("preserves seven positions while skipping the seventh date beyond the horizon", () => {
    const days = weeklyPlans({ ...p, date: addDays(p.date, 1) }, now);
    expect(days).toHaveLength(7);
    expect(days.filter(Boolean)).toHaveLength(6);
    expect(days[6]).toBeNull();
  });
  it("rejects a departure window extending beyond seven days even if its center is valid", () => {
    const boundary = localInstant(p.date, "09:00", p.timezone);
    expect(() =>
      liveWindow(
        {
          ...p,
          date: addDays(p.date, 7),
          mode: "leave_around",
          flexibilityMinutes: 30,
        },
        boundary,
      ),
    ).toThrow("seven days");
  });
  it("uses the actual avoid-traffic window rather than an unrelated arrival time", () => {
    const boundary = localInstant(p.date, "09:00", p.timezone);
    expect(() =>
      liveWindow(
        {
          ...p,
          date: addDays(p.date, 7),
          mode: "avoid_traffic",
          time: "01:00",
          earliestTime: "08:00",
          latestTime: "10:00",
        },
        boundary,
      ),
    ).toThrow("seven days");
  });
  it("keeps synthetic examples available for all seven dates", () => {
    expect(
      weeklyPlans({ ...p, date: addDays(p.date, 30), demo: true }, now).filter(
        Boolean,
      ),
    ).toHaveLength(7);
  });
});

describe("Server database key compatibility", () => {
  const env = {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  } as Env;
  it.each([
    [
      { SUPABASE_SECRET_KEY: "sb_secret_modern" },
      "sb_secret_modern",
      undefined,
    ],
    [
      { SUPABASE_SERVICE_ROLE_KEY: "sb_secret_alias" },
      "sb_secret_alias",
      undefined,
    ],
    [
      { SUPABASE_SERVICE_ROLE_KEY: "eyJlegacy.jwt.signature" },
      "eyJlegacy.jwt.signature",
      "Bearer eyJlegacy.jwt.signature",
    ],
  ])(
    "authorizes modern and legacy keys without confusing their formats",
    async (binding, key, bearer) => {
      const request = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(Response.json([]));
      try {
        await db({ ...env, ...binding }, "profiles", { service: true });
        const headers = request.mock.calls[0][1]!.headers as Record<
          string,
          string
        >;
        expect(headers.apikey).toBe(key);
        expect(headers.Authorization).toBe(bearer);
      } finally {
        request.mockRestore();
      }
    },
  );
  it("fails closed without a server key", async () => {
    const request = vi.spyOn(globalThis, "fetch");
    try {
      await expect(
        db(env, "profiles", { service: true }),
      ).rejects.toMatchObject({ status: 503 });
      expect(request).not.toHaveBeenCalled();
    } finally {
      request.mockRestore();
    }
  });
});

describe("Arabic forecast limitations", () => {
  it("keeps coverage and sampling warnings distinct and preserves an unknown warning", () => {
    const coverage = forecastWarning(
      "Traffic coverage is unconfirmed for part of this journey.",
      "ar",
    );
    const quota = forecastWarning(
      "Request budget reached. These are the best options among tested departures.",
      "ar",
    );
    expect(coverage).toContain("تغطية");
    expect(quota).toContain("الطلبات");
    expect(coverage).not.toEqual(quota);
    expect(forecastWarning("New provider warning", "ar")).toBe(
      "New provider warning",
    );
  });
});


describe("Country-scoped location search", () => {
  it("enforces a real country filter and preserves precise zero coordinates", async () => {
    const {locationQuery,locationSearchSchema,countryCodes} = await import("../shared/location-search");
    expect(new Set(countryCodes).size).toBe(249);
    const search = locationQuery("/api/location/suggest",locationSearchSchema.parse({text:"Main street",countryCode:"jo",latitude:0,longitude:0}));
    expect(search.query.get("filter")).toBe("countrycode:jo");
    expect(search.query.get("bias")).toBe("proximity:0,0");
    expect(search.endpoint).toBe("autocomplete");
  });
  it("uses an explicit country before network fallback and never silently searches worldwide", async () => {
    const {locationQuery,locationSearchSchema} = await import("../shared/location-search");
    expect(locationQuery("/api/location/suggest",locationSearchSchema.parse({text:"Museum"}),"LY").query.get("filter")).toBe("countrycode:ly");
    expect(locationQuery("/api/location/suggest",locationSearchSchema.parse({text:"Museum",countryCode:"SA"}),"JO").query.get("bias")).toBe("countrycode:sa");
    expect(() => locationQuery("/api/location/suggest",locationSearchSchema.parse({text:"Museum"}),"XX")).toThrow("Choose your search country");
    expect(() => locationSearchSchema.parse({text:"Museum",countryCode:"XX"})).toThrow();
    expect(() => locationSearchSchema.parse({text:"Museum",latitude:0})).toThrow();
    expect(() => locationSearchSchema.parse({text:"Museum",latitude:Infinity,longitude:0})).toThrow();
  });
  it("reverse geocodes GPS without filtering it to a stale manually selected country", async () => {
    const {locationQuery,locationSearchSchema} = await import("../shared/location-search");
    const search = locationQuery("/api/location/reverse",locationSearchSchema.parse({latitude:31.95,longitude:35.91,countryCode:"LY",language:"ar"}));
    expect(search.query.get("filter")).toBeNull();
    expect(search.country).toBeUndefined();
    expect(search.query.get("lang")).toBe("ar");
    expect(() => locationQuery("/api/location/unrecognized",locationSearchSchema.parse({}))).toThrow();
  });
});

describe('selected reminder timing and bounded retries',()=>{
 it('schedules lead times without changing departure, including a future date across midnight',async()=>{
  const {reminderTiming,retryAt}=await import('../shared/reminders');
  const now=Date.parse('2026-10-08T20:00Z'),departureAt='2026-10-08T22:15:00.000Z';
  expect(reminderTiming({departureAt},20,now)).toEqual({dueAt:'2026-10-08T21:55:00.000Z',expiresAt:departureAt});
  expect(()=>reminderTiming({departureAt},5,now)).toThrow();
  expect(()=>reminderTiming({departureAt},20,Date.parse(departureAt))).toThrow();
  expect(retryAt(1,now,'2026-10-08T22:00Z')).toBe('2026-10-08T20:05:00.000Z');
  expect(retryAt(3,now,'2026-10-08T22:00Z')).toBeNull();
  expect(retryAt(1,now,'2026-10-08T20:02Z')).toBeNull();
 });
});

it('rejects non-push endpoints, credentials and alternate ports before delivery',async()=>{
 const {pushEndpointAllowed}=await import('../shared/reminders');
 expect(pushEndpointAllowed('https://fcm.googleapis.com/push')).toBe(true);
 for(const url of ['http://fcm.googleapis.com/push','https://fcm.googleapis.com.evil.test/push','https://user:pass@fcm.googleapis.com/push','https://fcm.googleapis.com:8443/push','https://127.0.0.1/push'])expect(pushEndpointAllowed(url)).toBe(false);
});
