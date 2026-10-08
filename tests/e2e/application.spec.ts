import { test, expect } from "@playwright/test";
test("saved route editing is a draft, actions are distinct, and delete Cancel restores focus",async({page},testInfo)=>{
  await page.goto("/");await page.getByRole("button",{name:"Try an example",exact:true}).click();
  await page.getByRole("button",{name:"Find best time",exact:true}).click();
  await page.getByRole("button",{name:"Save route",exact:true}).click();await page.getByLabel("Route name").fill("Repeat route");
  await page.getByRole("dialog").getByRole("button",{name:"Save route",exact:true}).click();
  const routes=()=>page.locator("nav").getByRole("link",{name:"Routes",exact:true}).filter({visible:true}).first();await routes().click();
  const menu=page.getByLabel("Route actions: Repeat route");await menu.click();await page.getByRole("button",{name:"Edit or rename",exact:true}).click();
  await page.getByLabel("Route name").fill("Unsaved draft");await page.getByLabel("Latest arrival",{exact:true}).fill("11:00");await page.getByRole("button",{name:"Cancel",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Repeat route",exact:true})).toBeVisible();await expect(menu).toBeFocused();
  await page.getByRole("button",{name:"Use in Plan",exact:true}).click();await expect(page).toHaveURL(/\/plan$/);await expect(page.getByLabel("Latest arrival",{exact:true})).toHaveValue("10:00");await expect(page.locator(".result-panel")).toHaveCount(0);
  await routes().click();await menu.click();await page.getByRole("button",{name:"Delete route",exact:true}).click();
  await page.getByRole("dialog").getByRole("button",{name:"Cancel",exact:true}).click();await expect(menu).toBeFocused();
  await page.locator(".routes-grid").screenshot({path:testInfo.outputPath("repeat-routes-en.png")});
  await page.getByRole("button",{name:"Leave now",exact:true}).click();await expect(page).toHaveURL(/\/$/);await expect(page.getByRole("region",{name:"Selected departure",exact:true})).toBeVisible();
  await routes().click();await menu.click();await page.getByRole("button",{name:"Delete route",exact:true}).click();await page.getByRole("dialog").getByRole("button",{name:"Delete route",exact:true}).click();await expect(page.locator(".saved-route")).toHaveCount(0);
});
test("selected weekdays, duration legend and exact day table work in English and Arabic",async({page},testInfo)=>{
  await page.goto("/");await page.getByRole("button",{name:"Try an example",exact:true}).click();await page.locator("nav").getByRole("link",{name:"Week",exact:true}).filter({visible:true}).first().click();
  const start=await page.getByLabel("Week starting").inputValue(),weekday=new Date(start+"T12:00Z").getUTCDay(),selected=[weekday,(weekday+1)%7,(weekday+2)%7];
  const names=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  for(let i=0;i<7;i++)if(!selected.includes(i))await page.locator(".week-controls").getByRole("button",{name:names[i],exact:true}).click();
  await page.getByRole("button",{name:"Check selected days",exact:true}).click();await expect(page.locator(".day-summary")).toHaveCount(7);await expect(page.getByRole("button",{name:"Check selected days",exact:true})).toBeEnabled();
  await expect(page.locator(".day-summary small").filter({hasText:"Not selected"})).toHaveCount(4);
  await expect(page.locator(".heat-legend")).toContainText("Shorter checked drive");await expect(page.locator(".heat-legend")).not.toContainText("Light traffic");
  await expect(page.locator(".week-check-table tbody tr").first()).toBeVisible();
  if(testInfo.project.name!=="desktop")await expect(page.locator(".week-desktop-grid")).toBeHidden();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.locator(".week-grid").screenshot({path:testInfo.outputPath("repeat-week-en.png")});
  await page.getByRole("button",{name:"ع",exact:true}).click();await expect(page.locator("html")).toHaveAttribute("dir","rtl");await expect(page.locator(".weekly-insight")).toContainText("فترة انطلاق مختبرة متكررة");
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.locator(".week-grid").screenshot({path:testInfo.outputPath("repeat-week-ar.png")});
  await page.locator(".week-check-table tbody tr").first().getByRole("button").click();await expect(page).toHaveURL(/\/plan$/);await expect(page.locator(".result-panel")).toBeVisible();await expect(page.locator(".timeline-table tr[aria-selected=true]")).toHaveCount(1);
});
test("core goals, keyboard chart choices and overnight fields stay in Plan",async({page},testInfo)=>{
  await page.goto("/");
  await page.getByRole("button",{name:"Try an example",exact:true}).click();
  await page.getByRole("button",{name:"Find best time",exact:true}).click();
  await expect(page).toHaveURL(/\/plan$/);
  await expect(page.getByRole("heading",{name:"Best times to leave",exact:true})).toBeVisible();
  await page.getByRole("combobox",{name:"What matters most?"}).selectOption("soonest");
  await expect(page.locator(".goal-reason")).toContainText("Earliest estimated arrival");
  const points=page.locator(".chart-choice");
  await points.last().focus();await page.keyboard.press("Enter");
  await expect(points.last()).toHaveAttribute("aria-pressed","true");
  await expect(page.locator(".goal-reason")).toHaveText("Selected departure");
  await page.getByText("Checked departures table",{exact:true}).first().click();
  await expect(page.locator(".timeline-table tr[aria-selected=true]")).toHaveCount(1);
  if(testInfo.project.name!=="desktop") {
    const readableLabel=await page.locator(".forecast-timeline svg text").first().evaluate(el=>parseFloat(getComputedStyle(el).fontSize)*el.closest("svg")!.getBoundingClientRect().width/680);
    expect(readableLabel).toBeGreaterThanOrEqual(12);
  }
  await page.locator(".result-panel").screenshot({path:testInfo.outputPath("core-results-en.png")});
  await page.getByRole("button",{name:"ع",exact:true}).click();
  await expect(page.locator(".forecast-timeline")).toBeVisible();
  await page.locator(".result-panel").screenshot({path:testInfo.outputPath("core-results-ar.png")});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole("button",{name:"EN",exact:true}).click();
  await page.getByRole("button",{name:"Leave between",exact:true}).click();
  await page.getByLabel("Earliest departure",{exact:true}).fill("23:00");
  await page.getByLabel("Latest departure",{exact:true}).fill("01:00");
  await page.getByRole("checkbox",{name:"Ends next day"}).check();
  await page.getByRole("button",{name:"Find best time",exact:true}).click();
  await expect(page.locator(".forecast-timeline")).toBeVisible();
  await expect(page.getByRole("heading",{name:"Best times to leave",exact:true})).toBeVisible();
  await page.locator(".planner-form").screenshot({path:testInfo.outputPath("core-overnight-en.png")});
});
test("country search defaults visibly and supports manual choice and Arabic on small screens", async ({page}) => {
  await page.route("**/api/config",route => route.fulfill({json:{mode:"setup",authConfigured:false,searchConfigured:false,trafficConfigured:false,mapConfigured:false,publicBeta:false,detectedCountry:"JO"}}));
  await page.goto("/plan");
  const country = page.getByRole("combobox",{name:"Search country"});
  await expect(country).toHaveValue("JO");
  await expect(page.getByRole("button",{name:"Use current location"})).toBeDisabled();
  await country.selectOption("LY");
  await expect(country).toHaveValue("LY");
  await page.getByRole("button",{name:"ع",exact:true}).click();
  await expect(page.getByRole("combobox",{name:"بلد البحث"})).toHaveValue("LY");
  await expect(page.getByRole("button",{name:"استخدم موقعي الحالي"})).toBeVisible();
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
  await expect(page.locator(".goal-reason")).toContainText("Recommended");
  const link = page
    .locator(".result-panel .selected-journey")
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
  await page.getByRole("button", { name: "Check selected days" }).click();
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
    page.getByRole("heading", { name: "رحلات أسبوعك المختبرة" }),
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
  await expect(page.getByRole("button",{name:"Use current location"})).toBeDisabled();
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
  await page.keyboard.press("Escape");
  await expect(verification.getByRole("button",{name:"Sign in",exact:true})).toBeFocused();
  await expect(page.getByRole("button",{name:"Find best time"})).toBeDisabled();
  await expect(page.getByRole("button",{name:"Use current location"})).toBeDisabled();
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
  await expect(page.getByRole("button",{name:"Use current location"})).toBeEnabled();
  expect(widgetLoads).toBe(0);
  verified=false;
  await page.evaluate(()=>window.dispatchEvent(new Event("traffic-guest-expired")));
  await expect(page.locator(".guest-verification")).toContainText("Human check test fixture");
  await expect(page.getByRole("button",{name:"Use current location"})).toBeDisabled();
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
  await card.getByRole("button",{name:"Use in Plan",exact:true}).click();
  await expect(page.locator(".result-panel")).toHaveCount(0);
  await page.getByRole("button",{name:"Find best time",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Best times to leave",exact:true})).toBeVisible();
  await page.getByText("Checked departures table",{exact:true}).first().click();
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


test("the shipped Arabic helper shapes and orders map text under the actual security policy",async({page})=>{
  const response=await page.goto("/plan");
  expect(response!.headers()["content-security-policy"]).not.toMatch(/wasm-unsafe-eval|\x27unsafe-eval\x27/);
  const result=await page.evaluate(async()=>{
    const url=new URL("/mapbox-rtl-text-v0.2.3.js",location.origin).href;
    const code=`self.registerRTLTextPlugin=plugin=>{try{const shaped=plugin.applyArabicShaping('عمان');postMessage({shaped,visual:plugin.processBidirectionalText(shaped,[])});}catch(e){postMessage({error:String(e)});}};importScripts(${JSON.stringify(url)});`;
    const blob=URL.createObjectURL(new Blob([code],{type:"application/javascript"}));
    const worker=new Worker(blob);
    try{return await new Promise<any>((resolve,reject)=>{worker.onmessage=e=>resolve(e.data);worker.onerror=e=>reject(new Error(e.message));});}
    finally{worker.terminate();URL.revokeObjectURL(blob);}
  });
  expect(result.error).toBeUndefined();
  expect(result.shaped).toBe("ﻋﻤﺎﻥ");expect(result.visual).toEqual(["ﻥﺎﻤﻋ"]);
});


test("Today checks leaving now while Plan explains future windows and both expose saved routes",async({page})=>{
  await page.goto("/");
  await expect(page.getByRole("heading",{name:"Your next journey"})).toBeVisible();
  await expect(page.getByRole("combobox",{name:"Use a saved route"})).toBeVisible();
  await expect(page.getByLabel("Earliest arrival",{exact:true})).toHaveCount(0);
  await page.getByRole("button",{name:"Plan a time window",exact:true}).click();
  await expect(page.getByLabel("Earliest arrival",{exact:true})).toBeVisible();
  await expect(page.getByRole("combobox",{name:"Use a saved route"})).toBeVisible();
  await page.getByRole("button",{name:"ع",exact:true}).click();
  await expect(page.getByRole("combobox",{name:"استخدام رحلة محفوظة"})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});


test("coordinate dialog supports keyboard errors, Escape and focus recovery",async({page})=>{
  await page.route("**/api/config",route=>route.fulfill({json:{mode:"setup",authConfigured:false,searchConfigured:false,trafficConfigured:false,mapConfigured:false,publicBeta:false,detectedCountry:"JO"}}));
  await page.goto("/plan");
  const from=page.getByRole("combobox",{name:"From",exact:true});
  await from.click();
  await page.getByRole("button",{name:"Use coordinates",exact:true}).click();
  const dialog=page.getByRole("dialog",{name:"Use coordinates",exact:true});
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Paste coordinates (latitude, longitude)").fill("invalid");
  await dialog.getByRole("button",{name:"Use location",exact:true}).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByLabel("Paste coordinates (latitude, longitude)")).toHaveAttribute("aria-invalid","true");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(from).toBeFocused();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test("personal signup and reset requests stay separate from website access in English and Arabic",async({page},testInfo)=>{
  const requests:string[]=[];
  await page.route("**/api/config",route=>route.fulfill({json:{mode:"live",authConfigured:true,googleAuthEnabled:true,publicBeta:false,supabaseUrl:"https://account-fixture.supabase.co",supabaseKey:"sb_publishable_fixture",searchConfigured:false,trafficConfigured:false,mapConfigured:false}}));
  await page.route("https://account-fixture.supabase.co/auth/v1/**",async route=>{
    const path=new URL(route.request().url()).pathname;requests.push(path);
    if(path.endsWith("/signup"))return route.fulfill({json:{user:{id:"account-fixture",email:"fixture@example.test"},session:null}});
    return route.fulfill({json:{}});
  });
  await page.goto("/settings");const accountSection=page.locator('section[aria-labelledby="settings-account"]');await accountSection.getByRole("button",{name:"Sign in",exact:true}).click();
  let modal=page.getByRole("dialog");await modal.getByRole("button",{name:"Create account",exact:true}).click();
  await modal.getByLabel("Email address",{exact:true}).fill("fixture@example.test");await modal.getByLabel("Password",{exact:true}).fill("Valid123!");await modal.getByLabel("Confirm password",{exact:true}).fill("Valid123!");
  await modal.getByRole("button",{name:"Show password: Password",exact:true}).click();await expect(modal.getByLabel("Password",{exact:true})).toHaveAttribute("type","text");
  await expect(modal.getByLabel("Confirm password",{exact:true})).toHaveAttribute("type","password");await modal.getByRole("button",{name:"Show password: Confirm password",exact:true}).click();await expect(modal.getByLabel("Confirm password",{exact:true})).toHaveAttribute("type","text");
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await modal.screenshot({path:testInfo.outputPath("account-signup-en.png")});
  await modal.getByRole("button",{name:"Create account",exact:true}).click();await expect(modal.getByRole("status")).toContainText("Confirm your email before signing in");expect(requests.filter(p=>p.endsWith("/signup"))).toHaveLength(1);
  await modal.getByRole("button",{name:"Resend confirmation email",exact:true}).click();await expect.poll(()=>requests.filter(p=>p.endsWith("/resend")).length).toBe(1);
  await modal.getByRole("button",{name:"Back to sign in",exact:true}).click();await expect(modal.getByLabel("Password",{exact:true})).toHaveValue("");await modal.getByRole("button",{name:"Forgot password?",exact:true}).click();await modal.getByRole("button",{name:"Request password reset",exact:true}).click();await expect(modal.getByRole("status")).toContainText("If an account exists");expect(requests.filter(p=>p.endsWith("/recover"))).toHaveLength(1);
  await modal.getByRole("button",{name:"Close",exact:true}).click();await expect(accountSection.getByRole("button",{name:"Sign in",exact:true})).toBeFocused();
  await page.getByRole("button",{name:"ع",exact:true}).click();await accountSection.getByRole("button",{name:"تسجيل الدخول",exact:true}).click();modal=page.getByRole("dialog");await modal.getByRole("button",{name:"إنشاء حساب",exact:true}).click();await expect(page.locator("html")).toHaveAttribute("dir","rtl");await expect(modal.getByLabel("كلمة المرور",{exact:true})).toHaveAttribute("autocomplete","new-password");
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await modal.screenshot({path:testInfo.outputPath("account-signup-ar.png")});
});

test("expired account callbacks remove sensitive URL context and offer a fresh link",async({page})=>{
  await page.route("**/api/config",route=>route.fulfill({json:{mode:"live",authConfigured:true,googleAuthEnabled:true,publicBeta:false,supabaseUrl:"https://account-fixture.supabase.co",supabaseKey:"sb_publishable_fixture",searchConfigured:false,trafficConfigured:false,mapConfigured:false}}));
  await page.goto("/settings#error_code=otp_expired&error_description=fixture-private-context");const modal=page.getByRole("dialog");await expect(modal.getByRole("alert")).toContainText("expired or already used");await expect(page).toHaveURL(/\/settings$/);await expect(modal.getByRole("button",{name:"Save new password",exact:true})).toHaveCount(0);await expect(modal).not.toContainText("fixture-private-context");
});


test("grouped Settings keeps advanced defaults optional and discards unsaved changes in both languages",async({page},testInfo)=>{
  await page.goto("/settings");const journey=page.getByRole("region",{name:"Journey preferences",exact:true});await expect(journey).toBeVisible();await expect(page.getByRole("region",{name:"Privacy",exact:true})).toBeVisible();
  await expect(journey.getByLabel("Safety buffer",{exact:true})).toBeHidden();await journey.getByText("Advanced journey defaults",{exact:true}).click();
  const buffer=journey.getByLabel("Safety buffer",{exact:true});await buffer.fill("7");await journey.getByRole("button",{name:"Discard preference changes",exact:true}).click();await expect(buffer).toHaveValue("0");await buffer.fill("5");await journey.getByRole("button",{name:"Save preferences",exact:true}).click();await page.reload();await journey.getByText("Advanced journey defaults",{exact:true}).click();await expect(buffer).toHaveValue("5");
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.locator(".grouped-settings").screenshot({path:testInfo.outputPath("grouped-settings-en.png")});
  await page.getByRole("button",{name:"ع",exact:true}).click();await expect(page.locator("html")).toHaveAttribute("dir","rtl");await expect(page.getByRole("region",{name:"تفضيلات الرحلة",exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.locator(".grouped-settings").screenshot({path:testInfo.outputPath("grouped-settings-ar.png")});
});

test('owner drafts require Save and Cancel restores caps across English and Arabic',async({page},testInfo)=>{
 const account={id:'11111111-1111-4111-8111-111111111111',email:'owner@example.test'};
 const cfg={paid:false,monthlyBudget:0,providers:Object.fromEntries(['mapbox','google','geoapify','maps'].map(name=>[name,{hard:5,enabled:name!=='google',free:10,period:'month',rpm:60}])),countries:{JO:'mapbox',LY:'mapbox',SA:'mapbox'},allowances:{guest:1,user:10,family:30,admin:100},userAllowances:{}};
 const changes:any[]=[];
 await page.addInitScript(({account})=>{const exp=Math.floor(Date.now()/1000)+3600;const token=btoa(JSON.stringify({alg:'HS256',typ:'JWT'}))+'.'+btoa(JSON.stringify({sub:account.id,exp}))+'.fixture';localStorage.setItem('sb-owner-fixture-auth-token',JSON.stringify({access_token:token,refresh_token:'fixture',token_type:'bearer',expires_at:exp,user:account}));},{account});
 await page.route('https://owner-fixture.supabase.co/auth/v1/**',route=>route.fulfill({json:account}));
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path==='/api/admin/config'){const value=route.request().postDataJSON();changes.push(value);Object.assign(cfg,value);return route.fulfill({json:cfg});}
  return route.fulfill({json:path==='/api/config'?{mode:'live',authConfigured:true,publicBeta:false,supabaseUrl:'https://owner-fixture.supabase.co',supabaseKey:'sb_publishable_fixture',searchConfigured:false,trafficConfigured:false,mapConfigured:false}:path==='/api/me'?{role:'admin'}:path==='/api/admin/overview'?{config:cfg,usage:{},audit:[],errors:[]}:path==='/api/admin/users'?[account]:[]});
 });
 await page.goto('/admin');const field=page.getByLabel('mapbox Hard cap');await expect(field).toHaveValue('5');await field.fill('4');await field.blur();expect(changes).toHaveLength(0);
 await page.getByRole('button',{name:'Discard changes',exact:true}).first().click();await expect(field).toHaveValue('5');
 await page.getByLabel('user Daily limit').fill('2');await page.getByRole('button',{name:'Save changes',exact:true}).first().click();await expect(page.getByText('Owner settings saved.',{exact:true})).toBeVisible();expect(changes[0]).toMatchObject({paid:false,monthlyBudget:0,allowances:{user:2},providers:{mapbox:{hard:5}}});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.locator('.main').screenshot({path:testInfo.outputPath('owner-en.png')});
 await page.getByRole('button',{name:'ع',exact:true}).click();await expect(page.getByLabel('user الحد اليومي')).toHaveValue('2');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.locator('.main').screenshot({path:testInfo.outputPath('owner-ar.png')});
});

test('policy pages describe current retention and reminder limits and support keyboard bypass',async({page})=>{
 await page.goto('/privacy');await expect(page.getByRole('heading',{name:'Retention and deletion'})).toBeVisible();await expect(page.locator('.legal-page')).toContainText('30 days');
 await page.keyboard.press('Tab');await expect(page.getByRole('link',{name:'Skip to main content'})).toBeFocused();await page.keyboard.press('Enter');await expect(page.locator('#main-content')).toBeFocused();
 await page.getByRole('button',{name:'ع',exact:true}).click();await expect(page.getByRole('heading',{name:'الاحتفاظ والحذف'})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.goto('/terms');await expect(page.locator('.legal-page')).toContainText('كل عشر دقائق');
});
