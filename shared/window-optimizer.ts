import type { Analysis, Candidate, Plan } from "./types";
import type { Forecast } from "./optimizer";
import { feasible, summarize } from "./optimizer";
import { isArrival, selectedWindow } from "./windows";
import { iso } from "./time";
import { recommendationAllowed } from "./forecast-reliability";

export async function optimizeWindow(p: Plan, forecast: Forecast, options: {maxCalls?: number; now?: number} = {}): Promise<Analysis> {
  const max = Math.max(1, Math.min(24, options.maxCalls ?? 24)), now = options.now ?? Date.now();
  const [a, b] = selectedWindow(p), end = b - (isArrival(p) ? p.safetyBufferMinutes * 60000 : 0);
  const future = Math.ceil(now / 60000) * 60000;
  if (end < future) throw new Error("This travel window has passed. Choose a later time or date.");
  const cache = new Map<number, Candidate>(), failed = new Set<number>();
  let calls = 0;
  async function sample(t: number): Promise<Candidate | undefined> {
    t = Math.max(future, Math.round(t / 60000) * 60000);
    if (t > end) return;
    if (cache.has(t)) return cache.get(t);
    if (failed.has(t) || calls >= max) return;
    calls++;
    try {
      const raw = await forecast(iso(t));
      if (!Number.isFinite(raw.durationSeconds) || raw.durationSeconds <= 0 || !Number.isFinite(raw.distanceMeters)) throw new Error("Invalid forecast");
      const c: Candidate = {...raw, departureAt: iso(t), arrivalAt: iso(t + raw.durationSeconds * 1000)};
      c.feasible = feasible(c, p);
      c.score = c.feasible ? c.durationSeconds / 60 : undefined;
      cache.set(t, c);
      return c;
    } catch { failed.add(t); }
  }
  let start = Math.max(a, future), finish = end;
  if (isArrival(p)) {
    // A route forecast, not a fixed lookback, seeds both inverse-arrival boundaries.
    const seed = await sample(end) ?? await sample(Math.max(a, future));
    if (!seed) throw new Error("No route forecasts are available. Check provider setup, coverage, or usage limits.");
    async function boundary(target: number, lower: boolean) {
      let t = target - seed!.durationSeconds * 1000;
      const passes = max >= 12 ? 3 : 1;
      for (let i = 0; i < passes; i++) {
        t = Math.max(future, (lower ? Math.ceil(t / 60000) : Math.floor(t / 60000)) * 60000);
        const c = await sample(t);
        if (!c) break;
        const next = target - c.durationSeconds * 1000;
        if (Math.abs(next - t) < 60000) break;
        t = next;
      }
      return Math.max(future, (lower ? Math.ceil(t / 60000) : Math.floor(t / 60000)) * 60000);
    }
    start = await boundary(a, true);
    finish = await boundary(end, false);
    if (finish < start) [start, finish] = [finish, start];
  }
  // Reserve refinement calls, and always distribute coverage across the WHOLE range.
  const points = Math.max(2, Math.min(12, max - calls - (max >= 12 ? 8 : 0)));
  for (let i = 0; i < points; i++) await sample(start + (finish - start) * i / (points - 1));
  for (const step of [1, 5, 10]) {
    const valid = [...cache.values()].filter(c => c.feasible);
    const best = summarize(valid, p).best;
    const latest = summarize(valid, p).latest;
    const earliest = valid.sort((x, y) => Date.parse(x.arrivalAt) - Date.parse(y.arrivalAt))[0];
    for (const c of [best, latest, earliest]) {
      if (!c) continue;
      for (const sign of [-1, 1]) {
        const t = Date.parse(c.departureAt) + sign * step * 60000;
        if (t >= start && t <= finish) await sample(t);
      }
    }
  }
  const samples = [...cache.values()].sort((x, y) => Date.parse(x.departureAt) - Date.parse(y.departureAt));
  if (!samples.length) throw new Error("No route forecasts are available. Check provider setup, coverage, or usage limits.");
  const result = summarize(samples, p);
  const warnings = ["Adaptive scan with minute-level refinement. Only marked departures were checked directly; connecting lines are interpolation."];
  if (calls >= max) warnings.push("Request budget reached. These are the best options among tested departures.");
  if (failed.size) warnings.push("Some forecasts were unavailable. Results cover the tested departures only.");
  if (!recommendationAllowed(p)) warnings.push("Forecast accuracy for this route is unvalidated after a reported discrepancy. Automatic traffic recommendations are paused.");
  else if (!result.best) warnings.push("No tested departure meets your arrival constraints. Increase the window or reduce the buffer.");
  if (result.lowestMetric === "duration") warnings.push("A no-traffic baseline is unavailable. Minimum driving time is shown instead of a congestion claim.");
  if (samples.some(c => c.trafficCoverage !== "available")) warnings.push("Traffic coverage is unconfirmed for part of this journey.");
  const providers = [...new Set(samples.map(c => c.provider))];
  if (providers.length > 1) warnings.push("Providers returned different route estimates. Compare these as separate journey options.");
  return {id: crypto.randomUUID(), plan: p, samples, ...result, earliest: recommendationAllowed(p) ? samples.filter(c => c.feasible).sort((x,y) => Date.parse(x.arrivalAt)-Date.parse(y.arrivalAt))[0] ?? null : null, searchWindow: [iso(start),iso(finish)], failedDepartures: [...failed].map(iso), provider: providers.join(", "), quality: "limited", partial: calls >= max || failed.size > 0, calls, createdAt: iso(now), warnings};
}
