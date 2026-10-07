import { test, expect } from "@playwright/test";
test("country search defaults visibly and supports manual choice and Arabic on small screens", async ({page}) => {
  await page.route("**/api/config",route => route.fulfill({json:{mode:"setup",authConfigured:false,searchConfigured:false,trafficConfigured:false,mapConfigured:false,publicBeta:false,detectedCountry:"JO"}}));
  await page.goto("/plan");
  const country = page.getByRole("combobox",{name:"Search country"});
  await expect(country).toHaveValue("JO");
  await expect(page.getByRole("button",{name:"Share location for nearby results"})).toBeDisabled();
  await country.selectOption("LY");
  await expect(country).toHaveValue("LY");
  await page.getByRole("button",{name:"ع",exact:true}).click();
  await expect(page.getByRole("combobox",{name:"بلد البحث"})).toHaveValue("LY");
  await expect(page.getByRole("button",{name:"مشاركة الموقع لعرض الأماكن القريبة"})).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test("plans an example, respects the deadline, saves a route and opens navigation", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page
    .getByRole("button", { name: "Try an example", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Find best time", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Best times to leave", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".result-card.best")).toContainText("Recommended");
  const link = page
    .locator(".result-card.best")
    .getByRole("link", { name: "Google Maps" });
  expect(await link.getAttribute("href")).toContain(
    "google.com/maps/dir/?api=1",
  );
  expect(await link.getAttribute("href")).toContain("origin=31.996");
  await page.getByRole("button", { name: "Save route", exact: true }).click();
  await page.getByLabel("Route name").fill("University commute");
  await page
    .getByRole("button", { name: "Save route", exact: true })
    .last()
    .click();
  await page
    .locator("nav")
    .getByRole("link", { name: "Routes", exact: true })
    .filter({ visible: true })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "University commute" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
test("weekly heatmap is computed and Arabic is RTL without horizontal overflow", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Try an example", exact: true })
    .click();
  await page
    .locator("nav")
    .getByRole("link", { name: "Week", exact: true })
    .filter({ visible: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Analyze seven days" }).click();
  await expect(page.locator(".day-summary")).toHaveCount(7);
  await expect(page.locator(".heat-cell")).toHaveCount(35);
  await page.getByRole("button", { name: "ع", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(
    page.getByRole("heading", { name: "أسبوعك بازدحام أقل" }),
  ).toBeVisible();
});
test("owner controls cannot be accessed by an unsigned visitor and privacy is available", async ({
  page,
}) => {
  await page.goto("/admin");
  await expect(
    page.getByRole("heading", { name: "Owner dashboard", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      /Owner controls become available after authentication is connected\.|Sign in with an owner account to view this dashboard\./,
    ),
  ).toBeVisible();
  await page.goto("/privacy");
  await expect(
    page.getByRole("heading", { name: "Privacy policy" }),
  ).toBeVisible();
});

test("guest verification exposes the failure code, preserves route text, and stays within a phone screen", async ({page}) => {
  await page.route("**/api/config",route=>route.fulfill({json:{mode:"live",authConfigured:false,searchConfigured:true,trafficConfigured:true,mapConfigured:false,publicBeta:true,turnstileSiteKey:"test-site-key",detectedCountry:"JO"}}));
  await page.route("**/api/guest-session",route=>route.fulfill({json:{verified:false}}));
  // Synthetic SDK only in this test; never a production Turnstile key or challenge bypass.
  await page.route("https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit",route=>route.fulfill({contentType:"application/javascript",body:`window.turnstile={ready:()=>{throw new Error("async script cannot use ready()");},render:(root,options)=>{window.testVerification=options;root.textContent='Human check test fixture';return 'test-widget';},remove:()=>{}};`}));
  await page.goto("/plan");
  const verification=page.locator(".guest-verification");
  await expect(verification).toContainText("Human check test fixture");
  await page.getByRole("combobox",{name:"From",exact:true}).fill("My route stays here");
  await page.evaluate(()=> (window as any).testVerification["error-callback"]("200500"));
  await expect(verification).toContainText("Verification code: 200500");
  await expect(page.getByRole("button",{name:"Share location for nearby results"})).toBeDisabled();
  await verification.getByRole("button",{name:"Refresh verification"}).click();
  await expect(verification).not.toContainText("200500");
  await expect(page.getByRole("combobox",{name:"From",exact:true})).toHaveValue("My route stays here");
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test("failed guest verification provides a visible account sign-in path without unlocking access", async ({page}) => {
  await page.route("**/api/config",route=>route.fulfill({json:{mode:"live",authConfigured:true,googleAuthEnabled:false,supabaseUrl:"https://example.supabase.co",supabaseKey:"sb_publishable_test",searchConfigured:true,trafficConfigured:true,mapConfigured:false,publicBeta:true,turnstileSiteKey:"test-site-key",detectedCountry:"JO"}}));
  await page.route("**/api/guest-session",route=>route.fulfill({json:{verified:false}}));
  await page.route("https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit",route=>route.fulfill({contentType:"application/javascript",body:`window.turnstile={render:(root,options)=>{window.testVerification=options;root.textContent='Human check test fixture';return 'test-widget';},remove:()=>{}};`}));
  await page.goto("/plan");
  const verification=page.locator(".guest-verification");
  await expect(verification).toContainText("Human check test fixture");
  await page.getByRole("combobox",{name:"From",exact:true}).fill("Route preserved after sign-in");
  await page.evaluate(()=>(window as any).testVerification["error-callback"]("600010"));
  await expect(verification).toContainText("600010");
  await verification.getByRole("button",{name:"Sign in",exact:true}).click();
  await expect(page.getByRole("dialog",{name:"Sign in"})).toBeVisible();
  await expect(page.getByRole("textbox",{name:"Email address"})).toBeVisible();
  await page.getByRole("dialog").getByRole("button",{name:"Close",exact:true}).click();
  await expect(page.getByRole("button",{name:"Find best time"})).toBeDisabled();
  await expect(page.getByRole("button",{name:"Share location for nearby results"})).toBeDisabled();
  await expect(page.getByRole("combobox",{name:"From",exact:true})).toHaveValue("Route preserved after sign-in");
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test("an existing verified guest is restored without loading a challenge and access expiry returns the check", async ({page})=>{
  let verified=true;
  await page.route("**/api/config",route=>route.fulfill({json:{mode:"live",authConfigured:false,searchConfigured:true,trafficConfigured:true,mapConfigured:false,publicBeta:true,turnstileSiteKey:"test-site-key",detectedCountry:"JO"}}));
  await page.route("**/api/guest-session",route=>route.fulfill({json:verified?{verified:true,expiresAt:Date.now()+3600000}:{verified:false}}));
  let widgetLoads=0;
  await page.route("https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit",route=>{widgetLoads++;return route.fulfill({contentType:"application/javascript",body:`window.turnstile={ready:()=>{throw new Error("async script cannot use ready()");},render:(root)=>{root.textContent='Human check test fixture';return 'test-widget';},remove:()=>{}};`});});
  await page.goto("/plan");
  await expect(page.getByRole("button",{name:"Share location for nearby results"})).toBeEnabled();
  expect(widgetLoads).toBe(0);
  verified=false;
  await page.evaluate(()=>window.dispatchEvent(new Event("traffic-guest-expired")));
  await expect(page.locator(".guest-verification")).toContainText("Human check test fixture");
  await expect(page.getByRole("button",{name:"Share location for nearby results"})).toBeDisabled();
  expect(widgetLoads).toBe(1);
});

test("reuses a saved route, checks Leave now and selects a listed departure on small screens", async({page})=>{
  await page.goto("/");
  await page.getByRole("button",{name:"Try an example",exact:true}).click();
  await page.getByRole("button",{name:"Find best time",exact:true}).click();
  await page.getByRole("button",{name:"Save route",exact:true}).click();
  await page.getByLabel("Route name").fill("Fast commute");
  await page.getByRole("dialog").getByRole("button",{name:"Save route",exact:true}).click();
  await page.locator("nav").getByRole("link",{name:"Routes",exact:true}).filter({visible:true}).first().click();
  const card=page.locator("article.saved-route").filter({hasText:"Fast commute"});
  await card.getByRole("button",{name:"Compare departures",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Best times to leave",exact:true})).toBeVisible();
  const choices=page.getByRole("combobox",{name:"Choose a checked departure"});
  const value=await choices.locator("option:not([disabled])").first().getAttribute("value");
  await choices.selectOption(value!);
  await expect(page.getByRole("region",{name:"Selected departure"})).toContainText("Google Maps");
  await page.getByRole("button",{name:"Leave now",exact:true}).click();
  await expect(page.getByRole("region",{name:"Leave now",exact:true})).toBeVisible();
  await expect(page.getByRole("region",{name:"Selected departure"})).toContainText("min");
  await page.getByRole("button",{name:"ع",exact:true}).click();
  await expect(page.getByRole("region",{name:"وقت الانطلاق المحدد"})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
