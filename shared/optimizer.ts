import type { Analysis, Candidate, Plan } from "./types";
import { iso, localInstant } from "./time";
import { isArrival, isWindowPlan, selectedWindow } from "./windows";
import { optimizeWindow } from "./window-optimizer";
export type Forecast = (departureAt: string) => Promise<Candidate>;
export function windowFor(p: Plan, now = Date.now()): [number, number] {
  if (isWindowPlan(p)) {
    const [start, end] = selectedWindow(p);
    if (end < now) throw new Error("This travel window has passed. Choose a later time or date.");
    return [Math.max(start, Math.ceil(now / 60000) * 60000), end];
  }
  const target = localInstant(p.date, p.time, p.timezone);
  let start: number, end: number;
  if (p.mode === "arrive_by") {
    end = target - p.safetyBufferMinutes * 60000;
    start = end - p.maxEarlinessMinutes * 60000;
  } else if (p.mode === "leave_around") {
    start = target - p.flexibilityMinutes * 60000;
    end = target + p.flexibilityMinutes * 60000;
  } else {
    start = localInstant(p.date, p.earliestTime, p.timezone);
    end = localInstant(p.date, p.latestTime, p.timezone);
  }
  if (end - start > 6 * 3600000 || end <= start)
    throw new Error("Choose a travel window between 5 minutes and 6 hours.");
  start = Math.max(start, Math.ceil(now / 300000) * 300000);
  end = Math.floor(end / 300000) * 300000;
  if (end < start)
    throw new Error(
      "This travel window has passed. Choose a later time or date.",
    );
  return [start, end];
}
export function feasible(c: Candidate, p: Plan): boolean {
  const a = Date.parse(c.arrivalAt);
  if (isWindowPlan(p)) {
    const [start, end] = selectedWindow(p);
    const t = isArrival(p) ? a : Date.parse(c.departureAt);
    return t >= start && t <= end - (isArrival(p) ? p.safetyBufferMinutes * 60000 : 0);
  }
  if (
    p.mode === "arrive_by" &&
    a > localInstant(p.date, p.time, p.timezone) - p.safetyBufferMinutes * 60000
  )
    return false;
  if (
    p.earliestArrival &&
    a < localInstant(p.date, p.earliestArrival, p.timezone)
  )
    return false;
  return true;
}
export function score(c: Candidate, p: Plan): number {
  if (!feasible(c, p)) return Infinity;
  if (isWindowPlan(p)) return c.durationSeconds / 60;
  const duration = c.durationSeconds / 60,
    departure = Date.parse(c.departureAt),
    arrival = Date.parse(c.arrivalAt),
    target = localInstant(p.date, p.time, p.timezone);
  const congestion =
    c.staticDurationSeconds === undefined
      ? 0
      : Math.max(0, duration - c.staticDurationSeconds / 60);
  const early =
    isArrival(p)
      ? Math.max(
          0,
          ((p.preferredArrivalStart
            ? localInstant(p.date, p.preferredArrivalStart, p.timezone)
            : target - 60 * 60000) -
            arrival) /
            60000,
        )
      : 0;
  const earlyPenalty =
    early <= 60 ? early * 0.12 : 7.2 + (early - 60) ** 2 / 100;
  const deviation =
    p.mode === "leave_around"
      ? (Math.abs(departure - target) / 60000) * 0.18
      : 0;
  const slack =
    p.mode === "arrive_by"
      ? (target - arrival) / 60000 - p.safetyBufferMinutes
      : 60;
  return (
    duration +
    0.3 * congestion +
    earlyPenalty +
    deviation +
    Math.max(0, 10 - slack) * 0.25
  );
}
export function summarize(
  samples: Candidate[],
  p: Plan,
): Pick<Analysis, "best" | "lowest" | "latest" | "avoid" | "lowestMetric"> {
  const valid = samples.filter((c) => feasible(c, p));
  const byScore = [...valid].sort(
    (a, b) =>
      score(a, p) - score(b, p) ||
      Date.parse(b.departureAt) - Date.parse(a.departureAt),
  );
  const congestion =
    valid.length > 0 &&
    valid.every((c) => c.staticDurationSeconds !== undefined);
  const metric = (c: Candidate) =>
    congestion
      ? Math.max(0, c.durationSeconds - c.staticDurationSeconds!)
      : c.durationSeconds;
  const low = [...valid].sort(
    (a, b) => metric(a) - metric(b) || score(a, p) - score(b, p),
  );
  const latest =
    isArrival(p)
      ? ([...valid].sort(
          (a, b) => Date.parse(b.departureAt) - Date.parse(a.departureAt),
        )[0] ?? null)
      : null;
  const compared = isWindowPlan(p) ? valid : samples;
  const baseline = Math.min(...compared.map((c) => c.durationSeconds));
  const bad = compared
    .filter(
      (c) =>
        c.durationSeconds >= baseline * 1.3 &&
        c.durationSeconds - baseline >= 300,
    )
    .sort((a, b) => Date.parse(a.departureAt) - Date.parse(b.departureAt));
  const avoid: Analysis["avoid"] = [];
  for (const c of bad) {
    const prev = avoid.at(-1);
    if (
      prev &&
      Date.parse(c.departureAt) - Date.parse(prev.end) <= 30 * 60000
    ) {
      prev.end = c.departureAt;
      prev.peakMinutes = Math.max(
        prev.peakMinutes,
        Math.round(c.durationSeconds / 60),
      );
    } else
      avoid.push({
        start: c.departureAt,
        end: c.departureAt,
        peakMinutes: Math.round(c.durationSeconds / 60),
      });
  }
  return {
    best: byScore[0] ?? null,
    lowest: low[0] ?? null,
    latest,
    avoid,
    lowestMetric: congestion ? "congestion" : "duration",
  };
}
export async function optimize(
  p: Plan,
  forecast: Forecast,
  options: { maxCalls?: number; now?: number } = {},
): Promise<Analysis> {
  if (isWindowPlan(p)) return optimizeWindow(p, forecast, options);
  const max = options.maxCalls ?? 24,
    now = options.now ?? Date.now(),
    [start, end] = windowFor(p, now),
    cache = new Map<number, Candidate>();
  let calls = 0,
    partial = false;
  const warnings: string[] = [];
  async function sample(t: number) {
    t = Math.round(t / 300000) * 300000;
    if (t < start || t > end || cache.has(t) || calls >= max) return;
    calls++;
    try {
      const c = await forecast(iso(t));
      if (
        !Number.isFinite(c.durationSeconds) ||
        c.durationSeconds <= 0 ||
        !Number.isFinite(c.distanceMeters)
      )
        throw new Error("Invalid forecast");
      cache.set(t, {
        ...c,
        departureAt: iso(t),
        arrivalAt: iso(t + c.durationSeconds * 1000),
        feasible: feasible(
          { ...c, arrivalAt: iso(t + c.durationSeconds * 1000) },
          p,
        ),
        score: Number.isFinite(score(c, p)) ? score(c, p) : undefined,
      });
    } catch {
      partial = true;
    }
  }
  await sample(start);
  for (let t = Math.ceil(start / 1800000) * 1800000; t <= end; t += 1800000)
    await sample(t);
  await sample(end);
  // Refine distinct decisions and the largest observed change; deduplication makes every call useful.
  for (const step of [600000, 300000]) {
    const list = [...cache.values()].sort(
      (a, b) => Date.parse(a.departureAt) - Date.parse(b.departureAt),
    );
    const s = summarize(list, p);
    let ramp: number | undefined,
      maxChange = 0;
    for (let i = 1; i < list.length; i++) {
      const change = Math.abs(
        list[i].durationSeconds - list[i - 1].durationSeconds,
      );
      if (change > maxChange) {
        maxChange = change;
        ramp =
          (Date.parse(list[i].departureAt) +
            Date.parse(list[i - 1].departureAt)) /
          2;
      }
    }
    const points = [s.best, s.latest, s.lowest]
      .filter(Boolean)
      .map((c) => Date.parse(c!.departureAt));
    if (ramp !== undefined) points.push(ramp);
    // No tested feasible point: refine the shortest point rather than claim an impossible deadline too early.
    if (!points.length && list.length)
      points.push(
        Date.parse(
          [...list].sort((a, b) => a.durationSeconds - b.durationSeconds)[0]
            .departureAt,
        ),
      );
    for (const t of new Set(points))
      for (const delta of [-step, step, -2 * step, 2 * step])
        await sample(t + delta);
  }
  const samples = [...cache.values()].sort(
    (a, b) => Date.parse(a.departureAt) - Date.parse(b.departureAt),
  );
  if (!samples.length)
    throw new Error(
      "No route forecasts are available. Check provider setup, coverage, or usage limits.",
    );
  const result = summarize(samples, p);
  if (calls >= max) {
    partial = true;
    warnings.push(
      "Request budget reached. These are the best options among tested departures.",
    );
  }
  if (partial && !warnings.length)
    warnings.push(
      "Some forecasts were unavailable. Results cover the tested departures only.",
    );
  if (!result.best)
    warnings.push(
      "No tested departure meets your arrival constraints. Increase the window or reduce the buffer.",
    );
  const providers = new Set(samples.map((s) => s.provider));
  if (providers.size > 1)
    warnings.push(
      "Providers returned different route estimates. Compare these as separate journey options.",
    );
  if (result.lowestMetric === "duration")
    warnings.push(
      "A no-traffic baseline is unavailable. Minimum driving time is shown instead of a congestion claim.",
    );
  if (samples.some((s) => s.trafficCoverage === "unknown"))
    warnings.push("Traffic coverage is unconfirmed for part of this journey.");
  return {
    id: crypto.randomUUID(),
    plan: p,
    samples,
    ...result,
    provider: [...providers].join(", "),
    quality: "limited",
    partial,
    calls,
    createdAt: iso(now),
    warnings,
  };
}
