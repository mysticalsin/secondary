import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(new URL("../runtime/register-worker-hooks.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});

test("persona id: a malformed email is rejected", async () => {
  const specifier = new URL("../../recovered-source/worker/src/org.ts", import.meta.url).href;
  const { personaId } = (await import(specifier)) as {
    personaId: (roleId: "consultant", email: string) => Promise<string | null>;
  };
  assert.equal(await personaId("consultant", "@bad.example"), null);
  assert.equal(await personaId("consultant", "consultant@example.invalid"), "u_consultant");
});
