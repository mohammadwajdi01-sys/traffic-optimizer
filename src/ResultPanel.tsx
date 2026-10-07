import type { Analysis, Candidate } from "../shared/types";
import { journeyKey, journeyOptions, recommendationAllowed } from "../shared/journey-options";
import { clock } from "../shared/time";
import { ar, en } from "./i18n";
import { SelectedJourney } from "./SelectedJourney";
import { ForecastTimeline } from "./ForecastTimeline";

export function ResultPanel({analysis, selected, locale, navigation, onSelect, onSave}: {
  analysis:Analysis; selected:Candidate|null; locale:"en"|"ar";navigation?:"ask"|"google"|"waze";onSelect:(c:Candidate)=>void;onSave:()=>void;
}) {
  const t=locale==="ar"?ar:en, allowed=recommendationAllowed(analysis.plan);
  const label={shortest:t.goalShortest,soonest:t.goalSoonest,latest:t.safe,start:t.boundaryStart};
  return <section className="result-panel" aria-label={t.results}>
    <div className="section-heading"><h2>{t.results}</h2><button type="button" className="button secondary" onClick={onSave}>{t.save}</button></div>
    <p className="estimate-notice" role="status">{!allowed ? t.unvalidatedRoute : analysis.samples.some(c=>c.trafficCoverage!=="available") ? t.partialCoverage : t.estimateOnly}</p>
    <p className="micro-copy">{analysis.plan.timezone} · {analysis.provider} · {t.checkedAt} {new Date(analysis.createdAt).toLocaleString(locale)}{analysis.plan.safetyBufferMinutes ? ` · ${t.buffer}: ${analysis.plan.safetyBufferMinutes} ${t.minutes}` : ""}</p>
    {selected ? <>
      <p className="goal-reason">{allowed && analysis.best && journeyKey(selected)===journeyKey(analysis.best) ? `${t.recommended} · ${analysis.plan.goal==="soonest"?t.goalSoonestHelp:t.goalShortestHelp}` : t.selected}</p>
      <SelectedJourney candidate={selected} plan={analysis.plan} locale={locale} navigation={navigation}/>
    </> : <p role="status">{allowed ? t.noFeasible : t.selectUnvalidated}</p>}
    {allowed && <div className="journey-options" role="group" aria-label={t.alternatives}>
      {journeyOptions(analysis).map(row=><button type="button" key={journeyKey(row.candidate)} aria-pressed={selected ? journeyKey(selected)===journeyKey(row.candidate) : false} onClick={()=>onSelect(row.candidate)}>
        <strong>{row.labels.map(l=>label[l]).join(" · ")}</strong>
        <span>{t.departure} {clock(row.candidate.departureAt,analysis.plan.timezone,locale)} · {Math.round(row.candidate.durationSeconds/60)} {t.minutes} · {t.arrive} {clock(row.candidate.arrivalAt,analysis.plan.timezone,locale)}</span>
      </button>)}
    </div>}
    {analysis.partial && <p role="status">{t.partialResults}</p>}
    <ForecastTimeline analysis={analysis} selected={selected} onSelect={onSelect} locale={locale}/>
  </section>;
}
