/**
 * Local bundles only. cloudflare:workers stays external. Nothing is uploaded.
 */
import { spawnSync } from "node:child_process";

const workers = ["audit", "connector", "mcp", "ops", "pages"];
const results = [];
for (const name of workers) {
  // MCP's published agents package imports Node builtins and cloudflare:email.
  // A neutral workerd bundle does not resolve them. The Node bundle is local only.
  const mcp = name === "mcp";
  const out = spawnSync(
    "npx",
    [
      "esbuild",
      `reconstruction/${name}/worker/src/index.ts`,
      "--bundle",
      "--format=esm",
      `--platform=${mcp ? "node" : "neutral"}`,
      "--target=es2022",
      `--outfile=reconstruction/dist/${name}.js`,
      "--preserve-symlinks",
      "--external:cloudflare:*",
      ...(mcp ? ["--conditions=node"] : ["--external:node:*"]),
      "--main-fields=module,main",
      `--banner:js=/* Local reconstruction bundle${mcp ? " (Node platform, not workerd)" : ""}. Not a deployment artifact. */`,
    ],
    { stdio: "inherit" },
  );
  results.push({ name, status: out.status ?? 1 });
}
for (const row of results) console.log(`${row.name}\t${row.status === 0 ? "pass" : "fail"}\t${row.status}`);
process.exit(results.every((row) => row.status === 0) ? 0 : 1);
