import { useState } from "react";
import type { Analysis, Candidate, Plan } from "../shared/types";
import { addDays, clock, dateLabel, localDate } from "../shared/time";
import { isArrival, selectedWindow } from "../shared/windows";
import { initialJourney, journeyKey } from "../shared/journey-options";
import { checkedWeekSamples, durationLevel, durationScale, nearestWeekCheck, weeklyInsight } from "../shared/weekly-insights";
import { ar, en } from "./i18n";
import { repeatAr, repeatEn } from "./repeat-copy";

export type WeekStatus="notSelected"|"unavailable"|"waiting"|"failed"|"checking"|"done";
export function WeekResults({analyses,statuses,plan,locale,onChoose}:{analyses:(Analysis|null)[];statuses:WeekStatus[];plan:Plan;locale:"en"|"ar";onChoose:(a:Analysis,c:Candidate)=>void}){
  const t=locale==="ar"?ar:en,c=locale==="ar"?repeatAr:repeatEn;
  const [day,setDay]=useState(0),scale=durationScale(analyses),insight=weeklyInsight(analyses);
  const windows=analyses.map(a=>{try{return a?selectedWindow(a.plan):null;}catch{return null;}}),base=windows.find(Boolean);
  const offsets:number[]=[];
  if(base){for(let n=0;n<base[1]-base[0];n+=30*60000)offsets.push(n);offsets.push(base[1]-base[0]);}
  const duration=(seconds:number)=>`${Math.round(seconds/60)} ${t.minutes}`;
  const bucketClock=(minute:number)=>{
    const offset=Math.floor(minute/1440),m=((minute%1440)+1440)%1440;
    const iso=new Date(Date.UTC(2000,0,1,Math.floor(m/60),m%60)).toISOString();
    return `${clock(iso,"UTC",locale)}${offset ? ` (${offset<0?(locale==="ar"?"اليوم السابق":"previous day"):c.nextDay})` : ""}`;
  };
  const timestamp=(iso:string)=>`${dateLabel(localDate(Date.parse(iso),plan.timezone),locale)} ${clock(iso,plan.timezone,locale)}`;
  const active=analyses[day],samples=active?checkedWeekSamples(active).sort((a,b)=>Date.parse(a.departureAt)-Date.parse(b.departureAt)):[];
  return <div className="week-grid"><section className="panel week-duration-panel"><h2>{t.heatmap}</h2><p className="micro-copy">{c.durationHelp}</p>
    <div className="week-desktop-grid"><p>{isArrival(plan)?c.axisArrival:c.axisDeparture}</p><div className="heatmap"><div/>{Array.from({length:7},(_,i)=><b key={i}>{dateLabel(addDays(plan.date,i),locale)}</b>)}
      {offsets.map(offset=><div className="heat-row" key={offset}><span>{clock(new Date(base![0]+offset).toISOString(),plan.timezone,locale)}</span>{Array.from({length:7},(_,i)=>{
        const a=analyses[i],target=windows[i]?windows[i]![0]+offset:NaN,check=nearestWeekCheck(a,target),candidate=check?.candidate;
        const actual=check?clock(new Date(check.checkedAt).toISOString(),plan.timezone,locale):"";
        const description=candidate?`${check!.approximate?c.approximate:c.exact}; ${c.checkedTime}: ${actual}; ${c.duration}: ${duration(candidate.durationSeconds)}`:c[statuses[i]??"waiting"];
        return <button key={i} disabled={!candidate} className={`heat-cell ${candidate&&scale?`duration-${durationLevel(candidate.durationSeconds,scale)}`:"unknown"}`} title={description} aria-label={`${dateLabel(addDays(plan.date,i),locale)}: ${description}`} onClick={()=>{if(a&&candidate)onChoose(a,candidate);}}>{candidate?`${check!.approximate?"≈":""}${Math.round(candidate.durationSeconds/60)}`:"—"}</button>;
      })}</div>)}
    </div></div>
    <div className="heat-legend">{scale&&<><span><i className="duration-0"/>{c.shorter}: {duration(scale.min)}</span><span><i className="duration-3"/>{c.longer}: {duration(scale.max)}</span></>}<span><i className="unknown"/>{c.unknown}</span></div>
    <div className="week-day-tabs" role="group" aria-label={c.selectedDays}>{Array.from({length:7},(_,i)=><button key={i} aria-pressed={day===i} onClick={()=>setDay(i)}>{dateLabel(addDays(plan.date,i),locale)}</button>)}</div>
    <h3>{c.checkedTable}</h3><p>{dateLabel(addDays(plan.date,day),locale)} · {c[statuses[day]??"waiting"]}</p>
    {samples.length?<div className="table-scroll"><table className="week-check-table"><caption>{c.checkedTable}</caption><thead><tr><th>{c.departure}</th><th>{c.arrival}</th><th>{c.duration}</th><th>{t.choose}</th></tr></thead><tbody>{samples.map(sample=><tr key={journeyKey(sample)}><td>{timestamp(sample.departureAt)}</td><td>{timestamp(sample.arrivalAt)}</td><td>{duration(sample.durationSeconds)}</td><td><button className="button secondary small" onClick={()=>onChoose(active!,sample)} aria-label={`${c.choose}: ${timestamp(sample.departureAt)}`}>{t.choose}</button></td></tr>)}</tbody></table></div>:<p className="empty-hint">{c.unknown}</p>}
    {active&&<p className="micro-copy">{t.checkedAt}: {clock(active.createdAt,plan.timezone,locale)} · <bdi>{active.provider}</bdi> · {active.samples.length} {t.sampled}</p>}
    <p className="micro-copy">{analyses.some(a=>a&&(a.partial||a.samples.some(sample=>sample.trafficCoverage!=="available")))?t.partialCoverage:t.estimateOnly}</p>
  </section><section className="panel"><h2>{t.weeklySummary}</h2>{Array.from({length:7},(_,i)=>{const a=analyses[i],best=a?initialJourney(a):null;return <div className="day-summary" key={i}><span>{dateLabel(addDays(plan.date,i),locale)}</span><strong>{best?clock(best.departureAt,plan.timezone,locale):"—"}</strong><small>{best?duration(best.durationSeconds):c[statuses[i]??"waiting"]}</small></div>;})}
    <div className="weekly-insight"><h3>{c.insightTitle}</h3>{insight?<><p><strong>{bucketClock(insight.bucket)}–{bucketClock(insight.bucket+15)}</strong></p><p>{insight.days} {c.evidenceDays}; {insight.checkedDays} {c.checkedDays}.</p><p>{insight.goal==="soonest"?t.goalSoonest:t.goalShortest} · {c.medianDrive}: {duration(insight.medianDurationSeconds)}</p><p>{insight.medianSavingsSeconds===0?c.noDifference:`${c.savings}: ${duration(Math.abs(insight.medianSavingsSeconds))} ${insight.medianSavingsSeconds>0?c.fewer:c.more}`}</p><p className="micro-copy">{c.baseline}</p>{insight.partial&&<p className="micro-copy">{t.partialCoverage}</p>}</>:<p>{c.insightMinimum}</p>}<p className="micro-copy">{c.insightLimit}</p></div>
  </section></div>;
}
