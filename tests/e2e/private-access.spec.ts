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
    page.getByRole("heading", { name: "Private website" }),
  ).toBeVisible();
  const denied = await context.request.get(base + "/mapbox-rtl-text-v0.2.3.js");
  expect(denied.status()).toBe(401);
  const api = await context.request.get(base + "/api/config");
  expect(api.status()).toBe(401);
  await page.getByLabel("Username / اسم المستخدم").fill("browser fixture");
  await page.getByLabel("Password / كلمة المرور").fill("wrong");
  await page
    .getByRole("button", { name: "Unlock website / فتح الموقع" })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Incorrect username or password",
  );
  await page.getByLabel("Username / اسم المستخدم").fill("browser fixture");
  await page
    .getByLabel("Password / كلمة المرور")
    .fill("browser-fixture-password");
  await page
    .getByRole("button", { name: "Unlock website / فتح الموقع" })
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
  await page
    .locator("nav")
    .getByRole("link", { name: "Settings", exact: true })
    .filter({ visible: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Lock website", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Private website" }),
  ).toBeVisible();
  expect((await context.request.get(base + "/api/config")).status()).toBe(401);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
