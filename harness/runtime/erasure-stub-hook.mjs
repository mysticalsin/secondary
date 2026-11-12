const stub = new URL("./fake-erasure-stub.ts", import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  const parent = context.parentURL ?? "";
  const rights =
    parent.endsWith("/ops-admin.ts") ||
    parent.endsWith("/ops-rights.ts") ||
    parent.endsWith("/human.ts");
  if (rights && specifier.endsWith("/stubs.ts")) return { url: stub, shortCircuit: true };
  return nextResolve(specifier, context);
}
