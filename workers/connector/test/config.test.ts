import { describe, expect, it } from "vitest";
import apiRaw from "../../api/wrangler.jsonc?raw";
import raw from "../wrangler.jsonc?raw";

// Full-line comments only; nothing else in these files needs JSONC parsing.
const parse = (s: string) => JSON.parse(s.replace(/^\s*\/\/.*$/gm, ""));
const cfg = parse(raw);

describe("connector deployment config", () => {
  it("has no public surface and no routes", () => {
    expect(cfg.workers_dev).toBe(false);
    expect(cfg.preview_urls).toBe(false);
    expect(cfg.routes).toBeUndefined();
    expect(cfg.assets).toBeUndefined();
    expect(cfg.compatibility_flags).toContain("global_fetch_strictly_public");
  });

  it("holds exactly the expected bindings", () => {
    expect(cfg.durable_objects.bindings).toEqual([
      { name: "CONNECTOR_STATE", class_name: "ConnectorState" },
    ]);
    expect(cfg.services).toEqual([{ binding: "API", service: "secondary-api-dev" }]);
    expect(cfg.queues.producers).toEqual([{ binding: "SYNC_QUEUE", queue: "secondary-sync-dev" }]);
    expect(cfg.queues.consumers[0].queue).toBe("secondary-sync-dev");
    expect(cfg.workflows).toHaveLength(1);
    expect(cfg.name).toBe("secondary-connector-dev");
    for (const k of [
      "kv_namespaces",
      "r2_buckets",
      "d1_databases",
      "ai",
      "vectorize",
      "hyperdrive",
    ])
      expect(cfg[k], k).toBeUndefined();
  });

  it("is off by default: kill switch false, Graph unset, calendar off, EU objects, 15 min ACL bound", () => {
    expect(cfg.vars).toMatchObject({
      CONNECTOR_ENABLED: "false",
      GRAPH_TENANT_ID: "",
      GRAPH_CLIENT_ID: "",
      CALENDAR_ENABLED: "false",
      DO_JURISDICTION: "eu",
      ACL_MAX_AGE_SECONDS: "900",
    });
    expect(cfg.triggers.crons).toEqual(["*/15 * * * *"]);
  });

  it("commits no secret values", () => {
    for (const k of ["GRAPH_CLIENT_SECRET", "CONNECTOR_HMAC_KEY"])
      expect(cfg.vars).not.toHaveProperty(k);
  });

  it("the api binds the connector by the same service name", () => {
    const api = parse(apiRaw);
    expect(api.services).toContainEqual({ binding: "CONNECTOR", service: cfg.name });
  });
});
