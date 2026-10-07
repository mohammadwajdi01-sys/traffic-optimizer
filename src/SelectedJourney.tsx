import type { Candidate, Plan } from "../shared/types";
import { clock, localDate, dateLabel } from "../shared/time";
import { navUrl } from "./api";
import { en, ar } from "./i18n";

export function SelectedJourney({ candidate, plan, locale, outsideWindow = false, navigation="ask" }: {
  candidate: Candidate; plan: Plan; locale: "en" | "ar"; outsideWindow?: boolean; navigation?:"ask"|"google"|"waze";
}) {
  const t = locale === "ar" ? ar : en;
  return <section className="selected-journey" aria-label={t.selected} aria-live="polite">
    <h3>{t.selected}</h3>
    <dl>
      <div><dt>{t.departure}</dt><dd><bdi>{clock(candidate.departureAt, plan.timezone, locale)}</bdi> · {dateLabel(localDate(Date.parse(candidate.departureAt), plan.timezone), locale)}</dd></div>
      <div><dt>{t.arrive}</dt><dd><bdi>{clock(candidate.arrivalAt, plan.timezone, locale)}</bdi> · {dateLabel(localDate(Date.parse(candidate.arrivalAt), plan.timezone), locale)}</dd></div>
      <div><dt>{t.duration}</dt><dd>{Math.round(candidate.durationSeconds / 60)} {t.minutes}</dd></div>
    </dl>
    <p className="micro-copy">{plan.timezone} · {candidate.provider}</p>
    {outsideWindow && <p role="status">{t.nowOutsideWindow}</p>}
    {Date.parse(candidate.departureAt) < Date.now() - 120000 && <p role="status">{t.departurePassed}</p>}
    <div className="navigation-row">
      <a className={navigation==="google"?"preferred":undefined} href={navUrl("google", plan.origin, plan.destination)} target="_blank" rel="noopener noreferrer">{t.google}</a>
      <a className={navigation==="waze"?"preferred":undefined} href={navUrl("waze", plan.origin, plan.destination)} target="_blank" rel="noopener noreferrer">{t.waze}</a>
    </div>
    <p className="micro-copy">{t.navigateTimeHelp} {t.navigationNowHelp}</p>
  </section>;
}
