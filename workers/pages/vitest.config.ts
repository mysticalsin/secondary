import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      // Test values. LOCAL_DEV lets the counter skip the EU jurisdiction, which workerd cannot create.
      miniflare: { bindings: { DO_JURISDICTION: "off", LOCAL_DEV: "yes" } },
    }),
  ],
});
