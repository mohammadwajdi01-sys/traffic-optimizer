import type { Plan, SavedRoute } from "./types";
import { addDays, localDate } from "./time";
import { recurringPlan, selectedWindow } from "./windows";

// Prefer a still-open occurrence today (or last night's overnight window).
// Otherwise use the next selected weekday; never silently default to tomorrow.
export function nextSavedPlan(route: SavedRoute, now = Date.now()): Plan {
  const today = localDate(now, route.plan.timezone);
  for (let offset = -1; offset <= 7; offset++) {
    const date = addDays(today, offset);
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (route.days.length && !route.days.includes(weekday)) continue;
    const p = recurringPlan(route.plan, date);
    try {
      if (selectedWindow(p)[1] > now) return p;
    } catch {
      // A nonexistent daylight-saving time can make one occurrence unusable.
    }
  }
  throw new Error("No usable saved window. Review the route's dates and times.");
}
