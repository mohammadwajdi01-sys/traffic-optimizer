import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as Dialog from "@radix-ui/react-dialog";
import {
  ArrowDownUp,
  BarChart3,
  Bell,
  Bookmark,
  CalendarDays,
  Check,
  ChevronDown,
  Clock,
  Download,
  Home,
  Leaf,
  LoaderCircle,
  MapPin,
  Navigation,
  Plus,
  Route,
  Settings,
  Shield,
  SlidersHorizontal,
  Sun,
  Trash2,
  Trophy,
  X,
} from "lucide-react";
import type {
  Analysis,
  AppConfig,
  Candidate,
  Location,
  Plan,
  SavedRoute,
} from "../shared/types";
import { defaultPlan, demoForecast, demoLocations } from "../shared/demo";
import { planSchema } from "../shared/schema";
import { optimize, windowFor } from "../shared/optimizer";
import {
  addDays,
  clock,
  dateLabel,
  localDate,
  localInstant,
} from "../shared/time";
import { api, ApiFailure, configureAuth, navUrl, supabase } from "./api";
import { useStore } from "./store";
import { en, ar, forecastWarning } from "./i18n";
import { weeklyPlans } from "../shared/planning";
import { isArrival, isWindowPlan, migratePlan, recurringPlan } from "../shared/windows";
import { ForecastTimeline } from "./ForecastTimeline";
import GuestAccess from "./GuestAccess";
import { LocationField } from "./LocationField";
import { SearchRegion } from "./SearchRegion";
import { MapPreview } from "./MapPreview";
const setupConfig: AppConfig = {
  mode: "setup",
  authConfigured: false,
  searchConfigured: false,
  trafficConfigured: false,
  mapConfigured: false,
  publicBeta: false,
};
const safeDeviceRoutes = () => {
  try {
    return JSON.parse(
      localStorage.getItem("traffic.demoRoutes") ?? "[]",
    ) as SavedRoute[];
  } catch {
    return [];
  }
};
const devicePreferences = () => {
  try {
    const p = JSON.parse(localStorage.getItem("traffic.preferences") ?? "{}");
    return {
      navigation: (["ask", "google", "waze"].includes(p.navigation)
        ? p.navigation
        : "ask") as "ask" | "google" | "waze",
      safety_buffer:
        Number.isInteger(p.safety_buffer) &&
        p.safety_buffer >= 0 &&
        p.safety_buffer <= 60
          ? p.safety_buffer
          : 0,
    };
  } catch {
    return { navigation: "ask" as const, safety_buffer: 0 };
  }
};
export default function App() {
  const {
      locale,
      plan,
      setPlan,
      analysis,
      setAnalysis,
      demo,
      setDemo,
      setLocale,
    } = useStore(),
    t = locale === "ar" ? ar : en;
  const [page, setPage] = useState(location.pathname.slice(1) || "today"),
    [origin, setOrigin] = useState<Location | null>(null),
    [destination, setDestination] = useState<Location | null>(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [saveOpen, setSaveOpen] = useState(false),
    [editingId, setEditingId] = useState<string | null>(null),
    [name, setName] = useState(""),
    [days, setDays] = useState([0, 1, 2, 3, 4]),
    [reminders, setReminders] = useState(false),
    [saved, setSaved] = useState<SavedRoute[]>(safeDeviceRoutes),
    [weekly, setWeekly] = useState<(Analysis | null)[]>([]),
    [weekProgress, setWeekProgress] = useState(0),
    [selected, setSelected] = useState<Candidate | null>(null),
    [authOpen, setAuthOpen] = useState(false),
    [email, setEmail] = useState(""),
    [user, setUser] = useState<string | null>(null),
    [role, setRole] = useState("user"),
    [online, setOnline] = useState(navigator.onLine),
    [installPrompt, setInstallPrompt] = useState<any>(null),
    [prefs, setPrefs] = useState({
      locale,
      ...devicePreferences(),
      measurement_opt_in: false,
    }),
    [guestReady, setGuestReady] = useState(false),
    [push, setPush] = useState(false),
    [tripStart, setTripStart] = useState<string | null>(null);
  const configQuery = useQuery({
    queryKey: ["config"],
    queryFn: () => api<AppConfig>("/api/config"),
  });
  const config = configQuery.data ?? setupConfig;
  const form = useForm<Plan>({
    resolver: zodResolver(planSchema),
    defaultValues: { ...plan, safetyBufferMinutes: prefs.safety_buffer },
  });
  const mode = form.watch("mode");
  const requestVersion = useRef(0);
  useEffect(() => {
    const subscription = form.watch(() => {
      requestVersion.current++;
      setAnalysis(null); setSelected(null); setWeekly([]);
    });
    return () => subscription.unsubscribe();
  }, [form, setAnalysis]);
  const go = (path: string) => {
    history.pushState(null, "", path === "today" ? "/" : "/" + path);
    setPage(path);
    setError("");
  };
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
    document.title = t.app;
    setPrefs((p) => ({ ...p, locale }));
  }, [locale, t.app]);
  useEffect(() => {
    const pop = () => setPage(location.pathname.slice(1) || "today"),
      on = () => setOnline(true),
      off = () => setOnline(false),
      install = (e: Event) => {
        e.preventDefault();
        setInstallPrompt(e);
      };
    window.addEventListener("popstate", pop);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    window.addEventListener("beforeinstallprompt", install);
    return () => {
      window.removeEventListener("popstate", pop);
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      window.removeEventListener("beforeinstallprompt", install);
    };
  }, []);
  useEffect(() => {
    if (!config.authConfigured) return;
    configureAuth(config);
    if (!supabase) return;
    supabase.auth
      .getSession()
      .then(({ data }) => setUser(data.session?.user.email ?? null));
    const { data } = supabase.auth.onAuthStateChange((_event, session) =>
      setUser(session?.user.email ?? null),
    );
    return () => data.subscription.unsubscribe();
  }, [config]);
  useEffect(() => {
    if (!user || demo) {
      setRole("user");
      setSaved(safeDeviceRoutes());
      return;
    }
    let active = true;
    api<{ role: string }>("/api/me")
      .then((v) => {if(active) setRole(v.role);})
      .catch(() => {});
    api<SavedRoute[]>("/api/routes")
      .then(rows => {if(active) setSaved(rows);})
      .catch((e) => setError((e as Error).message));
    api<any[]>("/api/preferences")
      .then((rows) => {
        if (active && rows[0]) {
          setPrefs(rows[0]);
          setLocale(rows[0].locale);
          form.setValue("safetyBufferMinutes", rows[0].safety_buffer);
        }
      })
      .catch(() => {});
    return () => {active = false;};
  }, [user, demo]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 6000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    let active = true;
    setPush(false);
    if (user && config.vapidPublicKey && "serviceWorker" in navigator && "PushManager" in window) {
      navigator.serviceWorker.ready.then(r => r.pushManager.getSubscription()).then(async sub => {
        if (!sub) return;
        const status = await api<{subscribed: boolean}>("/api/push/status", {endpoint: sub.endpoint});
        if(active) setPush(status.subscribed);
      }).catch(() => {});
    }
    return () => {active = false;};
  }, [user, config.vapidPublicKey]);
  function startDemo() {
    const p = { ...defaultPlan(), safetyBufferMinutes: prefs.safety_buffer };
    setDemo(true);
    setOrigin(p.origin);
    setDestination(p.destination);
    setPlan(p);
    form.reset(p);
    setAnalysis(null);
    setWeekly([]);
    setSelected(null);
    setError("");
    go("plan");
  }
  function useRoute(r: SavedRoute) {
    setEditingId(null);
    const isExample = r.plan.origin.source === "demo";
    setDemo(isExample);
    const p = recurringPlan(r.plan, localDate(Date.now() + 86400000, r.plan.timezone));
    setOrigin(p.origin.source === "gps" ? null : p.origin);
    setDestination(p.destination);
    form.reset(p);
    setPlan(p);
    setAnalysis(null);
    setSelected(null);
    setWeekly([]);
    if (!isWindowPlan(r.plan)) setNotice(t.migratedRoute);
    if (p.origin.source === "gps") setNotice(t.gpsRefresh);
    go("plan");
  }
  async function analyze(p: Plan) {
    setError("");
    setNotice("");
    if (!origin || !destination) {
      setError(t.locationMissing);
      return;
    }
    setBusy(true);
    const version = ++requestVersion.current;
    try {
      const actual = {
        ...p,
        origin,
        destination,
        timezone: origin.timezone ?? p.timezone,
        demo,
      };
      setPlan(actual);
      const a = demo
        ? await optimize(actual, (time) => demoForecast(actual, time))
        : await api<Analysis>("/api/analysis/day", actual);
      if (version !== requestVersion.current) return;
      setAnalysis(a);
      setSelected(a.best ?? a.lowest);
      go("results");
    } catch (e) {
      setError(locale === "ar" ? t.error : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function changeLocation(which: "from" | "to", l: Location | null) {
    if (which === "from") {
      setOrigin(l);
      if (l?.timezone) form.setValue("timezone", l.timezone);
    } else setDestination(l);
    form.setValue(
      which === "from" ? "origin" : "destination",
      l ?? { displayName: "", latitude: 0, longitude: 0 },
    );
    setAnalysis(null);
    setSelected(null);
    setWeekly([]);
  }
  async function saveRoute() {
    setError("");
    const p = analysis?.plan ?? form.getValues();
    if (!origin || !destination || !name.trim()) {
      setError(t.locationMissing);
      return;
    }
    const checked = planSchema.safeParse({...p, origin, destination, timezone: origin.timezone ?? p.timezone});
    if (!checked.success) {setError(t.windowError); return;}
    const r = {
      name: name.trim(),
      plan: {
        ...p,
        origin,
        destination,
        timezone: origin.timezone ?? p.timezone,
        demo,
      },
      days,
      reminders,
    };
    try {
      if (demo) {
        const next = editingId ? safeDeviceRoutes().map(old => old.id === editingId ? {...r, id: editingId} : old) : [{ ...r, id: crypto.randomUUID() }, ...safeDeviceRoutes()];
        localStorage.setItem("traffic.demoRoutes", JSON.stringify(next));
        setSaved(next);
      } else {
        if (!user) {
          setSaveOpen(false);
          setAuthOpen(true);
          return;
        }
        await api(editingId ? "/api/routes/" + editingId : "/api/routes", r, editingId ? "PATCH" : "POST");
        setSaved(await api<SavedRoute[]>("/api/routes"));
      }
      setSaveOpen(false);
      setNotice(t.saved);
    } catch (e) {
      setError(locale === "ar" ? t.error : (e as Error).message);
    }
  }
  async function deleteRoute(r: SavedRoute) {
    if (!window.confirm(t.confirmDelete)) return;
    try {
      if (r.plan.origin.source === "demo") {
        const next = safeDeviceRoutes().filter((v) => v.id !== r.id);
        localStorage.setItem("traffic.demoRoutes", JSON.stringify(next));
        setSaved(next);
      } else {
        await api("/api/routes/" + r.id, undefined, "DELETE");
        setSaved(await api<SavedRoute[]>("/api/routes"));
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function runWeek() {
    if (!demo && !user) {
      setError(t.signinForWeek);
      setAuthOpen(true);
      return;
    }
    if (!origin || !destination) {
      setError(t.locationMissing);
      return;
    }
    setError("");
    setBusy(true);
    setWeekly([]);
    const version = ++requestVersion.current;
    const list: (Analysis | null)[] = [];
    const p = {
      ...form.getValues(),
      origin,
      destination,
      timezone: origin.timezone ?? form.getValues("timezone"),
      demo,
    };
    setPlan(p);
    try {
      const days = weeklyPlans(p);
      const count = days.filter(Boolean).length;
      if (!count) {
        setError(t.weekHorizon);
        return;
      }
      if (!demo) {
        const allowance = await api<{ remaining: number }>(
          "/api/analysis/allowance",
        );
        if (allowance.remaining < count) {
          setError(t.weekAllowance);
          return;
        }
      }
      if (count < 7) setNotice(t.weekHorizon);
      for (let i = 0; i < 7; i++) {
        if (version !== requestVersion.current) return;
        setWeekProgress(i + 1);
        const day = days[i];
        if (!day) {
          list.push(null);
          setWeekly([...list]);
          continue;
        }
        try {
          list.push(
            demo
              ? await optimize(day, (time) => demoForecast(day, time))
              : await api<Analysis>("/api/analysis/day", day),
          );
        } catch (e) {
          list.push(null);
          setError(locale === "ar" ? t.error : (e as Error).message);
          if (
            e instanceof ApiFailure &&
            [401, 403, 429, 503].includes(e.status)
          ) {
            while (list.length < 7) list.push(null);
            setWeekly([...list]);
            break;
          }
        }
        if (version !== requestVersion.current) return;
        setWeekly([...list]);
      }
    } catch (e) {
      setError(locale === "ar" ? t.error : (e as Error).message);
    } finally {
      setBusy(false);
      setWeekProgress(0);
    }
  }
  async function liveRefresh() {
    if (!analysis || demo) return;
    setBusy(true);
    try {
      const { candidate } = await api<{ candidate: Candidate }>(
        "/api/analysis/live",
        analysis.plan,
      );
      setNotice(
        `${t.refreshHelp}: ${Math.round(candidate.durationSeconds / 60)} ${t.minutes}`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function savePreferences() {
    if (
      !Number.isInteger(prefs.safety_buffer) ||
      prefs.safety_buffer < 0 ||
      prefs.safety_buffer > 60
    ) {
      setError(
        locale === "ar"
          ? "اختر هامشًا من 0 إلى 60 دقيقة."
          : "Choose a safety buffer from 0 to 60 minutes.",
      );
      return;
    }
    try {
      if (user) {
        await api("/api/preferences", prefs, "PATCH");
      }
      localStorage.setItem(
        "traffic.preferences",
        JSON.stringify({
          navigation: prefs.navigation,
          safety_buffer: prefs.safety_buffer,
        }),
      );
      setLocale(prefs.locale);
      form.setValue("safetyBufferMinutes", prefs.safety_buffer);
      setPlan({ ...plan, safetyBufferMinutes: prefs.safety_buffer });
      setNotice(t.updated);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function enablePush() {
    try {
      if (!user || !config.vapidPublicKey || !("PushManager" in window)) {
        setError(t.pushUnavailable);
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setError(t.pushUnavailable);
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const base64 = config.vapidPublicKey
          .replace(/-/g, "+")
          .replace(/_/g, "/"),
        bytes = Uint8Array.from(
          atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")),
          (c) => c.charCodeAt(0),
        );
      const subscription = await registration.pushManager.getSubscription() ?? await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: bytes,
      });
      await api("/api/push", subscription.toJSON());
      setPush(true);
      setNotice(t.pushEnabled);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function disablePush() {
    try {
      await api("/api/push", undefined, "DELETE");
      const r = await navigator.serviceWorker.ready;
      await (await r.pushManager.getSubscription())?.unsubscribe();
      setPush(false);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function exportRoutes() {
    const blob = new Blob([JSON.stringify(saved, null, 2)], {
        type: "application/json",
      }),
      url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = "traffic-routes.json";
    a.click();
    URL.revokeObjectURL(url);
  }
  const navs = [
    { id: "today", label: t.today, icon: Home },
    { id: "plan", label: t.plan, icon: Navigation },
    { id: "week", label: t.week, icon: CalendarDays },
    { id: "routes", label: t.routes, icon: Bookmark },
    { id: "settings", label: t.settings, icon: Settings },
  ];

  const resultBody = analysis && (
    <>
      <div className="section-heading">
        <div>
          <span className="eyebrow">{demo ? t.demo : t.live}</span>
          <h2>{t.results}</h2>
          <p>{t.resultsHelp}</p>
        </div>
        <button
          className="icon-button"
          aria-label={t.save}
          onClick={() => {
            setName("");
            setEditingId(null);
            setReminders(false);
            setSaveOpen(true);
          }}
        >
          <Bookmark size={21} />
        </button>
      </div>
      <ForecastTimeline analysis={analysis} selected={selected} onSelect={setSelected} locale={locale} />
      <RecommendationCard
        analysis={analysis}
        selected={selected}
        onSelect={setSelected}
        locale={locale}
        t={t}
        navigation={prefs.navigation}
        title={t.best}
        type="best"
        candidate={analysis.best}
      />
      <RecommendationCard
        analysis={analysis}
        selected={selected}
        onSelect={setSelected}
        locale={locale}
        t={t}
        navigation={prefs.navigation}
        title={analysis.lowestMetric === "congestion" ? t.lowest : t.shortest}
        type="low"
        candidate={analysis.lowest}
      />
      {isArrival(analysis.plan) && (
        <RecommendationCard
          analysis={analysis}
          selected={selected}
          onSelect={setSelected}
          locale={locale}
          t={t}
          navigation={prefs.navigation}
          title={t.safe}
          type="late"
          candidate={analysis.latest}
        />
      )}
      {isArrival(analysis.plan) && analysis.earliest && (
        <RecommendationCard analysis={analysis} selected={selected} onSelect={setSelected} locale={locale} t={t} navigation={prefs.navigation} title={t.boundaryStart} type="early" candidate={analysis.earliest} />
      )}
      <div className="avoid-card">
        <Clock size={19} />
        <div>
          <h4>{t.avoid}</h4>
          {analysis.avoid.length ? (
            analysis.avoid.map((v) => (
              <p key={v.start}>
                {clock(v.start, analysis.plan.timezone, locale)} –{" "}
                {clock(v.end, analysis.plan.timezone, locale)} · {v.peakMinutes}{" "}
                {t.minutes}
              </p>
            ))
          ) : (
            <p>{t.noAvoid}</p>
          )}
        </div>
      </div>
      <div className="forecast-meta">
        <span>
          {analysis.samples.length} {t.sampled}
        </span>
        <span>{t.quality}</span>
      </div>
      <details className="notes">
        <summary>{t.warning}</summary>
        <p>{t.windowHelp}</p>
        {analysis.warnings.map((w, i) => (
          <p key={i}>{forecastWarning(w, locale)}</p>
        ))}
        <p>
          {new Date(analysis.createdAt).toLocaleString(locale)} ·{" "}
          {analysis.provider}
        </p>
      </details>
      {!demo && (
        <button
          className="button secondary full"
          disabled={busy}
          onClick={liveRefresh}
        >
          <Clock size={18} />
          {t.liveRefresh}
        </button>
      )}
    </>
  );
  const planner = (
    <form
      onSubmit={form.handleSubmit(analyze, errors => setError(errors.latestTime || errors.endDate || errors.date ? t.windowError : t.locationMissing))}
      className="planner-form"
    >
      <div className="section-heading">
        <div>
          <span className="eyebrow">{t.ready}</span>
          <h1>{page === "today" ? t.empty : t.plan}</h1>
          <p>{t.emptyHelp}</p>
          {config.publicBeta && !user && !demo && !guestReady && (
            <p className="micro-copy">{t.guestVerification}</p>
          )}
        </div>
        <SlidersHorizontal size={20} />
      </div>
      {!demo && <SearchRegion detectedCountry={config.detectedCountry} searchEnabled={config.searchConfigured && Boolean(user || guestReady)} />}
      <div className="locations">
        <LocationField
          label={t.from}
          value={origin}
          onChange={(l) => changeLocation("from", l)}
          gps
          searchEnabled={config.searchConfigured && Boolean(user || guestReady)}
        />
        <button
          type="button"
          className="swap-button"
          aria-label={t.swap}
          onClick={() => {
            const a = origin;
            changeLocation("from", destination);
            changeLocation("to", a);
          }}
        >
          <ArrowDownUp size={17} />
        </button>
        <LocationField
          label={t.to}
          value={destination}
          onChange={(l) => changeLocation("to", l)}
          searchEnabled={config.searchConfigured && Boolean(user || guestReady)}
        />
      </div>
      <div className="mode-tabs" role="group" aria-label={t.plan}>
        {(["arrive_between", "leave_between"] as const).map(
          (m, i) => {
            const Icon = [Clock, Navigation][i];
            return (
              <button
                key={m}
                type="button"
                className={mode === m ? "active" : ""}
                aria-pressed={mode === m}
                onClick={() => form.setValue("mode", m)}
              >
                <Icon size={20} />
                {t[m]}
              </button>
            );
          },
        )}
      </div>
      <p className="micro-copy">{t.windowExplanation}</p>
      <div className="date-time">
        <label>{t.date}<input type="date" {...form.register("date")} min={localDate(Date.now(), form.getValues("timezone"))} /></label>
        <label>{t.endDate}<input type="date" {...form.register("endDate")} min={form.watch("date")} /></label>
      </div>
      <div className="date-time">
        <label>{mode === "arrive_between" ? t.earliestArrivalLabel : t.earliest}<input type="time" {...form.register("earliestTime")} /></label>
        <label>{mode === "arrive_between" ? t.latestArrivalLabel : t.latest}<input type="time" {...form.register("latestTime")} /></label>
      </div>
      <details className="advanced">
        <summary>
          <span>{t.advanced}</span>
          <ChevronDown size={17} />
        </summary>
        <div className="advanced-fields">
          <p className="micro-copy">{t.bufferHelp}</p>
          <label>
            {t.buffer}
            <input
              type="number"
              min="0"
              max="60"
              {...form.register("safetyBufferMinutes", { valueAsNumber: true })}
            />
          </label>
          <label>
            {t.timezone}
            <input {...form.register("timezone")} />
          </label>
        </div>
      </details>
      <button
        className="button primary full analyze-button"
        disabled={
          busy ||
          !online ||
          (!demo && config.publicBeta && !user && !guestReady)
        }
        type="submit"
      >
        {busy ? (
          <LoaderCircle className="spin" size={20} />
        ) : (
          <BarChart3 size={20} />
        )}{" "}
        {busy ? t.finding : t.find}
      </button>
      <p className="micro-copy">{demo ? t.demoAttribution : t.chooseDate}</p>
      {config.publicBeta &&
        !user &&
        !demo &&
        config.turnstileSiteKey &&
        !guestReady && (
          <GuestAccess
            siteKey={config.turnstileSiteKey}
            onReady={() => setGuestReady(true)}
            onError={setError}
          />
        )}
    </form>
  );

  const weekWindows = weekly.map((a) => (a ? windowFor(a.plan, 0) : null));
  const heatWindow = weekWindows.find((w) => w !== null);
  const heatOffsets: number[] = [];
  if (heatWindow) {
    for (
      let offset = 0;
      offset < heatWindow[1] - heatWindow[0];
      offset += 30 * 60000
    )
      heatOffsets.push(offset);
    heatOffsets.push(heatWindow[1] - heatWindow[0]);
  }
  const legal = page === "terms" || page === "privacy";
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          href="/"
          className="brand"
          onClick={(e) => {
            e.preventDefault();
            go("today");
          }}
        >
          <span className="brand-icon">
            <MapPin size={26} />
          </span>
          <strong>
            Traffic
            <br />
            Optimizer
          </strong>
        </a>
        <nav>
          {navs.map((n) => (
            <a
              key={n.id}
              href={n.id === "today" ? "/" : "/" + n.id}
              className={
                page === n.id || (page === "results" && n.id === "plan")
                  ? "active"
                  : ""
              }
              onClick={(e) => {
                e.preventDefault();
                go(n.id);
              }}
            >
              <n.icon size={20} />
              {n.label}
            </a>
          ))}
          {role === "admin" && (
            <a
              href="/admin"
              className={page === "admin" ? "active" : ""}
              onClick={(e) => {
                e.preventDefault();
                go("admin");
              }}
            >
              <Shield size={20} />
              {t.owner}
            </a>
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="side-tip">
            <Sun size={22} />
            <p>{t.tagline}</p>
          </div>
          <button
            onClick={() => setLocale(locale === "en" ? "ar" : "en")}
            className="language-button"
          >
            {locale === "en" ? "العربية" : "English"}
          </button>
          <div className="legal-links">
            <a
              href="/privacy"
              onClick={(e) => {
                e.preventDefault();
                go("privacy");
              }}
            >
              {t.privacy}
            </a>
            <a
              href="/terms"
              onClick={(e) => {
                e.preventDefault();
                go("terms");
              }}
            >
              {t.terms}
            </a>
          </div>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="mobile-brand">
            <span className="brand-icon">
              <MapPin size={23} />
            </span>
            <strong>{t.app}</strong>
          </div>
          <div className="breadcrumb">
            <span>{t.app}</span>
            <span>/</span>
            <b>
              {page === "results"
                ? t.results
                : (navs.find((n) => n.id === page)?.label ?? t.owner)}
            </b>
          </div>
          <div className="topbar-actions">
            <span className={"status " + (demo ? "example" : "")}>
              <span className="status-dot" />
              {demo
                ? t.testOnly
                : configQuery.isError
                  ? t.serviceUnavailable
                  : configQuery.isPending
                    ? t.connecting
                    : config.mode === "live"
                      ? t.live
                      : t.notConnected}
            </span>
            <button
              className="icon-button language-top"
              onClick={() => setLocale(locale === "en" ? "ar" : "en")}
            >
              {locale === "en" ? "ع" : "EN"}
            </button>
            <button
              className="avatar"
              title={user ?? t.signin}
              aria-label={user ?? t.signin}
              onClick={() => (user ? go("settings") : setAuthOpen(true))}
            >
              {user ? (
                user[0].toUpperCase()
              ) : (
                <span>
                  <Home size={18} />
                </span>
              )}
            </button>
          </div>
        </header>
        <div className="workspace">
          {!online && (
            <div className="banner warning" role="status">
              {t.offline}
            </div>
          )}
          {error && (
            <div className="banner error" role="alert">
              {error}
              <button aria-label={t.close} onClick={() => setError("")}>
                <X size={18} />
              </button>
            </div>
          )}
          {notice && (
            <div className="banner success" role="status">
              <Check size={18} />
              {notice}
            </div>
          )}
          {configQuery.isError && !demo && !legal && (
            <div className="banner error" role="alert">
              <span>{t.connectionFailed}</span>
              <button
                className="button small"
                onClick={() => configQuery.refetch()}
              >
                {t.retry}
              </button>
              <button className="button small" onClick={startDemo}>
                {t.tryDemo}
              </button>
            </div>
          )}
          {configQuery.isSuccess &&
            config.mode !== "live" &&
            !demo &&
            !legal && (
              <div className="setup-banner">
                <div>
                  <Shield size={22} />
                  <span>
                    <b>{t.setup}</b>
                    <small>{t.setupHelp}</small>
                  </span>
                </div>
                <button className="button small" onClick={startDemo}>
                  {t.tryDemo}
                </button>
              </div>
            )}
          {demo && !legal && (
            <div className="demo-banner">
              <span>{t.demoAttribution}</span>
              <button
                onClick={() => {
                  setDemo(false);
                  setOrigin(null);
                  setDestination(null);
                  setAnalysis(null);
                  setWeekly([]);
                  setSelected(null);
                  form.reset(defaultPlan());
                  go("plan");
                }}
              >
                {t.switchLive}
              </button>
            </div>
          )}
          {(page === "today" || page === "plan" || page === "results") && (
            <div className="planning-grid">
              <section className="control-panel">
                {page === "results" && analysis ? (
                  <>
                    {resultBody}
                    <button
                      className="button secondary full"
                      onClick={() => go("plan")}
                    >
                      {t.back}
                    </button>
                  </>
                ) : (
                  planner
                )}
              </section>
              <div className="map-results">
                <MapPreview
                  origin={origin}
                  destination={destination}
                  candidate={selected}
                  googleContent={Boolean(analysis?.provider.includes("google"))}
                  mapEnabled={
                    config.mapConfigured && Boolean(user || guestReady)
                  }
                  verificationPending={
                    config.publicBeta && !user && !guestReady
                  }
                />
                {page !== "results" && analysis && (
                  <section className="inline-summary">
                    <Trophy size={24} />
                    <div>
                      <p>{t.best}</p>
                      <h2>
                        {analysis.best
                          ? clock(
                              analysis.best.departureAt,
                              analysis.plan.timezone,
                              locale,
                            )
                          : t.noFeasible}
                      </h2>
                    </div>
                    <button
                      className="button secondary"
                      onClick={() => go("results")}
                    >
                      {t.details}
                    </button>
                  </section>
                )}
                {page !== "results" && !analysis && (
                  <div className="journey-benefits">
                    <div>
                      <Clock size={20} />
                      <span>{t.departure}</span>
                      <p>{t.best}</p>
                    </div>
                    <div>
                      <Leaf size={20} />
                      <span>{t.shortest}</span>
                      <p>{t.drive}</p>
                    </div>
                    <div>
                      <Shield size={20} />
                      <span>{t.buffer}</span>
                      <p>{t.arrive_between}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
          {page === "week" && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">{t.week}</span>
                  <h1>{t.weekTitle}</h1>
                  <p>
                    {origin && destination
                      ? `${origin.displayName} · ${destination.displayName}`
                      : t.weekHelp}
                  </p>
                </div>
                <button
                  className="button primary"
                  disabled={busy || !online}
                  onClick={runWeek}
                >
                  {busy ? (
                    <LoaderCircle size={19} className="spin" />
                  ) : (
                    <BarChart3 size={19} />
                  )}{" "}
                  {weekProgress
                    ? `${t.workingWeek} ${weekProgress}/7`
                    : t.runWeek}
                </button>
              </div>
              <div className="week-grid">
                <section className="panel">
                  <div className="section-heading">
                    <h2>{t.heatmap}</h2>
                    <button
                      className="icon-button"
                      title={t.returnTrip}
                      aria-label={t.returnTrip}
                      onClick={() => {
                        const a = origin;
                        changeLocation("from", destination);
                        changeLocation("to", a);
                      }}
                    >
                      <ArrowDownUp size={19} />
                    </button>
                  </div>
                  {weekly.length ? (
                    <>
                      <div className="heatmap">
                        <div />
                        {Array.from({ length: 7 }, (_, i) => (
                          <b key={i}>
                            {dateLabel(addDays(plan.date, i), locale)}
                          </b>
                        ))}
                        {heatOffsets.map((offset) => {
                          const rowTime = heatWindow![0] + offset;
                          const hm = clock(
                            new Date(rowTime).toISOString(),
                            plan.timezone,
                            locale,
                          );
                          return (
                            <div className="heat-row" key={hm}>
                              <span>{hm}</span>
                              {Array.from({ length: 7 }, (_, day) => {
                                const a = weekly[day];
                                const target = weekWindows[day]
                                  ? weekWindows[day]![0] + offset
                                  : NaN;
                                const c = a?.samples.reduce<
                                  Candidate | undefined
                                >(
                                  (best, c) =>
                                    !best ||
                                    Math.abs(
                                      Date.parse(isArrival(a!.plan) ? c.arrivalAt : c.departureAt) - target,
                                    ) <
                                      Math.abs(
                                        Date.parse(isArrival(a!.plan) ? best.arrivalAt : best.departureAt) - target,
                                      )
                                      ? c
                                      : best,
                                  undefined,
                                );
                                const usable =
                                  c &&
                                  Math.abs(
                                    Date.parse(isArrival(a!.plan) ? c.arrivalAt : c.departureAt) - target,
                                  ) <=
                                    15 * 60000;
                                const min = usable
                                  ? Math.round(c!.durationSeconds / 60)
                                  : null;
                                return (
                                  <button
                                    className={
                                      "heat-cell " +
                                      (min === null
                                        ? "unknown"
                                        : min < 28
                                          ? "low"
                                          : min < 36
                                            ? "medium"
                                            : min < 45
                                              ? "high"
                                              : "severe")
                                    }
                                    key={day}
                                    title={
                                      min === null
                                        ? t.notSampled
                                        : `${hm}: ${min} ${t.minutes}`
                                    }
                                    aria-label={`${dateLabel(addDays(plan.date, day), locale)} ${hm}: ${min === null ? t.notSampled : min + " " + t.minutes}`}
                                    onClick={() => {
                                      if (usable) {
                                        setSelected(c!);
                                        setAnalysis(a!);
                                        setOrigin(a!.plan.origin);
                                        setDestination(a!.plan.destination);
                                        go("results");
                                      }
                                    }}
                                  >
                                    {min ?? "—"}
                                  </button>
                                );
                              })}
                            </div>
                          );
                        })}
                      </div>
                      <div className="heat-legend">
                        <span>
                          <i className="low" />
                          {t.light}
                        </span>
                        <span>
                          <i className="medium" />
                          28–35
                        </span>
                        <span>
                          <i className="high" />
                          36–44
                        </span>
                        <span>
                          <i className="severe" />
                          {t.heavy}
                        </span>
                      </div>
                      <p className="micro-copy">{t.windowHelp}</p>
                    </>
                  ) : (
                    <div className="empty-state">
                      <CalendarDays size={42} />
                      <p>{t.weekEmpty}</p>
                      <button
                        className="button secondary"
                        onClick={() => go("plan")}
                      >
                        {t.plan}
                      </button>
                    </div>
                  )}
                </section>
                <section className="panel">
                  <h2>{t.weeklySummary}</h2>
                  {weekly.map((a, i) => (
                    <div className="day-summary" key={i}>
                      <span>{dateLabel(addDays(plan.date, i), locale)}</span>
                      <strong>
                        {a?.best
                          ? clock(a.best.departureAt, plan.timezone, locale)
                          : "—"}
                      </strong>
                      <small>
                        {a?.best
                          ? `${Math.round(a.best.durationSeconds / 60)} ${t.minutes}`
                          : t.notSampled}
                      </small>
                    </div>
                  ))}
                  <div className="insight-note">
                    <Leaf size={23} />
                    <p>{t.accuracyHelp}</p>
                  </div>
                </section>
              </div>
            </>
          )}
          {page === "routes" && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">
                    {saved.length} {t.count}
                  </span>
                  <h1>{t.routeTitle}</h1>
                  <p>{t.routeHelp}</p>
                </div>
                <button className="button primary" onClick={() => go("plan")}>
                  <Plus size={19} />
                  {t.newRoute}
                </button>
              </div>
              <div className="routes-grid">
                {saved.map((r) => (
                  <article className="saved-route panel" key={r.id}>
                    <div className="saved-route-head">
                      <span className="route-icon">
                        <Route size={23} />
                      </span>
                      <h2>{r.name}</h2>
                      <button
                        className="icon-button danger"
                        aria-label={t.delete + " " + r.name}
                        onClick={() => deleteRoute(r)}
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                    <p>{r.plan.origin.displayName}</p>
                    <p>{r.plan.destination.displayName}</p>
                    <div className="route-pills">
                      <span>
                        {r.plan.origin.source === "demo"
                          ? t.savedOnDevice
                          : t[migratePlan(r.plan).mode]}
                      </span>
                      <span>
                        {r.days.map((d) => t.dayNames[d]).join(" · ")}
                      </span>
                    </div>
                    {r.reminders && (
                      <p>
                        <Bell size={14} /> {t.reminders}
                      </p>
                    )}
                    <button className="button secondary full" onClick={() => {
                      useRoute(r); setEditingId(r.id); setName(r.name); setDays(r.days); setReminders(r.reminders); setSaveOpen(true);
                    }}>{t.edit}</button>
                    <button
                      className="button secondary full"
                      onClick={() => useRoute(r)}
                    >
                      {t.use}
                    </button>
                  </article>
                ))}
                {!saved.length && (
                  <div className="panel empty-state">
                    <Bookmark size={40} />
                    <p>{t.noRoutes}</p>
                    <button
                      className="button secondary"
                      onClick={() => go("plan")}
                    >
                      {t.newRoute}
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
          {page === "settings" && (
            <>
              <div className="page-heading">
                <h1>{t.settings}</h1>
              </div>
              <div className="settings-grid">
                <section className="panel">
                  <h2>{t.account}</h2>
                  {user ? (
                    <>
                      <p>{user}</p>
                      <button
                        className="button secondary"
                        onClick={async () => {
                          await supabase?.auth.signOut();
                          setUser(null);
                        }}
                      >
                        {t.signout}
                      </button>
                    </>
                  ) : (
                    <>
                      <p>{config.authConfigured ? t.signin : t.authSetup}</p>
                      <button
                        className="button secondary"
                        onClick={() => setAuthOpen(true)}
                      >
                        {t.signin}
                      </button>
                    </>
                  )}
                  <hr />
                  <label>
                    {t.language}
                    <select
                      value={locale}
                      onChange={(e) => setLocale(e.target.value as "en" | "ar")}
                    >
                      <option value="en">English</option>
                      <option value="ar">العربية</option>
                    </select>
                  </label>
                  <label>
                    {t.defaultNav}
                    <select
                      value={prefs.navigation}
                      onChange={(e) =>
                        setPrefs({
                          ...prefs,
                          navigation: e.target.value as "ask",
                        })
                      }
                    >
                      <option value="ask">{t.ask}</option>
                      <option value="google">Google Maps</option>
                      <option value="waze">Waze</option>
                    </select>
                  </label>
                  <label>
                    {t.buffer}
                    <input
                      type="number"
                      min="0"
                      max="60"
                      value={prefs.safety_buffer}
                      onChange={(e) =>
                        setPrefs({
                          ...prefs,
                          safety_buffer: Number(e.target.value),
                        })
                      }
                    />
                  </label>
                  <button className="button primary" onClick={savePreferences}>
                    {t.saveSettings}
                  </button>
                </section>
                <section className="panel">
                  <h2>{t.notifications}</h2>
                  <p>{push ? t.pushReady : t.pushHelp}</p>
                  <button
                    className="button secondary"
                    disabled={!config.vapidPublicKey || !user}
                    onClick={push ? disablePush : enablePush}
                  >
                    <Bell size={17} />
                    {push ? t.disablePush : t.enablePush}
                  </button>
                  <hr />
                  <h2>{t.install}</h2>
                  <p>{t.installHelp}</p>
                  {installPrompt && (
                    <button
                      className="button primary"
                      onClick={async () => {
                        await installPrompt.prompt();
                        setInstallPrompt(null);
                      }}
                    >
                      <Download size={17} />
                      {t.install}
                    </button>
                  )}
                  <hr />
                  <h2>{t.privacy}</h2>
                  <p>{t.privacyCopy}</p>
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={prefs.measurement_opt_in}
                      onChange={(e) =>
                        setPrefs({
                          ...prefs,
                          measurement_opt_in: e.target.checked,
                        })
                      }
                    />
                    {t.measurement}
                  </label>
                  <p className="micro-copy">{t.measurementHelp}</p>
                  {prefs.measurement_opt_in && user && (
                    <button
                      className="button secondary"
                      onClick={async () => {
                        if (!tripStart) {
                          setTripStart(new Date().toISOString());
                        } else {
                          try {
                            await api("/api/trips", {
                              actual_departure: tripStart,
                              actual_arrival: new Date().toISOString(),
                            });
                            setTripStart(null);
                            setNotice(t.tripRecorded);
                          } catch (e) {
                            setError((e as Error).message);
                          }
                        }
                      }}
                    >
                      {tripStart ? t.tripEnd : t.tripStart}
                    </button>
                  )}
                  <div className="settings-actions">
                    <button className="text-button" onClick={exportRoutes}>
                      {t.exportData}
                    </button>
                    <button
                      className="text-button danger"
                      onClick={() => {
                        localStorage.removeItem("traffic.demoRoutes");
                        if (demo || !user) setSaved([]);
                        setNotice(t.clearDone);
                      }}
                    >
                      {t.clearData}
                    </button>
                  </div>
                </section>
              </div>
            </>
          )}
          {page === "admin" && (
            <Owner role={role} config={config} t={t} onError={setError} />
          )}
          {legal && (
            <section className="panel legal-page">
              <h1>{page === "privacy" ? t.privacyPolicy : t.terms}</h1>
              <p>{page === "privacy" ? t.privacyCopy : t.termsCopy}</p>
              <p>{t.localPrivacy}</p>
              <p>{t.searchLocationPrivacy}</p>
              <p>{t.measurementHelp}</p>
              <p>{t.navigateTimeHelp}</p>
              <a
                href="https://policies.google.com/privacy"
                target="_blank"
                rel="noopener noreferrer"
              >
                Google Privacy Policy
              </a>
              <a
                href="https://www.google.com/help/terms_maps/"
                target="_blank"
                rel="noopener noreferrer"
              >
                Google Maps Terms of Service
              </a>
              <button className="button secondary" onClick={() => go("plan")}>
                {t.back}
              </button>
            </section>
          )}
        </div>
      </main>
      <nav className="bottom-nav">
        {navs.map((n) => (
          <a
            key={n.id}
            href={n.id === "today" ? "/" : "/" + n.id}
            className={
              page === n.id || (page === "results" && n.id === "plan")
                ? "active"
                : ""
            }
            onClick={(e) => {
              e.preventDefault();
              go(n.id);
            }}
          >
            <n.icon size={22} />
            <span>{n.label}</span>
          </a>
        ))}
      </nav>
      <Dialog.Root open={saveOpen} onOpenChange={setSaveOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content">
            <Dialog.Title>{editingId ? t.edit : t.save}</Dialog.Title>
            <Dialog.Description>{t.saveHelp}</Dialog.Description>
            <Dialog.Close className="dialog-close" aria-label={t.close}>
              <X size={20} />
            </Dialog.Close>
            <label>
              {t.routeName}
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={
                  locale === "ar" ? "المنزل إلى العمل" : "Home to Work"
                }
              />
            </label>
            {editingId && <div className="date-time">
              <label>{isArrival(form.getValues()) ? t.earliestArrivalLabel : t.earliest}<input type="time" value={form.watch("earliestTime")} onChange={e => form.setValue("earliestTime",e.target.value)} /></label>
              <label>{isArrival(form.getValues()) ? t.latestArrivalLabel : t.latest}<input type="time" value={form.watch("latestTime")} onChange={e => form.setValue("latestTime",e.target.value)} /></label>
            </div>}
            <p>{t.days}</p>
            <div className="day-picker">
              {t.dayNames.map((d, i) => (
                <button
                  key={i}
                  className={days.includes(i) ? "active" : ""}
                  aria-pressed={days.includes(i)}
                  onClick={() =>
                    setDays(
                      days.includes(i)
                        ? days.filter((v) => v !== i)
                        : [...days, i],
                    )
                  }
                >
                  {d}
                </button>
              ))}
            </div>
            <label className="check-label">
              <input
                type="checkbox"
                checked={reminders}
                disabled={demo || (!push && !reminders)}
                onChange={(e) => setReminders(e.target.checked)}
              />
              {t.reminders}
            </label>
            {!demo && !push && <p className="micro-copy">{t.pushHelp}</p>}
            <button
              className="button primary full"
              disabled={!name.trim() || !days.length}
              onClick={saveRoute}
            >
              {t.save}
            </button>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root open={authOpen} onOpenChange={setAuthOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content">
            <Dialog.Title>{t.signin}</Dialog.Title>
            <Dialog.Description>
              {config.authConfigured ? t.account : t.authSetup}
            </Dialog.Description>
            <Dialog.Close className="dialog-close" aria-label={t.close}>
              <X size={20} />
            </Dialog.Close>
            {config.authConfigured && config.googleAuthEnabled && (
              <button
                className="button primary full"
                type="button"
                onClick={async () => {
                  try {
                    const { error } = await supabase!.auth.signInWithOAuth({
                      provider: "google",
                      options: { redirectTo: location.origin + "/settings" },
                    });
                    if (error) throw error;
                  } catch (err) {
                    setError((err as Error).message);
                  }
                }}
              >
                {t.signinGoogle}
              </button>
            )}
            {config.authConfigured && (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  try {
                    const { error } = await supabase!.auth.signInWithOtp({
                      email,
                      options: {
                        emailRedirectTo: location.origin + "/settings",
                        shouldCreateUser: config.publicBeta,
                      },
                    });
                    if (error) throw error;
                    setAuthOpen(false);
                    setNotice(t.sentLink);
                  } catch (err) {
                    setError((err as Error).message);
                  }
                }}
              >
                <label>
                  {t.email}
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </label>
                <button className="button primary full" type="submit">
                  {t.sendLink}
                </button>
              </form>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
function Owner({
  role,
  config,
  t,
  onError,
}: {
  role: string;
  config: AppConfig;
  t: typeof en;
  onError: (e: string) => void;
}) {
  const q = useQuery({
    queryKey: ["admin", role],
    enabled: role === "admin",
    queryFn: () => api<any>("/api/admin/overview"),
  });
  const [monthly, setMonthly] = useState("0");
  useEffect(() => { if (q.data) setMonthly(String(q.data.config.monthlyBudget)); }, [q.data]);
  async function update(body: unknown) {
    try {
      await api("/api/admin/config", body, "PATCH");
      await q.refetch();
    } catch (e) {
      onError((e as Error).message);
    }
  }
  if (role !== "admin")
    return (
      <section className="panel empty-state">
        <Shield size={40} />
        <h1>{t.owner}</h1>
        <p>{config.authConfigured ? t.needsOwner : t.ownerSetup}</p>
      </section>
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{t.quotaTitle}</h1>
          <p>{t.quotaHelp}</p>
        </div>
      </div>
      {q.data && (
        <>
          <section className="panel budget-panel">
            <label className="check-label">
              <input
                type="checkbox"
                checked={q.data.config.paid}
                onChange={(e) => update({ paid: e.target.checked })}
              />
              <b>{t.paid}</b>
            </label>
            <div>
              <label>
                {t.budgetUsd}
                <input
                  type="number"
                  min="0"
                  max="1000"
                  value={monthly}
                  onChange={(e) => setMonthly(e.target.value)}
                />
              </label>
              <button
                className="button secondary"
                onClick={() => update({ monthlyBudget: Number(monthly) })}
              >
                {t.saveChanges}
              </button>
            </div>
          </section>
          <section className="panel provider-panel">
            <table>
              <thead>
                <tr>
                  <th>{t.provider}</th>
                  <th>{t.used}</th>
                  <th>{t.hardCap}</th>
                  <th>{t.enabled}</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(q.data.config.providers).map(
                  ([provider, c]: [string, any]) => (
                    <tr key={provider}>
                      <th>{provider}</th>
                      <td>
                        {Object.entries(q.data.usage)
                          .filter(([k]) => k.startsWith(`p:${provider}:`))
                          .reduce((total, [, v]) => total + Number(v), 0)}
                      </td>
                      <td>
                        <input
                          aria-label={`${provider} ${t.hardCap}`}
                          type="number"
                          defaultValue={c.hard}
                          min="0"
                          onBlur={(e) => {
                            if (Number(e.target.value) !== c.hard)
                              update({
                                provider,
                                hard: Number(e.target.value),
                              });
                          }}
                        />
                      </td>
                      <td>
                        <input
                          aria-label={`${provider} ${t.enabled}`}
                          type="checkbox"
                          checked={c.enabled}
                          onChange={(e) =>
                            update({ provider, enabled: e.target.checked })
                          }
                        />
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </section>
          <div className="settings-grid">
            <section className="panel">
              <h2>{t.countryRules}</h2>
              {Object.entries(q.data.config.countries).map(
                ([country, primary]) => (
                  <label key={country}>
                    {t[country as "JO"]}
                    <select
                      value={String(primary)}
                      onChange={(e) =>
                        update({ country, primary: e.target.value })
                      }
                    >
                      <option value="mapbox">Mapbox</option>
                      <option value="google">Google</option>
                    </select>
                  </label>
                ),
              )}
              <h2>{t.accuracy}</h2>
              <p>{t.accuracyHelp}</p>
            </section>
            <section className="panel">
              <h2>{t.audit}</h2>
              {q.data.audit.length ? (
                q.data.audit.slice(0, 5).map((v: any, i: number) => (
                  <p key={i}>
                    {new Date(v.at).toLocaleString()} ·{" "}
                    {JSON.stringify(v.change)}
                  </p>
                ))
              ) : (
                <p>{t.noAudit}</p>
              )}
              <hr />
              <h2>{t.errors}</h2>
              {q.data.errors.length ? (
                q.data.errors.slice(0, 5).map((v: any, i: number) => (
                  <p key={i}>
                    {v.code} · {new Date(v.at).toLocaleString()}
                  </p>
                ))
              ) : (
                <p>{t.noErrors}</p>
              )}
            </section>
          </div>
        </>
      )}
    </>
  );
}

function RecommendationCard({
  candidate,
  title,
  type,
  analysis,
  selected,
  onSelect,
  locale,
  t,
  navigation,
}: {
  candidate: Candidate | null;
  title: string;
  type: "best" | "low" | "late" | "early";
  analysis: Analysis;
  selected: Candidate | null;
  onSelect: (c: Candidate | null) => void;
  locale: "en" | "ar";
  t: typeof en;
  navigation: "ask" | "google" | "waze";
}) {
  const Icon = type === "best" ? Trophy : type === "low" ? Leaf : Clock;
  return (
    <article
      className={
        "result-card " +
        type +
        (selected?.departureAt === candidate?.departureAt ? " chosen" : "")
      }
    >
      <button
        className="result-select"
        disabled={!candidate}
        onClick={() => onSelect(candidate)}
      >
        <div className="card-title">
          <span>
            <Icon size={19} />
            {title}
          </span>
          {type === "best" && candidate && (
            <small className="pill">{t.recommended}</small>
          )}
        </div>
        {candidate ? (
          <>
            <div className="time-row">
              <strong>
                {clock(candidate.departureAt, analysis!.plan.timezone, locale)}
              </strong>
              <span className="arrival">
                {t.arrive}{" "}
                {clock(candidate.arrivalAt, analysis!.plan.timezone, locale)}
              </span>
            </div>
            <div className="drive-row">
              <b>
                {Math.round(candidate.durationSeconds / 60)} {t.minutes}
              </b>
              <span>
                {t.drive} · {(candidate.distanceMeters / 1000).toFixed(1)} km
              </span>
            </div>
          </>
        ) : (
          <p>{t.noFeasible}</p>
        )}
      </button>
      {candidate && (
        <div className="navigation-row">
          <a
            className={navigation === "google" ? "preferred" : undefined}
            href={navUrl(
              "google",
              analysis.plan.origin,
              analysis.plan.destination,
            )}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Navigation size={15} />
            {t.google}
          </a>
          <a
            className={navigation === "waze" ? "preferred" : undefined}
            style={navigation === "waze" ? { order: -1 } : undefined}
            href={navUrl(
              "waze",
              analysis.plan.origin,
              analysis.plan.destination,
            )}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Route size={15} />
            {t.waze}
          </a>
        </div>
      )}
      {candidate?.provider === "google" && (
        <p className="google-attribution" translate="no">
          Google Maps
        </p>
      )}
    </article>
  );
}
