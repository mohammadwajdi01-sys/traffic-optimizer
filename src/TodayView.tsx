import type { ReactNode } from "react";
import type { Candidate, Plan } from "../shared/types";
import { SelectedJourney } from "./SelectedJourney";
import { ar, en } from "./i18n";
import { recommendationAllowed } from "../shared/forecast-reliability";

export function TodayView({children, instant, locale, navigation, busy, online, onRefresh}: {
  children: ReactNode; instant:{candidate:Candidate;plan:Plan;checkedAt:string}|null;
  locale:"en"|"ar";navigation?:"ask"|"google"|"waze";busy:boolean;online:boolean;onRefresh:()=>void;
}) {
  const t=locale==="ar"?ar:en;
  return <div className="today-view">{children}{instant && <section className="instant-forecast" aria-label={t.leaveNow}>
    <h2>{t.leaveNow}</h2>
    <div className="notice" role="status">{!recommendationAllowed(instant.plan) ? t.unvalidatedRoute : instant.candidate.trafficCoverage === "available" ? t.estimateOnly : t.partialCoverage}</div>
    <SelectedJourney candidate={instant.candidate} plan={instant.plan} locale={locale} navigation={navigation}/>
    <p className="micro-copy">{t.checkedAt} · {new Date(instant.checkedAt).toLocaleString(locale)}</p>
    <button type="button" className="button secondary full" disabled={busy||!online} onClick={onRefresh}>{t.refreshNow}</button>
  </section>}</div>;
}
