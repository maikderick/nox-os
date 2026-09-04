import { defineConfig, devices } from "@playwright/test";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

const configuredBaseURL = process.env.PLAYWRIGHT_BASE_URL;
const configuredPort = process.env.PLAYWRIGHT_PORT;
// Keep E2E isolated from local dashboards such as Grafana, which commonly owns
// port 3000. An occupied port must fail instead of making Playwright validate
// whichever application happened to be there.
const baseURL = configuredBaseURL ?? `http://127.0.0.1:${configuredPort ?? "3100"}`;
const port = configuredPort ?? (() => {
  try {
    return new URL(baseURL).port || "3100";
  } catch {
    return "3100";
  }
})();

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60000,
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run start -- --port ${port}`,
    url: baseURL,
    env: { NEXTAUTH_URL: baseURL },
    reuseExistingServer: false,
    timeout: 120000,
  },
});
