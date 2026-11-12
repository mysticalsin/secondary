const stub = new URL("./fake-workspace-stub.ts", import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  const parent = context.parentURL ?? "";
  if (parent.endsWith("/ai/budget.ts") && specifier.endsWith("/stubs.ts")) {
    return { url: stub, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
