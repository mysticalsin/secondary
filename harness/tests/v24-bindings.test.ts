import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
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

function sha256(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

function assetFixture(fill: (assets: string) => void): string {
  const dir = mkdtempSync(join(tmpdir(), "v24-assets-"));
  writeFileSync(join(dir, "wrangler.jsonc"), readFileSync(join(root, "wrangler.jsonc")));
  writeFileSync(join(dir, "deploy.sh"), readFileSync(join(root, "deploy.sh")));
  mkdirSync(join(dir, "deploy"));
  writeFileSync(join(dir, "deploy", "guard.ts"), readFileSync(join(root, "deploy", "guard.ts")));
  const bin = join(dir, "node_modules", ".bin");
  mkdirSync(bin, { recursive: true });
  const stub = join(bin, "wrangler");
  writeFileSync(stub, "#!/bin/sh\necho wrangler-invoked >&2\nexit 99\n");
  chmodSync(stub, 0o755);
  const assets = join(dir, "deploy", "assets");
  mkdirSync(assets);
  fill(assets);
  return dir;
}

function refuseDeploy(dir: string, reason: string): void {
  const result = spawnSync("bash", ["deploy.sh"], { cwd: dir, encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, new RegExp(reason));
  assert.equal(result.stderr.includes("wrangler-invoked"), false);
  assert.equal(result.stdout.includes("Uploaded"), false);
}

test("asset drop-in: deploy.sh refuses a marker or a manifest mismatch and the guard accepts a match", async () => {
  const guard = (await import("../../deploy/guard.ts")) as {
    guardRoot: (root: string, mode: "dry-run" | "deploy") => { ok: true } | { ok: false; reason: string };
  };
  const index = "alpha";
  const app = "beta";
  const indexLine = `${sha256(index)}  index.html`;
  const appLine = `${sha256(app)}  nested/app.js`;

  const marked = assetFixture((assets) => {
    writeFileSync(join(assets, "UNREPRODUCED"), "marker\n");
    writeFileSync(join(assets, "index.html"), index);
    writeFileSync(join(assets, "MANIFEST.sha256"), `${indexLine}\n`);
  });
  refuseDeploy(marked, "assets-unreproduced");

  const mismatched = assetFixture((assets) => {
    writeFileSync(join(assets, "index.html"), index);
    mkdirSync(join(assets, "nested"));
    writeFileSync(join(assets, "nested", "app.js"), "changed");
    writeFileSync(join(assets, "MANIFEST.sha256"), `${indexLine}\n${appLine}\n`);
  });
  refuseDeploy(mismatched, "assets-manifest-mismatch");

  const missing = assetFixture((assets) => {
    writeFileSync(join(assets, "index.html"), index);
    writeFileSync(join(assets, "MANIFEST.sha256"), `${indexLine}\n${appLine}\n`);
  });
  refuseDeploy(missing, "assets-manifest-mismatch");

  const extra = assetFixture((assets) => {
    writeFileSync(join(assets, "index.html"), index);
    writeFileSync(join(assets, "extra.txt"), "extra");
    writeFileSync(join(assets, "MANIFEST.sha256"), `${indexLine}\n`);
  });
  refuseDeploy(extra, "assets-manifest-mismatch");

  const noManifest = assetFixture((assets) => {
    writeFileSync(join(assets, "index.html"), index);
  });
  refuseDeploy(noManifest, "assets-manifest-missing");

  const matched = assetFixture((assets) => {
    writeFileSync(join(assets, "index.html"), index);
    mkdirSync(join(assets, "nested"));
    writeFileSync(join(assets, "nested", "app.js"), app);
    writeFileSync(join(assets, "MANIFEST.sha256"), `${indexLine}\n${appLine}\n`);
  });
  const passed = spawnSync(
    "node",
    ["--experimental-strip-types", "deploy/guard.ts", "deploy"],
    { cwd: matched, encoding: "utf8" },
  );
  assert.equal(passed.status, 0);
  assert.equal(passed.stderr.includes("wrangler-invoked"), false);
  assert.deepEqual(guard.guardRoot(matched, "deploy"), { ok: true });
  assert.deepEqual(readdirSync(join(root, "deploy", "assets")), ["UNREPRODUCED"]);
});

function writeAssetDirectory(dir: string, directory: string): void {
  const text = readFileSync(join(dir, "wrangler.jsonc"), "utf8");
  const next = text.replace(/"directory":\s*"[^"]+"/, `"directory": "${directory}"`);
  assert.match(next, new RegExp(`"directory": "${directory.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  writeFileSync(join(dir, "wrangler.jsonc"), next);
}

test("npm run deploy is the guard, and a direct wrangler deploy has no staging directory", () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  assert.equal(pkg.scripts.deploy, "./deploy.sh");
  const config = readConfig();
  const assets = config.assets as { directory: string };
  assert.equal(assets.directory.replace(/^\.\//, ""), "deploy/.staged");
  assert.equal(existsSync(join(root, "deploy/.staged")), false);
  const ignore = readFileSync(join(root, ".gitignore"), "utf8");
  assert.match(ignore, /(^|\n)deploy\/\.staged\/?(?:\n|$)/);
  const result = spawnSync("npm", ["run", "deploy"], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /assets-unreproduced/);
  assert.equal(result.stderr.includes("wrangler-invoked"), false);
  assert.equal(result.stdout.includes("Uploaded"), false);
});

test("a case-variant unreproduced sentinel is refused", () => {
  const body = "sentinel";
  const index = "alpha";
  const dir = assetFixture((assets) => {
    writeFileSync(join(assets, "unreproduced"), body);
    writeFileSync(join(assets, "index.html"), index);
    writeFileSync(
      join(assets, "MANIFEST.sha256"),
      `${sha256(index)}  index.html\n${sha256(body)}  unreproduced\n`,
    );
  });
  refuseDeploy(dir, "assets-unreproduced");
});

test("an assets.directory that is the source tree is refused", async () => {
  const guard = (await import("../../deploy/guard.ts")) as {
    guardRoot: (root: string, mode: "dry-run" | "deploy") => { ok: true } | { ok: false; reason: string };
  };
  const index = "alpha";
  const dir = assetFixture((assets) => {
    writeFileSync(join(assets, "index.html"), index);
    writeFileSync(join(assets, "MANIFEST.sha256"), `${sha256(index)}  index.html\n`);
  });
  writeAssetDirectory(dir, "./deploy/assets");
  assert.deepEqual(guard.guardRoot(dir, "deploy"), { ok: false, reason: "assets-directory-mismatch" });
  const escaped = assetFixture((assets) => {
    writeFileSync(join(assets, "index.html"), index);
    writeFileSync(join(assets, "MANIFEST.sha256"), `${sha256(index)}  index.html\n`);
  });
  writeAssetDirectory(escaped, "../outside");
  assert.deepEqual(guard.guardRoot(escaped, "deploy"), { ok: false, reason: "assets-directory-mismatch" });
});

test("bytes changed after verify are not the bytes wrangler would upload", () => {
  const index = "alpha";
  const dir = assetFixture((assets) => {
    writeFileSync(join(assets, "index.html"), index);
    writeFileSync(join(assets, "MANIFEST.sha256"), `${sha256(index)}  index.html\n`);
  });
  writeAssetDirectory(dir, "./deploy/from-config");
  const passed = spawnSync(
    "node",
    ["--experimental-strip-types", "deploy/guard.ts", "deploy"],
    { cwd: dir, encoding: "utf8" },
  );
  assert.equal(passed.status, 0);
  const stagedPath = join(dir, "deploy/from-config/index.html");
  assert.equal(readFileSync(stagedPath, "utf8"), index);
  writeFileSync(join(dir, "deploy/assets/index.html"), "mutated");
  assert.equal(readFileSync(stagedPath, "utf8"), index);
  const again = spawnSync("bash", ["deploy.sh"], { cwd: dir, encoding: "utf8" });
  assert.equal(again.status, 2);
  assert.match(again.stderr, /assets-manifest-mismatch/);
  assert.equal(again.stderr.includes("wrangler-invoked"), false);
  const uploaded = existsSync(stagedPath) ? readFileSync(stagedPath, "utf8") : index;
  assert.equal(uploaded, index);
});
