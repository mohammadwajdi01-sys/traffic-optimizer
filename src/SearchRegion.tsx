import type { Location } from "../shared/types";
import { useEffect, useRef, useState } from "react";
import { countryCode, countryCodes } from "../shared/location-search";
import { browserLocation, freshSearchPosition, useSearchLocation } from "./search-location";
import { useStore } from "./store";
import { ar, en } from "./i18n";

export function SearchRegion({detectedCountry, searchEnabled, onLocation}:{detectedCountry?:string;searchEnabled:boolean;onLocation?:(location:Location)=>void}) {
  const {locale} = useStore(), t = locale === "ar" ? ar : en,
    context = useSearchLocation(), [busy,setBusy] = useState(false), [error,setError] = useState("");
  const sequence = useRef(0);
  useEffect(() => {
    if (!useSearchLocation.getState().countryCode && countryCode(detectedCountry)) context.setContext({countryCode:countryCode(detectedCountry),source:"network"});
  },[detectedCountry,context.setContext]);
  useEffect(() => () => { sequence.current++; }, []);
  useEffect(() => {
    if (!context.position) return;
    const capturedAt = context.position.capturedAt;
    const timer = setTimeout(() => {
      const current = useSearchLocation.getState();
      if (current.position?.capturedAt === capturedAt) current.setContext({countryCode:current.countryCode,source:"manual"});
    },Math.max(0,capturedAt + 15 * 60000 - Date.now()));
    return () => clearTimeout(timer);
  },[context.position]);
  const names = new Intl.DisplayNames([locale],{type:"region"}),
    countries = countryCodes.map(code => ({code,name:names.of(code) ?? code})).sort((a,b) => a.name.localeCompare(b.name,locale));
  async function locate() {
    const run = ++sequence.current;
    setBusy(true);setError("");
    try {
      const {accuracyMeters,capturedAt,...position} = await browserLocation(locale,true);
      if (run !== sequence.current) return;
      onLocation?.({...position,displayName:t.current});
      if (!position.countryCode) {context.setContext({countryCode:context.countryCode,source:"manual"});setError(t.countryNotFound);return;}
      context.setContext({countryCode:position.countryCode,position:{latitude:position.latitude,longitude:position.longitude,capturedAt,accuracyMeters},source:"gps"});
    } catch { if (run === sequence.current) setError(t.locationPermissionHelp); }
    finally { if (run === sequence.current) setBusy(false); }
  }
  return <div className="search-region">
    <label>{t.searchCountry}<select value={context.countryCode ?? ""} onChange={e => {
      sequence.current++;setBusy(false);setError("");context.setContext({countryCode:countryCode(e.target.value),source:"manual"});
    }}><option value="" disabled>{t.chooseCountry}</option>{countries.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}</select></label>
    <details className="search-options"><summary>{t.locationOptions}</summary><p className="micro-copy">{t.searchLocationHelp}</p></details>
    <button type="button" className="button secondary" disabled={busy || !searchEnabled} onClick={locate}>{busy ? t.locating : onLocation ? t.current : t.shareSearchLocation}</button>
    <p className="micro-copy" role="status">{freshSearchPosition(context) ? t.nearbySearch : context.source === "network" ? t.networkCountry : t.countryOnlySearch}</p>
    {freshSearchPosition(context) && <p className="micro-copy">{Number.isFinite(context.position?.accuracyMeters)?`${t.gpsAccuracy}: ±${Math.round(context.position!.accuracyMeters!)} ${t.meters} · `:""}{t.capturedAt} {new Date(context.position!.capturedAt).toLocaleTimeString(locale)}</p>}
    {context.position && <button type="button" className="text-button" onClick={() => {sequence.current++;setBusy(false);context.setContext({countryCode:context.countryCode,source:"manual"});}}>{t.clearSearchLocation}</button>}
    {!searchEnabled && <p className="micro-copy">{t.searchAccessHelp}</p>}
    {error && <p className="field-error" role="alert">{error}</p>}
  </div>;
}
