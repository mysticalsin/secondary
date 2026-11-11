// Dev-only wiki seed. After the synthetic org is loaded, each workspace gets a realistic synthetic brain:
// raw records (seed-content.ts) are ingested through the ordinary deterministic path and accepted at
// once as origin "seed". It runs only in the dev environment, once per WIKI_SEED_VERSION, and never
// removes anything people wrote.

import { ROLE_ORDER } from "@secondary/policy";
import { seedRunStatus, type WikiSeedResult } from "../../../../src/state/wiki-seed.ts";
import { getOrg } from "../org.ts";
import { tenantStub, workspaceStub } from "../stubs.ts";
import { planWikiSeed, SEED_TYPES, WIKI_SEED_VERSION } from "./seed-content.ts";

export type { WikiSeedResult };

/** Dev only. `WIKI_SEED=off` turns it off (the test configuration does, and so can a local run). */
export const wikiSeedEnabled = (env: Env): boolean =>
  env.ENVIRONMENT === "dev" && String(env.WIKI_SEED ?? "").toLowerCase() !== "off";

const BATCH = 10;

export async function ensureWikiSeed(
  env: Env,
  tenantId: string,
  now: number,
): Promise<WikiSeedResult> {
  if (!wikiSeedEnabled(env)) return seedRunStatus({ enabled: false });
  const tenant = tenantStub(env, tenantId);
  const config = await tenant.getConfig();
  if (!config) return seedRunStatus({ enabled: true, hasConfig: false });
  if (!(await tenant.seedClaim(WIKI_SEED_VERSION, now))) {
    return seedRunStatus({
      enabled: true,
      hasConfig: true,
      claimed: false,
      completed: await tenant.seedVersion(),
      version: WIKI_SEED_VERSION,
    });
  }
  try {
    const org = getOrg(config);
    const owners = new Set(config.personalOwners);
    const personal = ROLE_ORDER.map((role) => ({ role, principalId: `u_${role}` })).filter((p) =>
      owners.has(p.principalId),
    );
    const plan = planWikiSeed(org, personal, now);
    let records = 0;
    let pages = 0;
    for (let i = 0; i < plan.length; i += BATCH) {
      const done = await Promise.all(
        plan
          .slice(i, i + BATCH)
          .map((w) =>
            workspaceStub(env, tenantId, w.scope).wikiSeedRun(
              tenantId,
              w.scope,
              w.plane,
              SEED_TYPES,
              w.docs,
              now,
            ),
          ),
      );
      done.forEach((r, k) => {
        if ("refused" in r) throw new Error("wiki seed refused outside dev");
        records += (plan[i + k] as { docs: unknown[] }).docs.length;
        pages += r.pages;
      });
    }
    await tenant.seedDone(WIKI_SEED_VERSION);
    return seedRunStatus({
      enabled: true,
      hasConfig: true,
      claimed: true,
      failed: false,
      version: WIKI_SEED_VERSION,
      workspaces: plan.length,
      records,
      pages,
    });
  } catch (e) {
    // The claim expires by itself and the next request tries again.
    console.warn(JSON.stringify({ at: "wiki_seed", error: String(e).slice(0, 200) }));
    return seedRunStatus({
      enabled: true,
      hasConfig: true,
      claimed: true,
      failed: true,
      version: WIKI_SEED_VERSION,
    });
  }
}
