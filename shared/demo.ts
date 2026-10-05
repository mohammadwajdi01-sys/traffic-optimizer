import type { Candidate, Location, Plan } from "./types";
import { localDate } from "./time";
export const demoLocations: Location[] = [
  {
    displayName: "Khalda, Amman",
    latitude: 31.996,
    longitude: 35.846,
    countryCode: "JO",
    timezone: "Asia/Amman",
    source: "demo",
  },
  {
    displayName: "Abdali, Amman",
    latitude: 31.963,
    longitude: 35.908,
    countryCode: "JO",
    timezone: "Asia/Amman",
    source: "demo",
  },
  {
    displayName: "Janzour, Tripoli",
    latitude: 32.821,
    longitude: 13.02,
    countryCode: "LY",
    timezone: "Africa/Tripoli",
    source: "demo",
  },
  {
    displayName: "Central Tripoli",
    latitude: 32.888,
    longitude: 13.188,
    countryCode: "LY",
    timezone: "Africa/Tripoli",
    source: "demo",
  },
  {
    displayName: "Al Yasmin, Riyadh",
    latitude: 24.827,
    longitude: 46.638,
    countryCode: "SA",
    timezone: "Asia/Riyadh",
    source: "demo",
  },
  {
    displayName: "KAFD, Riyadh",
    latitude: 24.762,
    longitude: 46.643,
    countryCode: "SA",
    timezone: "Asia/Riyadh",
    source: "demo",
  },
];
export function defaultPlan(): Plan {
  return {
    origin: demoLocations[0],
    destination: demoLocations[1],
    mode: "arrive_by",
    date: localDate(Date.now() + 86400000, "Asia/Amman"),
    time: "09:00",
    timezone: "Asia/Amman",
    flexibilityMinutes: 60,
    safetyBufferMinutes: 10,
    maxEarlinessMinutes: 180,
    earliestTime: "06:00",
    latestTime: "10:00",
  };
}
export async function demoForecast(
  p: Plan,
  departureAt: string,
): Promise<Candidate> {
  const hour =
    Number(
      new Intl.DateTimeFormat("en", {
        timeZone: p.timezone,
        hour: "2-digit",
        hourCycle: "h23",
      }).format(new Date(departureAt)),
    ) +
    Number(
      new Intl.DateTimeFormat("en", {
        timeZone: p.timezone,
        minute: "2-digit",
      }).format(new Date(departureAt)),
    ) /
      60;
  const day = new Date(departureAt).getUTCDay(),
    factor = day === 5 || day === 6 ? 0.4 : 1;
  const traffic =
    (26 * Math.exp(-(((hour - 8.05) / 0.75) ** 2)) +
      31 * Math.exp(-(((hour - 17.2) / 1.2) ** 2))) *
    factor;
  const d = Math.hypot(
    (p.origin.latitude - p.destination.latitude) * 111000,
    (p.origin.longitude - p.destination.longitude) * 94000,
  );
  return {
    departureAt,
    arrivalAt: new Date(
      Date.parse(departureAt) + (21 + traffic) * 60000,
    ).toISOString(),
    durationSeconds: Math.round((21 + traffic) * 60),
    staticDurationSeconds: 21 * 60,
    distanceMeters: Math.round(d * 1.4),
    provider: "demo",
    trafficCoverage: "available",
  };
}
