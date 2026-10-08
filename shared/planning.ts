import type { Plan } from "./types";
import { windowFor } from "./optimizer";
import { addDays, localInstant } from "./time";
import { isWindowPlan } from "./windows";

export function liveWindow(p: Plan, now = Date.now()) {
  const window = windowFor(p, now);
  const target = isWindowPlan(p) ? window[1] : localInstant(
    p.date,
    p.mode === "avoid_traffic" ? p.latestTime : p.time,
    p.timezone,
  );
  if (Math.max(target, window[1]) > now + 7 * 86400000)
    throw new Error("Plan a journey within the next seven days.");
  return window;
}

// Keep all seven date positions, including unavailable dates, for the weekly grid.
export function weeklyPlans(p: Plan, now = Date.now(), weekdays: readonly number[] = [0, 1, 2, 3, 4, 5, 6]): (Plan | null)[] {
  return Array.from({ length: 7 }, (_, i) => {
    const day = { ...p, date: addDays(p.date, i), endDate: p.endDate ? addDays(p.endDate, i) : undefined };
    if (!weekdays.includes(new Date(`${day.date}T12:00:00Z`).getUTCDay())) return null;
    try {
      if (!p.demo) liveWindow(day, now);
      return day;
    } catch {
      return null;
    }
  });
}
