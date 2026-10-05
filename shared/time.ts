import { Temporal } from "@js-temporal/polyfill";
const timeCache = new Map<string, number>();
export function localInstant(
  date: string,
  time: string,
  timezone: string,
): number {
  const key = `${date}/${time}/${timezone}`;
  const known = timeCache.get(key);
  if (known !== undefined) return known;
  const p = Temporal.PlainDateTime.from(`${date}T${time}:00`);
  const result = p.toZonedDateTime(timezone, {
    disambiguation: "reject",
  }).epochMilliseconds;
  if (timeCache.size >= 256) timeCache.delete(timeCache.keys().next().value!);
  timeCache.set(key, result);
  return result;
}
export function localDate(now: number, timezone: string): string {
  return Temporal.Instant.fromEpochMilliseconds(now)
    .toZonedDateTimeISO(timezone)
    .toPlainDate()
    .toString();
}
export function addDays(date: string, days: number): string {
  return Temporal.PlainDate.from(date).add({ days }).toString();
}
export function clock(iso: string, timezone: string, locale = "en"): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}
export function dateLabel(date: string, locale = "en"): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(date + "T12:00:00Z"));
}
export const iso = (ms: number) => new Date(ms).toISOString();
