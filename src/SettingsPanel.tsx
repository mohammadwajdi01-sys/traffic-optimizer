import type {ReactNode} from "react";
import {Bell,Download} from "lucide-react";
import {Button,Pending,Notice} from "./feedback";
import {en,ar} from "./i18n";
import {settingsEn,settingsAr} from "./settings-copy";
export type Preferences={locale:"en"|"ar";navigation:"ask"|"google"|"waze";safety_buffer:number;measurement_opt_in:boolean};
export default function SettingsPanel({locale,prefs,onPrefs,signedIn,account,website,loading,failed,saving,dirty,onRetry,onSave,onCancel,pushBusy=false,push,pushAvailable,onPush,install,recordingAllowed,tripStart,onTrip,onExport,onClearExamples,onClearLocation}: {
  locale:"en"|"ar";prefs:Preferences;onPrefs:(prefs:Preferences)=>void;signedIn:boolean;account:ReactNode;website?:ReactNode;loading:boolean;failed:boolean;saving:boolean;dirty:boolean;onRetry:()=>void;onSave:()=>void;onCancel:()=>void;pushBusy?:boolean;push:boolean;pushAvailable:boolean;onPush:()=>void;install?:()=>void;recordingAllowed:boolean;tripStart:boolean;onTrip:()=>void;onExport:()=>void;onClearExamples:()=>void;onClearLocation:()=>void;
}) {
  const t=locale==="ar"?ar:en,s=locale==="ar"?settingsAr:settingsEn,locked=loading||failed||saving;
  return <div className="settings-grid grouped-settings">
    <section className="panel" aria-labelledby="settings-account"><h2 id="settings-account">{t.account}</h2><p>{s.accountHelp}</p>{account}</section>
    <section className="panel" aria-labelledby="settings-journey"><h2 id="settings-journey">{s.journey}</h2><p>{s.preferenceHelp}</p><p className="micro-copy">{signedIn?s.accountPreferences:s.devicePreferences}</p>
      {loading&&<Pending>{s.load}</Pending>}{failed&&<><Notice>{s.loadError}</Notice><Button className="button secondary" onClick={onRetry}>{s.retry}</Button></>}
      <fieldset disabled={locked} className="settings-fields"><legend className="sr-only">{s.journey}</legend>
        <label>{t.language}<select value={locale} onChange={e=>onPrefs({...prefs,locale:e.target.value as "en"|"ar"})}><option value="en">English</option><option value="ar">العربية</option></select></label>
        <label>{t.defaultNav}<select value={prefs.navigation} onChange={e=>onPrefs({...prefs,navigation:e.target.value as Preferences["navigation"]})}><option value="ask">{t.ask}</option><option value="google">Google Maps</option><option value="waze">Waze</option></select></label>
        <details className="settings-advanced"><summary>{s.advanced}</summary><p className="micro-copy">{t.bufferHelp}</p><label>{t.buffer}<input type="number" min={0} max={60} value={prefs.safety_buffer} onChange={e=>onPrefs({...prefs,safety_buffer:Number(e.target.value)})}/></label><p className="micro-copy">{s.timezoneHelp}</p></details>
      </fieldset>
      {dirty&&<p className="micro-copy">{s.unsaved}</p>}<div className="settings-actions"><Button pending={saving} disabled={locked} onClick={onSave}>{t.saveSettings}</Button><Button className="button secondary" disabled={locked||!dirty} onClick={onCancel}>{s.cancel}</Button></div>
    </section>
    <section className="panel" aria-labelledby="settings-notifications"><h2 id="settings-notifications">{s.device}</h2><p>{s.deviceHelp}</p><p>{push?t.pushReady:t.pushHelp}</p>{push&&<p className="micro-copy">{s.disableScope}</p>}<Button className="button secondary" pending={pushBusy} disabled={!pushAvailable} onClick={onPush}><Bell size={17}/>{push?t.disablePush:t.enablePush}</Button><hr/><h3>{t.install}</h3><p>{t.installHelp}</p>{install&&<Button onClick={install}><Download size={17}/>{t.install}</Button>}</section>
    <section className="panel" aria-labelledby="settings-privacy"><h2 id="settings-privacy">{t.privacy}</h2><p>{t.privacyCopy}</p><label className="check-label"><input type="checkbox" disabled={!signedIn||locked} checked={prefs.measurement_opt_in} onChange={e=>onPrefs({...prefs,measurement_opt_in:e.target.checked})}/>{t.measurement}</label><p className="micro-copy">{t.measurementHelp}</p><p className="micro-copy">{!signedIn?s.consentHelp:prefs.measurement_opt_in&&!recordingAllowed?s.saveFirst:""}</p><Button pending={saving} disabled={!signedIn||locked} onClick={onSave}>{s.privacySave}</Button>{recordingAllowed&&<Button className="button secondary" onClick={onTrip}>{tripStart?t.tripEnd:t.tripStart}</Button>}
      <hr/><Button className="button secondary" onClick={onClearLocation}>{s.clearLocation}</Button><p className="micro-copy">{s.locationHelp}</p><div className="settings-actions"><Button className="button secondary" onClick={onExport}>{t.exportData}</Button><Button className="button secondary" onClick={onClearExamples}>{t.clearData}</Button></div><p className="micro-copy">{s.exportHelp}</p><p className="micro-copy">{s.clearHelp}</p>
    </section>
    {website&&<section className="panel" aria-labelledby="settings-website"><h2 id="settings-website">{s.website}</h2><p>{s.websiteHelp}</p>{website}</section>}
  </div>;
}
