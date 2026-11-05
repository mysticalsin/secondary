import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runMcpFlow } from "./mcp-flow.ts";

async function until(label: string, probe: () => Promise<boolean>, ms = 90_000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await probe().catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error(`${label} did not become ready within ${ms / 1000}s`);
}

/** Reseed the synthetic tenant so every run starts from the same state. */
export default async function globalSetup() {
  const secrets = JSON.parse(
    readFileSync(fileURLToPath(new URL("../.dev/secrets.json", import.meta.url)), "utf8"),
  ) as { SEED_TOKEN: string };
  const res = await fetch("http://localhost:8787/v1/admin/seed", {
    method: "POST",
    headers: { "X-Seed-Token": secrets.SEED_TOKEN, "Content-Type": "application/json" },
    body: "{}",
  });
  if (!res.ok) throw new Error(`seed failed: ${res.status} ${await res.text()}`);

  // `wrangler dev` links the workers through a local registry. Right after a cold start the first
  // calls over a service binding can fail (the audit worker "does not answer", and every write fails
  // closed). Deployed bindings do not behave like this. Wait until both bindings that carry audit
  // receipts answer, so a test never races the stack's own start.
  await until("api -> audit binding", async () => {
    const r = await fetch("http://localhost:8787/v1/audit/receipts?principal=u_warm", {
      headers: { "X-Demo-Persona": "auditor" },
    });
    return r.status === 200;
  });
  await until("mcp -> api and audit bindings", async () => {
    await runMcpFlow("http://localhost:8788", "ceo");
    return true;
  });
}
