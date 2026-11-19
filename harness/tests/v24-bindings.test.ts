import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
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
  assert.equal(assets.directory.replace(/^\.\//, ""), "deploy/.staged");
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
  const outside = mkdtempSync(join(tmpdir(), "v24-outside-"));
  const passed = spawnSync(
    "node",
    ["--experimental-strip-types", "deploy/guard.ts", "deploy", outside],
    { cwd: dir, encoding: "utf8" },
  );
  assert.equal(passed.status, 0);
  assert.equal(existsSync(join(dir, "deploy/from-config")), false);
  assert.equal(readFileSync(join(outside, "index.html"), "utf8"), index);
  writeFileSync(join(dir, "deploy/assets/index.html"), "mutated");
  assert.equal(readFileSync(join(outside, "index.html"), "utf8"), index);
  const again = spawnSync("bash", ["deploy.sh"], { cwd: dir, encoding: "utf8" });
  assert.equal(again.status, 2);
  assert.match(again.stderr, /assets-manifest-mismatch/);
  assert.equal(again.stderr.includes("wrangler-invoked"), false);
});

test("a pre-existing or stale configured asset directory is refused", () => {
  const index = "alpha";
  const fill = (assets: string) => {
    writeFileSync(join(assets, "index.html"), index);
    writeFileSync(join(assets, "MANIFEST.sha256"), `${sha256(index)}  index.html\n`);
  };
  const stale = assetFixture(fill);
  mkdirSync(join(stale, "deploy/.staged"));
  writeFileSync(join(stale, "deploy/.staged/old.txt"), "old");
  refuseDeploy(stale, "assets-directory-present");
  assert.equal(readFileSync(join(stale, "deploy/.staged/old.txt"), "utf8"), "old");

  const empty = assetFixture(fill);
  mkdirSync(join(empty, "deploy/.staged"));
  refuseDeploy(empty, "assets-directory-present");
  assert.equal(existsSync(join(empty, "deploy/.staged")), true);
});

test("staging is outside the configured path and is removed when wrangler exits non-zero", () => {
  const index = "alpha";
  const dir = assetFixture((assets) => {
    writeFileSync(join(assets, "index.html"), index);
    writeFileSync(join(assets, "MANIFEST.sha256"), `${sha256(index)}  index.html\n`);
  });
  const record = join(dir, "wrangler-args");
  const stub = join(dir, "node_modules", ".bin", "wrangler");
  writeFileSync(
    stub,
    `#!/bin/sh
printf '%s\\n' "$@" > '${record}'
assets=""
prev=""
for arg in "$@"; do
  if [ "$prev" = "--assets" ]; then
    assets="$arg"
  fi
  prev="$arg"
done
if [ -n "$assets" ] && [ -f "$assets/index.html" ]; then
  echo saw-index >> '${record}'
  stat -c %a "$assets" >> '${record}'
fi
exit 7
`,
  );
  chmodSync(stub, 0o755);
  const tmpParent = join(dir, "tmp-parent");
  mkdirSync(tmpParent);
  const result = spawnSync("bash", ["deploy.sh"], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, TMPDIR: tmpParent },
  });
  assert.equal(result.status, 7);
  const lines = readFileSync(record, "utf8").split("\n").filter((line) => line.length > 0);
  const at = lines.indexOf("--assets");
  assert.notEqual(at, -1);
  const staged = lines[at + 1];
  assert.equal(staged.startsWith(`${tmpParent}/`), true);
  assert.equal(staged.includes("/deploy/"), false);
  assert.equal(lines.includes("saw-index"), true);
  assert.equal(lines.includes("700"), true);
  assert.equal(existsSync(join(dir, "deploy/.staged")), false);
  assert.equal(existsSync(staged), false);
  assert.deepEqual(readdirSync(tmpParent), []);
});

test("DEPLOY_AFTER_COPY on deploy.sh does not change the staged bytes", () => {
  const index = "alpha";
  const dir = assetFixture((assets) => {
    writeFileSync(join(assets, "index.html"), index);
    writeFileSync(join(assets, "MANIFEST.sha256"), `${sha256(index)}  index.html\n`);
  });
  const record = join(dir, "staged-bytes");
  const stub = join(dir, "node_modules", ".bin", "wrangler");
  writeFileSync(
    stub,
    `#!/bin/sh
assets=""
prev=""
for arg in "$@"; do
  if [ "$prev" = "--assets" ]; then
    assets="$arg"
  fi
  prev="$arg"
done
if [ -n "$assets" ]; then
  cat "$assets/index.html" > '${record}'
fi
echo wrangler-invoked >&2
exit 7
`,
  );
  chmodSync(stub, 0o755);
  const result = spawnSync("bash", ["deploy.sh"], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, DEPLOY_AFTER_COPY: "mutated" },
  });
  assert.equal(result.status, 7);
  assert.equal(result.stderr.includes("wrangler-invoked"), true);
  assert.equal(readFileSync(record, "utf8"), index);
});

test("afterCopy that replaces a staged file is refused and does not start wrangler", async () => {
  const guard = (await import("../../deploy/guard.ts")) as {
    copyThenRehash?: (
      destRoot: string,
      assets: string,
      files: Map<string, string>,
      afterCopy?: (dest: string) => void,
    ) => { ok: true } | { ok: false; reason: string };
  };
  assert.equal(typeof guard.copyThenRehash, "function");
  const index = "alpha";
  const dir = mkdtempSync(join(tmpdir(), "v24-rehash-"));
  const assets = join(dir, "assets");
  const destRoot = join(dir, "staged");
  mkdirSync(assets);
  writeFileSync(join(assets, "index.html"), index);
  const result = guard.copyThenRehash!(
    destRoot,
    assets,
    new Map([["index.html", sha256(index)]]),
    (copied) => {
      writeFileSync(copied, "mutated");
    },
  );
  assert.deepEqual(result, { ok: false, reason: "assets-manifest-mismatch" });
  assert.equal(readFileSync(join(destRoot, "index.html"), "utf8"), "mutated");
});

test("DEPLOY_AFTER_COPY is absent and does not change staged bytes", async () => {
  const guardText = readFileSync(join(root, "deploy/guard.ts"), "utf8");
  const scriptText = readFileSync(join(root, "deploy.sh"), "utf8");
  assert.equal(guardText.includes("DEPLOY_AFTER_COPY"), false);
  assert.equal(scriptText.includes("DEPLOY_AFTER_COPY"), false);
  assert.equal(guardText.includes("process.env"), false);
  const guard = (await import("../../deploy/guard.ts")) as {
    copyThenRehash?: (
      destRoot: string,
      assets: string,
      files: Map<string, string>,
    ) => { ok: true } | { ok: false; reason: string };
  };
  assert.equal(typeof guard.copyThenRehash, "function");
  const index = "alpha";
  const dir = mkdtempSync(join(tmpdir(), "v24-env-"));
  const assets = join(dir, "assets");
  const destRoot = join(dir, "staged");
  mkdirSync(assets);
  writeFileSync(join(assets, "index.html"), index);
  const previous = process.env.DEPLOY_AFTER_COPY;
  process.env.DEPLOY_AFTER_COPY = "mutated";
  try {
    const result = guard.copyThenRehash!(destRoot, assets, new Map([["index.html", sha256(index)]]));
    assert.deepEqual(result, { ok: true });
    assert.equal(readFileSync(join(destRoot, "index.html"), "utf8"), index);
  } finally {
    if (previous === undefined) delete process.env.DEPLOY_AFTER_COPY;
    else process.env.DEPLOY_AFTER_COPY = previous;
  }
});

function matchingAssets(): string {
  const index = "alpha";
  return assetFixture((assets) => {
    writeFileSync(join(assets, "index.html"), index);
    writeFileSync(join(assets, "MANIFEST.sha256"), `${sha256(index)}  index.html\n`);
  });
}

test("deploy.sh pins wrangler.jsonc and the installed wrangler is 4.158.0", () => {
  const text = readFileSync(join(root, "deploy.sh"), "utf8");
  assert.match(text, /dirname -- "\$0"/);
  assert.equal(text.match(/--config wrangler\.jsonc/g)?.length, 2);
  const pkg = JSON.parse(readFileSync(join(root, "node_modules/wrangler/package.json"), "utf8")) as { version: string };
  assert.equal(pkg.version, "4.158.0");
});

test("a wrangler.json beside wrangler.jsonc is refused", () => {
  const dir = matchingAssets();
  writeFileSync(join(dir, "wrangler.json"), "{}\n");
  refuseDeploy(dir, "config-shadow");
});

test("a wrangler.toml beside wrangler.jsonc is refused", () => {
  const dir = matchingAssets();
  writeFileSync(join(dir, "wrangler.toml"), 'name = "shadow"\n');
  refuseDeploy(dir, "config-shadow");
});

test("a wrangler deploy config redirect is refused", () => {
  const dir = matchingAssets();
  mkdirSync(join(dir, ".wrangler", "deploy"), { recursive: true });
  writeFileSync(join(dir, ".wrangler", "deploy", "config.json"), '{"configPath":"../wrangler.jsonc"}\n');
  refuseDeploy(dir, "config-shadow");
});

test("a dangling symlink at the configured asset directory is refused", () => {
  const dir = matchingAssets();
  symlinkSync(join(dir, "missing-target"), join(dir, "deploy/.staged"));
  refuseDeploy(dir, "assets-directory-present");
});

test("a symlink deploy or deploy/assets directory is refused", () => {
  const assetsLink = matchingAssets();
  const heldAssets = join(assetsLink, "held-assets");
  renameSync(join(assetsLink, "deploy", "assets"), heldAssets);
  symlinkSync(heldAssets, join(assetsLink, "deploy", "assets"));
  refuseDeploy(assetsLink, "assets-symlink");

  const rootLink = matchingAssets();
  const heldDeploy = join(rootLink, "held-deploy");
  renameSync(join(rootLink, "deploy"), heldDeploy);
  symlinkSync(heldDeploy, join(rootLink, "deploy"));
  refuseDeploy(rootLink, "assets-symlink");
});

test("an empty unreproduced directory in any case is refused", () => {
  const index = "alpha";
  const manifest = `${sha256(index)}  index.html\n`;
  for (const name of ["unreproduced", "UNREPRODUCED", "keep/Unreproduced"]) {
    const dir = assetFixture((assets) => {
      writeFileSync(join(assets, "index.html"), index);
      writeFileSync(join(assets, "MANIFEST.sha256"), manifest);
      mkdirSync(join(assets, name), { recursive: true });
    });
    refuseDeploy(dir, "assets-unreproduced");
  }
});

test("a symlinked wrangler.jsonc is refused", () => {
  const dir = matchingAssets();
  const held = join(dir, "held-wrangler.jsonc");
  renameSync(join(dir, "wrangler.jsonc"), held);
  symlinkSync(held, join(dir, "wrangler.jsonc"));
  refuseDeploy(dir, "config-symlink");
});

test("a stat error on wrangler.jsonc is refused", async () => {
  const dir = matchingAssets();
  unlinkSync(join(dir, "wrangler.jsonc"));
  mkdirSync(join(dir, "wrangler.jsonc"));
  refuseDeploy(dir, "config-unreadable");

  const guard = (await import("../../deploy/guard.ts")) as {
    guardRoot: (root: string, mode: "dry-run" | "deploy") => { ok: true } | { ok: false; reason: string };
  };
  const base = mkdtempSync(join(tmpdir(), "v24-eloop-"));
  symlinkSync("link", join(base, "link"));
  const root = join(base, ...Array(50).fill("link"));
  assert.deepEqual(guard.guardRoot(root, "deploy"), { ok: false, reason: "dev-vars-present" });
});

test("a dangling or symlinked .dev.vars is refused", () => {
  const dangling = matchingAssets();
  symlinkSync(join(dangling, "missing-vars"), join(dangling, ".dev.vars"));
  refuseDeploy(dangling, "dev-vars-present");

  const linked = matchingAssets();
  const target = join(linked, "vars-target");
  writeFileSync(target, "NAME=value\n");
  symlinkSync(target, join(linked, ".dev.vars"));
  refuseDeploy(linked, "dev-vars-present");
});

test("bare deploy.sh is a dry run and npm test cannot apply", () => {
  const here = readFileSync(join(root, "harness/tests/v24-bindings.test.ts"), "utf8");
  assert.equal((here.match(/\[\"deploy\.sh\", \"--apply\"\]/g) ?? []).length, 2);
  for (const name of readdirSync(join(root, "harness/tests"))) {
    if (!name.endsWith(".test.ts") || name === "v24-bindings.test.ts") continue;
    const text = readFileSync(join(root, "harness/tests", name), "utf8");
    assert.equal(text.includes("--apply"), false, name);
  }

  const dir = matchingAssets();
  const record = join(dir, "wrangler-args");
  const stub = join(dir, "node_modules", ".bin", "wrangler");
  writeFileSync(stub, `#!/bin/sh\nprintf '%s\\n' "$@" > '${record}'\necho wrangler-invoked >&2\nexit 0\n`);
  chmodSync(stub, 0o755);

  const apply = spawnSync("bash", ["deploy.sh", "--apply"], { cwd: dir, encoding: "utf8" });
  assert.equal(apply.status, 2);
  assert.match(apply.stderr, /apply-under-test/);
  assert.equal(apply.stderr.includes("wrangler-invoked"), false);
  assert.equal(existsSync(record), false);

  const envApply = spawnSync("bash", ["deploy.sh", "--apply"], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, NODE_ENV: "test", NODE_TEST_CONTEXT: "" },
  });
  assert.equal(envApply.status, 2);
  assert.match(envApply.stderr, /apply-under-test/);
  assert.equal(envApply.stderr.includes("wrangler-invoked"), false);

  const bare = spawnSync("bash", ["deploy.sh"], { cwd: dir, encoding: "utf8" });
  assert.equal(bare.status, 0);
  assert.equal(bare.stderr.includes("wrangler-invoked"), true);
  assert.match(readFileSync(record, "utf8"), /(^|\n)--dry-run(\n|$)/);

  const flagged = spawnSync("bash", ["deploy.sh", "--dry-run"], { cwd: dir, encoding: "utf8" });
  assert.equal(flagged.status, 0);
  assert.match(readFileSync(record, "utf8"), /(^|\n)--dry-run(\n|$)/);
});

test("dotenv files and .dev.vars.* are refused like .dev.vars", async () => {
  const guard = (await import("../../deploy/guard.ts")) as {
    guardRoot: (root: string, mode: "dry-run" | "deploy") => { ok: true } | { ok: false; reason: string };
  };
  const cases: Array<{ name: string; reason: string; kind: "file" | "link" | "dangling" | "self" }> = [
    { name: ".env", reason: "env-file-present", kind: "file" },
    { name: ".env", reason: "env-file-present", kind: "link" },
    { name: ".env", reason: "env-file-present", kind: "dangling" },
    { name: ".env", reason: "env-file-present", kind: "self" },
    { name: ".env.local", reason: "env-file-present", kind: "file" },
    { name: ".env.local", reason: "env-file-present", kind: "link" },
    { name: ".env.local", reason: "env-file-present", kind: "dangling" },
    { name: ".env.production", reason: "env-file-present", kind: "file" },
    { name: ".env.production", reason: "env-file-present", kind: "dangling" },
    { name: ".dev.vars.local", reason: "dev-vars-present", kind: "file" },
    { name: ".dev.vars.local", reason: "dev-vars-present", kind: "link" },
    { name: ".dev.vars.local", reason: "dev-vars-present", kind: "dangling" },
    { name: ".dev.vars", reason: "dev-vars-present", kind: "self" },
  ];
  for (const item of cases) {
    const dir = matchingAssets();
    const path = join(dir, item.name);
    if (item.kind === "file") writeFileSync(path, "SECRET=value\n");
    else if (item.kind === "dangling") symlinkSync(join(dir, `${item.name}.missing`), path);
    else if (item.kind === "self") symlinkSync(item.name, path);
    else {
      const target = join(dir, `${item.name}.target`);
      writeFileSync(target, "SECRET=value\n");
      symlinkSync(target, path);
    }
    assert.deepEqual(guard.guardRoot(dir, "dry-run"), { ok: false, reason: item.reason }, `${item.name} ${item.kind}`);
    assert.deepEqual(guard.guardRoot(dir, "deploy"), { ok: false, reason: item.reason }, `${item.name} ${item.kind}`);
    refuseDeploy(dir, item.reason);
  }
  const ignore = readFileSync(join(root, ".gitignore"), "utf8");
  assert.match(ignore, /(^|\n)\.env\*(?:\n|$)/);
});
