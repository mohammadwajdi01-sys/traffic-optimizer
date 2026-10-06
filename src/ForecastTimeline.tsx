import type { Analysis, Candidate } from "../shared/types";
import { isArrival, isWindowPlan, selectedWindow } from "../shared/windows";
import { clock, dateLabel } from "../shared/time";
import { en, ar } from "./i18n";

export function ForecastTimeline({analysis, selected, onSelect, locale}: {analysis: Analysis; selected: Candidate | null; onSelect: (c: Candidate) => void; locale: "en" | "ar"}) {
  if (!isWindowPlan(analysis.plan)) return null;
  const t = locale === "ar" ? ar : en, p = analysis.plan, [start, end] = selectedWindow(p);
  const at = (c: Candidate) => Date.parse(isArrival(p) ? c.arrivalAt : c.departureAt);
  const samples = analysis.samples.filter(c => at(c) >= start && at(c) <= end).sort((a,b) => at(a)-at(b));
  const max = Math.max(10, ...samples.map(c => Math.ceil(c.durationSeconds / 300) * 5)) + 5;
  const x = (ms: number) => 58 + (ms-start)/(end-start)*572;
  const y = (c: Candidate) => 220 - c.durationSeconds / 60 / max * 172;
  const missing = (analysis.failedDepartures?.length ?? 0) > 0;
  const readable = (c: Candidate) => `${t.departure} ${clock(c.departureAt,p.timezone,locale)} · ${t.duration} ${Math.round(c.durationSeconds/60)} ${t.minutes} · ${t.arrive} ${clock(c.arrivalAt,p.timezone,locale)}`;
  return <section className="forecast-timeline" aria-label={t.timeline}>
    <h3>{t.timeline}</h3>
    <p>{dateLabel(p.date,locale)}{p.endDate && p.endDate !== p.date ? ` – ${dateLabel(p.endDate,locale)}` : ""} · {p.timezone}</p>
    <svg viewBox="0 0 680 286" role="img" aria-label={`${t.timeline}: ${clock(new Date(start).toISOString(),p.timezone,locale)} – ${clock(new Date(end).toISOString(),p.timezone,locale)}. ${t.duration}`}>
      <text x="58" y="24">{t.duration} ({t.minutes})</text>
      {[0,1,2,3,4].map(i => <g key={i}><line x1="58" x2="630" y1={220-i*43} y2={220-i*43} className="chart-grid"/><text x="48" y={225-i*43} textAnchor="end">{Math.round(max*i/4)}</text></g>)}
      {!missing && samples.slice(1).map((c,i) => samples[i].provider === c.provider && <line key={c.departureAt} x1={x(at(samples[i]))} y1={y(samples[i])} x2={x(at(c))} y2={y(c)} className="chart-interpolation" />)}
      {samples.map(c => <circle key={c.departureAt} cx={x(at(c))} cy={y(c)} r={c.departureAt === selected?.departureAt ? 7 : 4} className={c.departureAt === analysis.best?.departureAt ? "chart-best" : c.feasible ? "chart-point" : "chart-outside"}><title>{readable(c)}</title></circle>)}
      {[0,1,2,3,4].map(i => <text key={i} x={x(start+(end-start)*i/4)} y="245" textAnchor={i === 0 ? "start" : i === 4 ? "end" : "middle"}>{clock(new Date(start+(end-start)*i/4).toISOString(),p.timezone,locale)}</text>)}
      <text x="344" y="277" textAnchor="middle">{isArrival(p) ? t.arrivalAxis : t.departureAxis}</text>
    </svg>
    <p className="micro-copy">{missing ? t.timelineMissing : t.timelineHelp}</p>
    <p className="micro-copy">{analysis.samples.length} {t.sampled} · {analysis.provider} · {new Date(analysis.createdAt).toLocaleString(locale)}</p>
    <label>{t.chooseSample}<select value={selected?.departureAt ?? ""} onChange={e => {const c = samples.find(c => c.departureAt === e.target.value); if(c) onSelect(c);}}>
      <option value="" disabled>{t.chooseSample}</option>
      {samples.filter(c => c.feasible).map(c => <option key={c.departureAt} value={c.departureAt}>{readable(c)}</option>)}
    </select></label>
    {selected && <p className="timeline-choice">{readable(selected)}</p>}
  </section>;
}
