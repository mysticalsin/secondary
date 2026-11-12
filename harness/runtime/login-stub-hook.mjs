const stub = new URL("./fake-tenant-stub.ts", import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  const parent = context.parentURL ?? "";
  if (parent.endsWith("/auth/routes.ts") && specifier.endsWith("/stubs.ts")) {
    return { url: stub, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
