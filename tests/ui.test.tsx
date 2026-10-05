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
import { useStore } from "../src/store";
import { defaultPlan } from "../shared/demo";
beforeEach(() => {
  localStorage.clear();
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
    act(() => {
      options["error-callback"]("200500");
    });
    expect(ready).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toContain("couldn't finish");
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Refresh verification" }));
    expect(renderWidget).toHaveBeenCalledTimes(2);
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
    await act(async () => {
      await options.callback("test-token");
    });
    expect(ready).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toContain(
      "Verification failed.",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) })),
    );
    await act(async () => {
      await options.callback("new-test-token");
    });
    expect(ready).toHaveBeenCalledTimes(1);
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
      Date.parse(a!.plan.date + "T06:00:00Z") - 600000,
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
    expect(document.querySelectorAll(".heat-cell").length).toBe(49);
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
    await u.click(screen.getByRole("button", { name: "Leave around" }));
    const time = screen.getByLabelText("Time");
    await u.clear(time);
    await u.type(time, "16:00");
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
