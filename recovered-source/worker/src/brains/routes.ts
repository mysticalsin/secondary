// /v1/brains: directory, home, template, access, guide and Structure Coach (API-CONTRACT "v3 brains").
// Every route opens the brain through the caller's admitted view first (404 when it is not there).

import {
  BRAIN_ROLE_LABEL,
  BRAIN_ROLES,
  type BrainRole,
  type BrainType,
  brainRoleActions,
  brainTypeOf,
  canDoInView,
  type Everyone,
  effectiveEveryone,
  effectivePublication,
  everyoneBound,
  isBrainRole,
  isRestrictedBrain,
  isShareable,
  opensBrain,
  type Publication,
  publicationBound,
} from "@secondary/policy";
import { Hono } from "hono";
import { quorumConfirmed } from "../../../../src/state/quorum.ts";
import { govClient } from "../admin/client.ts";
import { manageAuthority, noticeLabel, scopeDescOf, scopeKey } from "../admin/validate.ts";
import { requireOrg, viewOf } from "../auth.ts";
import { humanIdsOf } from "../human.ts";
import { scopeOfNode } from "../scope.ts";
import { tenantStub } from "../stubs.ts";
import type { AppDeps, AppEnv } from "../types.ts";
import { audit, bad, type C, notFound, readObject, sess, text } from "../ux/util.ts";
import { cleanText, GENERATED, sha256Hex } from "../wiki/text.ts";
import {
  type Collection,
  DAY,
  defaultTemplate,
  isTemplateId,
  TEMPLATES,
  type TemplateId,
} from "./model.ts";
import { buildNav, NAV_NODE_IDS } from "./nav.ts";
import { admittedBrainParams, type Brain, brainOf, needBrain, needFlag } from "./open.ts";
import { cardOf, lineReadable, rateLimit, SKIP_TYPES, seeBrains } from "./shared.ts";

const WEEK = 7 * DAY;
const COACH_TTL = 60 * 60_000;
const MAX_LIST_ITEMS = 8;
const TYPES = new Set(["personal", "team", "account", "global"]);
const WIKI_KINDS = new Set(["account", "circle", "department", "core"]);

const CONVENTIONS = [
  "Cite every claim with its source token, for example {src:<source id>}.",
  "Link pages with [[page-id]]. Links across brains exist only toward Company Global.",
  "Write roles and opaque references, never names of private persons.",
  "Keep a page short and factual: Summary first, then the sections its collection asks for.",
];

const HOW_TO_PROPOSE =
  "Propose a page with propose_page (brain id, title, Markdown), or a new version of a page with propose_change. It waits in the review queue; an agent's proposal is never published unreviewed in a shared brain.";

const QUESTIONS = [
  {
    id: "role",
    prompt: "What is your role?",
    kind: "choice" as const,
    options: ["Bid manager", "Account lead", "Delivery consultant", "Practice lead", "Other"],
  },
  { id: "accounts", prompt: "Which accounts do you work with?", kind: "list" as const },
  { id: "recurring", prompt: "What recurring work should this brain hold?", kind: "list" as const },
  { id: "goal", prompt: "What should this brain help you do?", kind: "text" as const },
];

const list = (v: unknown): string[] => {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > MAX_LIST_ITEMS) throw bad("invalid_answers");
  return v.map((x) => cleanText(x, 60)).filter(Boolean);
};

function templateForRole(role: string, fallback: TemplateId): TemplateId {
  const r = role.toLowerCase();
  if (r.includes("bid")) return "bid";
  if (r.includes("account")) return "account";
  if (r.includes("practice")) return "practice";
  return fallback;
}

export function brainRoutes(_deps: AppDeps): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  // The whole family can be limited to a pilot cohort.
  r.use("/brains", async (c, next) => (await needFlag(c, "brains_v3")) ?? next());
  r.use("/brains/*", async (c, next) => (await needFlag(c, "brains_v3")) ?? next());

  // ---- directory ----

  /** The cards of these brains, for a caller the view admits to all of them. */
  async function cardsOf(c: C, params: { param: string }[], keep: (b: Brain) => boolean) {
    const humanIds = await humanIdsOf(c.env, sess(c));
    const opened = (await Promise.all(params.map((p) => brainOf(c, p.param, humanIds)))).filter(
      (b): b is Brain => b !== null && keep(b),
    );
    const seen = await seeBrains(c, opened);
    return Promise.all(seen.map((x) => cardOf(c, x)));
  }

  r.get("/brains", async (c) => {
    const type = c.req.query("type");
    if (type !== undefined && !TYPES.has(type)) throw bad("invalid_type");
    const scope = c.req.query("scope");
    if (scope !== undefined && scope !== "all") throw bad("invalid_scope");
    const q = (c.req.query("q") ?? "").trim().toLowerCase().slice(0, 80);
    const cards = await cardsOf(
      c,
      admittedBrainParams(c),
      (b) => (!type || b.facts.type === type) && (!q || b.label.toLowerCase().includes(q)),
    );
    cards.sort(
      (a, b) => Number(b.id === "me") - Number(a.id === "me") || a.name.localeCompare(b.name),
    );
    c.header("Cache-Control", "no-store");
    if (scope !== "all") return c.json({ brains: cards });
    // scope=all adds the brains the caller can see (their names are already on the map) but not open,
    // so the UI can offer "request access". Only identity: no pages, readers or health.
    const s = sess(c);
    const view = viewOf(s);
    const closed = [...view.nodes.values()]
      .filter((vn) => {
        const t = brainTypeOf(vn.kind);
        return (
          t !== null &&
          t !== "personal" &&
          WIKI_KINDS.has(vn.kind) &&
          !opensBrain(vn) &&
          scopeOfNode(vn) !== null &&
          (!type || t === type) &&
          (!q || vn.label.toLowerCase().includes(q))
        );
      })
      .map((vn) => {
        const t = brainTypeOf(vn.kind) as BrainType;
        return {
          id: vn.id,
          type: t,
          name: vn.label,
          canOpen: false as const,
          restricted: isRestrictedBrain({ type: t, restricted: vn.restricted, nda: vn.nda }),
          canRequestAccess:
            vn.kind !== "core" && canDoInView(view, s.principal, vn.id, "request_access").allowed,
        };
      })
      .sort((a, z) => a.name.localeCompare(z.name));
    return c.json({
      brains: [...cards.map((x) => ({ ...x, canOpen: true as const })), ...closed],
    });
  });

  // The v4 sidebar: Personal, governance brains in a fixed order (Accounts carries its account
  // brains), Company Global. Only brains the caller may open; a governance without one is omitted.
  r.get("/brains/nav", async (c) => {
    const cards = await cardsOf(
      c,
      admittedBrainParams(c).filter(
        (p) =>
          p.param === "me" ||
          p.param === "core" ||
          p.vn?.kind === "account" ||
          NAV_NODE_IDS.has(p.param),
      ),
      () => true,
    );
    c.header("Cache-Control", "no-store");
    return c.json({ items: buildNav(cards) });
  });

  // ---- home ----

  r.get("/brains/:id", async (c) => {
    const b = await needBrain(c, c.req.param("id"), "read");
    if (b instanceof Response) return b;
    const s = sess(c);
    const [x] = await seeBrains(c, [b]);
    if (!x) throw notFound();
    const card = await cardOf(c, x);
    const schema = await b.stub.wikiSchema();
    const counts = new Map<string, number>();
    for (const p of x.visible)
      if (p.type !== "journal") counts.set(p.type, (counts.get(p.type) ?? 0) + 1);
    const expected = new Set(
      TEMPLATES[x.template].collections.map((t) => t.type).filter((t) => !SKIP_TYPES.has(t)),
    );
    const own = Object.keys(schema.types).filter((t) => !SKIP_TYPES.has(t));
    const types = new Set([...counts.keys(), ...expected, ...own]);
    const collections = [...types]
      .map((type) => ({
        type,
        label:
          schema.types[type]?.label ??
          TEMPLATES[x.template].collections.find((t) => t.type === type)?.label ??
          type,
        count: counts.get(type) ?? 0,
        expected: expected.has(type),
      }))
      .sort((a, z) => a.label.localeCompare(z.label));

    const since = s.ctx.now - WEEK;
    const rows = await b.stub.brainChangesSince(since, 50);
    const byId = new Map(x.visible.map((p) => [p.id, p]));
    const items = rows.flatMap((row) => {
      const page = byId.get(row.pageId);
      if (!page) return [];
      let added = 0;
      let removed = 0;
      for (const d of row.diff) {
        if (!lineReadable(d.text, x.ok)) continue;
        if (d.type === "add") added++;
        else if (d.type === "del") removed++;
      }
      return [
        {
          pageId: row.pageId,
          title: page.title,
          type: page.type,
          change: row.change,
          revision: row.revision,
          at: new Date(row.at).toISOString(),
          actor: row.actor,
          added,
          removed,
        },
      ];
    });
    const suggestions = b.can.manage
      ? [...expected]
          .filter((t) => !counts.get(t))
          .slice(0, 5)
          .map((t) => ({
            kind: "missing_collection" as const,
            collection: t,
            message: `No pages in ${schema.types[t]?.label ?? t} yet. Add the first one.`,
          }))
      : [];
    c.header("Cache-Control", "no-store");
    return c.json({
      ...card,
      health: x.health,
      collections,
      changedThisWeek: { since: new Date(since).toISOString(), total: items.length, items },
      coach: { available: b.can.manage, suggestions },
    });
  });

  // ---- template ----

  r.post("/brains/:id/template", async (c) => {
    const b = await needBrain(c, c.req.param("id"), "manage");
    if (b instanceof Response) return b;
    const body = await readObject(c);
    if (!isTemplateId(body.template)) throw bad("invalid_template");
    const template: TemplateId = body.template;
    const s = sess(c);
    if (
      !(await audit(c, {
        action: "brain.template",
        nodeId: b.nodeId,
        scopeId: b.scope,
        revision: null,
      }))
    )
      return c.json({ error: "audit_unavailable" }, 503);
    const added = await b.stub.brainSchemaAdd(TEMPLATES[template].collections);
    await b.stub.brainConfigSet({ template }, s.principal.id, s.ctx.now);
    return c.json({ ok: true, template, added });
  });

  // ---- access ----

  r.get("/brains/:id/access", async (c) => {
    const b = await needBrain(c, c.req.param("id"), "read");
    if (b instanceof Response) return b;
    const s = sess(c);
    const config = await b.stub.brainConfig();
    const pub = publicationBound(b.facts);
    const every = everyoneBound(b.facts);
    type MemberOut = {
      principalId: string;
      email: string;
      role: BrainRole;
      state: "active" | "pending";
    };
    let members: MemberOut[] | null = null;
    if (b.can.manage && isShareable(b.facts)) {
      const tenant = tenantStub(c.env, s.tenantId);
      const stored = await b.stub.brainMembers();
      const byId = new Map(stored.map((m) => [m.principalId, m]));
      const kind = b.vn?.kind;
      const base =
        kind === "circle" || kind === "department" || kind === "account"
          ? await govClient(c.env, s.tenantId).members(kind, b.nodeId)
          : [];
      const out: MemberOut[] = [];
      for (const m of base)
        out.push({
          principalId: m.principalId,
          email: m.email,
          role: byId.get(m.principalId)?.role ?? "contributor",
          state: "active",
        });
      for (const m of stored)
        if (!base.some((x) => x.principalId === m.principalId))
          out.push({
            principalId: m.principalId,
            email: (await tenant.emailOfPrincipal(m.principalId)) ?? "",
            role: m.role,
            state: m.state,
          });
      members = out.sort((a, z) => a.email.localeCompare(z.email));
    }
    c.header("Cache-Control", "no-store");
    return c.json({
      brainId: b.param,
      type: b.facts.type,
      canManage: b.can.manage,
      publication: {
        mode: effectivePublication(b.facts, config.publication),
        allowed: pub.allowed,
        forced: pub.allowed.length === 1,
        reason: pub.reason,
      },
      everyone: {
        level: effectiveEveryone(b.facts, config.everyone),
        allowed: every.allowed,
        reason: every.reason,
      },
      roles: BRAIN_ROLES.map((id) => ({
        id,
        label: BRAIN_ROLE_LABEL[id].label,
        summary: BRAIN_ROLE_LABEL[id].summary,
        actions: [...brainRoleActions(id)],
      })),
      members,
    });
  });

  r.put("/brains/:id/access", async (c) => {
    const b = await needBrain(c, c.req.param("id"), "manage");
    if (b instanceof Response) return b;
    const body = await readObject(c);
    const patch: { publication?: Publication; everyone?: Everyone } = {};
    if (body.publication !== undefined) {
      if (body.publication !== "review" && body.publication !== "direct")
        throw bad("invalid_publication");
      const bound = publicationBound(b.facts);
      if (!bound.allowed.includes(body.publication))
        return c.json(
          { error: "policy_bound", reason: bound.reason ?? "Not allowed for this brain" },
          422,
        );
      patch.publication = body.publication;
    }
    if (body.everyone !== undefined) {
      if (body.everyone !== "none" && body.everyone !== "reader" && body.everyone !== "contributor")
        throw bad("invalid_everyone");
      const bound = everyoneBound(b.facts);
      if (!bound.allowed.includes(body.everyone))
        return c.json(
          { error: "policy_bound", reason: bound.reason ?? "Not allowed for this brain" },
          422,
        );
      patch.everyone = body.everyone;
    }
    if (!Object.keys(patch).length) throw bad("nothing_to_change");
    const s = sess(c);
    // M-8: opening a brain to everyone at Mantu takes two people (closing it does not). The second
    // person confirms the same level on the same brain within 24 hours.
    const opening =
      patch.everyone !== undefined &&
      patch.everyone !== "none" &&
      effectiveEveryone(b.facts, (await b.stub.brainConfig()).everyone) !== patch.everyone;
    if (opening) {
      const step = await tenantStub(c.env, s.tenantId).requestSecond(
        `brainopen:${b.scope}:${patch.everyone}`,
        s.principal.id,
        s.ctx.now,
        s.principal.email,
      );
      if (step.tag === "same_actor")
        return c.json(
          { error: "same_person", reason: "A different person must confirm opening this brain" },
          409,
        );
      if (!quorumConfirmed(step)) {
        await audit(c, {
          action: "brain.open_request",
          nodeId: b.nodeId,
          scopeId: b.scope,
          revision: null,
        });
        return c.json({ ok: true, status: "pending", needs: "second_person" }, 202);
      }
    }
    if (
      !(await audit(c, {
        action: "brain.access",
        nodeId: b.nodeId,
        scopeId: b.scope,
        revision: null,
      }))
    )
      return c.json({ error: "audit_unavailable" }, 503);
    const next = await b.stub.brainConfigSet(patch, s.principal.id, s.ctx.now);
    // The engine reads Everyone at Mantu from the tenant (it builds every view); the workspace copy is
    // what the Access page shows. Bounded above by brain type, and again by the engine on every view.
    if (patch.everyone !== undefined && !b.personal)
      await tenantStub(c.env, s.tenantId).openBrainSet(
        b.nodeId,
        effectiveEveryone(b.facts, next.everyone),
      );
    return c.json({
      ok: true,
      publication: effectivePublication(b.facts, next.publication),
      everyone: effectiveEveryone(b.facts, next.everyone),
    });
  });

  r.put("/brains/:id/access/members/:pid", async (c) => {
    const b = await needBrain(c, c.req.param("id"), "manage");
    if (b instanceof Response) return b;
    if (!isShareable(b.facts))
      return c.json(
        { error: "personal_not_shareable", reason: "A Personal Brain is never shared" },
        422,
      );
    const body = await readObject(c);
    if (!isBrainRole(body.role)) throw bad("invalid_role");
    const role: BrainRole = body.role;
    return setMember(c, b, c.req.param("pid"), role);
  });

  r.delete("/brains/:id/access/members/:pid", async (c) => {
    const b = await needBrain(c, c.req.param("id"), "manage");
    if (b instanceof Response) return b;
    if (!isShareable(b.facts))
      return c.json(
        { error: "personal_not_shareable", reason: "A Personal Brain is never shared" },
        422,
      );
    return setMember(c, b, c.req.param("pid"), null);
  });

  // ---- guide (also for MCP): structure, never content ----

  r.get("/brains/:id/guide", async (c) => {
    const b = await needBrain(c, c.req.param("id"), "read");
    if (b instanceof Response) return b;
    const [x] = await seeBrains(c, [b]);
    if (!x) throw notFound();
    const schema = await b.stub.wikiSchema();
    const counts = new Map<string, number>();
    for (const p of x.visible) counts.set(p.type, (counts.get(p.type) ?? 0) + 1);
    c.header("Cache-Control", "no-store");
    return c.json({
      brain: { id: b.param, type: b.facts.type, name: b.label, template: x.template },
      publication: x.publication,
      collections: Object.entries(schema.types)
        .filter(([t]) => t !== "journal")
        .map(([type, t]) => ({
          type,
          label: t.label,
          required: t.required,
          count: counts.get(type) ?? 0,
          generated: !!GENERATED[type],
        })),
      tone: schema.tone,
      // Definitions only, never a value: a guide is read by agents.
      fields: x.config.fields,
      conventions: CONVENTIONS,
      howToPropose: HOW_TO_PROPOSE,
    });
  });

  // ---- Structure Coach: only where the caller manages the brain ----

  r.get("/brains/:id/coach", async (c) => {
    const f = await needFlag(c, "coach");
    if (f) return f;
    const b = await needBrain(c, c.req.param("id"), "manage");
    if (b instanceof Response) return b;
    const [config, schema] = await Promise.all([b.stub.brainConfig(), b.stub.wikiSchema()]);
    return c.json({
      brainId: b.param,
      questions: QUESTIONS,
      templates: Object.values(TEMPLATES)
        .filter((t) => t.id !== "blank")
        .map((t) => ({ id: t.id, label: t.label, collections: t.collections })),
      current: {
        template: config.template ?? defaultTemplate(b.facts.type),
        collections: Object.keys(schema.types).filter((t) => !SKIP_TYPES.has(t)),
      },
    });
  });

  r.post("/brains/:id/coach/propose", async (c) => {
    const f = await needFlag(c, "coach");
    if (f) return f;
    const b = await needBrain(c, c.req.param("id"), "manage");
    if (b instanceof Response) return b;
    const limited = await rateLimit(c, "brain_coach", 20);
    if (limited) return limited;
    const body = await readObject(c);
    const a =
      body.answers && typeof body.answers === "object"
        ? (body.answers as Record<string, unknown>)
        : {};
    const fallback = defaultTemplate(b.facts.type);
    let template: TemplateId = fallback;
    if (a.template !== undefined) {
      if (!isTemplateId(a.template) || a.template === "blank") throw bad("invalid_template");
      template = a.template;
    } else if (typeof a.role === "string")
      template = templateForRole(cleanText(a.role, 60), fallback);
    const accounts = list(a.accounts);
    const recurring = list(a.recurring);
    const wanted: Collection[] = [...TEMPLATES[template].collections];
    if (accounts.length && !wanted.some((x) => x.type === "client"))
      wanted.push({ type: "client", label: "Clients", required: ["Summary"] });
    for (const item of recurring.slice(0, 5)) {
      const type = item
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 40);
      if (
        /^[a-z][a-z0-9_]*$/.test(type) &&
        !wanted.some((x) => x.type === type) &&
        !GENERATED[type] &&
        type !== "journal"
      )
        wanted.push({
          type,
          label: item.charAt(0).toUpperCase() + item.slice(1),
          required: ["Summary"],
        });
    }
    const schema = await b.stub.wikiSchema();
    const collections = wanted.map((x) => ({
      ...x,
      action: schema.types[x.type] ? ("keep" as const) : ("add" as const),
    }));
    const s = sess(c);
    const hash = (await sha256Hex(JSON.stringify([b.param, template, collections]))).slice(0, 32);
    const proposalId = `coach-${hash.slice(0, 12)}`;
    if (
      !(await audit(c, {
        action: "brain.coach_propose",
        nodeId: b.nodeId,
        scopeId: b.scope,
        revision: null,
      }))
    )
      return c.json({ error: "audit_unavailable" }, 503);
    await b.stub.brainCoachSave(
      proposalId,
      hash,
      JSON.stringify({ template, collections }),
      s.ctx.now,
      COACH_TTL,
    );
    const adds = collections.filter((x) => x.action === "add").length;
    return c.json({
      proposalId,
      hash,
      template,
      collections,
      rationale: `The ${TEMPLATES[template].label} template fits what you described. ${adds ? `${adds} collection${adds === 1 ? "" : "s"} would be added` : "Every collection already exists"}; nothing is removed and no page is created.`,
      expiresAt: new Date(s.ctx.now + COACH_TTL).toISOString(),
    });
  });

  r.post("/brains/:id/coach/apply", async (c) => {
    const f = await needFlag(c, "coach");
    if (f) return f;
    const b = await needBrain(c, c.req.param("id"), "manage");
    if (b instanceof Response) return b;
    const body = await readObject(c);
    const id = text(body.proposalId, 1, 40, "invalid_proposal");
    const hash = text(body.hash, 1, 64, "invalid_hash");
    const s = sess(c);
    const row = await b.stub.brainCoachGet(id, s.ctx.now);
    if (!row) throw notFound();
    if (row.hash !== hash)
      return c.json(
        { error: "hash_mismatch", reason: "The proposal changed since you read it" },
        409,
      );
    const plan = JSON.parse(row.body) as { template: TemplateId; collections: Collection[] };
    if (!isTemplateId(plan.template)) throw notFound();
    if (
      !(await audit(c, {
        action: "brain.coach_apply",
        nodeId: b.nodeId,
        scopeId: b.scope,
        revision: null,
      }))
    )
      return c.json({ error: "audit_unavailable" }, 503);
    // Collections only: no page, no member. Never removes one.
    const created = await b.stub.brainSchemaAdd(plan.collections);
    await b.stub.brainConfigSet({ template: plan.template }, s.principal.id, s.ctx.now);
    await b.stub.brainCoachDone(id, s.principal.id, s.ctx.now);
    return c.json({ ok: true, created });
  });

  return r;
}

/**
 * Add, change or remove a member. Admission goes through the governance membership change (two people
 * on a restricted brain); a stored role only narrows. Changing a role of an existing member on a
 * restricted brain, or granting steward or owner there, needs a second person.
 */
async function setMember(
  c: C,
  b: NonNullable<Awaited<ReturnType<typeof brainOf>>>,
  pid: string,
  role: BrainRole | null,
): Promise<Response> {
  const s = sess(c);
  if (!/^[A-Za-z0-9_.:@-]{1,128}$/.test(pid)) throw notFound();
  if (pid === s.principal.id)
    return c.json({ error: "own_role", reason: "You cannot change your own role" }, 422);
  const tenant = tenantStub(c.env, s.tenantId);
  if ((await tenant.emailOfPrincipal(pid)) === null) throw notFound();
  const kind = b.vn?.kind;
  const gov = govClient(c.env, s.tenantId);
  const scoped = kind === "circle" || kind === "department" || kind === "account";
  const govMember = scoped
    ? (await gov.members(kind, b.nodeId)).some((m) => m.principalId === pid)
    : false;
  const isMember = govMember || (await b.stub.brainMembers()).some((m) => m.principalId === pid);
  const restricted = isRestrictedBrain(b.facts);
  const heavy = role === "steward" || role === "owner";
  const needsSecond =
    role !== null && isMember && (restricted || (heavy && b.facts.type === "global"));
  if (needsSecond) {
    const key = `brainrole:${b.scope}:${pid}:${role}`;
    const step = await tenant.requestSecond(key, s.principal.id, s.ctx.now, s.principal.email);
    if (step.tag === "same_actor")
      return c.json(
        { error: "same_person", reason: "A different person must confirm this change" },
        409,
      );
    if (!quorumConfirmed(step)) {
      await audit(c, {
        action: "brain.role_request",
        nodeId: b.nodeId,
        scopeId: b.scope,
        revision: null,
      });
      return c.json({ ok: true, status: "pending", member: { principalId: pid, role } }, 202);
    }
  }
  if (
    !(await audit(c, {
      action: role ? "brain.member_set" : "brain.member_remove",
      nodeId: b.nodeId,
      scopeId: b.scope,
      revision: null,
    }))
  )
    return c.json({ error: "audit_unavailable" }, 503);
  await gov.remember(s.principal.id, s.principal.email);

  // Admission or removal of the membership itself, where the brain is a scope with memberships.
  let status: "applied" | "pending" = "applied";
  let changeId: string | undefined;
  if (scoped) {
    const d = scopeDescOf(requireOrg(s), kind, b.nodeId);
    if ("ok" in d) return c.json({ error: "invalid_scope" }, 422);
    if (!manageAuthority(b.view.roles, d))
      return c.json(
        { error: "forbidden", reason: "Membership changes need the steward or a Platform admin" },
        403,
      );
    const wantMember = role !== null;
    if (wantMember !== govMember) {
      const made = await gov.propose(
        {
          kind: wantMember ? "member_add" : "member_remove",
          payload: { principalId: pid, scope: { type: d.type, id: d.id }, subspace: null },
          scopeKey: scopeKey(d),
          scope: d,
          needsSecond: d.restricted,
          proposedBy: s.principal.id,
          label: `${wantMember ? "Adding" : "Removing"} a member of ${noticeLabel(d)}`,
        },
        s.ctx.now,
      );
      if (!made.ok) return c.json({ error: made.code, reason: made.message }, made.status);
      status = made.applied ? "applied" : "pending";
      changeId = made.change.id;
    }
  }
  if (role === null) {
    if (status === "applied") await b.stub.brainMemberRemove(pid, s.principal.id, s.ctx.now);
  } else {
    const set = await b.stub.brainMemberSet(
      pid,
      role,
      status === "applied" ? "active" : "pending",
      s.principal.id,
      s.ctx.now,
    );
    if (!set.ok) return c.json({ error: set.code }, 409);
  }
  return c.json({
    ok: true,
    status,
    ...(changeId ? { changeId } : {}),
    member: { principalId: pid, role },
  });
}
