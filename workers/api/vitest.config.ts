import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// The real audit worker is a separate deployment (and has its own tests). Here the AUDIT service
// binding is a small in-memory stand-in with the same two routes, so API tests can read back the
// receipts the API wrote through GET /v1/audit/receipts.
const receipts: Record<string, unknown>[] = [];

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        // A test value, not a secret.
        bindings: {
          SEED_TOKEN: "test-seed-token",
          INTERNAL_HMAC_KEY: "test-internal-hmac-key-0123456789abcdef",
          DO_JURISDICTION: "off",
        },
        serviceBindings: {
          AUDIT: async (request: Request) => {
            const url = new URL(request.url);
            if (url.pathname === "/append" && request.method === "POST") {
              receipts.push((await request.json()) as Record<string, unknown>);
              return Response.json({ ok: true }, { status: 202 });
            }
            if (url.pathname === "/receipts") {
              const principal = url.searchParams.get("principal");
              const tenant = url.searchParams.get("tenant");
              return Response.json({
                receipts: receipts.filter(
                  (r) =>
                    (principal === null || r.principalId === principal) && r.tenantId === tenant,
                ),
              });
            }
            return Response.json({ error: "not_found" }, { status: 404 });
          },
        },
      },
    }),
  ],
});
