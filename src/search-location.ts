import { create } from "zustand";
import type { Location } from "../shared/types";
import { countryCode } from "../shared/location-search";
import { api } from "./api";

export type SearchLocation = {
  countryCode?: string;
  position?: { latitude: number; longitude: number; capturedAt: number; accuracyMeters?: number };
  source?: "network" | "manual" | "gps";
};
export const useSearchLocation = create<SearchLocation & { setContext: (v: SearchLocation) => void }>((set) => ({
  setContext: v => set({countryCode: v.countryCode, position: v.position, source: v.source}),
}));
export function freshSearchPosition(context: SearchLocation) {
  return context.position && Date.now() - context.position.capturedAt < 15 * 60000 ? context.position : undefined;
}
export async function browserLocation(language: "en" | "ar", searchEnabled: boolean): Promise<Location & {accuracyMeters?:number;capturedAt:number}> {
  if (!navigator.geolocation) throw new Error("Location is unavailable.");
  const pos = await new Promise<GeolocationPosition>((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, {enableHighAccuracy:true, timeout:10000, maximumAge:0}));
  const base: Location = {displayName:"", latitude:pos.coords.latitude, longitude:pos.coords.longitude, source:"gps", timezone:Intl.DateTimeFormat().resolvedOptions().timeZone};
  if (searchEnabled) {
    try {
      const r = await api<{locations:Location[]}>("/api/location/reverse", {latitude:base.latitude,longitude:base.longitude,language});
      base.timezone = r.locations[0]?.timezone ?? base.timezone;
      base.countryCode = countryCode(r.locations[0]?.countryCode);
    } catch { /* GPS origin remains usable if reverse geocoding is unavailable. */ }
  }
  return {...base,accuracyMeters:pos.coords.accuracy,capturedAt:pos.timestamp || Date.now()};
}
