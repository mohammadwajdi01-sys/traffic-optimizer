import { describe, it, expect } from "vitest";
import {
  feasible,
  optimize,
  score,
  summarize,
  windowFor,
} from "../shared/optimizer";
import { localInstant, addDays } from "../shared/time";
import { defaultPlan, demoForecast } from "../shared/demo";
import { normalizeGoogle, normalizeMapbox } from "../worker/providers";
import { planSchema } from "../shared/schema";
import type { Candidate, Plan } from "../shared/types";
const p: Plan = { ...defaultPlan(), date: "2026-10-06", time: "09:00" };
const now = localInstant(p.date, "04:00", p.timezone);
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
