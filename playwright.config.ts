import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_PORT ?? 5173);
const harnessPort = Number(process.env.HARNESS_PORT ?? port + 1);
const demoURL = `http://127.0.0.1:${port}`;
const baseURL = `http://127.0.0.1:${harnessPort}`;
export default defineConfig({
  testDir: "./tests/browser",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL,
    viewport: { width: 1600, height: 1100 },
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1600, height: 1100 },
      },
    },
    {
      name: "firefox",
      use: {
        ...devices["Desktop Firefox"],
        viewport: { width: 1600, height: 1100 },
      },
    },
    {
      name: "webkit",
      use: {
        ...devices["Desktop Safari"],
        viewport: { width: 1600, height: 1100 },
      },
    },
  ],
  webServer: [
    {
      command: `pnpm run build:packages && pnpm --filter @georeferencing/demo run dev --port ${port} --strictPort`,
      url: demoURL,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: `pnpm run dev:harness --port ${harnessPort}`,
      url: `${baseURL}/validation.html`,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
