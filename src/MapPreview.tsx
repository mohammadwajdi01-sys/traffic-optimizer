import { useEffect, useRef, useState } from "react";
import type mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { MapPin, Navigation, Route, ShieldCheck } from "lucide-react";
import type { Candidate, Location } from "../shared/types";
import { api } from "./api";
import { useStore } from "./store";
import { en, ar } from "./i18n";
import { mapFailure, type MapFailure } from "./map-failure";
export function MapPreview({
  origin,
  destination,
  candidate,
  mapEnabled,
  verificationPending = false,
  googleContent = false,
}: {
  origin: Location | null;
  destination: Location | null;
  candidate?: Candidate | null;
  mapEnabled: boolean;
  verificationPending?: boolean;
  googleContent?: boolean;
}) {
  const { locale, demo } = useStore(),
    t = locale === "ar" ? ar : en,
    container = useRef<HTMLDivElement>(null),
    map = useRef<mapboxgl.Map | null>(null),
    [error, setError] = useState<MapFailure | null>(null),
    [labelsFailed, setLabelsFailed] = useState(false),
    [attempt,setAttempt]=useState(0),
    [ready, setReady] = useState(false);
  const google = googleContent || candidate?.provider === "google";
  const mapAvailable = mapEnabled && !demo && !google;
  const failureHelp = error ? {session:t.mapSessionHelp, access:t.mapAccessHelp, allowance:t.mapAllowanceHelp, setup:t.mapHelp, browser:t.mapBrowserHelp, network:t.mapNetworkHelp}[error] : null;
  useEffect(() => {
    if (!mapEnabled || demo || google || !container.current) return;
    let cancelled = false;
    setError(null);
    setLabelsFailed(false);
    api<{ token: string }>("/api/map-token")
      .then(async ({ token }) => {
        if (cancelled || !container.current) return;
        const lib = (await import("mapbox-gl")).default;
        if (cancelled) return;
        // Register once globally; Arabic shaping is needed even in an English UI.
        const rtlStatus = lib.getRTLTextPluginStatus();
        if (rtlStatus === "error" && attempt === 0) setLabelsFailed(true);
        if (rtlStatus === "unavailable" || (rtlStatus === "error" && attempt > 0)) {
          lib.setRTLTextPlugin(
            new URL("/mapbox-rtl-text-v0.2.3.js", window.location.origin).href,
            error => { if (!cancelled) setLabelsFailed(Boolean(error)); },
            true,
          );
        }
        const m = new lib.Map({
          container: container.current,
          accessToken: token,
          style: "mapbox://styles/mapbox/streets-v12",
          center: [origin?.longitude ?? 35.9, origin?.latitude ?? 31.97],
          zoom: 11,
          language: locale,
        });
        map.current = m;
        m.addControl(new lib.NavigationControl(), "top-right");
        m.on("error", event => {if(!cancelled)setError(mapFailure(event.error));});
        m.on("load", () => {if(!cancelled){setError(null);setReady(true);}});
      })
      .catch(error => {if(!cancelled)setError(mapFailure(error));});
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
      setReady(false);
    };
  }, [mapEnabled, demo, google, attempt]);
  useEffect(() => {
    map.current?.setLanguage(locale);
  }, [locale, ready]);
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    let markers: mapboxgl.Marker[] = [];
    let stopped = false;
    let onLoad: (() => void) | undefined;
    const draw = async () => {
      const lib = (await import("mapbox-gl")).default;
      if (stopped) return;
      markers = [origin, destination].flatMap((point, index) => point ? [
        new lib.Marker({ color: index === 0 ? "#0866ff" : "#ef426b" })
          .setLngLat([point.longitude, point.latitude]).addTo(m),
      ] : []);
      const update = () => {
        if (stopped) return;
        if (!m.isStyleLoaded()) return;
        const source = m.getSource("trip") as
          mapboxgl.GeoJSONSource | undefined;
        const data = {
          type: "Feature" as const,
          properties: {},
          geometry: (origin && destination ? candidate?.geometry : null) ?? {
            type: "LineString" as const,
            coordinates: [],
          },
        };
        if (source) source.setData(data);
        else {
          m.addSource("trip", { type: "geojson", data });
          m.addLayer({
            id: "trip-line",
            type: "line",
            source: "trip",
            paint: { "line-color": "#0866ff", "line-width": 5 },
            layout: { "line-cap": "round", "line-join": "round" },
          });
        }
        if (!origin || !destination) {
          const point = origin ?? destination;
          if (point) m.easeTo({center: [point.longitude, point.latitude], zoom: 14});
          return;
        }
        const b = new lib.LngLatBounds(
          [origin.longitude, origin.latitude],
          [destination.longitude, destination.latitude],
        );
        candidate?.geometry?.coordinates.forEach((c) => b.extend([c[0], c[1]]));
        m.fitBounds(b, { padding: 65, maxZoom: 14 });
      };
      m.on("load", update);
      onLoad = update;
      update();
    };
    draw().catch(error => {if (!stopped) setError(mapFailure(error));});
    return () => {
      stopped = true;
      if (onLoad) m.off("load", onLoad);
      markers.forEach((marker) => marker.remove());
    };
  }, [origin, destination, candidate, ready]);
  return (
    <section className="map-card" aria-label={t.preview}>
      {mapAvailable && <div ref={container} className="map-canvas" />}
      {(!mapAvailable || (error && !ready)) && (
        <div className={`map-placeholder${mapAvailable ? " map-recovery" : ""}`}>
          <div className="map-orbit">
            <Navigation size={38} />
          </div>
          <h3>{google ? t.mapPolicy : error ? t.mapError : t.mapSetup}</h3>
          <p>
            {error ? failureHelp : demo
              ? t.demoAttribution
              : verificationPending
                ? t.guestVerification
                : t.mapHelp}
          </p>
          {error && mapAvailable && <button type="button" className="button secondary" onClick={()=>{setError(null);setReady(false);setAttempt(value=>value+1);}}>{t.mapRetry}</button>}
          <div className="journey-preview">
            <div>
              <MapPin size={18} />
              <span>{origin?.displayName ?? t.origin}</span>
            </div>
            <div className="journey-dots" />
            <div>
              <MapPin size={18} />
              <span>{destination?.displayName ?? t.destination}</span>
            </div>
          </div>
        </div>
      )}
      {mapAvailable && ((error && ready) || (labelsFailed && !error)) && <div className="map-warning" role="status">
        <p>{error ? failureHelp : t.mapLabelsHelp}</p>
        <button type="button" className="button secondary" onClick={()=>{setError(null);setReady(false);setAttempt(value=>value+1);}}>{t.mapRetry}</button>
      </div>}
      <div className="map-top">
        <span>
          <Route size={16} />
          {t.preview}
        </span>
        {candidate && (
          <strong>{(candidate.distanceMeters / 1000).toFixed(1)} km</strong>
        )}
      </div>
      <div className="map-bottom">
        <ShieldCheck size={16} />
        <span>{demo ? t.demoAttribution : t.navigateTimeHelp}</span>
      </div>
    </section>
  );
}
