// The weekly digest job. Called by the ops worker's Monday cron (POST /v1/internal/ops/digest). For each
// person the directory lists in each tenant it composes the same digest GET /v1/digest/preview would
// show them, as that person (their roles, memberships and NDA grants, and the connector check on every
// source), and stores it as an email draft in their own workspace. It only ever creates drafts: no code
// path here sends anything. One draft per person per week: the id comes from the person and the week,
// so a second run, or a cron that fires twice, finds the draft and leaves it. A week with nothing to
// report makes no draft.

import { Context } from "hono";
import { govClient, tenantOrg } from "../admin/client.ts";
import { appendReceipt, newReceiptId } from "../audit.ts";
import { scimConfigured } from "../auth/config.ts";
import { tenantIds } from "../ops-internal.ts";
import { getOrg, makeCtx } from "../org.ts";
import { personalScope } from "../scope.ts";
import { tenantStub } from "../stubs.ts";
import type { AppEnv, Session } from "../types.ts";
import { sha256Hex } from "../wiki/text.ts";
import { composeDigest, mondayOf, saveDraft } from "./digest.ts";
import { stubOf } from "./shared.ts";

export type DigestJobResult = {
  weekOf: string;
  tenants: number;
  people: number;
  drafted: number;
  existing: number;
  empty: number;
  skipped: number;
};

/** The same draft id for the same person and week, in the id format the read route accepts. */
export async function weeklyDraftId(principalId: string, weekOf: string): Promise<string> {
  return `dg:${(await sha256Hex(`weekly-digest|${principalId}|${weekOf}`)).slice(0, 16)}`;
}

/** A session for a directory person, built the way a request builds it. Null when they cannot sign in. */
async function sessionOf(
  env: Env,
  tenantId: string,
  email: string,
  now: number,
): Promise<Session | null> {
  const s = await tenantStub(env, tenantId).session({
    email,
    actAs: null,
    now,
    // A job is not a request: it does not count against the person's rate window.
    limit: Number.MAX_SAFE_INTEGER,
    via: "internal",
    managed: scimConfigured(env),
    accessLinked: false,
  });
  if (!s.config || !s.active || s.limited) return null;
  return {
    principal: { ...s.principal, tenantId },
    ctx: makeCtx(now, s.ndaGrants, s.elevatedUntil),
    persona: null,
    tenantId,
    config: s.config,
    epoch: s.epoch,
    internal: null,
    switches: s.switches,
    org: await tenantOrg(env, tenantId, getOrg(s.config), s.rolesVersion),
  };
}

export async function runWeeklyDigests(env: Env, now: number): Promise<DigestJobResult> {
  const weekOf = mondayOf(now);
  const out: DigestJobResult = {
    weekOf,
    tenants: 0,
    people: 0,
    drafted: 0,
    existing: 0,
    empty: 0,
    skipped: 0,
  };
  for (const tenantId of tenantIds(env)) {
    if (!(await tenantStub(env, tenantId).getConfig())) continue;
    out.tenants++;
    for (const p of await govClient(env, tenantId).principals()) {
      // People without a role see nothing company wide, so there is nothing to report to them.
      if (p.roleIds.length === 0) continue;
      out.people++;
      try {
        const session = await sessionOf(env, tenantId, p.email, now);
        if (!session || session.principal.id !== p.id) {
          out.skipped++;
          continue;
        }
        const c = new Context<AppEnv>(new Request("https://digest-job.invalid/"), { env });
        c.set("session", session);
        const id = await weeklyDraftId(p.id, weekOf);
        if (await stubOf(c, personalScope(p.id)).get(id)) {
          out.existing++;
          continue;
        }
        const d = await composeDigest(c);
        if (d.sections.every((x) => x.items.length === 0)) {
          out.empty++;
          continue;
        }
        const audited = await appendReceipt(env, {
          receiptId: newReceiptId(),
          at: new Date(now).toISOString(),
          tenantId,
          principalId: p.id,
          action: "digest.scheduled",
          nodeId: null,
          scopeId: null,
          decision: "allow",
          reason: "scheduled",
          revision: null,
          requestId: null,
          clientId: null,
          tool: null,
        });
        // No receipt, no draft: the record comes first, as everywhere else.
        if (!audited) {
          out.skipped++;
          continue;
        }
        await saveDraft(c, id, d);
        out.drafted++;
      } catch {
        // One person's failure never stops the rest; the next run picks them up, as the id is stable.
        out.skipped++;
      }
    }
  }
  return out;
}
