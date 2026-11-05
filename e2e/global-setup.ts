import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

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
}
