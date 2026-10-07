import { test, expect } from "@playwright/test";
test("private gate protects assets and deep links, unlocks and locks again", async ({
  page,
  context,
}, testInfo) => {
  const base = process.env.PRIVATE_TEST_BASE_URL;
  test.skip(!base, "Requires the isolated private Worker fixture.");
  const ip = {
    desktop: "203.0.113.11",
    phone: "203.0.113.12",
    "small-phone": "203.0.113.13",
  }[testInfo.project.name];
  await context.setExtraHTTPHeaders({ "CF-Connecting-IP": ip! });
  const response = await page.goto(base + "/plan");
  expect(response!.status()).toBe(401);
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  const denied = await context.request.get(base + "/mapbox-rtl-text-v0.2.3.js");
  expect(denied.status()).toBe(401);
  const api = await context.request.get(base + "/api/config");
  expect(api.status()).toBe(401);
  await page.getByRole("button", {name:"Show password"}).click();
  await expect(page.getByLabel("Password", {exact:true})).toHaveAttribute("type","text");
  await page.getByRole("button", {name:"Hide password"}).click();
  await page.getByLabel("Username").fill("browser fixture");
  await page.getByLabel("Password", {exact:true}).fill("wrong");
  const wrongResponse = page.waitForResponse(response => response.url().endsWith("/private/unlock") && response.request().method() === "POST");
  await page
    .getByRole("button", { name: "Unlock website" })
    .click();
  const rejected = await wrongResponse;
  expect(rejected.status(), await rejected.text()).toBe(401);
  await expect(page.getByRole("alert")).toContainText(
    "Incorrect username or password",
  );
  await page.getByLabel("Username").fill("browser fixture");
  await page
    .getByLabel("Password", {exact:true})
    .fill("browser-fixture-password");
  await page
    .getByRole("button", { name: "Unlock website" })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Use a saved route" }),
  ).toBeVisible();
  expect(
    (await context.cookies()).some(
      (cookie) =>
        cookie.name === "__Host-traffic_private" &&
        cookie.httpOnly &&
        cookie.secure,
    ),
  ).toBe(true);
  await page.getByLabel("Account menu", {exact:true}).click();
  await page.getByRole("link", {name:"Settings",exact:true}).click();
  await page.getByRole("button", { name: "Lock website", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  expect((await context.request.get(base + "/api/config")).status()).toBe(401);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});


test("Arabic guest unlock preserves a callback and Remember me survives a new browser context", async ({page, context, browser}, testInfo) => {
  const base = process.env.PRIVATE_TEST_BASE_URL;
  test.skip(!base, "Requires the isolated private Worker fixture.");
  await context.setExtraHTTPHeaders({"CF-Connecting-IP":`203.0.113.${31 + ["desktop","phone","small-phone"].indexOf(testInfo.project.name)}`});
  if(testInfo.project.name === "small-phone") await page.setViewportSize({width:360,height:780});
  await page.goto(base + "/settings?flow=callback#recovery-test");
  await page.screenshot({path:testInfo.outputPath("gate-en.png"),fullPage:true});
  await page.getByRole("button",{name:"العربية",exact:true}).click();
  await expect(page.locator("html")).toHaveAttribute("lang","ar");
  await expect(page.locator("html")).toHaveAttribute("dir","rtl");
  await expect(page.getByRole("heading",{name:"أهلاً بعودتك"})).toBeVisible();
  await expect(page.getByRole("heading",{name:"Welcome back"})).toHaveCount(0);
  await expect(page.locator("#unlock input[name=next]")).toHaveValue("/settings?flow=callback#recovery-test");
  await page.screenshot({path:testInfo.outputPath("gate-ar.png"),fullPage:true});
  await page.getByLabel("اسم المستخدم",{exact:true}).fill("browser guest");
  await page.getByLabel("كلمة المرور",{exact:true}).fill("browser-guest-password");
  await page.getByLabel("تذكّرني").check();
  await page.getByRole("button",{name:"فتح الموقع",exact:true}).click();
  await expect(page).toHaveURL(base + "/settings?flow=callback#recovery-test");
  await expect(page.getByRole("heading",{name:"الإعدادات",exact:true})).toBeVisible();
  await expect(page.getByRole("link",{name:"لوحة المالك",exact:true})).toHaveCount(0);
  expect((await context.request.get(base + "/api/admin/budget")).status()).toBe(401);
  const cookie=(await context.cookies()).find(c=>c.name==="__Host-traffic_private")!;
  expect(cookie.value).toContain(".guest.");
  expect(cookie.expires - Date.now()/1000).toBeGreaterThan(604700);
  const fresh=await browser.newContext({storageState:await context.storageState(),viewport:{width:390,height:844}});
  try {
    const resumed=await fresh.newPage();
    await resumed.goto(base + "/plan");
    await expect(resumed.getByRole("combobox",{name:"استخدام رحلة محفوظة"})).toBeVisible();
    await resumed.screenshot({path:testInfo.outputPath("plan-ar.png"),fullPage:true});
    expect(await resumed.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await resumed.getByLabel("قائمة الحساب",{exact:true}).click();
    await resumed.getByRole("link",{name:"الإعدادات",exact:true}).click();
    await resumed.getByRole("button",{name:"قفل الموقع",exact:true}).click();
    await expect(resumed.getByRole("heading",{name:"أهلاً بعودتك"})).toBeVisible();
    expect((await context.request.get(base + "/api/config")).status()).toBe(401);
  } finally {await fresh.close();}
});
