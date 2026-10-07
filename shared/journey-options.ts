import type { Analysis, Candidate, Plan } from "./types";
import { feasible, summarize } from "./optimizer";
import { recommendationAllowed } from "./forecast-reliability";
import { isArrival } from "./windows";
export { recommendationAllowed } from "./forecast-reliability";

export const journeyKey = (c: Candidate) => `${c.provider}:${c.departureAt}`;

export function initialJourney(a: Analysis): Candidate | null {
  return recommendationAllowed(a.plan) && a.best && feasible(a.best, a.plan) ? a.best : null;
}
export function rerankAnalysis(a: Analysis, goal: Plan["goal"]): Analysis {
  const plan = {...a.plan, goal: goal ?? "shortest"};
  return {...a, plan, ...summarize(a.samples, plan)};
}
export function journeyOptions(a: Analysis) {
  const shortest = summarize(a.samples, {...a.plan, goal:"shortest"}).best;
  const soonest = summarize(a.samples, {...a.plan, goal:"soonest"}).best;
  const rows: {candidate: Candidate; labels: ("shortest"|"soonest"|"latest"|"start")[]}[] = [];
  for (const [label,candidate] of [["shortest",shortest],["soonest",soonest],["latest",a.latest],["start",isArrival(a.plan) ? a.earliest : null]] as const) {
    if (!candidate || !feasible(candidate,a.plan)) continue;
    const row = rows.find(row => journeyKey(row.candidate) === journeyKey(candidate));
    if (row) row.labels.push(label);
    else rows.push({candidate,labels:[label]});
  }
  return rows;
}
