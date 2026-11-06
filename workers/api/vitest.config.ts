import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
import { parseReceipt } from "../../packages/contracts/src/audit-receipt.ts";

// The real audit worker is a separate deployment (and has its own tests). Here the AUDIT service
// binding is a small in-memory stand-in with the same two routes, so API tests can read back the
// receipts the API wrote through GET /v1/audit/receipts.
const receipts: Record<string, unknown>[] = [];

export default defineConfig({
  // The AUDIT stand-in above is one in-memory list shared by every test file. Files run one at a time so
  // receipts written by another file never appear in the middle of the rights-erase assertions.
  test: { fileParallelism: false },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        // A test value, not a secret.
        bindings: {
          SEED_TOKEN: "test-seed-token",
          INTERNAL_HMAC_KEY: "test-internal-hmac-key-0123456789abcdef",
          BRIEF_PROOF_KEY: "test-brief-proof-key-0123456789abcdef01",
          OPS_HMAC_KEY: "test-ops-hmac-key-0123456789abcdef012345",
          CONNECTOR_HMAC_KEY: "test-connector-hmac-key-0123456789abcdef",
          // wrangler.jsonc carries the dev Access team and AUD tag; tests run without Access.
          ACCESS_TEAM_DOMAIN: "",
          ACCESS_AUD: "",
          DO_JURISDICTION: "off",
          // Local checkout marker: without it the code would ask for the EU jurisdiction, which workerd
          // cannot create (B1 L6). The sign-in bypass still needs a localhost request host.
          DEV_AUTH_BYPASS_EMAIL: "dev@example.invalid",
          // Wiki jobs wait for POST /v1/wiki/:ws/run in tests; only the alarm test turns them on.
          WIKI_ALARMS: "off",
          // The synthetic wiki seed is off by default so other tests start with empty wikis.
          WIKI_SEED: "off",
          // The dev stand-in for the connector (synthetic sources, mocked Graph). Tests that need the real
          // connector path pass OPS_SYNTHETIC: "off" through call({ env }).
          OPS_SYNTHETIC: "on",
          AUDIT_KEY_API: "test-audit-key-api-0123456789abcdef0123",
          AUDIT_KEY_READ: "test-audit-key-read-0123456789abcdef012",
          AUDIT_KEY_ERASE: "test-audit-key-erase-0123456789abcdef01",
          PSEUDONYM_KEY: "test-pseudonym-key-0123456789abcdef0123",
        },
        serviceBindings: {
          // The connector is a separate deployment. Tests that need it pass their own stand-in through call({ env }).
          CONNECTOR: async () => Response.json({ error: "not_in_test" }, { status: 503 }),
          AUDIT: async (request: Request) => {
            const url = new URL(request.url);
            // The real audit worker refuses calls without its keys; so does this stand-in.
            const key = request.headers.get("X-Audit-Key");
            const need =
              url.pathname === "/receipts"
                ? "test-audit-key-read-0123456789abcdef012"
                : url.pathname === "/pseudonymise"
                  ? "test-audit-key-erase-0123456789abcdef01"
                  : "test-audit-key-api-0123456789abcdef0123";
            if (key !== need) return Response.json({ error: "unauthorized" }, { status: 401 });
            if (url.pathname === "/append" && request.method === "POST") {
              // The real parser, so a receipt the audit worker would refuse fails here too.
              const parsed = parseReceipt(await request.json(), "api");
              if (!parsed) return Response.json({ error: "invalid_receipt" }, { status: 400 });
              receipts.push(parsed as unknown as Record<string, unknown>);
              return Response.json({ ok: true }, { status: 202 });
            }
            if (url.pathname === "/pseudonymise" && request.method === "POST") {
              const b = (await request.json()) as { tenant: string; from: string; to: string };
              let n = 0;
              for (const r of receipts)
                if (r.tenantId === b.tenant && r.principalId === b.from) {
                  r.principalId = b.to;
                  n++;
                }
              return Response.json({ rewritten: n });
            }
            if (url.pathname === "/receipts") {
              const principal = url.searchParams.get("principal");
              const tenant = url.searchParams.get("tenant");
              const limit = Math.min(
                Math.max(Number(url.searchParams.get("limit") ?? 200) || 200, 1),
                1000,
              );
              // Newest first and at most `limit` (default 200, up to 1000), like the real worker. `before`
              // is the receipt id of the last receipt of the previous page; `next` is set while more remain.
              const sorted = receipts
                .filter(
                  (r) =>
                    (principal === null || r.principalId === principal) && r.tenantId === tenant,
                )
                .sort((a, b) => String(b.at).localeCompare(String(a.at)));
              const before = url.searchParams.get("before");
              const from =
                before === null ? 0 : sorted.findIndex((r) => r.receiptId === before) + 1;
              const page = sorted.slice(from, from + limit);
              return Response.json({
                receipts: page,
                next: from + limit < sorted.length ? (page.at(-1)?.receiptId ?? null) : null,
              });
            }
            return Response.json({ error: "not_found" }, { status: 404 });
          },
        },
      },
    }),
  ],
});
