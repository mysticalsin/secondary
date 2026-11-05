import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      // Test values, not secrets.
      miniflare: {
        bindings: {
          AUDIT_KEY_API: "test-audit-key-api-0123456789abcdef0123",
          AUDIT_KEY_MCP: "test-audit-key-mcp-0123456789abcdef0123",
          AUDIT_KEY_READ: "test-audit-key-read-0123456789abcdef012",
        },
      },
    }),
  ],
});
