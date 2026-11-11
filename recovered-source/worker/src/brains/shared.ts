// Helpers shared by the brain routes: what the caller can read of a brain, and the card.

import {
  type BrainFacts,
  type BrainRole,
  effectivePublication,
  isRestrictedBrain,
  type Publication,
} from "@secondary/policy";
import { grantsMemberRole } from "../../../../src/state/brain-member.ts";
import { govClient } from "../admin/client.ts";
import { tenantStub } from "../stubs.ts";
import { type C, sess } from "../ux/util.ts";
import { lineReadable, pageVisible, type Readable, readableMany } from "../wiki/routes.ts";
import { citationsOf, GENERATED } from "../wiki/text.ts";
import type { PageRow } from "../wiki/types.ts";
import {
  computeHealth,
  defaultTemplate,
  type Health,
  type HealthPage,
  SESSION_REPORT_TYPE,
  TEMPLATES,
  type TemplateId,
} from "./model.ts";
import { type Brain, reconcileStoredMembers } from "./open.ts";
import type { BrainConfig } from "./store.ts";

export { lineReadable };

export const SKIP_TYPES: ReadonlySet<string> = new Set([
  ...Object.keys(GENERATED),
  "journal",
  SESSION_REPORT_TYPE,
]);

export interface Seen {
  brain: Brain;
  pages: PageRow[];
  /** Pages the caller may read: at least one cited source readable, or none cited. */
  visible: PageRow[];
  ok: Readable;
  config: BrainConfig;
  template: TemplateId;
  publication: Publication;
  freshnessDays: number;
  findings: number | null;
  backlog: number | null;
  health: Health;
}

export interface BrainCard {
  id: string;
  type: string;
  name: string;
  template: TemplateId;
  readers: number;
  manages: boolean;
  restricted: boolean;
  publication: Publication;
  /** The caller's effective role in this brain: what the policy and any stored role let them do. */
  role: BrainRole;
  pages: number;
  health: { score: number };
  lastActivityAt: string | null;
}

/** Everything a card and a home need from one brain, read once and filtered for this caller. */
export async function seeBrains(c: C, brains: Brain[]): Promise<Seen[]> {
  const s = sess(c);
  const raw = await Promise.all(
    brains.map(async (b) => {
      const [pages, config, meta, h] = await Promise.all([
        b.stub.wikiPages(),
        b.stub.brainConfig(),
        b.stub.wikiMeta(),
        b.stub.wikiHealth(s.ctx.now),
      ]);
      return { b, pages, config, meta, h };
    }),
  );
  const oks = await readableMany(
    c,
    raw.map((r) => ({
      w: { view: r.b.view, personal: r.b.personal, stub: r.b.stub },
      ids: r.pages.flatMap((p) => citationsOf(p.markdown)),
    })),
  );
  return raw.map((r, i): Seen => {
    const ok = oks[i] as Readable;
    const visible = r.pages.filter((p) => pageVisible(citationsOf(p.markdown), ok));
    const template = r.config.template ?? defaultTemplate(r.b.facts.type);
    const freshnessDays = r.meta?.freshnessDays ?? 180;
    // Lint findings and the review backlog are counted for someone who can decide them, and only then.
    const findings = r.b.can.decide && r.h ? r.h.openFindings : null;
    const backlog = r.b.can.decide && r.h ? r.h.openProposals : null;
    const pagesForHealth: HealthPage[] = visible.map((p) => ({
      id: p.id,
      type: p.type,
      markdown: p.markdown,
      updatedAt: p.updatedAt,
    }));
    const health = computeHealth({
      pages: pagesForHealth,
      now: s.ctx.now,
      freshnessDays,
      lint: findings,
      backlog,
      expected: TEMPLATES[template].collections
        .map((x) => x.type)
        .filter((t) => !SKIP_TYPES.has(t)),
      skipTypes: SKIP_TYPES,
    });
    return {
      brain: r.b,
      pages: r.pages,
      visible,
      ok,
      config: r.config,
      template,
      publication: effectivePublication(r.b.facts, r.config.publication),
      freshnessDays,
      findings,
      backlog,
      health,
    };
  });
}

/** Members and memberships of a brain, as a count. Personal is one, Global is the directory. */
export async function readersOf(
  c: C,
  b: Brain,
  stored: { principalId: string; state: unknown }[],
): Promise<number> {
  const s = sess(c);
  if (b.personal) return 1;
  if (b.facts.type === "global")
    return (await tenantStub(c.env, s.tenantId).listPrincipalIds()).length;
  const kind = b.vn?.kind;
  const ids = new Set(
    stored.filter((m) => grantsMemberRole(m.state)).map((m) => m.principalId),
  );
  if (kind === "circle" || kind === "department" || kind === "account")
    for (const m of await govClient(c.env, s.tenantId).members(kind, b.nodeId))
      ids.add(m.principalId);
  return ids.size;
}

/** The highest brain role whose actions the caller holds here. A Personal Brain is always its owner's. */
export const roleOfBrain = (b: Brain): BrainRole =>
  b.personal || b.can.manage
    ? "owner"
    : b.can.decide
      ? "steward"
      : b.can.edit
        ? "editor"
        : b.can.contribute
          ? "contributor"
          : "reader";

export async function cardOf(c: C, x: Seen): Promise<BrainCard> {
  const b = x.brain;
  const preliminary = await b.stub.brainMembers();
  await reconcileStoredMembers(
    c,
    b.stub,
    preliminary.map((m) => m.principalId),
  );
  const stored = await b.stub.brainMembers();
  return {
    id: b.param,
    type: b.facts.type,
    name: b.label,
    template: x.template,
    readers: await readersOf(c, b, stored),
    manages: b.can.manage,
    restricted: isRestrictedBrain(b.facts as BrainFacts),
    publication: x.publication,
    role: roleOfBrain(b),
    pages: x.visible.length,
    health: { score: x.health.score },
    lastActivityAt: x.visible.length
      ? new Date(Math.max(...x.visible.map((p) => p.updatedAt))).toISOString()
      : null,
  };
}

/** The wiki's own per-person limit helper, local: a Response is the refusal. */
export async function rateLimit(c: C, key: string, perMin: number): Promise<Response | null> {
  const s = sess(c);
  const res = await tenantStub(c.env, s.tenantId).hit(
    `${key}:${s.principal.id}`,
    s.ctx.now,
    perMin,
  );
  if (!res.limited) return null;
  c.header("Retry-After", String(res.retryAfter));
  return c.json({ error: "rate_limited" }, 429);
}
