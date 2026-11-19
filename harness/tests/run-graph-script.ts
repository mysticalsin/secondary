import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInContext, type Context } from "node:vm";

/** Load the shared fetch bound, then a graph script, in a classic vm context. */
export function runGraphScript(repo: string, file: string, context: Context): void {
  const shared = readFileSync(join(repo, "deploy/graph/fetch-bound.js.txt"), "utf8").replace(
    "export async function boundFetch",
    "globalThis.boundFetch = async function boundFetch",
  );
  runInContext(shared, context);
  const source = readFileSync(join(repo, file), "utf8").replace(
    /import\s*\{[^}]+\}\s*from\s*["'][^"']+["'];\n/,
    "",
  );
  runInContext(source, context);
}
