import { useEffect, useRef, useState } from "react";
import type mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { MapPin, Navigation, Route, ShieldCheck } from "lucide-react";
import type { Candidate, Location } from "../shared/types";
import { api } from "./api";
import { useStore } from "./store";
import { en, ar } from "./i18n";
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
    [error, setError] = useState(false),
    [ready, setReady] = useState(false);
  const google = googleContent || candidate?.provider === "google";
  useEffect(() => {
    if (!mapEnabled || demo || google || !container.current) return;
    let cancelled = false;
    setError(false);
    api<{ token: string }>("/api/map-token")
      .then(async ({ token }) => {
        if (cancelled || !container.current) return;
        const lib = (await import("mapbox-gl")).default;
        if (cancelled) return;
        // Register once globally; Arabic shaping is needed even in an English UI.
        if (lib.getRTLTextPluginStatus() === "unavailable") {
          lib.setRTLTextPlugin(
            new URL("/mapbox-rtl-text-v0.2.3.js", window.location.origin).href,
            error => { if (error && !cancelled) setError(true); },
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
        m.on("error", () => setError(true));
        m.on("load", () => setReady(true));
      })
      .catch(() => setError(true));
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
      setReady(false);
    };
  }, [mapEnabled, demo, google]);
  useEffect(() => {
    map.current?.setLanguage(locale);
  }, [locale, ready]);
  useEffect(() => {
    const m = map.current;
    if (!m || !origin || !destination) return;
    let markers: mapboxgl.Marker[] = [];
    let stopped = false;
    let onLoad: (() => void) | undefined;
    const draw = async () => {
      const lib = (await import("mapbox-gl")).default;
      if (stopped) return;
      markers = [
        new lib.Marker({ color: "#0866ff" })
          .setLngLat([origin.longitude, origin.latitude])
          .addTo(m),
        new lib.Marker({ color: "#ef426b" })
          .setLngLat([destination.longitude, destination.latitude])
          .addTo(m),
      ];
      const update = () => {
        if (stopped) return;
        if (!m.isStyleLoaded()) return;
        const source = m.getSource("trip") as
          mapboxgl.GeoJSONSource | undefined;
        const data = {
          type: "Feature" as const,
          properties: {},
          geometry: candidate?.geometry ?? {
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
    draw();
    return () => {
      stopped = true;
      if (onLoad) m.off("load", onLoad);
      markers.forEach((marker) => marker.remove());
    };
  }, [origin, destination, candidate, ready]);
  return (
    <section className="map-card" aria-label={t.preview}>
      {mapEnabled && !demo && !google && !error ? (
        <div ref={container} className="map-canvas" />
      ) : (
        <div className="map-placeholder">
          <div className="map-orbit">
            <Navigation size={38} />
          </div>
          <h3>{google ? t.mapPolicy : error ? t.mapError : t.mapSetup}</h3>
          <p>
            {demo
              ? t.demoAttribution
              : verificationPending
                ? t.guestVerification
                : t.mapHelp}
          </p>
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
