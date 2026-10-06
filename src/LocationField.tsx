import { useEffect, useRef, useState } from "react";
import { LocateFixed, MapPin, Search } from "lucide-react";
import type { Location } from "../shared/types";
import { demoLocations } from "../shared/demo";
import { api } from "./api";
import { en, ar } from "./i18n";
import { useStore } from "./store";
import { browserLocation, freshSearchPosition, useSearchLocation } from "./search-location";
export function LocationField({
  label,
  value,
  onChange,
  searchEnabled,
  gps = false,
}: {
  label: string;
  value: Location | null;
  onChange: (v: Location | null) => void;
  searchEnabled: boolean;
  gps?: boolean;
}) {
  const { locale, demo } = useStore(),
    t = locale === "ar" ? ar : en,
    [text, setText] = useState(value?.displayName ?? ""),
    [open, setOpen] = useState(false),
    [list, setList] = useState<Location[]>([]),
    [active, setActive] = useState(-1),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [manual, setManual] = useState(false),
    [lat, setLat] = useState(""),
    [lng, setLng] = useState(""),
    [pair, setPair] = useState(""),
    [tz, setTz] = useState("Asia/Amman");
  const searchContext = useSearchLocation(), position = freshSearchPosition(searchContext);
  const seq = useRef(0),
    root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setText(value?.displayName ?? "");
  }, [value]);
  useEffect(() => {
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  useEffect(() => {
    const run = ++seq.current;
    setActive(-1);
    setList([]); setBusy(false);
    if (!open) return;
    if (demo) {
      setList(
        demoLocations.filter((l) =>
          l.displayName.toLowerCase().includes(text.toLowerCase()),
        ),
      );
      return;
    }
    if (!searchEnabled || !searchContext.countryCode || text.trim().length < 3) {
      setList([]);
      return;
    }
    const timer = setTimeout(async () => {
      setBusy(true);
      try {
        const res = await api<{ locations: Location[] }>(
          "/api/location/suggest",
          { text, language: locale, countryCode: searchContext.countryCode, latitude: position?.latitude, longitude: position?.longitude },
        );
        if (run === seq.current) setList(res.locations.filter(l => l.countryCode?.toUpperCase() === searchContext.countryCode));
      } catch (e) {
        if (run === seq.current)
          setError(locale === "ar" ? t.error : (e as Error).message);
      } finally {
        if (run === seq.current) setBusy(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [text, open, searchEnabled, demo, locale, t.error, searchContext.countryCode, position?.latitude, position?.longitude]);
  async function locate() {
    setBusy(true);setError("");
    try {
      const location = await browserLocation(locale, searchEnabled);
      onChange({...location, displayName:t.current});
      if (location.countryCode) searchContext.setContext({countryCode:location.countryCode,position:{latitude:location.latitude,longitude:location.longitude,capturedAt:Date.now()},source:"gps"});
    } catch { setError(t.gpsDenied); }
    finally { setBusy(false); }
  }
  return (
    <div className="location-field" ref={root}>
      <div className={"location-icon " + (gps ? "blue" : "pink")}>
        <MapPin size={20} />
      </div>
      <div className="location-content">
        <label htmlFor={"location-" + (gps ? "from" : "to")}>{label}</label>
        <input
          autoComplete="off"
          id={"location-" + (gps ? "from" : "to")}
          role="combobox"
          aria-expanded={open}
          aria-controls={gps ? "from-options" : "to-options"}
          aria-autocomplete="list"
          aria-activedescendant={
            open && active >= 0
              ? `${gps ? "from" : "to"}-option-${active}`
              : undefined
          }
          placeholder={gps ? t.origin : t.destination}
          value={text}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setOpen(true);
              if (list.length)
                setActive((i) =>
                  e.key === "ArrowDown"
                    ? (i + 1) % list.length
                    : i <= 0
                      ? list.length - 1
                      : i - 1,
                );
            }
            if (e.key === "Enter" && open && active >= 0 && list[active]) {
              e.preventDefault();
              onChange(list[active]);
              setOpen(false);
            }
          }}
          onBlur={(e) => {
            if (!root.current?.contains(e.relatedTarget as Node))
              setOpen(false);
          }}
          onChange={(e) => {
            setText(e.target.value);
            onChange(null);
            setOpen(true);
            setError("");
          }}
        />
      </div>
      {gps && (
        <button
          type="button"
          className="icon-button"
          disabled={busy}
          title={t.current}
          aria-label={t.current}
          onClick={locate}
        >
          <LocateFixed size={19} />
        </button>
      )}
      {open && (
        <div
          className="suggestions"
          role="listbox"
          id={gps ? "from-options" : "to-options"}
        >
          {busy ? (
            <div>{t.searching}</div>
          ) : (
            list.map((l, index) => (
              <button
                type="button"
                role="option"
                id={`${gps ? "from" : "to"}-option-${index}`}
                aria-selected={active === index}
                key={l.displayName}
                onClick={() => {
                  onChange(l);
                  setOpen(false);
                }}
              >
                <Search size={16} />
                <span>{l.displayName}</span>
              </button>
            ))
          )}
          {!busy && !list.length && (
            <div className="muted">{!demo && !searchContext.countryCode ? t.chooseCountry : t.noSuggestions}</div>
          )}
          {demo && <small>{t.examples}</small>}
          {!demo && (
            <button
              type="button"
              onClick={() => {
                setPair("");
                setLat(value ? String(value.latitude) : "");
                setLng(value ? String(value.longitude) : "");
                setTz(value?.timezone || "Asia/Amman");
                setError("");
                setManual(true);
                setOpen(false);
              }}
            >
              {t.manual}
            </button>
          )}
          {searchEnabled && <small>{t.searchAttribution}</small>}
        </div>
      )}
      {error && !manual && <span className="field-error" role="alert">{error}</span>}
      {manual && (
        <div className="manual-panel">
          <p>{t.manualHelp}</p>
          <label>{t.coordinatePair}<input type="text" dir="ltr" placeholder="31.9455631, 35.9271963" value={pair} onChange={e => {
            setPair(e.target.value);
            const parts = normalizeDigits(e.target.value).trim().split(/[,;\s]+/).filter(Boolean);
            if (parts.length === 2) { setLat(parts[0]); setLng(parts[1]); setError(""); }
          }} /></label>
          <label>
            {t.latitude}
            <input
              type="text"
              inputMode="decimal"
              dir="ltr"
              value={lat}
              onChange={(e) => {setLat(e.target.value); setPair("");}}
            />
          </label>
          <label>
            {t.longitude}
            <input
              type="text"
              inputMode="decimal"
              dir="ltr"
              value={lng}
              onChange={(e) => {setLng(e.target.value); setPair("");}}
            />
          </label>
          <label>
            {t.timezone}
            <input value={tz} onChange={(e) => setTz(e.target.value)} />
          </label>
          <button
            type="button"
            onClick={() => {
              if (pair.trim() && normalizeDigits(pair).trim().split(/[,;\s]+/).filter(Boolean).length !== 2) { setError(t.coordinateError); return; }
              const a = coordinateNumber(lat), b = coordinateNumber(lng), timezone = tz.trim();
              if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a) > 90 || Math.abs(b) > 180) {
                setError(t.coordinateError); return;
              }
              try { new Intl.DateTimeFormat("en", {timeZone: timezone || "invalid"}); }
              catch { setError(t.timezoneError); return; }
              onChange({displayName: value && value.latitude === a && value.longitude === b ? value.displayName : `${a}, ${b}`, latitude: a, longitude: b, timezone, source: "manual"});
              setError(""); setManual(false); setOpen(false);
            }}
          >
            {t.apply}
          </button>
          {error && <p className="field-error" role="alert">{error}</p>}
          <button type="button" onClick={() => {setManual(false); setError("");}}>
            {t.cancel}
          </button>
        </div>
      )}
    </div>
  );
}

function normalizeDigits(text: string) {
  return text.replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 1632)).replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 1776)).replace(/،/g, ",").replace(/٫/g, ".").replace(/−/g, "-");
}
function coordinateNumber(text: string) {
  const value = normalizeDigits(text).trim().replace(",", ".");
  return /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value) ? Number(value) : NaN;
}
