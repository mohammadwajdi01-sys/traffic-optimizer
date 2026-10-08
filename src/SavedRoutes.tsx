import { useRef, useState } from "react";
import { Bell, MoreHorizontal, Route } from "lucide-react";
import type { SavedRoute } from "../shared/types";
import { addDays } from "../shared/time";
import { isArrival, migratePlan } from "../shared/windows";
import { planSchema } from "../shared/schema";
import { ar, en } from "./i18n";
import { repeatAr, repeatEn } from "./repeat-copy";
import { Button, FieldError, Modal, displayFailure } from "./feedback";

export function SavedRouteCard({route, locale, disabled, onUse, onNow, onEdit, onDelete}:{route:SavedRoute;locale:"en"|"ar";disabled:boolean;onUse:()=>void;onNow:()=>void;onEdit:()=>void;onDelete:()=>void}) {
  const t = locale === "ar" ? ar : en, c = locale === "ar" ? repeatAr : repeatEn;
  const menu = useRef<HTMLDetailsElement>(null), p = migratePlan(route.plan);
  const action = (callback:()=>void) => {if(menu.current)menu.current.open=false;callback();};
  return <article className="saved-route panel">
    <div className="saved-route-head"><span className="route-icon"><Route size={23}/></span><h2>{route.name}</h2>
      <details ref={menu} className="route-menu"><summary aria-label={`${c.routeActions}: ${route.name}`}><MoreHorizontal size={20}/></summary><div>
        <button disabled={disabled} onClick={()=>action(onEdit)}>{c.editRoute}</button>
        <button className="danger" disabled={disabled} onClick={()=>action(onDelete)}>{c.deleteRoute}</button>
      </div></details>
    </div>
    <p>{route.plan.origin.displayName}</p><p>{route.plan.destination.displayName}</p>
    <div className="route-pills"><span>{t[p.mode]}</span><span dir="ltr">{p.earliestTime}–{p.latestTime}{p.endDate!==p.date ? ` (${c.nextDay})` : ""}</span></div>
    <p className="route-schedule">{route.days.length === 7 ? c.everyDay : route.days.map(d=>t.dayNames[d]).join(" · ")} · <bdi>{p.timezone}</bdi></p>
    {route.plan.origin.source==="demo" && <p className="micro-copy">{t.savedOnDevice}</p>}
    {route.plan.origin.source==="gps" && <p className="micro-copy">{t.gpsRefresh}</p>}
    {route.reminders && <p><Bell size={14}/> {t.reminders}</p>}
    <div className="route-primary-actions"><Button disabled={disabled} onClick={onUse}>{c.usePlan}</Button><Button className="button secondary" disabled={disabled} onClick={onNow}>{t.leaveNow}</Button></div>
  </article>;
}

export function EditSavedRoute({route,locale,push,onSave,onClose}:{route:SavedRoute;locale:"en"|"ar";push:boolean;onSave:(route:SavedRoute)=>Promise<void>;onClose:()=>void}) {
  const t=locale==="ar"?ar:en,c=locale==="ar"?repeatAr:repeatEn;
  const returnFocus=useRef(document.activeElement?.closest("details")?.querySelector<HTMLElement>("summary") ?? document.activeElement);
  const [draft,setDraft]=useState(()=>({...route,plan:migratePlan(route.plan),days:[...route.days]}));
  const [pending,setPending]=useState(false),[error,setError]=useState("");
  const patchPlan=(value:Partial<SavedRoute["plan"]>)=>setDraft(d=>({...d,plan:{...d.plan,...value}}));
  const save=async()=>{
    if(pending)return;
    setError("");
    if(!draft.name.trim() || draft.name.trim().length>100){setError(t.routeName);return;}
    if(!draft.days.length){setError(c.noDays);return;}
    if(!planSchema.safeParse(draft.plan).success){setError(t.boundsError);return;}
    setPending(true);
    try{await onSave({...draft,name:draft.name.trim()});onClose();}catch(e){setError(displayFailure(e,locale));}finally{setPending(false);}
  };
  return <Modal title={c.editRoute} description={c.editHelp} closeLabel={t.close} onClose={()=>{if(!pending)onClose();}} busy={pending} focusTarget={()=>returnFocus.current instanceof HTMLElement?returnFocus.current:null}>
    <fieldset disabled={pending} className="route-editor-fields"><label>{t.routeName}<input autoFocus maxLength={100} value={draft.name} onChange={e=>setDraft(d=>({...d,name:e.target.value}))}/></label>
    <div className="date-time"><label>{isArrival(draft.plan)?t.earliestArrivalLabel:t.earliest}<input type="time" value={draft.plan.earliestTime} onChange={e=>patchPlan({earliestTime:e.target.value})}/></label><label>{isArrival(draft.plan)?t.latestArrivalLabel:t.latest}<input type="time" value={draft.plan.latestTime} onChange={e=>patchPlan({latestTime:e.target.value})}/></label></div>
    <label className="check-label"><input type="checkbox" checked={draft.plan.endDate!==draft.plan.date} onChange={e=>patchPlan({endDate:e.target.checked?addDays(draft.plan.date,1):draft.plan.date})}/>{t.endsNextDay}</label>
    <fieldset className="weekday-fields"><legend>{t.days}</legend><div className="day-picker">{t.dayNames.map((name,i)=><button type="button" key={i} aria-pressed={draft.days.includes(i)} className={draft.days.includes(i)?"active":""} onClick={()=>setDraft(d=>({...d,days:d.days.includes(i)?d.days.filter(v=>v!==i):[...d.days,i]}))}>{name}</button>)}</div></fieldset>
    <label className="check-label"><input type="checkbox" checked={draft.reminders} disabled={route.plan.origin.source==="demo" || (!push && !draft.reminders)} onChange={e=>setDraft(d=>({...d,reminders:e.target.checked}))}/>{t.reminders}</label>
    {!push && route.plan.origin.source!=="demo" && <p className="micro-copy">{t.pushHelp}</p>}</fieldset>
    <FieldError id="route-edit-error">{error}</FieldError><div className="dialog-actions"><Button className="button secondary" disabled={pending} onClick={onClose}>{c.cancel}</Button><Button pending={pending} onClick={()=>void save()}>{c.saveChanges}</Button></div>
  </Modal>;
}

export function DeleteSavedRoute({route,locale,onDelete,onClose}:{route:SavedRoute;locale:"en"|"ar";onDelete:()=>Promise<void>;onClose:()=>void}){
  const t=locale==="ar"?ar:en,c=locale==="ar"?repeatAr:repeatEn;
  const returnFocus=useRef(document.activeElement?.closest("details")?.querySelector<HTMLElement>("summary"));
  const [pending,setPending]=useState(false),[error,setError]=useState("");
  const remove=async()=>{if(pending)return;setPending(true);setError("");try{await onDelete();onClose();}catch(e){setError(displayFailure(e,locale));}finally{setPending(false);}};
  return <Modal title={`${c.deleteRoute}: ${route.name}`} description={c.deleteHelp} closeLabel={t.close} onClose={()=>{if(!pending)onClose();}} busy={pending} focusTarget={()=>returnFocus.current?.isConnected?returnFocus.current:document.querySelector<HTMLElement>(".page-heading .button")}>
    <FieldError id="route-delete-error">{error}</FieldError><div className="dialog-actions"><Button className="button secondary" disabled={pending} onClick={onClose}>{c.cancel}</Button><Button className="button danger" pending={pending} onClick={()=>void remove()}>{c.deleteRoute}</Button></div>
  </Modal>;
}
