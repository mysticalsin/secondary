const stub = new URL("./cf-workers-stub.ts", import.meta.url).href;
const policy = new URL("../adapters/policy-entry.ts", import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "cloudflare:workers") return { url: stub, shortCircuit: true };
  if (specifier === "@secondary/policy") return { url: policy, shortCircuit: true };
  return nextResolve(specifier, context);
}
