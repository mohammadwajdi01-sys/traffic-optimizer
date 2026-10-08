import type { Analysis, Candidate, Plan } from "./types";
import { feasible, summarize } from "./optimizer";
import { recommendationAllowed } from "./forecast-reliability";
import { isArrival } from "./windows";
import { localDate } from "./time";

export function checkedWeekSamples(a: Analysis): Candidate[] {
  return recommendationAllowed(a.plan) ? a.samples.filter(c => Number.isFinite(c.durationSeconds) && c.durationSeconds > 0 && feasible(c, a.plan)) : [];
}

// Cells represent a nearby direct provider check, never an interpolated forecast.
export function nearestWeekCheck(a: Analysis | null, target: number) {
  if (!a || !Number.isFinite(target)) return null;
  const time = (c: Candidate) => Date.parse(isArrival(a.plan) ? c.arrivalAt : c.departureAt);
  const candidate = checkedWeekSamples(a).reduce<Candidate | null>((best, c) => !best || Math.abs(time(c) - target) < Math.abs(time(best) - target) ? c : best, null);
  return candidate && Math.abs(time(candidate) - target) <= 15 * 60000
    ? { candidate, checkedAt: time(candidate), approximate: time(candidate) !== target }
    : null;
}

export function durationScale(analyses: (Analysis | null)[]) {
  const seconds = analyses.flatMap(a => a ? checkedWeekSamples(a).map(c => c.durationSeconds) : []);
  return seconds.length ? {min: Math.min(...seconds), max: Math.max(...seconds)} : null;
}
export function durationLevel(seconds: number, scale: {min: number; max: number}) {
  return scale.max === scale.min ? 0 : Math.min(3, Math.floor(4 * (seconds - scale.min) / (scale.max - scale.min)));
}

// Use local wall-clock minutes relative to the occurrence's start date, including overnight.
export function occurrenceMinute(iso: string, plan: Plan) {
  const local = localDate(Date.parse(iso), plan.timezone);
  const offset = Math.round((Date.parse(`${local}T12:00Z`) - Date.parse(`${plan.date}T12:00Z`)) / 86400000);
  const parts = new Intl.DateTimeFormat("en-GB", {timeZone: plan.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23"}).formatToParts(new Date(iso));
  return offset * 1440 + Number(parts.find(p => p.type === "hour")!.value) * 60 + Number(parts.find(p => p.type === "minute")!.value);
}
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
export type WeeklyInsight = {bucket: number; days: number; checkedDays: number; medianDurationSeconds: number; medianSavingsSeconds: number; partial: boolean; goal: "shortest" | "soonest"};
export function weeklyInsight(analyses: (Analysis | null)[]): WeeklyInsight | null {
  const buckets = new Map<number, Map<string, {chosen: Candidate; baseline: Candidate; arrival: number; partial: boolean}>>();
  const checkedDates = new Set<string>();
  let goal: "shortest" | "soonest" = "shortest";
  for (const a of analyses) {
    if (!a) continue;
    const samples = checkedWeekSamples(a);
    if (!samples.length) continue;
    checkedDates.add(a.plan.date); goal = a.plan.goal ?? "shortest";
    const baseline = samples.reduce((best, c) => Date.parse(c.departureAt) < Date.parse(best.departureAt) ? c : best);
    const perDay = new Map<number, Candidate[]>();
    for (const c of samples) {
      const bucket = Math.floor(occurrenceMinute(c.departureAt, a.plan) / 15) * 15;
      const group = perDay.get(bucket) ?? []; group.push(c); perDay.set(bucket, group);
    }
    for (const [bucket, group] of perDay) {
      const chosen = summarize(group, a.plan).best;
      if (!chosen) continue;
      const days = buckets.get(bucket) ?? new Map();
      days.set(a.plan.date, {chosen, baseline, arrival: occurrenceMinute(chosen.arrivalAt, a.plan), partial: a.partial || chosen.trafficCoverage !== "available"});
      buckets.set(bucket, days);
    }
  }
  const eligible = [...buckets].filter(([, days]) => days.size >= 3).map(([bucket, days]) => {
    const values = [...days.values()];
    return {bucket, days: days.size, checkedDays: checkedDates.size, medianDurationSeconds: median(values.map(v => v.chosen.durationSeconds)), medianSavingsSeconds: median(values.map(v => v.baseline.durationSeconds - v.chosen.durationSeconds)), medianArrival: median(values.map(v => v.arrival)), partial: values.some(v => v.partial), goal};
  });
  eligible.sort((a, b) => goal === "soonest" ? a.medianArrival - b.medianArrival || a.medianDurationSeconds - b.medianDurationSeconds || a.bucket - b.bucket : a.medianDurationSeconds - b.medianDurationSeconds || b.days - a.days || b.bucket - a.bucket);
  return eligible[0] ?? null;
}
