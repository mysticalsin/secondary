// Environments: dev (top level), staging and prod (wrangler env blocks). Config tests read the
// committed wrangler files, so a drift (a shared bucket, a dev flag in prod) fails here.

import { describe, expect, it } from "vitest";
import deployRaw from "../../../scripts/deploy.sh?raw";
import auditRaw from "../../audit/wrangler.jsonc?raw";
import connectorRaw from "../../connector/wrangler.jsonc?raw";
import mcpRaw from "../../mcp/wrangler.jsonc?raw";
import opsRaw from "../../ops/wrangler.jsonc?raw";
import apiRaw from "../wrangler.jsonc?raw";
import { as, call, json, type Loose, SEED_TOKEN } from "./helpers.ts";

function parseJsonc(src: string): Record<string, Loose> {
  let out = "";
  let inStr = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i] as string;
    if (inStr) {
      out += c;
      if (c === "\\") out += src[++i];
      else if (c === '"') inStr = false;
    } else if (c === '"') {
      inStr = true;
      out += c;
    } else if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      out += "\n";
    } else out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

const api = parseJsonc(apiRaw);
const audit = parseJsonc(auditRaw);
const mcp = parseJsonc(mcpRaw);
const ops = parseJsonc(opsRaw);
const connector = parseJsonc(connectorRaw);
const ENVS = ["staging", "prod"] as const;
const SECRET_NAMES = [
  "SEED_TOKEN",
  "INTERNAL_HMAC_KEY",
  "OPS_HMAC_KEY",
  "AUDIT_KEY_API",
  "AUDIT_KEY_MCP",
  "AUDIT_KEY_READ",
  "AUDIT_KEY_ERASE",
  "PSEUDONYM_KEY",
  "BRIEF_PROOF_KEY",
  "BACKUP_KEY",
  "OPS_ADMIN_KEY",
  "DEV_AUTH_BYPASS_EMAIL",
  "CONNECTOR_HMAC_KEY",
  "GRAPH_CLIENT_SECRET",
  "ENTRA_CLIENT_SECRET",
  "SCIM_TOKEN",
  "ANTHROPIC_API_KEY",
];

/** A flat, sorted list of every binding a worker config holds. */
function bindings(c: Loose): string[] {
  return [
    ...(c.assets ? [`${c.assets.binding}:assets`] : []),
    ...(c.durable_objects?.bindings ?? []).map(
      (b: Loose) => `${b.name}:durable_object:${b.class_name}`,
    ),
    ...(c.r2_buckets ?? []).map((b: Loose) => `${b.binding}:r2:${b.bucket_name}:${b.jurisdiction}`),
    ...(c.kv_namespaces ?? []).map((b: Loose) => `${b.binding}:kv`),
    ...(c.services ?? []).map((b: Loose) => `${b.binding}:service:${b.service}`),
  ].sort();
}

describe("environments: api", () => {
  for (const e of ENVS) {
    const c = api.env[e];
    it(`${e}: own name, EU bucket, own audit worker, exact binding inventory`, () => {
      expect(c.name).toBe(`secondary-api-${e}`);
      expect(bindings(c)).toEqual([
        "ASSETS:assets",
        `AUDIT:service:secondary-audit-${e}`,
        `BLOBS:r2:secondary-blobs-${e}:eu`,
        `CONNECTOR:service:secondary-connector-${e}`,
        "TENANT_POLICY:durable_object:TenantPolicy",
        "WORKSPACE:durable_object:Workspace",
      ]);
      expect(c.migrations[0].new_sqlite_classes.sort()).toEqual(["TenantPolicy", "Workspace"]);
      expect(c.preview_urls).toBe(false);
      expect(c.assets.run_worker_first).toBe(true);
    });

    it(`${e}: vars match the dev set, ENVIRONMENT is "${e}", EU jurisdiction, no secrets or dev flags`, () => {
      expect(Object.keys(c.vars).sort()).toEqual(Object.keys(api.vars).sort());
      expect(c.vars.ENVIRONMENT).toBe(e);
      expect(c.vars.DO_JURISDICTION).toBe("eu");
      expect(c.vars.ACCESS_AUD).toBe("");
      for (const k of SECRET_NAMES) expect(c.vars, k).not.toHaveProperty(k);
    });
  }

  it("prod: no workers.dev host, a route placeholder, restore off", () => {
    expect(api.env.prod.workers_dev).toBe(false);
    expect(api.env.prod.routes).toHaveLength(1);
    expect(api.env.prod.routes[0].pattern).toContain("<your-domain>");
    expect(api.env.prod.vars.RESTORE_ENABLED).toBe("no");
  });

  it("staging keeps the dev access pattern (workers.dev on) but restore is off by default (M-02)", () => {
    expect(api.env.staging.workers_dev).toBe(true);
    expect(api.env.staging.vars.RESTORE_ENABLED).toBe("no");
    expect(api.vars.RESTORE_ENABLED).toBe("yes");
  });
});

describe("environments: connector", () => {
  // The api and the connector bind each other: both sides must name the same environment.
  const all = [["dev", connector], ...ENVS.map((e) => [e, connector.env[e]] as const)] as const;
  for (const [e, c] of all) {
    it(`${e}: own worker, queue, workflow and state; binds the api of the same environment`, () => {
      expect(c.name).toBe(`secondary-connector-${e}`);
      expect(c.services).toEqual([{ binding: "API", service: `secondary-api-${e}` }]);
      expect(c.queues.producers).toEqual([{ binding: "SYNC_QUEUE", queue: `secondary-sync-${e}` }]);
      expect(c.queues.consumers[0].queue).toBe(`secondary-sync-${e}`);
      expect(c.workflows[0].name).toBe(`secondary-source-sync-${e}`);
      expect(c.durable_objects.bindings).toEqual([
        { name: "CONNECTOR_STATE", class_name: "ConnectorState" },
      ]);
      expect(c.migrations[0].new_sqlite_classes).toEqual(["ConnectorState"]);
      // No public surface, EU state, and the kill switch starts closed.
      expect(c.workers_dev).toBe(false);
      expect(c.preview_urls).toBe(false);
      expect(c.vars.ENVIRONMENT).toBe(e);
      expect(c.vars.DO_JURISDICTION).toBe("eu");
      expect(c.vars.CONNECTOR_ENABLED).toBe("false");
      for (const k of SECRET_NAMES) expect(c.vars, k).not.toHaveProperty(k);
    });
  }

  it("the connector's env vars match its dev set", () => {
    for (const e of ENVS)
      expect(Object.keys(connector.env[e].vars).sort()).toEqual(Object.keys(connector.vars).sort());
  });

  it("deploy.sh: queue first, placeholder before the api, real connector after it, one shared HMAC key", () => {
    const at = (needle: string) => {
      const i = deployRaw.indexOf(needle);
      expect(i, needle).toBeGreaterThan(-1);
      return i;
    };
    expect(at('wr queues create "$SYNC_QUEUE"')).toBeLessThan(at("\ndeploy audit"));
    expect(at('ensure_placeholder "$CONNECTOR"')).toBeLessThan(at("\ndeploy api"));
    expect(at("\ndeploy api")).toBeLessThan(at("\ndeploy connector"));
    expect(at("\ndeploy connector")).toBeLessThan(at("\ndeploy mcp"));
    expect(deployRaw).toContain("shared_secret CONNECTOR_HMAC_KEY api connector");
    // The Graph secret belongs to a person: the script never generates it.
    expect(deployRaw).not.toMatch(/(single|shared)_secret [^\n]*GRAPH_CLIENT_SECRET/);
  });

  it("dev: the api names the dev connector", () => {
    expect(bindings(api)).toContain("CONNECTOR:service:secondary-connector-dev");
  });
});

describe("environments: audit, mcp, ops", () => {
  for (const e of ENVS) {
    it(`${e}: audit has its own EU bucket and no public surface`, () => {
      const c = audit.env[e];
      expect(c.name).toBe(`secondary-audit-${e}`);
      expect(c.r2_buckets).toEqual([
        { binding: "AUDIT_LOG", bucket_name: `secondary-audit-${e}`, jurisdiction: "eu" },
      ]);
      expect(c.workers_dev).toBe(false);
      expect(c.preview_urls).toBe(false);
      expect(c.vars.ENVIRONMENT).toBe(e);
    });

    it(`${e}: mcp has its own KV, services of the same environment, no loopback redirect hosts`, () => {
      const c = mcp.env[e];
      expect(c.name).toBe(`secondary-mcp-${e}`);
      expect(bindings(c)).toEqual([
        `API:service:secondary-api-${e}`,
        `AUDIT:service:secondary-audit-${e}`,
        "OAUTH_KV:kv",
      ]);
      expect(c.kv_namespaces[0].id).not.toBe(mcp.kv_namespaces[0].id);
      expect(c.vars.ENVIRONMENT).toBe(e);
      const hosts = String(c.vars.ALLOWED_REDIRECT_HOSTS).split(",");
      expect(hosts).not.toContain("localhost");
      expect(hosts).not.toContain("127.0.0.1");
      expect(c.vars.MCP_PUBLIC_URL).toBe("");
      expect(c.preview_urls).toBe(false);
    });

    it(`${e}: ops has its own EU backup bucket, API of the same environment, crons, 35 day retention`, () => {
      const c = ops.env[e];
      expect(c.name).toBe(`secondary-ops-${e}`);
      expect(bindings(c)).toEqual([
        `API:service:secondary-api-${e}`,
        `BACKUPS:r2:secondary-backups-${e}:eu`,
      ]);
      expect(c.triggers.crons).toHaveLength(2);
      expect(c.vars.BACKUP_RETENTION_DAYS).toBe("35");
      expect(c.vars.ENVIRONMENT).toBe(e);
      for (const k of SECRET_NAMES) expect(c.vars, k).not.toHaveProperty(k);
    });
  }

  it("mcp and ops prod have no workers.dev host and a route placeholder; ops prod restore is off", () => {
    for (const c of [mcp.env.prod, ops.env.prod]) {
      expect(c.workers_dev).toBe(false);
      expect(c.routes[0].pattern).toContain("<your-domain>");
    }
    expect(ops.env.prod.vars.RESTORE_ENABLED).toBe("no");
  });

  it("M-02: ops staging and prod have restore off and carry the Access vars; only dev restores by default", () => {
    expect(ops.vars.RESTORE_ENABLED).toBe("yes");
    for (const e of ENVS) {
      expect(ops.env[e].vars.RESTORE_ENABLED, e).toBe("no");
      expect(ops.env[e].vars, e).toHaveProperty("ACCESS_TEAM_DOMAIN");
      expect(ops.env[e].vars, e).toHaveProperty("ACCESS_AUD");
    }
  });

  it("M-01: the ops key is shared with api and ops only, the MCP key with api and mcp only", () => {
    expect(deployRaw).toMatch(/^shared_secret OPS_HMAC_KEY api ops$/m);
    expect(deployRaw).toMatch(/^shared_secret INTERNAL_HMAC_KEY api mcp$/m);
    expect(deployRaw).not.toMatch(/OPS_HMAC_KEY[^\n]*\bmcp\b/);
  });

  it("N-04: the brief proof key is generated for the api alone", () => {
    expect(deployRaw).toMatch(/^single_secret api BRIEF_PROOF_KEY$/m);
    expect(deployRaw).not.toMatch(/BRIEF_PROOF_KEY[^\n]*\b(mcp|ops|connector)\b/);
    for (const c of [mcp, ops, connector])
      expect(JSON.stringify(c)).not.toContain("BRIEF_PROOF_KEY");
  });

  it("no bucket, KV id, worker name or service is shared between environments", () => {
    const configs = [
      { c: api, kind: "api" },
      { c: audit, kind: "audit" },
      { c: mcp, kind: "mcp" },
      { c: ops, kind: "ops" },
    ];
    const names: string[] = [];
    const buckets: string[] = [];
    for (const { c } of configs)
      for (const e of [c, c.env.staging, c.env.prod]) {
        names.push(e.name ?? c.name);
        for (const b of e.r2_buckets ?? []) buckets.push(b.bucket_name);
      }
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(buckets).size).toBe(buckets.length);
    const kv = [mcp, mcp.env.staging, mcp.env.prod].map((c) => c.kv_namespaces[0].id);
    expect(new Set(kv).size).toBe(3);
  });
});

describe("staging and prod run with every dev-only feature off", () => {
  const unseeded = { TENANT_DOMAINS: JSON.stringify({ "fresh.example.invalid": "tenant_fresh" }) };

  for (const e of ENVS) {
    const env = { ENVIRONMENT: e, ...unseeded };

    it(`${e}: the localhost bypass email is ignored`, async () => {
      const res = await call("/v1/me", {
        origin: "http://localhost:8787",
        env: { ...env, DEV_AUTH_BYPASS_EMAIL: "dev@example.invalid" },
      });
      expect(res.status).toBe(401);
    });

    it(`${e}: the persona header is ignored and a new tenant is not auto-seeded`, async () => {
      const res = await as("platform_admin", "/v1/me", {
        email: "someone@fresh.example.invalid",
        env,
      });
      expect(res.status).toBe(200);
      const me = await json(res);
      expect(me.persona).toBeNull();
      expect(me.seeded).toBe(false);
      expect(me.principal.roleIds).toEqual([]);
      expect(me.env).toBe(e);
    });

    it(`${e}: M1: with Access and Entra unconfigured every route but health fails closed`, async () => {
      const closed = { ENVIRONMENT: e, ACCESS_TEAM_DOMAIN: "", ACCESS_AUD: "" };
      for (const path of ["/v1/me", "/v1/map?lens=departments", "/v1/admin/switches"])
        expect(
          (await call(path, { email: "someone@example.invalid", env: closed })).status,
          path,
        ).toBe(401);
      expect((await call("/v1/health", { env: closed })).status).toBe(200);
    });

    it(`${e}: the dev seed endpoint does not exist`, async () => {
      const res = await call("/v1/admin/seed", {
        email: "seeder@example.invalid",
        body: {},
        headers: { "X-Seed-Token": SEED_TOKEN },
        env,
      });
      expect(res.status).toBe(404);
    });
  }
});
