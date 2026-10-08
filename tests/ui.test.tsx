// @vitest-environment jsdom
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import {
  render,
  screen,
  within,
  cleanup,
  waitFor,
  act,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "../src/App";
import {EditSavedRoute, DeleteSavedRoute} from "../src/SavedRoutes";
import {MapPreview} from "../src/MapPreview";
import {mapFailure} from "../src/map-failure";
import GuestAccess from "../src/GuestAccess";
import SignInDialog from "../src/SignInDialog";
import {preparePrivateAccount} from "../src/private-session";
import { displayFailure } from "../src/feedback";
import { en, ar } from "../src/i18n";
import { ApiFailure, configureAuth } from "../src/api";
import {LocationField} from "../src/LocationField";
import {SearchRegion} from "../src/SearchRegion";
import {freshSearchPosition,useSearchLocation} from "../src/search-location";
import { useStore } from "../src/store";
import { optimize } from "../shared/optimizer";
import { demoForecast } from "../shared/demo";
import { defaultPlan } from "../shared/demo";
const auth = vi.hoisted(() => ({
  getSession: vi.fn(async () => ({ data: { session: null } })),
  signOut: vi.fn(async () => ({error:null})),
  signInWithOAuth: vi.fn(async (): Promise<{error: Error | null}> => ({ error: null })),
  signInWithOtp: vi.fn(async (): Promise<{error: Error | null}> => ({ error: null })),
  onAuthStateChange: vi.fn((_callback: any) => ({
    data: { subscription: { unsubscribe: vi.fn() } },
  })),
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ auth }) }));
const mapMock = vi.hoisted(() => ({status:"unavailable",rtl:vi.fn(),create:vi.fn(),language:vi.fn(),remove:vi.fn(),marker:vi.fn(),markerRemove:vi.fn(),center:vi.fn(),source:vi.fn(),bounds:vi.fn(),callbacks:{} as Record<string,Set<(event:any)=>void>>}));
vi.mock("mapbox-gl",()=>({default:{
  getRTLTextPluginStatus:()=>mapMock.status,
  setRTLTextPlugin:(...args:any[])=>{mapMock.rtl(...args);mapMock.status="deferred";},
  Map:class {constructor(options:any){mapMock.create(options);mapMock.callbacks={};}addControl(){}on(name:string,callback:any){(mapMock.callbacks[name]??=new Set()).add(callback);if(name==="load") queueMicrotask(callback);}off(name:string,callback:any){mapMock.callbacks[name]?.delete(callback);}remove(){mapMock.remove();}setLanguage(language:string){mapMock.language(language);}isStyleLoaded(){return true;}getSource(){return {setData:mapMock.source};}easeTo(options:any){mapMock.center(options);}fitBounds(options:any){mapMock.bounds(options);}},
  NavigationControl:class {},
  Marker:class {setLngLat(coords:any){mapMock.marker(coords);return this;}addTo(){return this;}remove(){mapMock.markerRemove();}},
  LngLatBounds:class {extend(){return this;}},
}}));
beforeEach(() => {
  auth.getSession.mockReset().mockResolvedValue({data:{session:null}});
  auth.onAuthStateChange.mockReset().mockImplementation((_callback:any)=>({data:{subscription:{unsubscribe:vi.fn()}}}));
  auth.signOut.mockReset().mockResolvedValue({error:null});
  auth.signInWithOAuth.mockReset().mockResolvedValue({error: null});
  auth.signInWithOtp.mockReset().mockResolvedValue({error: null});
  localStorage.clear();
  useSearchLocation.getState().setContext({});
  history.replaceState(null, "", "/");
  useStore.getState().setLocale("en");
  useStore.getState().setDemo(false);
  useStore.getState().setPlan(defaultPlan());
  useStore.getState().setAnalysis(null);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        mode: "setup",
        authConfigured: false,
        searchConfigured: false,
        trafficConfigured: false,
        mapConfigured: false,
        publicBeta: false,
      }),
    })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe("Guest verification recovery", () => {
  it("keeps access locked after a challenge failure and supports an explicit refresh", async () => {
    let options: any;
    const renderWidget = vi.fn((_root, value) => {
      options = value;
      return "widget-id";
    });
    const ready = vi.fn();
    vi.stubGlobal("turnstile", { render: renderWidget, remove: vi.fn() });
    render(
      <GuestAccess siteKey="test-site-key" onReady={ready} onError={vi.fn()} />,
    );
    await waitFor(() => expect(renderWidget).toHaveBeenCalledTimes(1));
    act(() => {
      options["error-callback"]("200500");
    });
    expect(ready).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toContain("could not load");
    expect(screen.getByText(/Verification code:/).textContent).toContain("200500");
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Refresh verification" }));
    await waitFor(() => expect(renderWidget).toHaveBeenCalledTimes(2));
    expect(ready).not.toHaveBeenCalled();
  });
  it("unlocks access only after server validation succeeds", async () => {
    let options: any;
    const ready = vi.fn();
    vi.stubGlobal("turnstile", {
      render: (_root: unknown, value: any) => {
        options = value;
        return "widget-id";
      },
      remove: vi.fn(),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        json: async () => ({ error: "Verification failed." }),
      })),
    );
    render(
      <GuestAccess siteKey="test-site-key" onReady={ready} onError={vi.fn()} />,
    );
    await waitFor(() => expect(options).toBeDefined());
    await act(async () => {
      await options.callback("test-token");
    });
    expect(ready).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toContain(
      "Verification failed.",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, expiresAt: Date.now() + 3600000 }) })),
    );
    await act(async () => {
      await options.callback("new-test-token");
    });
    expect(ready).toHaveBeenCalledTimes(1);
  });
  it("restores only a server-verified unexpired session without loading a challenge", async () => {
    const expiresAt = Date.now() + 60000;
    const widget = vi.fn(); const ready = vi.fn();
    vi.stubGlobal("turnstile", {render:widget,remove:vi.fn()});
    vi.stubGlobal("fetch", vi.fn(async () => ({ok:true,json:async()=>({verified:true,expiresAt})})));
    render(<GuestAccess siteKey="test-site-key" onReady={ready} onError={vi.fn()}/>);
    await waitFor(()=>expect(ready).toHaveBeenCalledWith(expiresAt));
    expect(widget).not.toHaveBeenCalled();
  });
  it("uses explicit rendering after async script load without calling the incompatible ready API", async () => {
    document.getElementById("turnstile-script")?.remove();
    const widget=vi.fn(()=>"id");
    const incompatibleReady=vi.fn(()=>{throw new Error("Remove async/defer before using ready()");});
    render(<GuestAccess siteKey="test-site-key" onReady={vi.fn()} onError={vi.fn()}/>);
    await waitFor(()=>expect(document.getElementById("turnstile-script")).not.toBeNull());
    const script=document.getElementById("turnstile-script") as HTMLScriptElement;
    expect(script.async).toBe(true);
    expect(widget).not.toHaveBeenCalled();
    vi.stubGlobal("turnstile",{ready:incompatibleReady,render:widget,remove:vi.fn()});
    act(()=>script.dispatchEvent(new Event("load")));
    expect(widget).toHaveBeenCalledTimes(1);
    expect(incompatibleReady).not.toHaveBeenCalled();
    await userEvent.setup().click(screen.getByRole("button",{name:"Refresh verification"}));
    await waitFor(()=>expect(widget).toHaveBeenCalledTimes(2));
    act(()=>script.dispatchEvent(new Event("load")));
    expect(widget).toHaveBeenCalledTimes(2);
    expect(incompatibleReady).not.toHaveBeenCalled();
  });
  it("submits a challenge once and ignores old challenge callbacks after refresh", async () => {
    const options:any[]=[]; let release:(v:any)=>void=()=>{};
    const post=vi.fn(()=>new Promise(resolve=>{release=resolve;}));
    vi.stubGlobal("turnstile", {render:(_r:any,o:any)=>{options.push(o);return "id";},remove:vi.fn()});
    vi.stubGlobal("fetch",vi.fn(async (_url:any,init:any)=>init.method==="POST" ? post() : {ok:true,json:async()=>({verified:false})}));
    const ready=vi.fn();
    render(<GuestAccess siteKey="test-site-key" onReady={ready} onError={vi.fn()}/>);
    await waitFor(()=>expect(options).toHaveLength(1));
    let pending:Promise<void>;
    act(()=>{pending=options[0].callback("test-token"); options[0].callback("test-token");});
    await waitFor(()=>expect(post).toHaveBeenCalledTimes(1));
    await act(async()=>{release({ok:true,json:async()=>({ok:true,expiresAt:Date.now()+60000})});await pending;});
    expect(ready).toHaveBeenCalledTimes(1);
    await act(async()=>{await options[0].callback("old-token");});
    expect(post).toHaveBeenCalledTimes(1);
  });
  it("ignores callbacks from a removed challenge and keeps routes locked", async () => {
    const options:any[]=[]; const ready=vi.fn();
    vi.stubGlobal("turnstile",{render:(_r:any,o:any)=>{options.push(o);return "id";},remove:vi.fn()});
    const fetcher=vi.fn(async()=>({ok:true,json:async()=>({verified:false})}));
    vi.stubGlobal("fetch",fetcher);
    render(<GuestAccess siteKey="test-site-key" onReady={ready} onError={vi.fn()}/>);
    await waitFor(()=>expect(options).toHaveLength(1));
    await userEvent.setup().click(screen.getByRole("button",{name:"Refresh verification"}));
    await waitFor(()=>expect(options).toHaveLength(2));
    const calls=fetcher.mock.calls.length;
    await act(async()=>{await options[0].callback("stale-token");options[0]["error-callback"]("110200");});
    expect(fetcher).toHaveBeenCalledTimes(calls);
    expect(ready).not.toHaveBeenCalled();
    expect(screen.queryByText(/110200/)).toBeNull();
  });
  it("shows safe localized configuration and browser codes without granting access", async()=>{
    let options:any; const ready=vi.fn();
    vi.stubGlobal("turnstile",{render:(_r:any,o:any)=>{options=o;return "id";},remove:vi.fn()});
    useStore.getState().setLocale("ar");
    render(<GuestAccess siteKey="test-site-key" onReady={ready} onError={vi.fn()}/>);
    await waitFor(()=>expect(options).toBeDefined());
    act(()=>options["error-callback"]("110200"));
    expect(screen.getByRole("status").textContent).toContain("إعداد");
    expect(screen.getByText(/رمز التحقق/).textContent).toContain("110200");
    act(()=>options["error-callback"]("600010"));
    expect(screen.getByRole("status").textContent).toContain("المتصفح");
    act(()=>options["error-callback"]("<private-value>"));
    expect(screen.queryByText(/private-value/)).toBeNull();
    expect(ready).not.toHaveBeenCalled();
  });
});
function mount() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <App />
    </QueryClientProvider>,
  );
}
describe("Sign-in recovery after a failed human check", () => {
  const config = {mode: "live" as const, authConfigured: true, googleAuthEnabled: true,
    publicBeta: true, supabaseUrl: "https://example.supabase.co", supabaseKey: "sb_publishable_test",
    searchConfigured: true, trafficConfigured: true, mapConfigured: false};
  function dialog() {
    configureAuth(config);
    return render(<SignInDialog config={config} email="route-test@example.com" onEmail={vi.fn()} onClose={vi.fn()} />);
  }
  it("opens account sign-in directly from a failed challenge without granting guest access", async () => {
    let options: any;
    vi.stubGlobal("turnstile", {render: (_r: unknown, o: any) => {options=o; return "id";},remove: vi.fn()});
    vi.stubGlobal("fetch", vi.fn(async (url: unknown) => ({ok: true,json: async () => String(url).endsWith("/api/config") ? {...config, turnstileSiteKey: "test-site-key"} : {verified: false}})));
    mount();
    await waitFor(() => expect(options).toBeDefined());
    act(() => options["error-callback"]("600010"));
    const planButton=screen.getByRole("button",{name:"Plan a time window"});
    const locationButton=screen.getByRole("button",{name:"Use current location"});
    const card = screen.getByRole("region", {name: /Complete the human verification/});
    await userEvent.setup().click(within(card).getByRole("button", {name:"Sign in"}));
    expect(await screen.findByRole("dialog",{name:"Sign in"})).toBeTruthy();
    expect(planButton.hasAttribute("disabled")).toBe(true);
    expect(locationButton.hasAttribute("disabled")).toBe(true);
  });
  it("shows Google failures inside the open dialog and permits a retry", async () => {
    auth.signInWithOAuth.mockResolvedValueOnce({error:new Error("Google sign-in request failed")});
    dialog();
    await userEvent.setup().click(screen.getByRole("button",{name:"Continue with Google"}));
    const modal=screen.getByRole("dialog");
    expect((await within(modal).findByRole("alert")).textContent).toContain("Sign-in could not finish");
    await userEvent.setup().click(within(modal).getByRole("button",{name:"Continue with Google"}));
    await waitFor(()=>expect(within(modal).queryByRole("alert")).toBeNull());
    expect(auth.signInWithOAuth).toHaveBeenCalledTimes(2);
  });
  it("reports email failure within the dialog without claiming the link was sent", async () => {
    auth.signInWithOtp.mockResolvedValueOnce({error:Object.assign(new Error("Email request rate limit reached"),{status:429})});
    dialog();
    await userEvent.setup().click(screen.getByRole("button",{name:"Email a sign-in link"}));
    expect((await within(screen.getByRole("dialog")).findByRole("alert")).textContent).toContain("usage limit");
    expect(screen.queryByText(/Sign-in link requested/)).toBeNull();
  });
  it("prevents duplicate requests and explains that a requested email link is not sign-in", async () => {
    let release!: (v:{error:null})=>void;
    auth.signInWithOtp.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
    dialog();
    const u=userEvent.setup();
    const submit=screen.getByRole("button",{name:"Email a sign-in link"});
    await u.click(submit); await u.click(submit);
    expect(auth.signInWithOtp).toHaveBeenCalledTimes(1);
    expect(submit.hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button",{name:"Continue with Google"}).hasAttribute("disabled")).toBe(true);
    await act(async()=>release({error:null}));
    expect((await screen.findByRole("status")).textContent).toContain("You are not signed in yet");
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
  it("discards late errors after the dialog is unmounted", async () => {
    let release!: (v:{error:Error})=>void;
    auth.signInWithOAuth.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
    const view=dialog();
    await userEvent.setup().click(screen.getByRole("button",{name:"Continue with Google"}));
    view.unmount(); dialog();
    await act(async()=>release({error:new Error("Old request failed")}));
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("keeps email-request completion and recovery controls in Arabic", async () => {
    useStore.getState().setLocale("ar"); dialog();
    await userEvent.setup().click(screen.getByRole("button",{name:"أرسل رابط تسجيل الدخول"}));
    expect((await screen.findByRole("status")).textContent).toContain("لم يتم تسجيل دخولك بعد");
  });
});
describe("Application interactions without service credentials", () => {
  it("distinguishes an unreachable backend from an unconfigured service", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Network unavailable");
      }),
    );
    mount();
    await screen.findByText("Service unavailable");
    expect(screen.queryByText("Live traffic is not connected yet.")).toBeNull();
    expect(screen.getByRole("button", { name: "Try an example" })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("couldn't reach");
  });
  it("keeps live status honest and executes an example with a valid deadline", async () => {
    const u = userEvent.setup();
    mount();
    await screen.findByText("Live traffic is not connected yet.");
    await u.click(
      await screen.findByRole("button", { name: "Try an example" }),
    );
    await u.click(screen.getByRole("button", { name: "Find best time" }));
    await screen.findByRole("heading", { name: "Best times to leave" });
    const a = useStore.getState().analysis;
    expect(a?.best).not.toBeNull();
    expect(Date.parse(a!.best!.arrivalAt)).toBeLessThanOrEqual(
      Date.parse(a!.plan.date + "T07:00:00Z"),
    );
    expect(a!.samples.every((c) => c.provider === "demo")).toBe(true);
    const link = within(document.querySelector(".result-panel .selected-journey")!).getByRole(
      "link",
      { name: "Google Maps" },
    );
    expect(link.getAttribute("href")).toContain("google.com/maps/dir/?api=1");
  });
  it("saves an example route locally and restores it from Routes", async () => {
    const u = userEvent.setup();
    mount();
    await u.click(
      await screen.findByRole("button", { name: "Try an example" }),
    );
    await u.click(screen.getByRole("button", { name: "Find best time" }));
    await screen.findByRole("heading", { name: "Best times to leave" });
    await u.click(screen.getByRole("button", { name: "Save route" }));
    await u.type(screen.getByLabelText("Route name"), "University");
    await u.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Save route",
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await u.click(
      within(document.querySelector(".sidebar")!).getByRole("link", {
        name: "Routes",
      }),
    );
    await screen.findByRole("heading", { name: "University" });
    expect(
      JSON.parse(localStorage.getItem("traffic.demoRoutes")!),
    ).toHaveLength(1);
  });
  it("computes seven days and changes the whole interface to Arabic RTL", async () => {
    const u = userEvent.setup();
    mount();
    await u.click(
      await screen.findByRole("button", { name: "Try an example" }),
    );
    await u.click(
      within(document.querySelector(".sidebar")!).getByRole("link", {
        name: "Week",
      }),
    );
    await u.click(screen.getByRole("button", { name: "Check selected days" }));
    await waitFor(() =>
      expect(document.querySelectorAll(".day-summary").length).toBe(7),
    );
    expect(document.querySelectorAll(".heat-cell").length).toBe(35);
    await u.click(screen.getByRole("button", { name: "ع" }));
    expect(document.documentElement.dir).toBe("rtl");
    await screen.findByRole("heading", { name: "رحلات أسبوعك المختبرة" });
  });
  it("does not expose active owner switches to a visitor", async () => {
    history.replaceState(null, "", "/admin");
    mount();
    await screen.findByRole("heading", {
      name: "Owner dashboard",
    });
    expect(
      screen.queryByRole("checkbox", { name: "Allow paid provider requests" }),
    ).toBeNull();
  });
  it("uses the afternoon window for weekly forecasts", async () => {
    const u = userEvent.setup();
    mount();
    await u.click(
      await screen.findByRole("button", { name: "Try an example" }),
    );
    await u.click(screen.getByRole("button", { name: "Leave between" }));
    const time = screen.getByLabelText("Earliest departure");
    await u.clear(time);
    await u.type(time, "16:00");
    await u.clear(screen.getByLabelText("Latest departure"));
    await u.type(screen.getByLabelText("Latest departure"), "18:00");
    await u.click(
      within(document.querySelector(".sidebar")!).getByRole("link", {
        name: "Week",
      }),
    );
    await u.click(screen.getByRole("button", { name: "Check selected days" }));
    await waitFor(() =>
      expect(document.querySelectorAll(".day-summary")).toHaveLength(7),
    );
    const labels = [...document.querySelectorAll(".heat-row > span")].map(
      (n) => n.textContent,
    );
    expect(labels).toContain("4:00 PM");
    expect(labels.some((s) => s?.includes("AM"))).toBe(false);
    expect(
      document.querySelectorAll(".heat-cell:not(.unknown)").length,
    ).toBeGreaterThan(0);
  });
  it("applies saved buffer and navigation preferences to a new plan", async () => {
    const u = userEvent.setup();
    history.replaceState(null, "", "/settings");
    mount();
    await u.selectOptions(
      screen.getByLabelText("Preferred navigation"),
      "waze",
    );
    await u.clear(screen.getByLabelText("Safety buffer"));
    await u.type(screen.getByLabelText("Safety buffer"), "20");
    await u.click(screen.getByRole("button", { name: "Save preferences" }));
    await u.click(
      await screen.findByRole("button", { name: "Try an example" }),
    );
    await u.click(screen.getByRole("button", { name: "Find best time" }));
    await screen.findByRole("heading", { name: "Best times to leave" });
    expect(useStore.getState().analysis?.plan.safetyBufferMinutes).toBe(20);
    expect(
      document.querySelector(".selected-journey a.preferred")?.textContent,
    ).toContain("Waze");
    expect(
      JSON.parse(localStorage.getItem("traffic.preferences")!).navigation,
    ).toBe("waze");
  });
  it("selects address suggestions with the keyboard", async () => {
    const u = userEvent.setup();
    mount();
    await u.click(
      await screen.findByRole("button", { name: "Try an example" }),
    );
    const origin = screen.getByRole("combobox", { name: "From" });
    await u.clear(origin);
    await u.type(origin, "Khalda");
    await screen.findByRole("option",{name:"Khalda, Amman"});
    await u.keyboard("{ArrowDown}{Enter}");
    expect(origin.getAttribute("aria-expanded")).toBe("false");
    expect((origin as HTMLInputElement).value).toContain("Khalda");
  });
});

describe("Weekly sign-in and Google login", () => {
  it("asks a guest to sign in before spending any weekly allowance", async () => {
    history.replaceState(null, "", "/week");
    const request = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        mode: "live",
        authConfigured: true,
        googleAuthEnabled: true,
        supabaseUrl: "https://example.supabase.co",
        supabaseKey: "sb_publishable_test",
        publicBeta: true,
        searchConfigured: false,
        trafficConfigured: false,
        mapConfigured: false,
      }),
    }));
    vi.stubGlobal("fetch", request);
    mount();
    await waitFor(() => expect(auth.onAuthStateChange).toHaveBeenCalled());
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Check selected days" }));
    await screen.findByRole("dialog");
    expect(
      request.mock.calls.some((args: unknown[]) =>
        String(args[0]).includes("/api/analysis/"),
      ),
    ).toBe(false);
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: location.origin + "/settings" },
    });
  });
});

describe("Coordinate and whole-window regressions", () => {
  it("accepts pasted public coordinates and applies them without submitting the planner", async () => {
    const u=userEvent.setup(), change=vi.fn(), submit=vi.fn(e=>e.preventDefault());
    useSearchLocation.getState().setContext({countryCode:"JO",source:"manual"});
    render(<form onSubmit={submit}><LocationField label="From" value={null} onChange={change} searchEnabled={false} gps /></form>);
    await u.click(screen.getByRole("combobox",{name:"From"}));
    await u.click(screen.getByRole("button",{name:"Use coordinates"}));
    await u.type(screen.getByLabelText("Paste coordinates (latitude, longitude)"),"31.9455631, 35.9271963");
    await u.click(screen.getByRole("button",{name:"Use location"}));
    expect(change).toHaveBeenLastCalledWith(expect.objectContaining({latitude:31.9455631,longitude:35.9271963,timezone:"Asia/Amman",source:"manual"}));
    expect(screen.queryByLabelText("Latitude")).toBeNull(); expect(submit).not.toHaveBeenCalled();
  });
  it("accepts zero, signed coordinates and Arabic decimal digits",async()=>{
    const u=userEvent.setup(), change=vi.fn();
    render(<LocationField label="From" value={null} onChange={change} searchEnabled={false} gps />);
    await u.click(screen.getByRole("combobox",{name:"From"}));await u.click(screen.getByRole("button",{name:"Use coordinates"}));
    await u.type(screen.getByLabelText("Latitude"),"٠");await u.type(screen.getByLabelText("Longitude"),"−٣٥٫٩٢");
    await u.click(screen.getByRole("button",{name:"Use location"}));
    expect(change).toHaveBeenLastCalledWith(expect.objectContaining({latitude:0,longitude:-35.92}));
  });
  it("shows specific coordinate/timezone errors and Cancel preserves a prior selection",async()=>{
    const u=userEvent.setup(), change=vi.fn(), location={displayName:"Landmark",latitude:31.9,longitude:35.9,timezone:"Asia/Amman"};
    render(<LocationField label="From" value={location} onChange={change} searchEnabled={false} gps />);
    await u.click(screen.getByRole("combobox",{name:"From"}));await u.click(screen.getByRole("button",{name:"Use coordinates"}));
    await u.type(screen.getByLabelText("Paste coordinates (latitude, longitude)"),"31.9, 35.9, 52");
    await u.click(screen.getByRole("button",{name:"Use location"}));expect(screen.getByRole("alert").textContent).toContain("−90 to 90");expect(change).not.toHaveBeenCalled();
    await u.clear(screen.getByLabelText("Paste coordinates (latitude, longitude)"));
    await u.clear(screen.getByLabelText("Latitude"));await u.type(screen.getByLabelText("Latitude"),"Infinity");
    await u.click(screen.getByRole("button",{name:"Use location"}));expect(screen.getByRole("alert").textContent).toContain("−90 to 90");expect(change).not.toHaveBeenCalled();
    await u.clear(screen.getByLabelText("Latitude"));await u.type(screen.getByLabelText("Latitude"),"32");
    await u.clear(screen.getByLabelText("Origin timezone"));await u.type(screen.getByLabelText("Origin timezone"),"invalid");
    await u.click(screen.getByRole("button",{name:"Use location"}));expect(screen.getByRole("alert").textContent).toContain("valid timezone");
    await u.click(screen.getByRole("button",{name:"Cancel"}));expect(screen.getByRole("combobox",{name:"From"}).getAttribute("value")).toBe("Landmark");expect(change).not.toHaveBeenCalled();
  });
  it("exposes only two modes, renders both chart endpoints and invalidates results on input edits",async()=>{
    const u=userEvent.setup();mount();await u.click(await screen.findByRole("button",{name:"Try an example"}));
    expect(screen.queryByRole("button",{name:"Avoid traffic"})).toBeNull();expect(screen.queryByLabelText("Explore up to this many minutes earlier")).toBeNull();
    await u.click(screen.getByRole("button",{name:"Find best time"}));await screen.findByRole("heading",{name:"Best times to leave"});
    const chart=screen.getByRole("region",{name:"Your complete time window"});
    expect(chart.textContent).toContain("8:00 AM");expect(chart.textContent).toContain("10:00 AM");expect(chart.textContent).toContain("Estimated arrival time");
    await u.click(within(document.querySelector(".sidebar")!).getByRole("link",{name:"Plan"}));
    await u.clear(screen.getByLabelText("Latest arrival"));await u.type(screen.getByLabelText("Latest arrival"),"11:00");
    expect(useStore.getState().analysis).toBeNull();
  });
  it("edits a saved route's name, bounds and days and restores the updated values",async()=>{
    const u=userEvent.setup();mount();await u.click(await screen.findByRole("button",{name:"Try an example"}));
    await u.click(screen.getByRole("button",{name:"Find best time"}));await screen.findByRole("heading",{name:"Best times to leave"});
    await u.click(screen.getByRole("button",{name:"Save route"}));await u.type(screen.getByLabelText("Route name"),"Old route");
    await u.click(within(screen.getByRole("dialog")).getByRole("button",{name:"Save route"}));
    await u.click(within(document.querySelector(".sidebar")!).getByRole("link",{name:"Routes"}));
    await u.click(screen.getByLabelText("Route actions: Old route"));await u.click(screen.getByRole("button",{name:"Edit or rename"}));const dialog=within(screen.getByRole("dialog"));
    await u.clear(dialog.getByLabelText("Route name"));await u.type(dialog.getByLabelText("Route name"),"Updated route");
    await u.clear(dialog.getByLabelText("Latest arrival"));await u.type(dialog.getByLabelText("Latest arrival"),"11:00");
    await u.click(dialog.getByRole("button",{name:"Sat"}));await u.click(dialog.getByRole("button",{name:"Save changes"}));
    const rows=JSON.parse(localStorage.getItem("traffic.demoRoutes")!);expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({name:"Updated route",plan:{latestTime:"11:00",mode:"arrive_between"}});expect(rows[0].days).toContain(6);
  });
});


describe("Location sharing and country search", () => {
  it("requires a click before GPS, detects the country and clears precise bias on manual country change", async () => {
    const u = userEvent.setup(), getCurrentPosition = vi.fn((success, _fail, _options) => success({coords:{latitude:31.95,longitude:35.91}}));
    Object.defineProperty(navigator,"geolocation",{configurable:true,value:{getCurrentPosition}});
    const request = vi.fn(async () => ({ok:true,json:async () => ({locations:[{countryCode:"JO",timezone:"Asia/Amman"}]})}));
    vi.stubGlobal("fetch",request);
    render(<SearchRegion detectedCountry="LY" searchEnabled />);
    expect(useSearchLocation.getState().countryCode).toBe("LY");
    expect(getCurrentPosition).not.toHaveBeenCalled();
    await u.click(screen.getByRole("button",{name:"Share location for nearby results"}));
    await waitFor(() => expect(useSearchLocation.getState().countryCode).toBe("JO"));
    expect(getCurrentPosition.mock.calls[0][2]).toMatchObject({maximumAge:0,enableHighAccuracy:true});
    expect(useSearchLocation.getState().position?.latitude).toBe(31.95);
    expect(localStorage.getItem("traffic.searchLocation")).toBeNull();
    await u.selectOptions(screen.getByRole("combobox",{name:"Search country"}),"SA");
    expect(useSearchLocation.getState().position).toBeUndefined();
    expect(useSearchLocation.getState().countryCode).toBe("SA");
  });
  it("keeps manual country search usable when permission is denied", async () => {
    const u = userEvent.setup();
    Object.defineProperty(navigator,"geolocation",{configurable:true,value:{getCurrentPosition:vi.fn((_success,fail) => fail({code:1}))}});
    render(<SearchRegion detectedCountry="JO" searchEnabled />);
    await u.click(screen.getByRole("button",{name:"Share location for nearby results"}));
    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).toContain("Choose your country to continue");
    expect(useSearchLocation.getState().countryCode).toBe("JO");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not overwrite manual country changes with an older location request", async () => {
    const u = userEvent.setup();let success:any;
    Object.defineProperty(navigator,"geolocation",{configurable:true,value:{getCurrentPosition:vi.fn(fn => {success=fn;})}});
    vi.stubGlobal("fetch",vi.fn(async () => ({ok:true,json:async () => ({locations:[{countryCode:"JO"}]})})));
    render(<SearchRegion detectedCountry="LY" searchEnabled />);
    await u.click(screen.getByRole("button",{name:"Share location for nearby results"}));
    await u.selectOptions(screen.getByRole("combobox",{name:"Search country"}),"SA");
    await act(async () => {success({coords:{latitude:31.95,longitude:35.91}});});
    expect(useSearchLocation.getState().countryCode).toBe("SA");
    expect(useSearchLocation.getState().position).toBeUndefined();
  });
  it("sends country and nearby bias to autocomplete and removes foreign results", async () => {
    const u = userEvent.setup();
    useSearchLocation.getState().setContext({countryCode:"JO",position:{latitude:31.95,longitude:35.91,capturedAt:Date.now()},source:"gps"});
    const request = vi.fn(async () => ({ok:true,json:async () => ({locations:[{displayName:"Museum in Amman",countryCode:"JO",latitude:31.9,longitude:35.9},{displayName:"Foreign Museum",countryCode:"SA",latitude:24,longitude:46}]})}));
    vi.stubGlobal("fetch",request);
    render(<LocationField label="From" value={null} onChange={vi.fn()} searchEnabled gps />);
    await u.type(screen.getByRole("combobox"),"Museum");
    await screen.findByRole("option",{name:"Museum in Amman"});
    expect(screen.queryByRole("option",{name:"Foreign Museum"})).toBeNull();
    const input = JSON.parse((request.mock.calls[0] as any)[1].body);
    expect(input).toMatchObject({countryCode:"JO",latitude:31.95,longitude:35.91});
    expect(freshSearchPosition({position:{latitude:0,longitude:0,capturedAt:Date.now()-16*60000}})).toBeUndefined();
  });
});

describe("Quick account routes and departure choices", () => {
  const route = {id:"00000000-0000-4000-8000-000000000001", name:"Home to university", plan:{...defaultPlan(), origin:{...defaultPlan().origin,source:"manual" as const},destination:{...defaultPlan().destination,source:"manual" as const}},days:[],reminders:false};
  function accountFixture() {
    auth.getSession.mockResolvedValue({data:{session:{user:{email:"account-a@example.test"},access_token:"unit-only"}}} as any);
    const requests: {path: string; body: any}[] = [];
    vi.stubGlobal("fetch",vi.fn(async(path: string, init?: RequestInit)=>{
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      requests.push({path,body});
      const json = path === "/api/config" ? {mode:"live",authConfigured:true,supabaseUrl:"https://example.supabase.co",supabaseKey:"unit-only",searchConfigured:false,trafficConfigured:true,mapConfigured:false,publicBeta:false}
        : path === "/api/routes" ? [route] : path === "/api/me" ? {role:"user"}
        : path === "/api/analysis/allowance" ? {remaining:10}
        : path === "/api/analysis/day" ? await optimize(body, at => demoForecast(body,at))
        : path === "/api/analysis/live" ? {candidate:await demoForecast(body,new Date().toISOString()),checkedAt:new Date().toISOString()} : [];
      return {ok:true,json:async()=>json};
    }));
    return requests;
  }
  it("loads database-backed route details and forecasts directly without typing locations", async()=>{
    const requests=accountFixture(), u=userEvent.setup(); mount();
    const picker=await screen.findByRole("combobox",{name:"Use a saved route"});
    await screen.findByRole("option",{name:/Home to university/});
    await u.selectOptions(picker,route.id);
    expect(screen.getByRole("combobox",{name:"From"}).getAttribute("value")).toBe(route.plan.origin.displayName);
    expect(screen.getByRole("combobox",{name:"To"}).getAttribute("value")).toBe(route.plan.destination.displayName);
    expect(screen.getByRole("heading",{name:"Your next journey"})).toBeTruthy();
    await u.click(screen.getByRole("button",{name:"Plan a time window"}));
    expect((screen.getByRole("combobox",{name:"Use a saved route"}) as unknown as HTMLSelectElement).value).toBe(route.id);
    await u.click(screen.getByRole("button",{name:"Find best time"}));
    await screen.findByRole("heading",{name:"Best times to leave"});
    expect(requests.find(r=>r.path==="/api/analysis/day")?.body).toMatchObject({origin:route.plan.origin,destination:route.plan.destination,earliestTime:route.plan.earliestTime,latestTime:route.plan.latestTime,demo:false});
    expect(localStorage.getItem("traffic.demoRoutes")).toBeNull();
    const a=useStore.getState().analysis!;
    const alternative=a.samples.find(c=>c.feasible && c.departureAt!==a.best?.departureAt)!;
    await u.selectOptions(screen.getByRole("combobox",{name:"Choose a checked departure"}),`${alternative.provider}:${alternative.departureAt}`);
    expect(within(screen.getByRole("region",{name:"Selected departure"})).getByText(String(Math.round(alternative.durationSeconds/60))+" min")).toBeTruthy();
    expect(within(screen.getByRole("region",{name:"Selected departure"})).getByRole("link",{name:"Google Maps"}).getAttribute("href")).toContain("origin=31.996");
  });
  it("opens saved route in Plan without a forecast request",async()=>{
    const requests=accountFixture(),u=userEvent.setup();mount();
    await screen.findByRole("option",{name:/Home to university/});
    await u.click(within(document.querySelector(".sidebar")!).getByRole("link",{name:"Routes"}));
    await u.click(screen.getByRole("button",{name:"Use in Plan"}));
    expect(location.pathname).toBe("/plan");
    expect(screen.getByRole("combobox",{name:"From"}).getAttribute("value")).toBe(route.plan.origin.displayName);
    expect(requests.filter(r=>r.path.startsWith("/api/analysis/"))).toHaveLength(0);
  });
  async function selectedWeek(u:ReturnType<typeof userEvent.setup>){
    await screen.findByRole("option",{name:/Home to university/});
    await u.click(within(document.querySelector(".sidebar")!).getByRole("link",{name:"Week"}));
    await u.selectOptions(screen.getByRole("combobox",{name:"Use a saved route"}),route.id);
    const start=(screen.getByLabelText("Week starting") as HTMLInputElement).value;
    const selected=[0,1,2].map(i=>new Date(Date.parse(start+"T12:00Z")+i*86400000).getUTCDay());
    const group=within(screen.getByRole("group",{name:"Days to check"}));
    for(let day=0;day<7;day++)if(!selected.includes(day))await u.click(group.getByRole("button",{name:en.dayNames[day]}));
    return selected;
  }
  it("preflights only selected eligible days and preserves seven result positions",async()=>{
    const requests=accountFixture(),u=userEvent.setup();mount();await selectedWeek(u);
    await u.click(screen.getByRole("button",{name:"Check selected days"}));
    await waitFor(()=>expect(requests.filter(r=>r.path==="/api/analysis/day")).toHaveLength(3));
    await waitFor(()=>expect(screen.getByRole("button",{name:"Check selected days"}).getAttribute("aria-busy")).toBeNull());
    expect(document.querySelectorAll(".day-summary")).toHaveLength(7);
    expect([...document.querySelectorAll(".day-summary small")].filter(el=>el.textContent==="Not selected")).toHaveLength(4);
    expect(requests.filter(r=>r.path==="/api/analysis/allowance")).toHaveLength(1);
  });
  it("spends no forecasts on insufficient allowance or invalid bounds",async()=>{
    const requests=accountFixture(),original=fetch,u=userEvent.setup();
    vi.stubGlobal("fetch",vi.fn(async(path,init)=>path==="/api/analysis/allowance"?{ok:true,json:async()=>({remaining:2})}:original(path,init)));
    mount();await selectedWeek(u);await u.click(screen.getByRole("button",{name:"Check selected days"}));
    await screen.findByText(en.weekAllowance);expect(requests.filter(r=>r.path==="/api/analysis/day")).toHaveLength(0);
    await u.click(screen.getByRole("button",{name:"Edit window in Plan"}));
    await u.clear(screen.getByLabelText("Latest arrival"));await u.type(screen.getByLabelText("Latest arrival"),"07:00");
    await u.click(within(document.querySelector(".sidebar")!).getByRole("link",{name:"Week"}));
    await u.click(screen.getByRole("button",{name:"Check selected days"}));await screen.findByText(en.windowError);
    expect(requests.filter(r=>r.path==="/api/analysis/day")).toHaveLength(0);
  });
  it.each([401,429,503])("stops the weekly sequence after blocking response %s",async(status)=>{
    const requests=accountFixture(),original=fetch,u=userEvent.setup(),calls:unknown[]=[];
    vi.stubGlobal("fetch",vi.fn(async(path,init)=>{if(path==="/api/analysis/day"){calls.push(path);return {ok:false,status,json:async()=>({error:"blocked"})};}return original(path,init);}));
    mount();await selectedWeek(u);await u.click(screen.getByRole("button",{name:"Check selected days"}));
    await waitFor(()=>expect(calls).toHaveLength(1));await waitFor(()=>expect(screen.getByRole("button",{name:"Check selected days"}).getAttribute("aria-busy")).toBeNull());
    expect(document.querySelectorAll(".day-summary")).toHaveLength(7);expect(calls).toHaveLength(1);
  });
  it("runs Leave now on a saved account route and preserves its stored time window",async()=>{
    const requests=accountFixture(), u=userEvent.setup(); mount();
    await screen.findByRole("option",{name:/Home to university/});
    await u.click(within(document.querySelector(".sidebar")!).getByRole("link",{name:"Routes"}));
    await u.click(within(screen.getByRole("heading",{name:route.name}).closest("article")!).getByRole("button",{name:"Leave now"}));
    await screen.findByRole("region",{name:"Selected departure"});
    expect(requests.filter(r=>r.path==="/api/analysis/live")).toHaveLength(1);
    expect(requests.some(r=>r.path==="/api/analysis/day")).toBe(false);
    expect(route.plan.earliestTime).toBe("08:00");expect(route.plan.latestTime).toBe("10:00");
    expect(screen.getByText(/This is separate from your selected time window/)).toBeTruthy();
  });
  it("removes the previous account's saved route and restored addresses before another account loads",async()=>{
    accountFixture();let changed:any;
    auth.onAuthStateChange.mockImplementation(callback=>{changed=callback;return {data:{subscription:{unsubscribe:vi.fn()}}};});
    const u=userEvent.setup();mount();await screen.findByRole("option",{name:/Home to university/});
    await u.selectOptions(screen.getByRole("combobox",{name:"Use a saved route"}),route.id);
    let finish:any;const pending=new Promise<any>(resolve=>{finish=resolve;});
    const original=globalThis.fetch;
    vi.stubGlobal("fetch",vi.fn((path,init)=>path==="/api/routes"?pending:original(path,init)));
    auth.getSession.mockResolvedValue({data:{session:{user:{email:"account-b@example.test"},access_token:"unit-b"}}} as any);
    act(()=>changed("SIGNED_IN",{user:{email:"account-b@example.test"}}));
    expect(screen.queryByRole("option",{name:/Home to university/})).toBeNull();
    expect(screen.getByRole("combobox",{name:"From"}).getAttribute("value")).toBe("");
    await act(async()=>finish({ok:true,json:async()=>[]}));
  });
  it("never forecasts a stale saved GPS origin or requests permission automatically",async()=>{
    accountFixture();const gpsRoute={...route,plan:{...route.plan,origin:{...route.plan.origin,source:"gps" as const}}};
    const original=globalThis.fetch;
    vi.stubGlobal("fetch",vi.fn(async(path,init)=>path==="/api/routes"?{ok:true,json:async()=>[gpsRoute]}:original(path,init)));
    const gps=vi.fn();Object.defineProperty(navigator,"geolocation",{configurable:true,value:{getCurrentPosition:gps}});
    const u=userEvent.setup();mount();await screen.findByRole("option",{name:/Home to university/});
    await u.click(within(document.querySelector(".sidebar")!).getByRole("link",{name:"Routes"}));
    await u.click(within(screen.getByRole("heading",{name:route.name}).closest("article")!).getByRole("button",{name:"Leave now"}));
    expect(screen.getByRole("combobox",{name:"From"}).getAttribute("value")).toBe("");
    expect(gps).not.toHaveBeenCalled();expect(screen.getByText(/Obtain a fresh location/)).toBeTruthy();
  });
  it("reranks a checked account route without another API request and ignores an edited pending request",async()=>{
    const requests=accountFixture(),u=userEvent.setup();mount();
    await screen.findByRole("option",{name:/Home to university/});
    await u.selectOptions(screen.getByRole("combobox",{name:"Use a saved route"}),route.id);
    await u.click(screen.getByRole("button",{name:"Plan a time window"}));
    await u.click(screen.getByRole("button",{name:"Find best time"}));
    await screen.findByRole("heading",{name:"Best times to leave"});
    expect(location.pathname).toBe("/plan");
    const samples=useStore.getState().analysis!.samples;
    await u.selectOptions(screen.getByRole("combobox",{name:"What matters most?"}),"soonest");
    expect(useStore.getState().analysis!.samples).toBe(samples);
    expect(requests.filter(r=>r.path==="/api/analysis/day")).toHaveLength(1);
    let finish:any,signal:AbortSignal|undefined;
    const pending=new Promise<any>(resolve=>{finish=resolve;});const previous=globalThis.fetch;
    vi.stubGlobal("fetch",vi.fn((path,init)=>{if(path==="/api/analysis/day"){signal=init?.signal as AbortSignal;return pending;}return previous(path,init);}));
    await u.click(screen.getByRole("button",{name:"Find best time"}));
    await waitFor(()=>expect(signal).toBeDefined());
    const late=useStore.getState().analysis!;
    await u.clear(screen.getByLabelText("Earliest arrival"));
    expect(signal!.aborted).toBe(true);expect(useStore.getState().analysis).toBeNull();
    await act(async()=>finish({ok:true,json:async()=>late}));
    expect(useStore.getState().analysis).toBeNull();
    expect(screen.queryByRole("heading",{name:"Best times to leave"})).toBeNull();
  });
});


describe("Map failure recovery",()=>{
  it("separates map access, allowance, setup and graphics failures without exposing raw errors",()=>{
    expect(mapFailure(new ApiFailure(429,'Reached limit.'))).toBe('allowance');
    expect(mapFailure(new ApiFailure(503,'The map is not configured yet.'))).toBe('setup');
    expect(mapFailure(new Error('Failed to initialize WebGL.'))).toBe('browser');
    expect(mapFailure({status:401,message:'provider-secret'})).toBe('access');
    expect(mapFailure(new Error('https://example.invalid?access_token=secret'))).toBe('network');
  });
  it("keeps the map and pins when the Arabic label loader fails",async()=>{
    mapMock.status='unavailable';mapMock.rtl.mockClear();
    vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({token:'unit-map'})})));
    useStore.getState().setLocale('ar');
    const view=render(<MapPreview origin={{displayName:'Origin',latitude:31.95,longitude:35.91}} destination={null} mapEnabled/>);
    await waitFor(()=>expect(mapMock.rtl).toHaveBeenCalledTimes(1));
    const canvas=view.container.querySelector('.map-canvas');
    act(()=>mapMock.rtl.mock.calls[0][1](new Error('label-loader-failure')));
    expect(screen.getByText(ar.mapLabelsHelp)).toBeTruthy();
    expect(view.container.querySelector('.map-canvas')).toBe(canvas);
    expect(screen.queryByRole('heading',{name:ar.mapError})).toBeNull();
    mapMock.status='error';
    await userEvent.setup().click(screen.getByRole('button',{name:ar.mapRetry}));
    await waitFor(()=>expect(mapMock.rtl).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(ar.mapLabelsHelp)).toBeNull();
  });
  it("keeps the canvas attached after a provider error and lets a later load recover without another token request",async()=>{
    const fetchMap=vi.fn(async()=>({ok:true,json:async()=>({token:"unit-map"})}));
    vi.stubGlobal("fetch",fetchMap);
    const view=render(<MapPreview origin={null} destination={null} mapEnabled/>);
    await waitFor(()=>expect(mapMock.callbacks.error?.size).toBe(1));
    const canvas=view.container.querySelector('.map-canvas');
    act(()=>mapMock.callbacks.error.forEach(fn=>fn({error:{status:403,message:'private-token-value'}})));
    expect(screen.getByText(en.mapAccessHelp)).toBeTruthy();
    expect(view.container.querySelector('.map-canvas')).toBe(canvas);
    expect(view.container.textContent).not.toContain('private-token-value');
    act(()=>mapMock.callbacks.load.forEach(fn=>fn({})));
    await waitFor(()=>expect(screen.queryByText(en.mapAccessHelp)).toBeNull());
    expect(fetchMap).toHaveBeenCalledTimes(1);
  });
  it("explains a session failure and retries the token request only after an explicit Retry",async()=>{
    const fetchMap=vi.fn().mockResolvedValueOnce({ok:false,status:401,json:async()=>({error:'Authentication required.'})}).mockResolvedValue({ok:true,json:async()=>({token:'unit-map'})});
    vi.stubGlobal('fetch',fetchMap);
    render(<MapPreview origin={null} destination={null} mapEnabled/>);
    await waitFor(()=>expect(screen.getByText(en.mapSessionHelp)).toBeTruthy());
    expect(screen.queryByText(en.mapHelp)).toBeNull();
    expect(fetchMap).toHaveBeenCalledTimes(1);
    await userEvent.setup().click(screen.getByRole('button',{name:en.mapRetry}));
    await waitFor(()=>expect(screen.queryByText(en.mapSessionHelp)).toBeNull());
    expect(fetchMap).toHaveBeenCalledTimes(2);
  });
});

describe("Arabic map rendering setup",()=>{
  it("registers RTL shaping before map creation, switches language and avoids duplicate registration",async()=>{
    mapMock.status="unavailable";mapMock.rtl.mockClear();mapMock.create.mockClear();mapMock.language.mockClear();mapMock.remove.mockClear();
    vi.stubGlobal("fetch",vi.fn(async()=>({ok:true,json:async()=>({token:"test-map-token"})})));
    useStore.getState().setLocale("ar");
    const first=render(<MapPreview origin={null} destination={null} mapEnabled/>);
    await waitFor(()=>expect(mapMock.create).toHaveBeenCalledTimes(1));
    expect(mapMock.rtl.mock.invocationCallOrder[0]).toBeLessThan(mapMock.create.mock.invocationCallOrder[0]);
    expect(mapMock.create.mock.calls[0][0].language).toBe("ar");
    act(()=>useStore.getState().setLocale("en"));expect(mapMock.language).toHaveBeenCalledWith("en");
    first.unmount();expect(mapMock.remove).toHaveBeenCalledTimes(1);
    render(<MapPreview origin={null} destination={null} mapEnabled/>);
    await waitFor(()=>expect(mapMock.create).toHaveBeenCalledTimes(2));
    expect(mapMock.rtl).toHaveBeenCalledTimes(1);
  });
});


describe("Immediate location map pins",()=>{
  it("centers the origin pin without a destination, moves it on a fresh GPS reading and clears old route geometry",async()=>{
    mapMock.marker.mockClear();mapMock.center.mockClear();mapMock.source.mockClear();mapMock.markerRemove.mockClear();
    vi.stubGlobal("fetch",vi.fn(async()=>({ok:true,json:async()=>({token:"unit-map"})})));
    const origin={displayName:"Current location",latitude:31.95,longitude:35.91,source:"gps" as const};
    const view=render(<MapPreview origin={origin} destination={null} mapEnabled/>);
    await waitFor(()=>expect(mapMock.center).toHaveBeenCalledWith({center:[35.91,31.95],zoom:14}));
    expect(mapMock.marker).toHaveBeenCalledWith([35.91,31.95]);
    expect(mapMock.source).toHaveBeenCalledWith(expect.objectContaining({geometry:{type:"LineString",coordinates:[]}}));
    view.rerender(<MapPreview origin={{...origin,latitude:0,longitude:0}} destination={null} mapEnabled/>);
    await waitFor(()=>expect(mapMock.center).toHaveBeenCalledWith({center:[0,0],zoom:14}));
    expect(mapMock.markerRemove).toHaveBeenCalled();
  });
  it("draws both pins and fits the route only when both locations are present",async()=>{
    mapMock.marker.mockClear();mapMock.bounds.mockClear();
    vi.stubGlobal("fetch",vi.fn(async()=>({ok:true,json:async()=>({token:"unit-map"})})));
    render(<MapPreview origin={{displayName:"From",latitude:31.95,longitude:35.91}} destination={{displayName:"To",latitude:32,longitude:35.83}} mapEnabled/>);
    await waitFor(()=>expect(mapMock.bounds).toHaveBeenCalled());
    expect(mapMock.marker).toHaveBeenCalledWith([35.91,31.95]);expect(mapMock.marker).toHaveBeenCalledWith([35.83,32]);
  });
});

describe("Today and Plan purposes",()=>{
  it("shows account-route guidance to signed-out visitors on both pages and keeps timing controls on Plan",async()=>{
    const u=userEvent.setup();mount();
    expect(screen.getByRole("heading",{name:"Your next journey"})).toBeTruthy();
    expect(screen.getByRole("combobox",{name:"Use a saved route"}).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/Sign in to load your account/)).toBeTruthy();
    expect(screen.queryByLabelText("Earliest arrival")).toBeNull();
    await u.click(screen.getByRole("button",{name:"Plan a time window"}));
    expect(screen.getByLabelText("Earliest arrival")).toBeTruthy();
    expect(screen.getByRole("combobox",{name:"Use a saved route"})).toBeTruthy();
  });
});


describe("Private account boundary and local logout", () => {
  it("clears only the previous account token before a fresh unlock and retains a pending PKCE verifier",()=>{
    const config={mode:"live" as const,authConfigured:true,searchConfigured:false,trafficConfigured:false,mapConfigured:false,publicBeta:false,privateAccess:true,privateSessionId:"new-gate",supabaseUrl:"https://example.supabase.co"};
    localStorage.setItem("traffic.authGateSession","old-gate");localStorage.setItem("sb-example-auth-token","old-personal-session");localStorage.setItem("sb-example-auth-token-user","old-user");localStorage.setItem("sb-example-auth-token-code-verifier","pending-callback");localStorage.setItem("traffic.locale","ar");
    preparePrivateAccount(config);
    expect(localStorage.getItem("sb-example-auth-token")).toBeNull();expect(localStorage.getItem("sb-example-auth-token-user")).toBeNull();expect(localStorage.getItem("sb-example-auth-token-code-verifier")).toBe("pending-callback");expect(localStorage.getItem("traffic.locale")).toBe("ar");
    localStorage.setItem("sb-example-auth-token","new-personal-session");preparePrivateAccount(config);expect(localStorage.getItem("sb-example-auth-token")).toBe("new-personal-session");
  });
  it("fails closed when a private account boundary is unavailable",()=>{
    expect(()=>preparePrivateAccount({mode:"live",authConfigured:true,searchConfigured:false,trafficConfigured:false,mapConfigured:false,publicBeta:false,privateAccess:true,supabaseUrl:"https://example.supabase.co"})).toThrow();
  });
  it("keeps Settings out of primary navigation and exposes it from the profile",async()=>{
    mount();const primary=document.querySelector<HTMLElement>(".bottom-nav")!;expect(within(primary).getAllByRole("link")).toHaveLength(4);expect(within(primary).queryByRole("link",{name:"Settings"})).toBeNull();
    await userEvent.setup().click(screen.getByLabelText("Account menu"));await userEvent.setup().click(screen.getByRole("link",{name:"Settings"}));expect(screen.getByRole("heading",{name:"Settings"})).toBeTruthy();
  });
  it("signs out only this personal session and clears displayed route details",async()=>{
    history.replaceState(null,"","/settings");auth.getSession.mockResolvedValue({data:{session:{user:{email:"local-session@example.test"},access_token:"unit-only"}}} as any);
    vi.stubGlobal("fetch",vi.fn(async(path:string)=>({ok:true,json:async()=>path==="/api/config"?{mode:"live",authConfigured:true,supabaseUrl:"https://example.supabase.co",supabaseKey:"unit-only",searchConfigured:false,trafficConfigured:false,mapConfigured:false,publicBeta:false}:path==="/api/me"?{role:"user"}:[]})));
    mount();await userEvent.setup().click(await screen.findByRole("button",{name:"Sign out of personal account"}));expect(auth.signOut).toHaveBeenCalledWith({scope:"local"});await waitFor(()=>expect(screen.queryByRole("button",{name:"Sign out of personal account"})).toBeNull());expect(useStore.getState().analysis).toBeNull();
  });
});


describe("Localized API recovery",()=>{
  it("distinguishes verification, permission and daily allowances without exposing provider details",()=>{
    expect(displayFailure(new ApiFailure(403,"internal detail","VERIFICATION_REQUIRED"),"en")).toBe(en.verificationFailed);
    expect(displayFailure(new ApiFailure(403,"internal detail","PERMISSION_DENIED"),"ar")).toBe(ar.permissionDenied);
    expect(displayFailure(new ApiFailure(429,"internal detail","DAILY_ALLOWANCE"),"en")).toBe(en.dailyAllowance);
    expect(displayFailure(new ApiFailure(429,"internal detail","USAGE_LIMIT"),"ar")).toBe(ar.usageLimit);
  });
  it("uses localized recovery for invalid input, provider, network and unknown failures",()=>{
    expect(displayFailure(new ApiFailure(400,"secret detail"),"ar")).toBe(ar.invalidInput);
    expect(displayFailure(new ApiFailure(503,"secret detail"),"en")).toBe(en.providerFailure);
    expect(displayFailure(new TypeError("fetch failed"),"ar")).toBe(ar.networkFailure);
    expect(displayFailure(new Error("secret detail"),"en")).toBe(en.error);
  });
});


describe("Safe saved-route dialogs",()=>{
 const route={id:"route-test",name:"Original",plan:defaultPlan(),days:[1,3],reminders:false};
 it("keeps saved bounds and name unchanged on edit Cancel",async()=>{
   const save=vi.fn(),close=vi.fn(),u=userEvent.setup();render(<EditSavedRoute route={route} locale="en" push={false} onSave={save} onClose={close}/>);
   await u.clear(screen.getByLabelText("Route name"));await u.type(screen.getByLabelText("Route name"),"Draft name");
   await u.clear(screen.getByLabelText("Latest arrival"));await u.type(screen.getByLabelText("Latest arrival"),"11:00");
   await u.click(screen.getByRole("button",{name:"Cancel"}));expect(close).toHaveBeenCalledOnce();expect(save).not.toHaveBeenCalled();expect(route.name).toBe("Original");expect(route.plan.latestTime).toBe("10:00");
 });
 it("supports Arabic delete Cancel and safe retry after provider failure",async()=>{
   const remove=vi.fn().mockRejectedValueOnce(new ApiFailure(503,"secret internal detail")).mockResolvedValue(undefined),close=vi.fn(),u=userEvent.setup();
   render(<DeleteSavedRoute route={route} locale="ar" onDelete={remove} onClose={close}/>);
   await u.click(screen.getByRole("button",{name:"إلغاء"}));expect(close).toHaveBeenCalledOnce();expect(remove).not.toHaveBeenCalled();
   await u.click(screen.getByRole("button",{name:"حذف الرحلة"}));await screen.findByText(ar.providerFailure);expect(screen.queryByText("secret internal detail")).toBeNull();
   await u.click(screen.getByRole("button",{name:"حذف الرحلة"}));await waitFor(()=>expect(close).toHaveBeenCalledTimes(2));
 });
});
