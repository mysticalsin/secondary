import { defineConfig } from "@playwright/test";
import { API_URL } from "./ports.ts";

// Runs against the local multi-worker stack (`pnpm dev:all`). When nothing answers on :8787 the
// webServer entry starts it. Tests share one seeded tenant and run in order, in one worker.
export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts/,
  globalSetup: "./global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  outputDir: "../.dev/e2e-results",
  use: {
    baseURL: API_URL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    viewport: { width: 1360, height: 860 },
  },
  webServer: {
    command: "node scripts/dev-all.mjs --no-build",
    cwd: "..",
    url: `${API_URL}/v1/health`,
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
