import type { Plan } from "./types";
import { localDate, localInstant } from "./time";

export const isWindowPlan = (p: Plan) => p.mode === "arrive_between" || p.mode === "leave_between";
export const isArrival = (p: Plan) => p.mode === "arrive_between" || p.mode === "arrive_by";

export function selectedWindow(p: Plan): [number, number] {
  const start = localInstant(p.date, p.earliestTime, p.timezone);
  const end = localInstant(p.endDate || p.date, p.latestTime, p.timezone);
  if (end <= start || end - start > 24 * 3600000)
    throw new Error("Choose an end after the start, with a window of at most 24 hours. Set the end date for an overnight journey.");
  if (isArrival(p) && end - p.safetyBufferMinutes * 60000 < start)
    throw new Error("The arrival window is shorter than your optional safety allowance.");
  return [start, end];
}

// Old saved routes stay usable. Converted bounds are visible and editable before analysis.
export function migratePlan(p: Plan): Plan {
  if (isWindowPlan(p)) return { ...p, endDate: p.endDate || p.date };
  let start: number, end: number;
  if (p.mode === "arrive_by") {
    end = localInstant(p.date, p.time, p.timezone);
    start = p.earliestArrival || p.preferredArrivalStart
      ? localInstant(p.date, p.earliestArrival || p.preferredArrivalStart!, p.timezone)
      : end - 60 * 60000;
  } else if (p.mode === "leave_around") {
    const target = localInstant(p.date, p.time, p.timezone);
    start = target - p.flexibilityMinutes * 60000;
    end = target + p.flexibilityMinutes * 60000;
  } else {
    start = localInstant(p.date, p.earliestTime, p.timezone);
    end = localInstant(p.endDate || p.date, p.latestTime, p.timezone);
  }
  const hm = (ms: number) => new Intl.DateTimeFormat("en-GB", {timeZone: p.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23"}).format(ms);
  return {...p, mode: p.mode === "arrive_by" ? "arrive_between" : "leave_between", date: localDate(start, p.timezone), endDate: localDate(end, p.timezone), earliestTime: hm(start), latestTime: hm(end)};
}

export function recurringPlan(plan: Plan, date: string): Plan {
  const p = migratePlan(plan);
  const days = Math.round((Date.parse((p.endDate || p.date) + "T12:00Z") - Date.parse(p.date + "T12:00Z")) / 86400000);
  const endDate = new Date(Date.parse(date + "T12:00Z") + days * 86400000).toISOString().slice(0,10);
  return {...p, date, endDate};
}
