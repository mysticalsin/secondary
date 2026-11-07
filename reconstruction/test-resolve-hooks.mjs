const policy = new URL("../harness/adapters/policy-entry.ts", import.meta.url).href;
const workers = new URL("./cloudflare-workers-stub.mjs", import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "cloudflare:workers") {
    return { url: workers, shortCircuit: true };
  }
  if (specifier === "@secondary/policy") {
    return { url: policy, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
