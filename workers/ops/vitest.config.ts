import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      // Test values, not secrets.
      miniflare: {
        // The API is a separate deployment. This stand-in refuses everything; tests that need an API pass their own.
        serviceBindings: { API: async () => new Response("no api in this test", { status: 503 }) },
        bindings: {
          BACKUP_KEY: "test-backup-key-0123456789abcdef0123456",
          INTERNAL_HMAC_KEY: "test-internal-hmac-key-0123456789abcdef",
          OPS_ADMIN_KEY: "test-ops-admin-key-0123456789abcdef012",
        },
      },
    }),
  ],
});
