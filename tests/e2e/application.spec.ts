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
