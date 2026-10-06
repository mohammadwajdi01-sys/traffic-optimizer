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
import GuestAccess from "../src/GuestAccess";
import {LocationField} from "../src/LocationField";
import {SearchRegion} from "../src/SearchRegion";
import {freshSearchPosition,useSearchLocation} from "../src/search-location";
import { useStore } from "../src/store";
import { defaultPlan } from "../shared/demo";
const auth = vi.hoisted(() => ({
  getSession: vi.fn(async () => ({ data: { session: null } })),
  signInWithOAuth: vi.fn(async () => ({ error: null })),
  onAuthStateChange: vi.fn(() => ({
    data: { subscription: { unsubscribe: vi.fn() } },
  })),
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ auth }) }));
beforeEach(() => {
  auth.signInWithOAuth.mockClear();
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
    const link = within(document.querySelector(".result-card.best")!).getByRole(
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
    await u.click(screen.getByRole("button", { name: "Analyze seven days" }));
    await waitFor(() =>
      expect(document.querySelectorAll(".day-summary").length).toBe(7),
    );
    expect(document.querySelectorAll(".heat-cell").length).toBe(35);
    await u.click(screen.getByRole("button", { name: "ع" }));
    expect(document.documentElement.dir).toBe("rtl");
    await screen.findByRole("heading", { name: "أسبوعك بازدحام أقل" });
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
    await u.click(screen.getByRole("button", { name: "Analyze seven days" }));
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
      document.querySelector(".result-card.best a.preferred")?.textContent,
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
    await screen.findByRole("option");
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
      .click(screen.getByRole("button", { name: "Analyze seven days" }));
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
    await u.click(screen.getByRole("button",{name:"Edit route"}));const dialog=within(screen.getByRole("dialog"));
    await u.clear(dialog.getByLabelText("Route name"));await u.type(dialog.getByLabelText("Route name"),"Updated route");
    await u.clear(dialog.getByLabelText("Latest arrival"));await u.type(dialog.getByLabelText("Latest arrival"),"11:00");
    await u.click(dialog.getByRole("button",{name:"Sat"}));await u.click(dialog.getByRole("button",{name:"Save route"}));
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
