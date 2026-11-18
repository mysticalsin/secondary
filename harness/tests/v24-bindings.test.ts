import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));

const PLAIN = [
  "ACCESS_AUD",
  "ACCESS_TEAM_DOMAIN",
  "DEFAULT_TENANT_ID",
  "DO_JURISDICTION",
  "ENVIRONMENT",
  "MCP_PUBLIC_URL",
  "RATE_LIMIT_PER_MIN",
  "RESTORE_ENABLED",
  "RETENTION_BRIEF_DAYS",
  "RETENTION_DRAFT_DAYS",
  "TENANT_DOMAINS",
];

const SECRETS = [
  "AUDIT_KEY_API",
  "AUDIT_KEY_ERASE",
  "AUDIT_KEY_READ",
  "BRIEF_PROOF_KEY",
  "CONNECTOR_HMAC_KEY",
  "INTERNAL_HMAC_KEY",
  "OPS_HMAC_KEY",
  "PSEUDONYM_KEY",
  "SEED_TOKEN",
];

function stripJsonc(text: string): string {
  return text
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
}

function readConfig(): Record<string, unknown> {
  const text = readFileSync(join(root, "wrangler.jsonc"), "utf8");
  return JSON.parse(stripJsonc(text)) as Record<string, unknown>;
}

test("v24 bindings: names, types, and no values", () => {
  const text = readFileSync(join(root, "wrangler.jsonc"), "utf8");
  const config = JSON.parse(stripJsonc(text)) as Record<string, unknown>;
  assert.equal(config.name, "secondary-api-dev");
  assert.equal(config.main, "deploy/graph-entry.ts");
  assert.equal(config.compatibility_date, "2026-10-01");
  assert.deepEqual(config.compatibility_flags, ["nodejs_compat"]);
  assert.equal(config.workers_dev, true);
  assert.equal(config.preview_urls, false);
  assert.equal(config.logpush, false);
  assert.equal(config.keep_vars, true);
  assert.equal(Object.hasOwn(config, "vars"), false);
  assert.equal(Object.hasOwn(config, "account_id"), false);
  assert.equal(Object.hasOwn(config, "routes"), false);
  assert.equal(Object.hasOwn(config, "route"), false);
  assert.equal(Object.hasOwn(config, "observability"), false);
  assert.equal(Object.hasOwn(config, "kv_namespaces"), false);
  assert.equal(Object.hasOwn(config, "d1_databases"), false);
  assert.equal(Object.hasOwn(config, "queues"), false);
  assert.equal(Object.hasOwn(config, "triggers"), false);
  assert.equal(Object.hasOwn(config, "env"), false);

  const comment = text.match(/^\/\/ plain-text: (.+)$/m);
  assert.ok(comment);
  assert.deepEqual(
    comment[1].split(", ").map((name) => name.trim()),
    PLAIN,
  );

  const secrets = config.secrets as { required: string[] };
  assert.deepEqual(secrets.required, SECRETS);

  const assets = config.assets as {
    directory: string;
    binding: string;
    not_found_handling: string;
    run_worker_first: boolean;
    base_path: string;
  };
  assert.equal(assets.directory.replace(/^\.\//, ""), "deploy/assets");
  assert.equal(assets.binding, "ASSETS");
  assert.equal(assets.not_found_handling, "single-page-application");
  assert.equal(assets.run_worker_first, true);
  assert.equal(assets.base_path, "/");

  const services = config.services as { binding: string; service: string }[];
  assert.deepEqual(
    services.map((row) => [row.binding, row.service]),
    [
      ["AUDIT", "secondary-audit-dev"],
      ["CONNECTOR", "secondary-connector-dev"],
    ],
  );
  assert.equal(services.every((row) => Object.keys(row).length === 2), true);

  const buckets = config.r2_buckets as { binding: string; bucket_name: string; jurisdiction: string }[];
  assert.deepEqual(buckets, [
    { binding: "BLOBS", bucket_name: "secondary-blobs-dev", jurisdiction: "eu" },
  ]);

  const objects = config.durable_objects as { bindings: { name: string; class_name: string }[] };
  assert.deepEqual(objects.bindings, [
    { name: "TENANT_POLICY", class_name: "TenantPolicy" },
    { name: "WORKSPACE", class_name: "Workspace" },
  ]);

  const migrations = config.migrations as Record<string, unknown>[];
  assert.equal(migrations.length, 1);
  assert.equal(migrations[0].tag, "v3");
  assert.deepEqual(migrations[0].new_sqlite_classes, ["TenantPolicy", "Workspace"]);
  for (const key of ["deleted_classes", "renamed_classes", "transferred_classes", "new_classes"]) {
    assert.equal(Object.hasOwn(migrations[0], key), false);
  }

  const names = new Set<string>([...PLAIN, ...SECRETS, "ASSETS", "AUDIT", "BLOBS", "CONNECTOR", "TENANT_POLICY", "WORKSPACE"]);
  assert.equal(names.size, 26);

  const alias = config.alias as Record<string, string>;
  assert.equal(alias["@secondary/policy"], "./harness/adapters/policy-entry.ts");
  const rules = config.rules as { type: string; globs: string[]; fallthrough: boolean }[];
  assert.equal(rules.length, 1);
  assert.equal(rules[0].type, "Text");
  assert.equal(rules[0].fallthrough, true);
  assert.deepEqual(rules[0].globs, ["**/*.html", "**/*.css", "**/*.txt"]);

  const parsed = JSON.stringify(config);
  for (const name of PLAIN) assert.equal(parsed.includes(name), false);
  for (const name of SECRETS) assert.equal(parsed.includes(`"${name}":`), false);
  assert.equal(parsed.includes("sk-"), false);
  assert.equal(parsed.includes("BEGIN "), false);
});

test("v24 bindings: the asset directory is only the unreproduced marker", () => {
  const names = readdirSync(join(root, "deploy/assets"));
  assert.deepEqual(names, ["UNREPRODUCED"]);
});

test("v24 bindings: workers-types stay pinned and the description names the refusal", () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    description: string;
    devDependencies: Record<string, string>;
  };
  assert.equal(pkg.devDependencies["@cloudflare/workers-types"], "5.20261107.1");
  assert.equal(pkg.devDependencies.wrangler, "4.158.0");
  assert.match(pkg.description, /deploy\.sh refuses a real deploy while deploy\/assets\/UNREPRODUCED exists/);
});

test("deploy guard: a dev vars file and a real deploy are refused", async () => {
  const guard = (await import("../../deploy/guard.ts")) as {
    guardRoot: (root: string, mode: "dry-run" | "deploy") => { ok: true } | { ok: false; reason: string };
  };
  const dir = mkdtempSync(join(tmpdir(), "v24-guard-"));
  writeFileSync(join(dir, ".dev.vars"), "NAME=value\n");
  writeFileSync(join(dir, "wrangler.jsonc"), readFileSync(join(root, "wrangler.jsonc")));
  assert.deepEqual(guard.guardRoot(dir, "dry-run"), { ok: false, reason: "dev-vars-present" });
  assert.deepEqual(guard.guardRoot(dir, "deploy"), { ok: false, reason: "dev-vars-present" });
  assert.deepEqual(guard.guardRoot(root, "deploy"), { ok: false, reason: "assets-unreproduced" });
  assert.deepEqual(guard.guardRoot(root, "dry-run"), { ok: true });
});

test("deploy.sh without --dry-run exits non-zero and does not upload", () => {
  const result = spawnSync("bash", ["deploy.sh"], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /assets-unreproduced/);
  assert.equal(result.stdout.includes("Uploaded"), false);
  const extra = spawnSync("bash", ["deploy.sh", "--upload"], { cwd: root, encoding: "utf8" });
  assert.equal(extra.status, 2);
});
