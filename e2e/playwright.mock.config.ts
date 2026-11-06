import { defineConfig } from "@playwright/test";

// The v4 UI against the dev mock (VITE_MOCK=1): no worker stack needed.
// Run: `pnpm --filter @secondary/web e2e:mock`.
const PORT = Number(process.env.MOCK_PORT ?? 5198);
export default defineConfig({
  testDir: ".",
  testMatch: /(v[456]|v8-lens)\.e2e\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  outputDir: "../.dev/e2e-results-mock",
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  webServer: {
    command: `node node_modules/vite/bin/vite.js --port ${PORT} --strictPort`,
    cwd: "../apps/web",
    url: `http://localhost:${PORT}`,
    env: { VITE_MOCK: "1" },
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
