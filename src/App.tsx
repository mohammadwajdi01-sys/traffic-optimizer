import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
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
import { optimize, windowFor, feasible } from "../shared/optimizer";
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
import { liveWindow, weeklyPlans } from "../shared/planning";
import { isArrival, isWindowPlan, migratePlan, recurringPlan } from "../shared/windows";
import { ResultPanel } from "./ResultPanel";
import { TodayView } from "./TodayView";
import { SavedRouteSelector } from "./SavedRouteSelector";
import { initialJourney, rerankAnalysis, recommendationAllowed } from "../shared/journey-options";
import { useSearchLocation } from "./search-location";
import GuestAccess from "./GuestAccess";
import SignInDialog from "./SignInDialog";
import { LocationField } from "./LocationField";
import { SearchRegion } from "./SearchRegion";
import { MapPreview } from "./MapPreview";
import { nextSavedPlan } from "../shared/saved-route";
import { SelectedJourney } from "./SelectedJourney";
import { SavedRouteCard, EditSavedRoute, DeleteSavedRoute } from "./SavedRoutes";
import { WeekResults, type WeekStatus } from "./WeekResults";
import { repeatAr, repeatEn } from "./repeat-copy";
import { Button, FieldError, Modal, Notice, displayFailure } from "./feedback";
import { broadcastWebsiteLock } from "./private-session";
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
  const queryClient = useQueryClient();
  const profileMenu = useRef<HTMLDetailsElement>(null);
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
    t = locale === "ar" ? ar : en,
    repeat = locale === "ar" ? repeatAr : repeatEn;
  const [page, setPage] = useState(location.pathname === "/results" ? "plan" : location.pathname.slice(1) || "today"),
    [origin, setOrigin] = useState<Location | null>(null),
    [destination, setDestination] = useState<Location | null>(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [saveOpen, setSaveOpen] = useState(false),
    [editingRoute, setEditingRoute] = useState<SavedRoute | null>(null),
    [deletingRoute, setDeletingRoute] = useState<SavedRoute | null>(null),
    [weekDays, setWeekDays] = useState([0,1,2,3,4,5,6]),
    [weekStatuses, setWeekStatuses] = useState<WeekStatus[]>([]),
    [name, setName] = useState(""),
    [days, setDays] = useState([0, 1, 2, 3, 4]),
    [reminders, setReminders] = useState(false),
    [saved, setSaved] = useState<SavedRoute[]>(safeDeviceRoutes),
    [savedFor, setSavedFor] = useState<string | null>(null),
    [routesLoading, setRoutesLoading] = useState(false),
    [routesError, setRoutesError] = useState(false),
    [routesReload, setRoutesReload] = useState(0),
    [quickRouteId, setQuickRouteId] = useState(""),
    [instant, setInstant] = useState<{candidate: Candidate; plan: Plan; checkedAt: string} | null>(null),
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
    [guestExpiresAt, setGuestExpiresAt] = useState<number | null>(null),
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
  const requestController = useRef<AbortController | null>(null);
  const mapPanel = useRef<HTMLDivElement>(null);
  const forecastInFlight = useRef(false);
  const restoredOwner = useRef<string | null>(null);
  const accountRef = useRef(user);
  accountRef.current = user;
  const visibleSaved = savedFor === user ? saved : [];
  const accessReady = demo || Boolean(user || guestReady);
  useEffect(() => {
    if (user) setAuthOpen(false);
  }, [user]);
  useEffect(() => {
    const expire = () => {setGuestReady(false); setGuestExpiresAt(null);};
    window.addEventListener("traffic-guest-expired", expire);
    return () => window.removeEventListener("traffic-guest-expired", expire);
  }, []);
  useEffect(() => {
    if (!guestExpiresAt) return;
    const timer = setTimeout(() => setGuestReady(false), Math.max(0, guestExpiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [guestExpiresAt]);
  useEffect(() => {
    const subscription = form.watch((values, info) => {
      if (info.name === "goal") {
        const current = useStore.getState(); setPlan({...current.plan,goal:values.goal});
        if (current.analysis) {const ranked=rerankAnalysis(current.analysis,values.goal);setAnalysis(ranked);setSelected(initialJourney(ranked));}
        return;
      }
      cancelRequest(); setAnalysis(null);setSelected(null);setInstant(null);setWeekly([]);
    });
    return () => subscription.unsubscribe();
  }, [form, setAnalysis]);
  function cancelRequest() {
    requestVersion.current++;requestController.current?.abort();requestController.current=null;
    forecastInFlight.current=false;setBusy(false);setWeekProgress(0);
  }
  useEffect(()=>()=>{requestController.current?.abort();},[]);
  const go = (path: string) => {
    cancelRequest();if(path === "results") path="plan";
    history.pushState(null, "", path === "today" ? "/" : "/" + path);
    setPage(path);
    if (profileMenu.current) profileMenu.current.open = false;
    setError("");
  };
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
    document.title = t.app;
    setPrefs((p) => ({ ...p, locale }));
  }, [locale, t.app]);
  useEffect(() => {
    const pop = () => {cancelRequest();setPage(location.pathname === "/results" ? "plan" : location.pathname.slice(1) || "today");},
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
    try { configureAuth(config); } catch { setError(t.authFailed); return; }
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
    cancelRequest();
    if (restoredOwner.current && restoredOwner.current !== user) {
      setOrigin(null); setDestination(null);
      form.reset({...defaultPlan(), origin:{displayName:"",latitude:0,longitude:0}, destination:{displayName:"",latitude:0,longitude:0}});
      restoredOwner.current = null;
    }
    setEditingRoute(null);setDeletingRoute(null);setWeekStatuses([]);
    setQuickRouteId(""); setInstant(null); setAnalysis(null); setSelected(null); setWeekly([]);
  }, [user]);
  useEffect(() => {
    setSavedFor(user); setRoutesError(false);
    if (!user || demo) {
      setRole("user"); setSaved(safeDeviceRoutes()); setRoutesLoading(false);
      return;
    }
    let active = true;
    setSaved([]); setRoutesLoading(true);
    api<{ role: string }>("/api/me")
      .then(v => {if(active) setRole(v.role);}).catch(() => {});
    api<SavedRoute[]>("/api/routes")
      .then(rows => {if(active) setSaved(rows);})
      .catch(e => {if(active) {setRoutesError(true); setError(displayFailure(e, locale));}})
      .finally(() => {if(active) setRoutesLoading(false);});
    api<any[]>("/api/preferences")
      .then(rows => {
        if (active && rows[0]) {
          setPrefs(rows[0]); setLocale(rows[0].locale);
          if (!restoredOwner.current) form.setValue("safetyBufferMinutes", rows[0].safety_buffer);
        }
      }).catch(() => {});
    return () => {active = false;};
  }, [user, demo, routesReload]);
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
  function useRoute(r: SavedRoute, stayOnPage = false) {
    const p = nextSavedPlan(r);
    setWeekDays(r.days.length ? [...r.days] : [0,1,2,3,4,5,6]);
    setEditingRoute(null);
    const isExample = r.plan.origin.source === "demo";
    setDemo(isExample);
    setQuickRouteId(r.id);
    restoredOwner.current = isExample ? null : user;
    setOrigin(p.origin.source === "gps" ? null : p.origin);
    setDestination(p.destination);
    form.reset(p);
    setPlan(p);
    setAnalysis(null);
    setSelected(null);
    setWeekly([]);
    setNotice([!isWindowPlan(r.plan)?t.migratedRoute:"",p.date!==r.plan.date?`${t.dateAdjusted} ${dateLabel(p.date,locale)}`:"",p.origin.source==="gps"?t.gpsRefresh:""].filter(Boolean).join(" "));
    if(p.origin.source==="gps") useSearchLocation.getState().setContext({countryCode:useSearchLocation.getState().countryCode,source:"manual"});
    if (!stayOnPage) go("plan");
    return p;
  }
  async function runSaved(r: SavedRoute, now = false) {
    if (forecastInFlight.current) return;
    try {
      const p = useRoute(r, now);
      if (now) go("today");
      if (p.origin.source === "gps") return;
      const route = {...p, demo: p.origin.source === "demo"};
      if (now) await leaveNow(route);
      else await analyze(route, route);
    } catch (e) {setError(displayFailure(e, locale));}
  }
  async function analyze(p: Plan, restored?: Plan) {
    setError("");
    setNotice("");
    const from = restored?.origin ?? origin, to = restored?.destination ?? destination;
    if (!from || !to) {setError(t.locationMissing); return;}
    if (forecastInFlight.current) return;
    if(location.pathname!=="/plan")go("plan");
    forecastInFlight.current=true;setBusy(true);
    const controller=new AbortController();requestController.current=controller;
    const version=++requestVersion.current;
    try {
      const actual = {
        ...p,
        origin: from,
        destination: to,
        timezone: from.timezone ?? p.timezone,
        demo: restored?.demo ?? demo,
      };
      const checked=planSchema.safeParse(actual);
      if(!checked.success){applyPlanErrors(checked.error.issues);return;}
      if(!actual.demo){try{liveWindow(actual);}catch{form.setError("date",{message:t.dateError});return;}}
      setPlan(actual);
      const a = actual.demo
        ? await optimize(actual, (time) => demoForecast(actual, time))
        : await api<Analysis>("/api/analysis/day", actual,undefined,controller.signal);
      if (version !== requestVersion.current) return;
      const ranked=rerankAnalysis(a,form.getValues("goal"));setAnalysis(ranked);setSelected(initialJourney(ranked));
    } catch (e) {
      if (version === requestVersion.current) setError(displayFailure(e, locale));
    } finally {
      if(requestController.current===controller){requestController.current=null;forecastInFlight.current=false;setBusy(false);}
    }
  }
  function applyPlanErrors(issues:{path:(string|number)[];message:string}[]){
    for(const issue of issues){const field=issue.path[0] as keyof Plan;
      if(field==="origin" || field==="destination")setError(t.locationMissing);
      if(field==="timezone" || field==="safetyBufferMinutes"){const details=document.querySelector<HTMLDetailsElement>("details.advanced");if(details)details.open=true;}
      form.setError(field,{message:field==="timezone"?t.timezoneError:["date","endDate"].includes(field)?t.dateError:field==="safetyBufferMinutes"?t.bufferError:["earliestTime","latestTime"].includes(field)?t.boundsError:t.locationMissing});}
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
    if(which==="from" && l?.source==="gps" && window.matchMedia?.("(max-width:760px)").matches)
      requestAnimationFrame(()=>mapPanel.current?.scrollIntoView({behavior:window.matchMedia("(prefers-reduced-motion:reduce)").matches?"auto":"smooth",block:"start"}));
  }
  async function saveRoute() {
    const owner = user;
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
        const next = [{ ...r, id: crypto.randomUUID() }, ...safeDeviceRoutes()];
        localStorage.setItem("traffic.demoRoutes", JSON.stringify(next));
        setSaved(next);
      } else {
        if (!user) {
          setSaveOpen(false);
          setAuthOpen(true);
          return;
        }
        await api("/api/routes", r, "POST");
        const rows = await api<SavedRoute[]>("/api/routes");
        if (accountRef.current !== owner) return;
        setSaved(rows);
      }
      setSaveOpen(false);
      setNotice(t.saved);
    } catch (e) {
      setError(displayFailure(e, locale));
    }
  }
  async function updateRoute(r: SavedRoute) {
    const owner = user;
    if (r.plan.origin.source === "demo") {
      const next = safeDeviceRoutes().map(old => old.id === r.id ? r : old);
      localStorage.setItem("traffic.demoRoutes", JSON.stringify(next)); setSaved(next);
    } else {
      await api("/api/routes/" + r.id, {name:r.name,plan:r.plan,days:r.days,reminders:r.reminders}, "PATCH");
      if (accountRef.current !== owner) return;
      const rows = await api<SavedRoute[]>("/api/routes");
      if (accountRef.current !== owner) return;
      setSaved(rows);
    }
    setNotice(t.saved);
  }
  async function deleteRoute(r: SavedRoute) {
    const owner = user;
    if (r.plan.origin.source === "demo") {
      const next = safeDeviceRoutes().filter(v => v.id !== r.id);
      localStorage.setItem("traffic.demoRoutes", JSON.stringify(next)); setSaved(next);
    } else {
      await api("/api/routes/" + r.id, undefined, "DELETE");
      if (accountRef.current !== owner) return;
      const rows = await api<SavedRoute[]>("/api/routes");
      if (accountRef.current !== owner) return;
      setSaved(rows);
    }
    if(quickRouteId===r.id)setQuickRouteId("");
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
    cancelRequest();const controller=new AbortController();requestController.current=controller;
    setError("");setBusy(true);setWeekly([]);const version=++requestVersion.current;
    const list: (Analysis | null)[] = Array(7).fill(null);
    const p = {
      ...form.getValues(),
      origin,
      destination,
      timezone: origin.timezone ?? form.getValues("timezone"),
      demo,
    };
    setPlan(p);
    try {
      if (!demo && !recommendationAllowed(p)) {setError(t.unvalidatedRoute);return;}
      const checked=planSchema.safeParse(p);
      if(!checked.success){setError(t.windowError);return;}
      const days = weeklyPlans(p, Date.now(), weekDays);
      const statuses:WeekStatus[]=days.map((day,i)=>day?"waiting":weekDays.includes(new Date(`${addDays(p.date,i)}T12:00Z`).getUTCDay())?"unavailable":"notSelected");
      setWeekStatuses([...statuses]);
      const count = days.filter(Boolean).length;
      if (!count) {
        setError(repeat.noEligible);
        return;
      }
      if (!demo) {
        const allowance = await api<{ remaining: number }>(
          "/api/analysis/allowance",undefined,undefined,controller.signal,
        );
        if (allowance.remaining < count) {
          setError(t.weekAllowance);
          return;
        }
      }
      if (statuses.includes("unavailable")) setNotice(t.weekHorizon);
      setWeekly([...list]);
      for (let i = 0; i < 7; i++) {
        if (version !== requestVersion.current) return;
        setWeekProgress(i + 1);
        const day = days[i];
        if (!day) {
          continue;
        }
        try {
          statuses[i]="checking";setWeekStatuses([...statuses]);
          const result=demo
            ? await optimize(day, (time) => demoForecast(day, time))
            : await api<Analysis>("/api/analysis/day", day,undefined,controller.signal);
          if(version!==requestVersion.current)return;
          list[i]=result;statuses[i]="done";setWeekStatuses([...statuses]);
        } catch (e) {
          if(version!==requestVersion.current)return;
          statuses[i]="failed";setWeekStatuses([...statuses]);setError(displayFailure(e, locale));
          if (
            e instanceof ApiFailure &&
            [401, 403, 429, 503].includes(e.status)
          ) {
            setWeekly([...list]);
            break;
          }
        }
        if (version !== requestVersion.current) return;
        setWeekly([...list]);
      }
    } catch (e) {
      if(version===requestVersion.current)setError(displayFailure(e, locale));
    } finally {if(requestController.current===controller){requestController.current=null;setBusy(false);setWeekProgress(0);}}
  }
  async function leaveNow(restored?: Plan) {
    if (forecastInFlight.current) return;
    const from = restored?.origin ?? origin, to = restored?.destination ?? destination;
    if (!from || !to) {setError(t.locationMissing); return;}
    const base = restored ?? form.getValues();
    const timezone = from.timezone ?? base.timezone;
    const date = localDate(Date.now(), timezone);
    // Only the locations matter for a current estimate; leave the saved/form bounds intact.
    const currentPlan: Plan = {...base, origin: from, destination: to, timezone, date, endDate: date, mode: "leave_between", earliestTime: "00:00", latestTime: "23:59", safetyBufferMinutes: 0, demo: restored?.demo ?? demo};
    const checked = planSchema.safeParse(currentPlan);
    if (!checked.success) {setError(t.windowError); return;}
    if(location.pathname!=="/")go("today");
    forecastInFlight.current=true;setBusy(true);setError("");setNotice("");
    const controller=new AbortController();requestController.current=controller;const version=++requestVersion.current;
    try {
      const departure = new Date().toISOString();
      const response = currentPlan.demo
        ? {candidate: await demoForecast(currentPlan, departure), checkedAt: departure}
        : await api<{candidate: Candidate; checkedAt: string}>("/api/analysis/live", currentPlan,undefined,controller.signal);
      if (version !== requestVersion.current) return;
      setInstant({...response, plan: currentPlan});
    } catch (e) {
      if (version === requestVersion.current) setError(displayFailure(e, locale));
    } finally {if(requestController.current===controller){requestController.current=null;forecastInFlight.current=false;setBusy(false);}}
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
      setError(displayFailure(e, locale));
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
      setError(displayFailure(e, locale));
    }
  }
  async function disablePush() {
    try {
      await api("/api/push", undefined, "DELETE");
      const r = await navigator.serviceWorker.ready;
      await (await r.pushManager.getSubscription())?.unsubscribe();
      setPush(false);
    } catch (e) {
      setError(displayFailure(e, locale));
    }
  }
  function clearProtected() {
    cancelRequest();
    useSearchLocation.getState().setContext({countryCode:useSearchLocation.getState().countryCode});
    setUser(null); setRole("user"); setSaved([]); setSavedFor(null); setPush(false); setTripStart(null);
    setOrigin(null); setDestination(null); setQuickRouteId(""); setInstant(null); setAnalysis(null); setSelected(null); setWeekly([]);
    restoredOwner.current = null;
    setPrefs({locale, ...devicePreferences(), measurement_opt_in:false});
    setSaveOpen(false); setEditingRoute(null); setAuthOpen(false); setEmail(""); setName(""); setReminders(false); setNotice("");
    const reset = defaultPlan();
    setPlan(reset); form.reset(reset);
    queryClient.removeQueries({predicate:query => query.queryKey[0] !== "config"});
  }
  async function lockWebsite() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/private/lock", {method:"POST", headers:{Accept:"application/json"}});
      if (!response.ok) throw new ApiFailure(response.status, "Website lock failed.");
      clearProtected(); broadcastWebsiteLock(); location.assign("/");
    } catch (error) {setError(displayFailure(error, locale));}
    finally {setBusy(false);}
  }
  async function signOutPersonal(lock = false) {
    setBusy(true); setError("");
    try {
      const result = await supabase?.auth.signOut({scope:"local"});
      if (result?.error) throw result.error;
      clearProtected();
      if (lock) await lockWebsite();
    } catch (error) {setError(displayFailure(error, locale));}
    finally {setBusy(false);}
  }
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key === "traffic.websiteLocked" || (event.key === "traffic.authGateSession" && config.privateSessionId && event.newValue !== config.privateSessionId)) {clearProtected(); location.reload();}
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [config.privateSessionId]);
  function exportRoutes() {
    const blob = new Blob([JSON.stringify(visibleSaved, null, 2)], {
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
  ];

  const savedSelector=<SavedRouteSelector routes={visibleSaved} value={quickRouteId} loading={routesLoading} failed={routesError} busy={busy} signedIn={Boolean(user)} authConfigured={config.authConfigured} locale={locale}
    onSelect={route=>{try{useRoute(route,true);}catch(error){setError(displayFailure(error,locale));}}} onSignIn={()=>setAuthOpen(true)} onRetry={()=>setRoutesReload(value=>value+1)}/>;
  const resultBody=analysis && <ResultPanel navigation={prefs.navigation} analysis={analysis} selected={selected} onSelect={setSelected} locale={locale} onSave={()=>{setName("");setEditingRoute(null);setReminders(false);setSaveOpen(true);}}/>;
  const activeCandidate=page==="today"?instant?.candidate??null:selected;
  let minTravelDate:string;
  try{minTravelDate=localDate(Date.now(),form.getValues("timezone"));}catch{minTravelDate=localDate(Date.now(),"UTC");}
  const endsNextDay=Boolean(form.watch("endDate") && form.watch("endDate")!==form.watch("date"));
  const fieldError=(name:keyof Plan)=><FieldError id={`plan-${name}-error`}>{form.formState.errors[name]?.message as string|undefined}</FieldError>;
  const planner = (
    <form
      onSubmit={page === "today" ? e => {e.preventDefault(); if (origin && destination && accessReady && !busy && online) void leaveNow(); else setError(t.locationMissing);} : form.handleSubmit(p=>analyze(p),errors=>applyPlanErrors(Object.keys(errors).map(field=>({path:[field],message:""}))))}
      className="planner-form"
    >
      <div className="section-heading">
        <div>
          <h1>{page === "today" ? t.todayJourney : t.plan}</h1>
          <p>{page === "today" ? t.todayHelp : t.planHelp}</p>
          {config.publicBeta && !user && !demo && !guestReady && (
            <p className="micro-copy">{t.guestVerification}</p>
          )}
        </div>
        <SlidersHorizontal size={20} />
      </div>
      {savedSelector}
      {config.publicBeta && !user && !demo && config.turnstileSiteKey && !guestReady && (
        <GuestAccess
          siteKey={config.turnstileSiteKey}
          onReady={(expiresAt) => {setGuestExpiresAt(expiresAt); setGuestReady(true); setError("");}}
          onError={message => {if (!authOpen) setError(message);}}
          onSignIn={config.authConfigured ? () => {setError(""); setAuthOpen(true);} : undefined}
        />
      )}
      {!demo && <SearchRegion detectedCountry={config.detectedCountry} searchEnabled={config.searchConfigured && Boolean(user || guestReady)} onLocation={location=>changeLocation("from",location)} />}
      <div className="locations">
        <LocationField
          label={t.from}
          value={origin}
          onChange={(l) => changeLocation("from", l)}
          gps gpsButton={false}
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
      {page !== "today" && <>
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
      <p className="mode-prompt">{mode==="arrive_between"?t.arrivePrompt:t.leavePrompt}</p>
      <div className="date-time">
        <label>{t.date}<input type="date" {...form.register("date")} min={minTravelDate} aria-invalid={Boolean(form.formState.errors.date)} aria-describedby="plan-date-error" onChange={event=>{const overnight=endsNextDay;void form.register("date").onChange(event);if(event.target.value)form.setValue("endDate",addDays(event.target.value,overnight?1:0));}}/>{fieldError("date")}</label>
        <label className="overnight-option"><input type="checkbox" disabled={!form.watch("date")} checked={endsNextDay} onChange={event=>form.setValue("endDate",addDays(form.getValues("date"),event.target.checked?1:0))}/>{t.endsNextDay}</label>
      </div>
      <div className="date-time">
        <label>{mode==="arrive_between"?t.earliestArrivalLabel:t.earliest}<input type="time" aria-label={mode==="arrive_between"?t.earliestArrivalLabel:t.earliest} {...form.register("earliestTime")} aria-invalid={Boolean(form.formState.errors.earliestTime)} aria-describedby="plan-earliestTime-error"/>{fieldError("earliestTime")}</label>
        <label>{mode==="arrive_between"?t.latestArrivalLabel:t.latest}<input type="time" aria-label={mode==="arrive_between"?t.latestArrivalLabel:t.latest} {...form.register("latestTime")} aria-invalid={Boolean(form.formState.errors.latestTime)} aria-describedby="plan-latestTime-error"/>{fieldError("latestTime")}</label>
      </div>
      <label className="goal-picker">{t.goalLabel}<select {...form.register("goal")}><option value="shortest">{t.goalShortest}</option><option value="soonest">{t.goalSoonest}</option></select></label>
      <p className="micro-copy">{form.watch("goal")==="soonest"?t.goalSoonestHelp:t.goalShortestHelp} {analysis && t.goalsReuse}</p>
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
              {...form.register("safetyBufferMinutes",{valueAsNumber:true})} aria-invalid={Boolean(form.formState.errors.safetyBufferMinutes)} aria-describedby="plan-safetyBufferMinutes-error"
            />{fieldError("safetyBufferMinutes")}
          </label>
          <label>
            {t.timezone}
            <input {...form.register("timezone")} aria-invalid={Boolean(form.formState.errors.timezone)} aria-describedby="plan-timezone-error"/>{fieldError("timezone")}
          </label>
        </div>
      </details>
      </>}
      {page === "today" && <button type="button" className="button primary full" disabled={busy || !online || !accessReady || !origin || !destination} onClick={() => leaveNow()}>{busy ? t.finding : t.leaveNow}</button>}
      <button
        className={"button full analyze-button " + (page === "today" ? "secondary" : "primary")} 
        disabled={
          busy ||
          !online ||
          (!demo && config.publicBeta && !user && !guestReady)
        }
        type={page === "today" ? "button" : "submit"}
        onClick={page === "today" ? () => go("plan") : undefined}
      >
        {busy ? (
          <LoaderCircle className="spin" size={20} />
        ) : (
          <BarChart3 size={20} />
        )}{" "}
        {busy ? t.finding : page === "today" ? t.planWindow : t.find}
      </button>
      {page !== "today" && <button type="button" className="button secondary full" disabled={busy || !online || !accessReady || !origin || !destination} onClick={() => leaveNow()}>{t.leaveNow}</button>}
      {busy && <button type="button" className="button secondary full" onClick={()=>{cancelRequest();setNotice(t.cancelHelp);}}>{t.cancelCheck}</button>}
      {error && <p className="micro-copy">{t.retryCheckHelp}</p>}
      <p className="micro-copy">{t.leaveNowHelp}</p>
      <p className="micro-copy">{demo ? t.demoAttribution : page === "today" ? t.todayTimingHelp : t.chooseDate}</p>
    </form>
  );

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
        <nav aria-label={t.app}>
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
                : (navs.find((n) => n.id === page)?.label ?? (page === "settings" ? t.settings : t.owner))}
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
            <details className="profile-menu" ref={profileMenu} onKeyDown={event => {if(event.key === "Escape") {event.currentTarget.open = false;event.currentTarget.querySelector("summary")?.focus();}}}>
              <summary className="avatar" aria-label={t.accountMenu} title={t.accountMenu}>{user ? user[0].toUpperCase() : <Settings size={20}/>}</summary>
              <div className="profile-actions">
                {user ? <p><bdi>{user}</bdi></p> : <Button className="button secondary" onClick={() => {setAuthOpen(true);if(profileMenu.current)profileMenu.current.open=false;}}>{t.signin}</Button>}
                <a href="/settings" onClick={event => {event.preventDefault();go("settings");}}><Settings size={18}/>{t.settings}</a>
                {role === "admin" && user && <a href="/admin" onClick={event => {event.preventDefault();go("admin");}}><Shield size={18}/>{t.owner}</a>}
              </div>
            </details>
            {!user && <Button className="button secondary small" onClick={() => setAuthOpen(true)}>{t.signin}</Button>}
          </div>
        </header>
        <div className="workspace">
          {!online && (
            <div className="banner warning" role="status">
              {t.offline}
            </div>
          )}
          {error && (
            <Notice>
              <span>{error}</span>
              {error === t.accountRequired && <Button className="button secondary small" onClick={() => setAuthOpen(true)}>{t.signin}</Button>}
              <button aria-label={t.close} onClick={() => setError("")}>
                <X size={18} />
              </button>
            </Notice>
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
          {(page==="today" || page==="plan") && <div className="planning-grid">
            <section className="control-panel">{page==="today"?<TodayView navigation={prefs.navigation} instant={instant} locale={locale} busy={busy} online={online} onRefresh={()=>void leaveNow()}>{planner}</TodayView>:planner}</section>
            <div className="map-results" ref={mapPanel}><MapPreview origin={origin} destination={destination} candidate={activeCandidate} googleContent={page==="plan" && Boolean(analysis?.provider.includes("google"))} mapEnabled={config.mapConfigured && Boolean(user||guestReady)} verificationPending={config.publicBeta && !user && !guestReady}/>{page==="plan" && resultBody}</div>
          </div>}
          {page === "week" && <>
            <div className="page-heading"><div><span className="eyebrow">{t.week}</span><h1>{t.weekTitle}</h1><p>{origin&&destination?`${origin.displayName} · ${destination.displayName}`:t.weekHelp}</p></div>
              <Button pending={busy} disabled={!online || !weekDays.length} onClick={()=>void runWeek()}>{weekProgress?`${t.workingWeek} ${weekProgress}/7`:repeat.checkDays}</Button>
            </div>
            {savedSelector}
            <section className="panel week-controls"><label>{repeat.weekStart}<input type="date" min={demo?undefined:minTravelDate} value={form.watch("date")} disabled={busy} onChange={event=>{const date=event.target.value;if(!date)return;const overnight=form.getValues("endDate")!==form.getValues("date");form.setValue("date",date);form.setValue("endDate",overnight?addDays(date,1):date);}}/></label>
              <fieldset className="weekday-fields" disabled={busy}><legend>{repeat.selectedDays}</legend><div className="day-picker">{t.dayNames.map((name,i)=><button type="button" key={i} className={weekDays.includes(i)?"active":""} aria-pressed={weekDays.includes(i)} onClick={()=>{cancelRequest();setWeekly([]);setWeekStatuses([]);setWeekDays(previous=>previous.includes(i)?previous.filter(day=>day!==i):[...previous,i]);}}>{name}</button>)}</div></fieldset>
              <p>{repeat.weekWindow}: {t[mode]} · <bdi>{form.watch("earliestTime")}–{form.watch("latestTime")}</bdi> {endsNextDay?`(${t.endsNextDay})`:""} · <bdi>{form.watch("timezone")}</bdi></p><Button className="button secondary" disabled={busy} onClick={()=>go("plan")}>{repeat.editWindow}</Button><p className="micro-copy">{repeat.selectedHelp}</p>
              {busy&&<Button className="button secondary" onClick={()=>{cancelRequest();setNotice(t.cancelHelp);}}>{t.cancelCheck}</Button>}
            </section>
            {weekly.length?<WeekResults analyses={weekly} statuses={weekStatuses} plan={plan} locale={locale} onChoose={(a,c)=>{form.reset(a.plan);setPlan(a.plan);setInstant(null);setOrigin(a.plan.origin);setDestination(a.plan.destination);setAnalysis(a);setSelected(c);go("plan");}}/>:<section className="panel empty-state"><CalendarDays size={42}/><p>{t.weekEmpty}</p></section>}
          </>}
          {page === "routes" && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">
                    {visibleSaved.length} {t.count}
                  </span>
                  <h1>{t.routeTitle}</h1>
                  <p>{t.routeHelp}</p>
                </div>
                <button className="button primary" onClick={() => go("plan")}>
                  <Plus size={19} />
                  {t.newRoute}
                </button>
              </div>
              {routesLoading && <p role="status">{t.loadingRoutes}</p>}
              {routesError && <button className="button secondary" onClick={() => setRoutesReload(v=>v+1)}>{t.retryRoutes}</button>}
              <div className="routes-grid">
                {visibleSaved.map(r=><SavedRouteCard key={r.id} route={r} locale={locale} disabled={busy || !online || (r.plan.origin.source!=="demo" && !user)} onUse={()=>{try{useRoute(r);}catch(e){setError(displayFailure(e,locale));}}} onNow={()=>void runSaved(r,true)} onEdit={()=>setEditingRoute(r)} onDelete={()=>setDeletingRoute(r)}/>)}
                {!visibleSaved.length && !routesLoading && !routesError && (
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
                      <Button className="button secondary" disabled={busy} onClick={() => void signOutPersonal()}>{t.localSignOut}</Button>
                      <p className="micro-copy">{t.localSignOutHelp}</p>
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
                  {config.privateAccess && <div className="website-actions">
                    <form method="post" action="/private/lock" onSubmit={event => {event.preventDefault();void lockWebsite();}}><Button className="button secondary" type="submit" disabled={busy}>{t.lockSite}</Button></form>
                    <Button className="button secondary" disabled={busy} onClick={() => void signOutPersonal(true)}>{t.lockAndSignOut}</Button>
                    <p className="micro-copy">{t.privateAccountHelp}</p>
                  </div>}
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
                            setError(displayFailure(e, locale));
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
      {saveOpen && <Modal title={t.save} description={t.saveHelp} closeLabel={t.close} onClose={() => setSaveOpen(false)} busy={busy}>
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
      </Modal>}
      {editingRoute && <EditSavedRoute key={editingRoute.id} route={editingRoute} locale={locale} push={push} onSave={updateRoute} onClose={()=>setEditingRoute(null)}/>}
      {deletingRoute && <DeleteSavedRoute key={deletingRoute.id} route={deletingRoute} locale={locale} onDelete={()=>deleteRoute(deletingRoute)} onClose={()=>setDeletingRoute(null)}/>}
      {authOpen && <SignInDialog config={config} email={email} onEmail={setEmail} onClose={() => setAuthOpen(false)} />}
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

