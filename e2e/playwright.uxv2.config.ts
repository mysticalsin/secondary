import { defineConfig } from "@playwright/test";

// UX v2 acceptance against the web app in dev-mock mode (VITE_MOCK=1). The v2 API is built on its own
// branch, so this suite needs no worker stack. Run: `pnpm --filter @secondary/web e2e:mock`.
const PORT = Number(process.env.UXV2_PORT ?? 5199);
export default defineConfig({
  testDir: ".",
  testMatch: /(uxv2|lp)\.e2e\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  outputDir: "../.dev/e2e-results-uxv2",
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
