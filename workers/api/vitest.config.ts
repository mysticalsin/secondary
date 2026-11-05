import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
import { parseReceipt } from "../../packages/contracts/src/audit-receipt.ts";

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
          AUDIT_KEY_API: "test-audit-key-api-0123456789abcdef0123",
          AUDIT_KEY_READ: "test-audit-key-read-0123456789abcdef012",
        },
        serviceBindings: {
          AUDIT: async (request: Request) => {
            const url = new URL(request.url);
            // The real audit worker refuses calls without its keys; so does this stand-in.
            const key = request.headers.get("X-Audit-Key");
            const need = url.pathname === "/receipts" ? "test-audit-key-read-0123456789abcdef012" : "test-audit-key-api-0123456789abcdef0123";
            if (key !== need) return Response.json({ error: "unauthorized" }, { status: 401 });
            if (url.pathname === "/append" && request.method === "POST") {
              // The real parser, so a receipt the audit worker would refuse fails here too.
              const parsed = parseReceipt(await request.json(), "api");
              if (!parsed) return Response.json({ error: "invalid_receipt" }, { status: 400 });
              receipts.push(parsed as unknown as Record<string, unknown>);
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
