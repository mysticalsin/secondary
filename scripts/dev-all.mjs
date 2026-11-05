#!/usr/bin/env node
// Local multi-worker dev: builds the web app, then runs audit, api and mcp as three `wrangler dev`
// processes. Service bindings (API -> AUDIT, MCP -> API and AUDIT) resolve through wrangler's local dev
// registry by worker name, so the wiring is the same as in a deploy. Nothing here touches Cloudflare.
//
//   api   http://localhost:8787   web app + /v1/*   (sign-in: DEV_AUTH_BYPASS_EMAIL, persona header)
//   mcp   http://localhost:8788   /mcp, /authorize, /token, /register
//   audit (service binding only)  port 8789 is bound locally for the dev registry, never used directly
//   pages http://localhost:8790   the public landing page worker; it reads the same local bucket the api writes
//                                 (both persist to .dev/state), so a published page can be opened here
//
// The connector and ops workers are not part of this stack (they need Graph and a backup bucket); the api's
// CONNECTOR binding then resolves to nothing and source results stay hidden, which is the fail-closed default.
//
// Local-only secrets are generated once into .dev/secrets.json and written to each worker's .dev.vars
// (both git-ignored). Flags: --seed (load the synthetic org after start), --no-build (skip the web build).

import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
// Ports are 8787/8788/8789 unless DEV_API_PORT, DEV_MCP_PORT, DEV_AUDIT_PORT and DEV_INSPECTOR_BASE say
// otherwise. With DEV_REGISTRY_PATH the workers register in their own dev registry, so a second stack on
// the same machine never takes over another stack's service bindings (the worker names are the same).
const API_PORT = Number(process.env.DEV_API_PORT ?? 8787);
const MCP_PORT = Number(process.env.DEV_MCP_PORT ?? 8788);
const AUDIT_PORT = Number(process.env.DEV_AUDIT_PORT ?? 8789);
const PAGES_PORT = Number(process.env.DEV_PAGES_PORT ?? 8790);
const INSPECTOR = Number(process.env.DEV_INSPECTOR_BASE ?? 9229);
// The api writes published pages into a bucket and the pages worker serves them from it: locally both
// must open the same one.
const STATE = join(root, ".dev", "state");

// ---- secrets (local only) ----
mkdirSync(join(root, ".dev"), { recursive: true });
const secretsPath = join(root, ".dev", "secrets.json");
const names = [
  "SEED_TOKEN",
  "INTERNAL_HMAC_KEY",
  "OPS_HMAC_KEY",
  "AUDIT_KEY_API",
  "AUDIT_KEY_MCP",
  "AUDIT_KEY_READ",
  "AUDIT_KEY_ERASE",
  "PSEUDONYM_KEY",
  "BRIEF_PROOF_KEY",
];
const secrets = existsSync(secretsPath) ? JSON.parse(readFileSync(secretsPath, "utf8")) : {};
for (const n of names) secrets[n] ??= randomBytes(24).toString("hex");
writeFileSync(secretsPath, `${JSON.stringify(secrets, null, 2)}\n`, { mode: 0o600 });

const vars = (o) =>
  `${Object.entries(o)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n")}\n`;
writeFileSync(
  join(root, "workers/api/.dev.vars"),
  vars({
    SEED_TOKEN: secrets.SEED_TOKEN,
    INTERNAL_HMAC_KEY: secrets.INTERNAL_HMAC_KEY,
    OPS_HMAC_KEY: secrets.OPS_HMAC_KEY,
    AUDIT_KEY_API: secrets.AUDIT_KEY_API,
    AUDIT_KEY_READ: secrets.AUDIT_KEY_READ,
    AUDIT_KEY_ERASE: secrets.AUDIT_KEY_ERASE,
    PSEUDONYM_KEY: secrets.PSEUDONYM_KEY,
    BRIEF_PROOF_KEY: secrets.BRIEF_PROOF_KEY,
    DEV_AUTH_BYPASS_EMAIL: "dev@example.invalid",
    DO_JURISDICTION: "off",
    // wrangler.jsonc carries the deployed dev Access team and AUD tag. Locally there is no Access:
    // empty values keep the loopback sign-in headers and the persona picker working.
    ACCESS_TEAM_DOMAIN: "",
    ACCESS_AUD: "",
    // Every demo persona signs in under the same address, so they share one request counter. The
    // deployed 600 a minute is for one person; a test run of all personas needs more room.
    RATE_LIMIT_PER_MIN: "6000",
  }),
);
writeFileSync(
  join(root, "workers/mcp/.dev.vars"),
  vars({
    INTERNAL_HMAC_KEY: secrets.INTERNAL_HMAC_KEY,
    AUDIT_KEY_MCP: secrets.AUDIT_KEY_MCP,
    ACCESS_TEAM_DOMAIN: "",
    ACCESS_AUD: "",
  }),
);
writeFileSync(
  join(root, "workers/audit/.dev.vars"),
  vars({
    AUDIT_KEY_API: secrets.AUDIT_KEY_API,
    AUDIT_KEY_MCP: secrets.AUDIT_KEY_MCP,
    AUDIT_KEY_READ: secrets.AUDIT_KEY_READ,
    AUDIT_KEY_ERASE: secrets.AUDIT_KEY_ERASE,
  }),
);

writeFileSync(
  join(root, "workers/pages/.dev.vars"),
  vars({
    // Local workerd cannot create an EU-jurisdiction counter; the worker accepts "off" only with LOCAL_DEV.
    DO_JURISDICTION: "off",
    LOCAL_DEV: "yes",
  }),
);

// ---- web build ----
if (!args.has("--no-build")) {
  console.log("[dev:all] building apps/web");
  const r = spawnSync("corepack", ["pnpm", "--filter", "@secondary/web", "build"], {
    cwd: root,
    stdio: "inherit",
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
{
  // The api's ViewPlan validator is a generated, git-ignored file. (The mcp validator is committed.)
  const g = spawnSync("node", ["scripts/gen-validator.mjs"], { cwd: join(root, "workers/api") });
  if (g.status !== 0) process.exit(g.status ?? 1);
}

// ---- workers ----
const children = [];
const workers = [
  { name: "audit", dir: "workers/audit", port: AUDIT_PORT, inspector: INSPECTOR + 2 },
  { name: "api", dir: "workers/api", port: API_PORT, inspector: INSPECTOR },
  { name: "mcp", dir: "workers/mcp", port: MCP_PORT, inspector: INSPECTOR + 1 },
  { name: "pages", dir: "workers/pages", port: PAGES_PORT, inspector: INSPECTOR + 3, shared: true },
];

function start(w) {
  const bin = join(root, w.dir, "node_modules/.bin/wrangler");
  const child = spawn(
    bin,
    [
      "dev",
      "--port",
      String(w.port),
      "--inspector-port",
      String(w.inspector),
      "--show-interactive-dev-session=false",
      ...(w.shared || w.name === "api" ? ["--persist-to", STATE] : []),
    ],
    {
      cwd: join(root, w.dir),
      env: {
        ...process.env,
        NO_COLOR: "1",
        WRANGLER_SEND_METRICS: "false",
        ...(process.env.DEV_REGISTRY_PATH
          ? { WRANGLER_REGISTRY_PATH: process.env.DEV_REGISTRY_PATH }
          : {}),
      },
    },
  );
  children.push(child);
  const tag = `[${w.name}]`;
  const pipe = (s) => (d) =>
    String(d)
      .split("\n")
      .filter(Boolean)
      .forEach((l) => {
        s.write(`${tag} ${l}\n`);
      });
  child.stdout.on("data", pipe(process.stdout));
  child.stderr.on("data", pipe(process.stderr));
  child.on("exit", (code) => {
    console.log(`${tag} exited (${code})`);
    shutdown(code ?? 1);
  });
}

let closing = false;
function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  for (const c of children) c.kill("SIGTERM");
  setTimeout(() => process.exit(code), 500);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

async function waitFor(url, label, ms = 90_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${label} did not answer at ${url}`);
}

(async () => {
  start(workers[0]); // audit first, so the registry knows it when api and mcp bind to it
  await new Promise((r) => setTimeout(r, 3000));
  start(workers[1]);
  start(workers[3]);
  await waitFor(`http://localhost:${API_PORT}/v1/health`, "api");
  start(workers[2]);
  await waitFor(`http://localhost:${MCP_PORT}/health`, "mcp");

  if (args.has("--seed")) {
    const res = await fetch(`http://localhost:${API_PORT}/v1/admin/seed`, {
      method: "POST",
      headers: { "X-Seed-Token": secrets.SEED_TOKEN, "Content-Type": "application/json" },
      body: "{}",
    });
    console.log(`[dev:all] seed: ${res.status} ${await res.text()}`);
  }
  console.log("\n[dev:all] ready");
  console.log(
    `  web + api  http://localhost:${API_PORT}   (persona switch in the header, dev only)`,
  );
  console.log(`  mcp        http://localhost:${MCP_PORT}/mcp`);
  console.log(`  pages      http://localhost:${PAGES_PORT}/p/<slug>   (published landing pages)`);
  console.log(
    '  seed       curl -X POST localhost:8787/v1/admin/seed -H "X-Seed-Token: $(jq -r .SEED_TOKEN .dev/secrets.json)"',
  );
  console.log("  stop       Ctrl-C\n");
})().catch((e) => {
  console.error(`[dev:all] ${e.message}`);
  shutdown(1);
});
