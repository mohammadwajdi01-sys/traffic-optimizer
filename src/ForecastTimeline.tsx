import type { Analysis, Candidate } from "../shared/types";
import { isArrival, isWindowPlan, selectedWindow } from "../shared/windows";
import { feasible } from "../shared/optimizer";
import { journeyKey, recommendationAllowed } from "../shared/journey-options";
import { clock, dateLabel, localDate } from "../shared/time";
import { en, ar } from "./i18n";

export function ForecastTimeline({analysis,selected,onSelect,locale}: {analysis:Analysis;selected:Candidate|null;onSelect:(c:Candidate)=>void;locale:"en"|"ar"}) {
  if(!isWindowPlan(analysis.plan))return null;
  const t=locale==="ar"?ar:en,p=analysis.plan,[start,end]=selectedWindow(p),arrival=isArrival(p);
  const at=(c:Candidate)=>Date.parse(arrival?c.arrivalAt:c.departureAt);
  const samples=analysis.samples.filter(c=>at(c)>=start && at(c)<=end).sort((a,b)=>at(a)-at(b));
  const max=Math.max(10,...samples.map(c=>Math.ceil(c.durationSeconds/300)*5))+5;
  const x=(ms:number)=>58+(ms-start)/(end-start)*572;
  const y=(c:Candidate)=>220-c.durationSeconds/60/max*172;
  const missing=analysis.failedDepartures??[],allowed=recommendationAllowed(p);
  const readable=(c:Candidate)=>`${t.departure} ${clock(c.departureAt,p.timezone,locale)} · ${t.duration} ${Math.round(c.durationSeconds/60)} ${t.minutes} · ${t.arrive} ${clock(c.arrivalAt,p.timezone,locale)}`;
  const timestamp=(time:string)=>`${p.endDate && p.endDate!==p.date?dateLabel(localDate(Date.parse(time),p.timezone),locale)+" · ":""}${clock(time,p.timezone,locale)}`;
  const chosen=(c:Candidate)=>selected && journeyKey(c)===journeyKey(selected);
  return <section className="forecast-timeline" aria-label={t.timeline}>
    <h3>{t.timeline}</h3><p>{dateLabel(p.date,locale)}{p.endDate && p.endDate!==p.date?` – ${dateLabel(p.endDate,locale)}`:""} · {p.timezone}</p>
    <svg viewBox="0 0 680 286" role="group" aria-label={`${t.timeline}: ${clock(new Date(start).toISOString(),p.timezone,locale)} – ${clock(new Date(end).toISOString(),p.timezone,locale)}. ${t.duration}`}>
      <text x="58" y="24">{t.duration} ({t.minutes})</text>
      {[0,1,2,3,4].map(i=><g key={i}><line x1="58" x2="630" y1={220-i*43} y2={220-i*43} className="chart-grid"/><text x="48" y={225-i*43} textAnchor="end">{Math.round(max*i/4)}</text></g>)}
      {!missing.length && samples.slice(1).map((c,i)=>samples[i].provider===c.provider && <line key={journeyKey(c)} x1={x(at(samples[i]))} y1={y(samples[i])} x2={x(at(c))} y2={y(c)} className="chart-interpolation"/>)}
      {samples.map(c=>feasible(c,p)?<g key={journeyKey(c)} className="chart-choice" role="button" tabIndex={0} aria-label={readable(c)} aria-pressed={Boolean(chosen(c))} onClick={()=>onSelect(c)} onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();onSelect(c);}}}>
        <circle cx={x(at(c))} cy={y(c)} r="15" fill="transparent"/><circle cx={x(at(c))} cy={y(c)} r={chosen(c)?8:5} className={allowed && analysis.best && journeyKey(c)===journeyKey(analysis.best)?"chart-best":"chart-point"}/><title>{readable(c)}</title>
      </g>:<circle key={journeyKey(c)} cx={x(at(c))} cy={y(c)} r="4" className="chart-outside"><title>{readable(c)} · {t.outsideBounds}</title></circle>)}
      {!arrival && missing.filter(time=>Date.parse(time)>=start && Date.parse(time)<=end).map(time=><text key={time} x={x(Date.parse(time))} y="220" className="chart-missing" textAnchor="middle">×<title>{t.notSampled} · {clock(time,p.timezone,locale)}</title></text>)}
      {[0,1,2,3,4].map(i=><text key={i} data-tick={i} x={x(start+(end-start)*i/4)} y="245" textAnchor={i===0?"start":i===4?"end":"middle"}>{clock(new Date(start+(end-start)*i/4).toISOString(),p.timezone,locale)}</text>)}
      <text x="344" y="277" textAnchor="middle">{arrival?t.arrivalAxis:t.departureAxis}</text>
    </svg>
    <p className="micro-copy">{missing.length?t.timelineMissing:t.timelineHelp}</p>
    <p className="micro-copy">{analysis.samples.length} {t.sampled} · {missing.length} {t.failedCount} · {analysis.provider} · {new Date(analysis.createdAt).toLocaleString(locale)}</p>
    {missing.length>0 && <p className="missing-checks">{t.missingChecks}: {missing.map(time=>clock(time,p.timezone,locale)).join(" · ")}{arrival?` · ${t.unknownArrival}`:""}</p>}
    <details className="timeline-table"><summary>{t.checkedTable}</summary>
      <label>{t.chooseSample}<select value={selected?journeyKey(selected):""} onChange={event=>{const candidate=analysis.samples.find(c=>journeyKey(c)===event.target.value && feasible(c,p));if(candidate)onSelect(candidate);}}><option value="" disabled>{t.chooseSample}</option>{analysis.samples.filter(c=>feasible(c,p)).map(c=><option key={journeyKey(c)} value={journeyKey(c)}>{readable(c)}</option>)}</select></label>
      <div className="table-scroll"><table><caption>{t.checkedTable}</caption><thead><tr><th>{t.departure}</th><th>{t.arrive}</th><th>{t.duration}</th><th>{t.choose}</th></tr></thead><tbody>
        {analysis.samples.map(c=><tr key={journeyKey(c)} aria-selected={Boolean(chosen(c))}><td>{timestamp(c.departureAt)}</td><td>{timestamp(c.arrivalAt)}</td><td>{Math.round(c.durationSeconds/60)} {t.minutes}</td><td><button type="button" disabled={!feasible(c,p)} aria-label={`${t.choose}: ${readable(c)}`} aria-pressed={Boolean(chosen(c))} onClick={()=>onSelect(c)}>{feasible(c,p)?t.choose:t.outsideBounds}</button></td></tr>)}
      </tbody></table></div>
    </details>
  </section>;
}
