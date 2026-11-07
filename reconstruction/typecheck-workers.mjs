/**
 * Typecheck each recovered Worker through its reconstruction overlay.
 * The API project includes the derived worker, the release edge, and the harness.
 * typecheck:worker remains the original recovered tree without those modules.
 */
import { spawnSync } from "node:child_process";

const projects = [
  ["api", "reconstruction/tsconfig.json"],
  ["audit", "reconstruction/audit/tsconfig.json"],
  ["connector", "reconstruction/connector/tsconfig.json"],
  ["mcp", "reconstruction/mcp/tsconfig.json"],
  ["ops", "reconstruction/ops/tsconfig.json"],
  ["pages", "reconstruction/pages/tsconfig.json"],
];
const results = [];
for (const [name, project] of projects) {
  const out = spawnSync("npx", ["tsc", "--noEmit", "--pretty", "false", "-p", project], {
    encoding: "utf8",
  });
  const text = `${out.stdout ?? ""}${out.stderr ?? ""}`;
  const errors = text.split("\n").filter((line) => line.includes("error TS")).length;
  results.push({ name, status: out.status ?? 1, errors });
  if (text.trim()) process.stderr.write(`\n# ${name}\n${text}`);
}
for (const row of results) {
  console.log(`${row.name}\t${row.status === 0 ? "pass" : "fail"}\t${row.errors}`);
}
process.exit(results.every((row) => row.status === 0) ? 0 : 1);
