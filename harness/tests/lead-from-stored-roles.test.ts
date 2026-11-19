import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { admittedView } from "../../packages/policy/src/engine.ts";
import { buildOrg } from "../../packages/policy/src/org.ts";
import { persona } from "../../packages/policy/src/personas.ts";
import { ROLES } from "../../packages/policy/src/roles.ts";
import type { Role } from "../../packages/policy/src/types.ts";
import { openSqlite, sqliteStorage } from "../runtime/sqlite-storage.ts";

register(new URL("../runtime/register-worker-hooks.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});

const NOW = 1_700_000_000_000;

/** The role an old tenant stored: the built-in grants, without the later lead mark. */
function preseeded(role: Role): Role {
  return {
    ...role,
    grants: role.grants.map((grant) => {
      if (grant.conditions.lead !== true) return grant;
      const conditions = { ...grant.conditions };
      delete conditions.lead;
      return { ...grant, conditions };
    }),
  };
}

test("stored roles: an old acme_lead still decides, and can.decide false does not publish", async () => {
  const specifier = new URL("../../src/worker/wiki/review.ts", import.meta.url).href;
  const openSpecifier = new URL("../../src/worker/brains/open.ts", import.meta.url).href;
  const { mayDecide } = (await import(specifier)) as {
    mayDecide: (
      view: ReturnType<typeof admittedView>,
      principal: ReturnType<typeof persona>,
      nodeId: string,
    ) => { allowed: boolean };
  };
  const { directPublish } = (await import(openSpecifier)) as {
    directPublish: (c: unknown, w: Record<string, unknown>) => Promise<boolean>;
  };

  const stored = { ...ROLES, acme_lead: preseeded(ROLES.acme_lead) };
  assert.equal(
    stored.acme_lead.grants.some((grant) => grant.conditions.lead === true),
    false,
  );
  const org = buildOrg({ roles: stored });
  const lead = persona("acme_lead");
  const view = admittedView(lead, org, { now: NOW });
  assert.equal(mayDecide(view, lead, "a_acme").allowed, true);
  assert.equal(mayDecide(view, lead, "c_sales").allowed, true);
  assert.equal(mayDecide(view, lead, "core").allowed, false);

  const tenant = {
    jurisdiction() {
      return tenant;
    },
    idFromName() {
      return "id";
    },
    get() {
      return { humanIds: async () => [] };
    },
  };
  const published = await directPublish(
    {
      get: (key: string) =>
        key === "session"
          ? { principal: lead, internal: undefined, tenantId: lead.tenantId, ctx: { now: NOW } }
          : undefined,
      env: {
        ENVIRONMENT: "dev",
        DO_JURISDICTION: "off",
        DEV_AUTH_BYPASS_EMAIL: lead.email,
        TENANT_POLICY: tenant,
      },
    },
    {
      personal: false,
      nodeId: "c_sales",
      view,
      vn: view.nodes.get("c_sales"),
      stub: {
        brainConfig: async () => ({ publication: "direct" }),
        brainRoleOf: async () => null,
      },
      can: { edit: true, decide: false },
    },
  );
  assert.equal(published, false);
});

test("governance: editing acme_lead without resending grants is not invalid_condition", async () => {
  const validateSpecifier = new URL("../../src/worker/admin/validate.ts", import.meta.url).href;
  const { buildRole } = (await import(validateSpecifier)) as {
    buildRole: (
      input: { label?: string; grants?: unknown },
      org: ReturnType<typeof buildOrg>,
      base: Role | null,
    ) => { ok: true } | { ok: false; code: string; message: string };
  };
  const storeSpecifier = new URL("../../src/worker/admin/store.ts", import.meta.url).href;
  const { GovStore } = (await import(storeSpecifier)) as {
    GovStore: new (
      host: { sql: ReturnType<typeof sqliteStorage>; tx: <T>(fn: () => T) => T; bump: () => number },
      defaults: readonly Role[],
    ) => { listRoles: () => { roles: Role[] } };
  };
  const dir = mkdtempSync(path.join(tmpdir(), "lead-seed-"));
  const db: DatabaseSync = openSqlite(path.join(dir, "tenant.sqlite"));
  try {
    db.exec(
      `CREATE TABLE nda_grants (
        principal_id TEXT NOT NULL, account_id TEXT NOT NULL,
        PRIMARY KEY (principal_id, account_id))`,
    );
    const store = new GovStore(
      { sql: sqliteStorage(db), tx: (fn) => fn(), bump: () => 1 },
      Object.values(ROLES),
    );
    const base = store.listRoles().roles.find((role) => role.id === "acme_lead");
    assert.equal(base === undefined, false);
    const built = buildRole({ label: "Account lead, Acme (edited)" }, buildOrg(), base ?? null);
    assert.equal(built.ok, true, built.ok ? "" : `${built.code}: ${built.message}`);
    const sent = buildRole({ grants: ROLES.acme_lead.grants }, buildOrg(), base ?? null);
    assert.equal(sent.ok, true, sent.ok ? "" : `${sent.code}: ${sent.message}`);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
