/**
 * NEW RECONSTRUCTION. Local Wrangler dry-run and esbuild only.
 * Nothing is uploaded. compatibility_date is the reconstruction date.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const dist = resolve(root, "reconstruction/dist");

const alias = {
  "../../../packages/contracts/src/agent-host.ts": resolve(root, "reconstruction/packages/contracts/src/agent-host.ts"),
  "../../../packages/contracts/src/log.ts": resolve(root, "reconstruction/packages/contracts/src/log.ts"),
  "../../../packages/contracts/src/ops-auth.ts": resolve(root, "reconstruction/packages/contracts/src/ops-auth.ts"),
  "../../../packages/contracts/src/signed-call.ts": resolve(root, "reconstruction/packages/contracts/src/signed-call.ts"),
  "../../../../packages/contracts/src/view-plan.ts": resolve(root, "reconstruction/packages/contracts/src/view-plan.ts"),
};

function wranglerDryRun(name, config) {
  const dir = resolve(tmpdir(), "secondary-workerd-config");
  mkdirSync(dir, { recursive: true });
  const configPath = resolve(dir, `${name}.wrangler.jsonc`);
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  const outdir = resolve(dist, name);
  mkdirSync(outdir, { recursive: true });
  const run = spawnSync(
    "npx",
    ["wrangler", "deploy", "--dry-run", "--outdir", outdir, "--config", configPath],
    {
      cwd: root,
      env: {
        ...process.env,
        WRANGLER_SEND_METRICS: "false",
        CI: "true",
      },
      encoding: "utf8",
    },
  );
  const output = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
  if (run.status !== 0 || !/dry-run: exiting now/.test(output)) {
    throw new Error(`${name} wrangler dry-run failed\n${output}`);
  }
  const files = readdirSync(outdir).filter((file) => file.endsWith(".js"));
  if (files.length !== 1) throw new Error(`${name} emitted ${files.join(",") || "nothing"}`);
  return resolve(outdir, files[0]);
}

function esbuild(args) {
  const run = spawnSync("npx", ["esbuild", ...args], { cwd: root, encoding: "utf8" });
  if (run.status !== 0) throw new Error(run.stderr || run.stdout || "esbuild failed");
}

export function bundleWorkerd() {
  mkdirSync(dist, { recursive: true });
  esbuild([
    "reconstruction/workerd/api-harness.ts",
    "--bundle",
    "--format=esm",
    "--platform=neutral",
    "--target=es2022",
    "--outfile=reconstruction/dist/api-harness.js",
    "--preserve-symlinks",
    "--alias:@secondary/policy=./harness/adapters/policy-entry.ts",
    "--external:cloudflare:workers",
    "--banner:js=/* NEW local reconstruction harness. Not a deployment artifact. */",
  ]);
  esbuild([
    "reconstruction/workerd/connector-refresh-harness.ts",
    "--bundle",
    "--format=esm",
    "--platform=neutral",
    "--target=es2022",
    "--outfile=reconstruction/dist/connector-refresh.js",
    "--preserve-symlinks",
    "--external:cloudflare:workers",
    "--banner:js=/* NEW local reconstruction harness. Not a deployment artifact. */",
  ]);
  const base = {
    compatibility_date: "2026-11-07",
    workers_dev: false,
    preview_urls: false,
    alias,
  };
  const mcp = wranglerDryRun("mcp-workerd", {
    ...base,
    name: "secondary-mcp-reconstruction-local-only",
    main: resolve(root, "reconstruction/mcp/worker/src/index.ts"),
  });
  const view = wranglerDryRun("view-plan-workerd", {
    ...base,
    name: "secondary-view-plan-reconstruction-local-only",
    main: resolve(root, "reconstruction/workerd/view-plan-entry.ts"),
  });
  return { mcp, view, api: resolve(dist, "api-harness.js"), refresh: resolve(dist, "connector-refresh.js") };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const built = bundleWorkerd();
  for (const [name, file] of Object.entries(built)) console.log(`${name}\t${file}`);
}
