import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
import { apiStub, auditStub } from "./test/stubs.ts";

export default defineConfig({
  // The service-binding stubs keep call and audit logs in this process, so files run one at a time.
  test: { fileParallelism: false },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          INTERNAL_HMAC_KEY: "test-only-internal-hmac-key-0123456789abcdef",
          ALLOWED_REDIRECT_HOSTS:
            "claude.ai,claude.com,chatgpt.com,chat.openai.com,dust.tt,eu.dust.tt,localhost,127.0.0.1",
          MCP_PUBLIC_URL: "https://mcp.test",
        },
        serviceBindings: { API: apiStub, AUDIT: auditStub },
      },
    }),
  ],
});
