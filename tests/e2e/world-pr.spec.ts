import { expect, test } from "@playwright/test";

test("operator can create and review a fixture-backed World PR", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1_500);
  await expect(page.getByRole("heading", { name: "Make the reasoning behind an action visible." })).toBeVisible();

  await page.getByRole("button", { name: "Create World PR" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("Demo passcode").fill("playwright-demo-passcode");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.waitForTimeout(1_000);

  await page.getByRole("button", { name: "Create World PR" }).click();
  await expect(page).toHaveURL(/\/pr\/wpr_/);
  await expect(page.getByRole("heading", { name: "Acme UK" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Review proposed workspace changes")).toBeVisible();
  await expect(page.getByText("uk-ops@example.test", { exact: false })).toBeVisible();
  await expect(page.getByText("America/New_York", { exact: true })).toBeVisible();
  await expect(page.getByText("artifact-independence.v1", { exact: true })).toBeVisible();
  await expect(page.getByText("Requires initial.calendar.move to succeed", { exact: true })).toBeVisible();
  await expect(page.getByText("External integrations remain disabled until their safety gates pass.")).toBeVisible();

  const reviewUrl = page.url();
  await page.context().clearCookies();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText("Your review session has expired. Sign in again.", { exact: false })).toBeVisible();
  await page.getByRole("link", { name: "Sign in" }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/login" && url.searchParams.get("next") === new URL(reviewUrl).pathname);
  await page.getByLabel("Demo passcode").fill("playwright-demo-passcode");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(reviewUrl);
  await expect(page.getByRole("heading", { name: "Acme UK renewal" })).toBeVisible();
});
