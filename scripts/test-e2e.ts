import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";

const root = fileURLToPath(new URL("..", import.meta.url));
const host = "127.0.0.1";
const fixtureBaseUrl = "http://127.0.0.1:3100";

// This is a complete, explicitly fixture-only server environment. Do not
// inherit process.env: in particular, the smoke must not receive deployment
// credentials or let Next load .env.local in development mode.
export function createFixtureE2EServerEnvironment(baseUrl: string) {
  return {
  NODE_ENV: "test",
  APP_BASE_URL: baseUrl,
  REWIND_STORAGE_MODE: "memory_fixture",
  REWIND_SESSION_SECRET: "playwright-session-secret-000000000001",
  REWIND_DASHBOARD_PASSCODE: "playwright-demo-passcode",
  MCP_BACKEND_TOKEN: "playwright-mcp-token-000000000000001",
  OPENAI_API_KEY: "fixture-openai-key-not-used-by-e2e",
  OPENAI_MODEL: "fixture-model-v1",
  GOOGLE_CLIENT_ID: "fixture-client.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "fixture-google-client-secret-000001",
  GOOGLE_REDIRECT_URI: `${baseUrl}/api/v1/oauth/google/callback`,
  REWIND_TOKEN_ENCRYPTION_KEY: "playwright-token-encryption-key-000001",
  REWIND_GOOGLE_EXPECTED_EMAIL: "fixture-team@example.test",
  REWIND_RECIPIENT_ALLOWLIST: JSON.stringify({ UK: ["uk-ops@example.test"], US: ["us-ops@example.test"] }),
  REWIND_DEMO_DATE: "2026-08-20",
  } as const;
}

export const FIXTURE_E2E_SERVER_ENVIRONMENT = createFixtureE2EServerEnvironment(fixtureBaseUrl);

function spawnServer(port: number, baseUrl: string): ChildProcess {
  return spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", host, "--port", String(port)], {
    cwd: root,
    env: createFixtureE2EServerEnvironment(baseUrl),
    stdio: "inherit",
    windowsHide: true,
  });
}

async function chooseAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not reserve a loopback port for the fixture browser smoke."));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

async function waitForHealth(baseUrl: string): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Timed out waiting for the E2E server health check.");
}

function stopProcessTree(server: ChildProcess): void {
  if (!server.pid) return;
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(server.pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
    killer.unref();
    server.unref();
    return;
  }
  server.kill("SIGTERM");
}

async function main(): Promise<void> {
  const port = await chooseAvailablePort();
  const baseUrl = `http://${host}:${port}`;
  const server = spawnServer(port, baseUrl);
  let exitCode = 1;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await waitForHealth(baseUrl);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    page.setDefaultTimeout(15_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1_500);
    await page.getByTestId("composer-screen").waitFor({ state: "visible" });
    await page.getByTestId("fixture-status").waitFor({ state: "visible" });
    await page.getByRole("heading", { name: "Make the reasoning behind an action visible." }).waitFor({ state: "visible" });
    await page.getByTestId("composer-request").focus();
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("create-world-pr")).toBeFocused();
    await expect(page.getByTestId("create-world-pr")).toHaveCSS("outline-style", "solid");
    await expect(page.getByTestId("create-world-pr")).toHaveCSS("outline-color", "rgb(0, 0, 0)");
    await expect(page.getByTestId("create-world-pr")).toHaveCSS("outline-width", "3px");
    if (!(await page.evaluate(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches))) {
      throw new Error("Reduced-motion media emulation was not observed by the page.");
    }
    await page.getByRole("button", { name: "Create World PR" }).click();
    await page.waitForURL((url) => url.pathname === "/login");
    await page.getByTestId("login-screen").waitFor({ state: "visible" });
    await page.getByLabel("Demo passcode").focus();
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("login-submit")).toBeFocused();
    await expect(page.getByTestId("login-submit")).toHaveCSS("outline-color", "rgb(0, 0, 0)");
    await page.getByLabel("Demo passcode").fill("wrong-playwright-passcode");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("alert").getByText("Sign-in failed. Configure the demo operator passcode for this environment.").waitFor({ state: "visible" });
    await page.getByLabel("Demo passcode").fill("playwright-demo-passcode");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForURL((url) => url.pathname === "/");
    await page.waitForTimeout(1_000);
    await page.getByTestId("composer-screen").waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Create World PR" }).click();
    await page.waitForURL((url) => url.pathname.startsWith("/pr/wpr_"));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByTestId("review-screen").waitFor({ state: "visible" });
    await page.getByRole("heading", { name: "Acme UK" }).waitFor({ state: "visible" });
    await page.getByTestId("assumption-panel").waitFor({ state: "visible" });
    await page.getByTestId("planned-actions").waitFor({ state: "visible" });
    await page.getByTestId("review-timeline").waitFor({ state: "visible" });
    await page.getByTestId("fixture-mode-notice").waitFor({ state: "visible" });
    if (!(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))) {
      throw new Error("Responsive review viewport has horizontal overflow.");
    }
    await page.getByText("Review proposed workspace changes").waitFor({ state: "visible" });
    await page.getByText("uk-ops@example.test", { exact: false }).waitFor({ state: "visible" });
    await page.getByText("America/New_York", { exact: true }).waitFor({ state: "visible" });
    await page.getByText("artifact-independence.v1", { exact: true }).waitFor({ state: "visible" });
    await page.getByText("Requires initial.calendar.move to succeed", { exact: true }).waitFor({ state: "visible" });
    await page.getByText("External integrations remain disabled until their safety gates pass.").waitFor({ state: "visible" });
    const reviewUrl = page.url();
    await page.context().clearCookies();
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByText("Your review session has expired. Sign in again.", { exact: false }).waitFor({ state: "visible" });
    await page.getByRole("alert").filter({ hasText: "Your review session has expired." }).waitFor({ state: "visible" });
    await page.getByRole("link", { name: "Sign in" }).click();
    await page.waitForURL((url) => url.pathname === "/login" && url.searchParams.get("next") === new URL(reviewUrl).pathname);
    await page.getByLabel("Demo passcode").fill("playwright-demo-passcode");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForURL(reviewUrl);
    await page.getByRole("heading", { name: "Acme UK renewal" }).waitFor({ state: "visible" });
    console.log("E2E passed: auth rejection, login, creation, strict review rendering, expired-session handling, and safe return to the review URL.");
    exitCode = 0;
  } finally {
    await browser?.close();
    stopProcessTree(server);
  }
  process.exitCode = exitCode;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
