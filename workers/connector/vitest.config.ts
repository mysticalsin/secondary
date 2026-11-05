import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        // Test values, not secrets.
        bindings: {
          CONNECTOR_HMAC_KEY: "test-connector-hmac-key-0123456789abcdef",
          DO_JURISDICTION: "off",
        },
        // The api is a separate deployment. Tests inject their own api client; this stand-in just accepts calls.
        serviceBindings: {
          API: async () => Response.json({ ok: true }),
        },
      },
    }),
  ],
});
