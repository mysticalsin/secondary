import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      // The real audit worker is a separate deployment; tests stub the AUDIT service binding.
      miniflare: {
        serviceBindings: {
          AUDIT: async () => Response.json({ ok: true, stub: true }, { status: 202 }),
        },
      },
    }),
  ],
});
