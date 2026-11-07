const policy = new URL("../harness/adapters/policy-entry.ts", import.meta.url).href;
const workers = new URL("./cloudflare-workers-stub.mjs", import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("cloudflare:")) {
    return { url: workers, shortCircuit: true };
  }
  if (specifier === "@secondary/policy") {
    return { url: policy, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

/**
 * The recovered MCP validator mixes export with require(). Node rejects that.
 * This hook feeds Node a load-time copy that imports the same ajv runtime
 * modules. The file on disk is not modified.
 */
export async function load(url, context, nextLoad) {
  if (!url.includes("view-plan-validator.js")) return nextLoad(url, context);
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const source = `import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
${readFileSync(fileURLToPath(url), "utf8")}`;
  return { format: "module", shortCircuit: true, source };
}
