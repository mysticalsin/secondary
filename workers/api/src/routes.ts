// Every /v1 route. Rule for all of them: build the caller's admitted view with packages/policy
// first, answer only from it, and fan out only to the workspaces that view reaches. A node outside
// the view is indistinguishable from a node that does not exist.

import {
  ACTIONS,
  type Action,
  type AdmittedView,
  canDoInView,
  DEFAULT_SEED,
  describe,
  governanceStages,
  isPersonalKind,
  LENSES,
  type Lens,
  type MapNode,
  toMapView,
  toNodeDetail,
  type ViewNode,
} from "@secondary/policy";
import { type Context, Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { adminRoutes } from "./admin/routes.ts";
import { appendReceipt, fetchReceipts, newReceiptId, type Receipt } from "./audit.ts";
import { authenticate, requireOrg, viewOf } from "./auth.ts";
import { MAX_PROMPT, planView } from "./genui.ts";
import { readiness } from "./observe.ts";
import { opsAdminRoutes, switchedOff, switchGate } from "./ops-admin.ts";
import { PERSONAL_KINDS, type PersonalKind, personalKindOf } from "./personal-kind.ts";
import { candidateId, parseCandidateId, scopeOfNode } from "./scope.ts";
import { limitBody, mutationGuard, safeEqual } from "./security.ts";
import { seedTenant } from "./seed.ts";
import { detectSensitivity, type SensitivityFlag } from "./sensitivity.ts";
import { tenantStub, workspaceStub } from "./stubs.ts";
import type { AppDeps, AppEnv, Session } from "./types.ts";
import type { Fail, ItemRecord, UserValidated } from "./workspace.ts";

export const VERSION = "0.1.0";

type C = Context<AppEnv>;

const NODE_ID = /^[a-z0-9][a-z0-9_.:-]{0,127}$/;
const MAX_TEXT = 2_000;
const MAX_BODY_TEXT = 8_000;
const SEARCH_LIMIT = 25;
const VALIDATION_MAX_AGE_MS = 24 * 3_600_000;

const bad = (code: string, status: 400 | 404 | 409 | 422 = 400) =>
  new HTTPException(status, { message: code });

async function readObject(
  c: C,
  opts: { emptyOk?: boolean } = {},
): Promise<Record<string, unknown>> {
  const raw = await c.req.text();
  if (!raw.trim() && opts.emptyOk) return {};
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    throw bad("invalid_json");
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) throw bad("invalid_json");
  return v as Record<string, unknown>;
}

const text = (v: unknown, min: number, max: number, code: string): string => {
  if (typeof v !== "string") throw bad(code);
  const t = v.trim();
  if (t.length < min || t.length > max) throw bad(code);
  return t;
};
const optText = (v: unknown, max: number, code: string): string | undefined =>
  v === undefined || v === null ? undefined : text(v, 0, max, code);
const nodeIdOf = (v: unknown, code = "invalid_node_id"): string => {
  if (typeof v !== "string" || !NODE_ID.test(v)) throw bad(code);
  return v;
};
const revisionOf = (v: unknown): number => {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) throw bad("revision_required");
  return v;
};

const sess = (c: C): Session => c.get("session");
const notFound = () => new HTTPException(404, { message: "not_found" });
const forbidden = (c: C, reason: string) => c.json({ error: "forbidden", reason }, 403);

/** The workspace that stores a node the caller can see. */
function wsFor(c: C, vn: ViewNode | ({ kind: ViewNode["kind"] } & Partial<ViewNode>)) {
  const scope = scopeOfNode(vn as ViewNode);
  if (!scope) throw notFound();
  return workspaceStub(c.env, sess(c).tenantId, scope);
}

/** Workspace scopes the admitted view reaches. Nothing outside this set is ever queried. */
function admittedScopes(view: AdmittedView): string[] {
  const out = new Set<string>();
  for (const vn of view.nodes.values()) {
    const s = scopeOfNode(vn);
    if (s) out.add(s);
  }
  return [...out].sort();
}

// ---- audit ----

type Intent = Omit<
  Receipt,
  "receiptId" | "at" | "tenantId" | "principalId" | "requestId" | "clientId" | "tool"
>;

async function audit(c: C, i: Intent): Promise<{ receiptId: string; ok: boolean }> {
  const s = sess(c);
  const receiptId = newReceiptId();
  const ok = await appendReceipt(c.env, {
    ...i,
    receiptId,
    at: new Date().toISOString(),
    tenantId: s.tenantId,
    principalId: s.principal.id,
    requestId: c.get("requestId") ?? null,
    clientId: s.internal?.clientId ?? null,
    tool: s.internal?.tool ?? null,
  });
  return { receiptId, ok };
}

/** Maps a data-level refusal from a Workspace to an HTTP answer. */
function failResponse(c: C, f: Fail): Response {
  switch (f.code) {
    case "not_found":
      return c.json({ error: "not_found" }, 404);
    case "conflict":
      return c.json(
        { error: "revision_conflict", currentRevision: f.currentRevision, reason: f.message },
        409,
      );
    case "self_approval":
    case "not_author":
      return c.json({ error: "forbidden", reason: f.message }, 403);
    default:
      return c.json({ error: f.code, reason: f.message }, 409);
  }
}

// ---- candidates (Personal Brain contribute and direct contribute) ----

interface CandidateInput {
  targetNodeId: string;
  title: string;
  body: string | null;
  userValidated: UserValidated;
  acknowledged: string[];
  releaseTarget: "scope" | "global";
}

const hex8 = (): string =>
  [...crypto.getRandomValues(new Uint8Array(4))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

function parseUserValidated(v: unknown, s: Session, expectedRevision: number): UserValidated {
  if (!v || typeof v !== "object") throw bad("user_validation_required", 422);
  const o = v as Record<string, unknown>;
  const by = typeof o.by === "string" ? o.by.toLowerCase() : "";
  const at = typeof o.at === "string" ? Date.parse(o.at) : Number.NaN;
  if (by !== s.principal.id.toLowerCase() && by !== s.principal.email.toLowerCase())
    throw bad("user_validation_required", 422);
  if (!Number.isFinite(at) || at > s.ctx.now + 300_000 || s.ctx.now - at > VALIDATION_MAX_AGE_MS)
    throw bad("user_validation_required", 422);
  if (o.revision !== expectedRevision) throw bad("user_validation_required", 422);
  return { by: s.principal.id, at: new Date(at).toISOString(), revision: expectedRevision };
}

async function submitCandidate(c: C, view: AdmittedView, i: CandidateInput): Promise<Response> {
  const s = sess(c);
  if (!s.switches.contribute) return c.json(switchedOff("contribute"), 503);
  const flags = detectSensitivity({ title: i.title, body: i.body });
  const pending = flags.filter((f) => !i.acknowledged.includes(f.id));
  // R-110/R-111: anything flagged blocks until the owner acknowledges each flag.
  if (pending.length)
    return c.json(
      {
        error: "sensitivity_flags_pending",
        sensitivity_flags: flags,
        pending: pending.map((f) => f.id),
      },
      422,
    );
  const target = view.nodes.get(i.targetNodeId);
  if (!target || isPersonalKind(target.kind)) return forbidden(c, "Not in your view");
  const d = canDoInView(view, s.principal, i.targetNodeId, "contribute");
  const scopeId = scopeOfNode(target);
  if (!d.allowed || !scopeId) {
    await audit(c, {
      action: "contribute",
      nodeId: i.targetNodeId,
      scopeId,
      decision: "deny",
      reason: d.reason,
      revision: null,
    });
    return forbidden(c, d.reason);
  }
  const receipt = await audit(c, {
    action: "contribute",
    nodeId: i.targetNodeId,
    scopeId,
    decision: "allow",
    reason: d.reason,
    revision: 1,
  });
  if (!receipt.ok) return c.json({ error: "audit_unavailable" }, 503);
  const made = await workspaceStub(c.env, s.tenantId, scopeId).create(
    {
      id: candidateId(i.targetNodeId, hex8()),
      label: i.title,
      kind: "candidate",
      plane: target.plane,
      origin: "candidate",
      status: "candidate",
      authorId: s.principal.id,
      body: i.body,
      targetNode: i.targetNodeId,
      releaseTarget: i.releaseTarget,
      userValidated: i.userValidated,
      sensitivityFlags: flags,
    },
    s.ctx.now,
  );
  if ("ok" in made) return failResponse(c, made);
  return c.json(
    {
      ok: true,
      receiptId: receipt.receiptId,
      candidateId: made.id,
      status: made.status,
      sensitivity_flags: flags,
    },
    201,
  );
}

const releaseTargetOf = (v: unknown): "scope" | "global" => {
  if (v === undefined) return "scope";
  if (v === "scope" || v === "global") return v;
  throw bad("invalid_release_target");
};

const ackOf = (v: unknown): string[] => {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > 100 || v.some((x) => typeof x !== "string" || x.length > 80))
    throw bad("invalid_acknowledged_flags");
  return v as string[];
};

// ---- projections ----

function collectAccounts(nodes: MapNode[], out: MapNode[]): MapNode[] {
  for (const n of nodes) {
    if (n.kind === "account") out.push(n);
    else if (n.children) collectAccounts(n.children, out);
  }
  return out;
}

const personalKindFor = (r: ItemRecord): PersonalKind => personalKindOf(r.label, r.tags);

const personalView = (
  r: ItemRecord,
  contributed: { scopeId: string; candidateId: string; at: number }[],
) => ({
  id: r.id,
  title: r.label,
  body: r.body ?? "",
  kind: personalKindFor(r),
  updatedAt: new Date(r.updatedAt).toISOString(),
  ...(contributed.length
    ? {
        contributedTo: contributed.map((x) => ({
          scopeId: x.scopeId,
          candidateId: x.candidateId,
          at: new Date(x.at).toISOString(),
        })),
      }
    : {}),
  revision: r.revision,
  status: r.status,
  // Always the server's scan of the current text. A scan done in the browser is never trusted.
  sensitivity_flags: detectSensitivity({ title: r.label, body: r.body }),
});

const FLAG_REASON: Record<SensitivityFlag["type"], string> = {
  email: "Contains an email address",
  phone: "Contains a phone number",
  health: "Mentions health information",
  family: "Mentions family or private life",
  hr: "Mentions HR or pay matters",
};

const STAGE_NAMES = ["Discover", "In design", "Building", "Piloting", "Deployed"] as const;

function accountCards(view: AdmittedView) {
  return collectAccounts(
    toMapView(view, "accounts").hubs.flatMap((h) => h.children),
    [],
  ).map((n) => {
    const vn = view.nodes.get(n.id);
    const facts = vn?.facts ?? {};
    const ai = facts["AI use with client"];
    return {
      id: n.id,
      name: n.label,
      country: facts.Country ?? "",
      region: (vn?.region ? view.nodes.get(vn.region)?.label : undefined) ?? "",
      sector: facts.Sector ?? "",
      status: facts.Status ?? "",
      aiProcessing: ai === "allowed" || ai === "not allowed" ? ai : "unknown",
      openItems: n.counts?.open ?? 0,
      stars: n.counts?.stars ?? 0,
      plane: n.plane,
    };
  });
}

function governanceCards(view: AdmittedView) {
  return governanceStages(view).map((g) => {
    const stages = Object.fromEntries(STAGE_NAMES.map((n) => [n, 0])) as Record<string, number>;
    for (const st of g.stages) stages[st.stage] = st.count;
    return {
      id: g.id,
      label: g.label,
      group: view.nodes.get(g.id)?.group === "cf" ? "Corporate function" : "Business line",
      useCases: g.total,
      stages,
    };
  });
}

const SEED_LIMIT_PER_MIN = 10;

// ---- the router ----

export function v1Routes(deps: AppDeps): Hono<AppEnv> {
  const v1 = new Hono<AppEnv>();
  v1.use("*", limitBody, mutationGuard);

  // Unauthenticated: liveness only, no data.
  v1.get("/health", (c) => c.json({ ok: true, env: c.env.ENVIRONMENT, version: VERSION }));

  // Readiness: Durable Object and R2 reachability. No data, no identity, answers are cached for 5 s.
  v1.get("/ready", async (c) => {
    const body = await readiness(c.env);
    return c.json(body, body.ready ? 200 : 503);
  });

  v1.use("*", authenticate(deps));
  v1.use("*", switchGate);
  v1.route("/admin", opsAdminRoutes(deps));

  // Governance console (B2 GOV): roles, memberships, requests, elevation, NDA grants, audit viewer.
  v1.route("/admin", adminRoutes(deps));

  // Dev only. Needs BOTH a valid Access identity (this route sits behind `authenticate`) AND the
  // SEED_TOKEN secret, compared in constant time. Attempts are rate limited per signed-in user.
  v1.post("/admin/seed", async (c) => {
    if (c.env.ENVIRONMENT !== "dev") throw notFound();
    const secret = c.env.SEED_TOKEN;
    if (!secret) return c.json({ error: "seed_disabled" }, 503);
    const gate = await tenantStub(c.env, c.env.DEFAULT_TENANT_ID).hit(
      `seed:${sess(c).principal.id}`,
      deps.now?.() ?? Date.now(),
      SEED_LIMIT_PER_MIN,
    );
    if (gate.limited) {
      c.header("Retry-After", String(gate.retryAfter));
      return c.json({ error: "rate_limited" }, 429);
    }
    const given = c.req.header("X-Seed-Token") ?? "";
    if (!safeEqual(given, secret)) return c.json({ error: "unauthorized" }, 401);

    const body = await readObject(c, { emptyOk: true });
    const tenantId = typeof body.tenantId === "string" ? body.tenantId : c.env.DEFAULT_TENANT_ID;
    if (!/^[a-z0-9_]{3,64}$/.test(tenantId)) throw bad("invalid_tenant");
    const seed = body.seed === undefined ? DEFAULT_SEED : body.seed;
    if (typeof seed !== "number" || !Number.isSafeInteger(seed)) throw bad("invalid_seed");
    const domain = typeof body.emailDomain === "string" ? body.emailDomain : "example.invalid";
    if (!/^[a-z0-9.-]{3,100}$/.test(domain)) throw bad("invalid_email_domain");

    const summary = await seedTenant(
      c.env,
      { tenantId, seed, emailDomain: domain, now: deps.now?.() ?? Date.now() },
      true,
    );
    return c.json({ ok: true, ...summary });
  });

  v1.get("/me", (c) => {
    const s = sess(c);
    const roles = s.org ? viewOf(s).roles : [];
    // What the rail may show. The server still re-checks every action.
    const capabilities = {
      configure: roles.some((r) => r.grants.some((g) => g.actions.includes("configure"))),
      review: roles.some(
        (r) =>
          !!r.elevation?.actions.includes("review") ||
          r.grants.some(
            (g) => g.actions.includes("review") || g.actions.includes("approve_release"),
          ),
      ),
    };
    const d = s.org ? describe(s.principal, s.org) : { see: [], do: [], never: [] };
    return c.json({
      principal: { id: s.principal.id, email: s.principal.email, roleIds: s.principal.roleIds },
      tenantId: s.tenantId,
      persona: s.persona,
      describe: d,
      env: c.env.ENVIRONMENT,
      capabilities,
      seeded: s.org !== null,
    });
  });

  v1.get("/map", (c) => {
    const lens = c.req.query("lens") ?? "departments";
    if (!(LENSES as readonly string[]).includes(lens)) throw bad("invalid_lens");
    return c.json(toMapView(viewOf(sess(c)), lens as Lens));
  });

  v1.get("/nodes/:id", async (c) => {
    const s = sess(c);
    const id = c.req.param("id");
    if (!NODE_ID.test(id)) throw notFound();
    const view = viewOf(s);
    const detail = toNodeDetail(view, id, s.principal);
    const vn = view.nodes.get(id);
    if (!detail || !vn) throw notFound();

    // Overlay the mutable record (revision, status, comments) from the node's own workspace only.
    let record: unknown = null;
    let comments: unknown[] = [];
    if (vn.leaf && vn.level !== "structure") {
      const ws = wsFor(c, vn);
      const row = await ws.get(id);
      if (row) {
        detail.node.facts.Revision = String(row.revision);
        detail.node.facts.Status = row.status;
        if (vn.level === "content") {
          record = {
            revision: row.revision,
            status: row.status,
            approvals: row.approvals,
            required: row.required,
            mine: row.authorId === s.principal.id,
          };
          comments = (await ws.comments(id, 50)).map((m) => ({
            id: m.id,
            text: m.text,
            at: m.at,
            mine: m.authorId === s.principal.id,
          }));
        }
      }
    }
    return c.json({ ...detail, record, comments });
  });

  v1.get("/search", async (c) => {
    const s = sess(c);
    const q = (c.req.query("q") ?? "").normalize("NFKC").toLowerCase();
    const tokens = (q.match(/[\p{L}\p{N}]+/gu) ?? []).filter((t) => t.length <= 40).slice(0, 8);
    if (!tokens.length || q.length > 200) throw bad("invalid_query");
    const match = tokens.map((t) => `"${t}"*`).join(" ");
    const view = viewOf(s);
    const hits = (
      await Promise.all(
        admittedScopes(view).map((scope) =>
          workspaceStub(c.env, s.tenantId, scope).search(match, SEARCH_LIMIT),
        ),
      )
    ).flat();
    const seen = new Set<string>();
    const results = hits
      .sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id))
      .flatMap((h) => {
        // A hit counts only if the node itself is in the caller's view; labels come from the view.
        const vn = view.nodes.get(h.id);
        if (!vn || seen.has(h.id)) return [];
        seen.add(h.id);
        return [{ id: vn.id, label: vn.label, kind: vn.kind, plane: vn.plane }];
      })
      .slice(0, SEARCH_LIMIT);
    return c.json({ results });
  });

  v1.get("/accounts", (c) => {
    const view = viewOf(sess(c));
    return c.json(accountCards(view));
  });

  v1.get("/accounts/:id", (c) => {
    const view = viewOf(sess(c));
    const id = c.req.param("id");
    const vn = NODE_ID.test(id) ? view.nodes.get(id) : undefined;
    if (vn?.kind !== "account") throw notFound();
    const account = accountCards(view).find((a) => a.id === id);
    if (!account) throw notFound();
    // Sections follow the account's own branches; meetings and bids get a section each.
    const sections: { key: string; label: string; items: unknown[] }[] = [];
    const record = (n: ViewNode) => {
      const l = n.leaf;
      const story = l?.story;
      return {
        id: n.id,
        title: n.label,
        status: l?.status ?? "",
        revision: String(l?.revision ?? 0),
        ...(l?.note ? { note: l.note } : {}),
        ...(story
          ? {
              story: {
                internal: story.internal,
                lesson: story.lesson,
                external: {
                  available: story.extPermission,
                  reason: story.extPermission
                    ? "Customer permission on record"
                    : "No customer permission on record",
                },
              },
            }
          : {}),
      };
    };
    const extra = new Map<string, ViewNode[]>();
    for (const cid of vn.childIds) {
      const ch = view.nodes.get(cid);
      if (!ch) continue;
      if (ch.kind === "branch") {
        sections.push({
          key: cid.slice(id.length + 1),
          label: ch.label,
          items: ch.childIds.flatMap((x) => {
            const leaf = view.nodes.get(x);
            return leaf ? [record(leaf)] : [];
          }),
        });
      } else if (ch.kind === "meeting" || ch.kind === "bid") {
        extra.set(ch.kind, [...(extra.get(ch.kind) ?? []), ch]);
      }
    }
    for (const [kind, nodes] of extra)
      sections.push({
        key: `${kind}s`,
        label: kind === "meeting" ? "Meetings" : "Bids",
        items: nodes.map(record),
      });
    // The directory holds no per-account member list in B1, so members is null.
    return c.json({ account, members: null, sections });
  });

  v1.get("/governances", (c) => c.json(governanceCards(viewOf(sess(c)))));

  v1.get("/governances/:id", (c) => {
    const view = viewOf(sess(c));
    const id = c.req.param("id");
    const governance = governanceCards(view).find((g) => g.id === id);
    if (!governance) throw notFound();
    const useCases: unknown[] = [];
    const walk = (nid: string) => {
      const n = view.nodes.get(nid);
      if (!n) return;
      if (n.kind === "usecase")
        useCases.push({
          id: n.id,
          title: n.label,
          stage: STAGE_NAMES[n.leaf?.stage ?? 0] ?? "Discover",
          evidence: n.leaf?.evidence ?? "unsupported",
        });
      for (const k of n.childIds) walk(k);
    };
    walk(id);
    return c.json({ governance, useCases });
  });

  v1.get("/review", async (c) => {
    const s = sess(c);
    const view = viewOf(s);
    const lists = await Promise.all(
      admittedScopes(view).map((scope) => workspaceStub(c.env, s.tenantId, scope).pending(100)),
    );
    const items = lists.flat().flatMap((r) => {
      const policyNode = r.targetNode ?? r.id;
      const target = view.nodes.get(policyNode);
      if (!target) return [];
      // The contributor never reviews or approves their own item (the policy only sees the target scope).
      if (r.authorId === s.principal.id) return [];
      const review = canDoInView(view, s.principal, policyNode, "review");
      const approve = canDoInView(view, s.principal, policyNode, "approve_release");
      if (!review.allowed && !approve.allowed) return [];
      // Flags are always the server's own scan, stored when the candidate was created.
      const text = r.body ?? r.label;
      return [
        {
          id: r.id,
          nodeId: r.id,
          title: r.label,
          scopeLabel: target.label,
          plane: r.plane,
          author: r.authorId ?? "",
          revision: String(r.revision),
          previousRevision: r.revision > 1 ? String(r.revision - 1) : null,
          submittedAt: new Date(r.createdAt).toISOString(),
          diff: text.split("\n").map((t) => ({ type: "add" as const, text: t })),
          flags: r.sensitivityFlags.map((f) => ({
            kind: f.type,
            span: f.excerpt,
            reason: FLAG_REASON[f.type],
          })),
          twoPerson: { required: r.required > 1, approvals: r.approvals, needed: r.required },
          approve: { allowed: approve.allowed, reason: approve.reason },
          requestChanges: { allowed: review.allowed, reason: review.reason },
          origin: r.origin,
          release: r.releaseTarget,
        },
      ];
    });
    return c.json(items);
  });

  // Most recent edits and releases in the scopes the caller can read.
  v1.get("/activity", async (c) => {
    const s = sess(c);
    const view = viewOf(s);
    const scopes = new Set<string>();
    for (const vn of view.nodes.values()) {
      const sc = vn.level === "content" ? scopeOfNode(vn) : null;
      if (sc && !isPersonalKind(vn.kind)) scopes.add(sc);
    }
    const lists = await Promise.all(
      [...scopes].sort().map((sc) => workspaceStub(c.env, s.tenantId, sc).recent(20)),
    );
    const entries = lists
      .flat()
      .flatMap((e) => {
        const node = view.nodes.get(e.targetNode ?? e.id);
        if (node?.level !== "content") return [];
        return [
          {
            id: `${e.id}@${e.revision}:${e.at}`,
            title: e.label,
            scopeLabel: node.label,
            revision: String(e.revision),
            at: new Date(e.at).toISOString(),
            nodeId: e.targetNode ?? e.id,
          },
        ];
      })
      .sort((x, y) => y.at.localeCompare(x.at))
      .slice(0, 20);
    return c.json(entries);
  });

  // Platform admin (configure) and Auditor only. Structure, never content.
  const canConfigure = (view: AdmittedView) =>
    view.roles.some((r) => r.grants.some((g) => g.actions.includes("configure")));

  v1.get("/admin/roles", async (c) => {
    const s = sess(c);
    const view = viewOf(s);
    if (!canConfigure(view) && !s.principal.roleIds.includes("auditor"))
      return forbidden(c, "Configuration needs the Platform admin");
    const counts = await tenantStub(c.env, s.tenantId).roleCounts();
    const org = requireOrg(s);
    return c.json(
      [...org.roles.values()].map((r) => ({
        id: r.id,
        label: r.label,
        summary: r.summary,
        grants: r.grants,
        exclusions: r.exclusions,
        never: r.never,
        members: counts[r.id] ?? 0,
      })),
    );
  });

  v1.get("/admin/audit", async (c) => {
    const s = sess(c);
    const view = viewOf(s);
    if (!canConfigure(view) && !s.principal.roleIds.includes("auditor"))
      return forbidden(c, "Audit needs the Platform admin or the Auditor");
    const receipts = await fetchReceipts(c.env, s.tenantId, null, 7);
    if (!receipts) return c.json({ error: "audit_unavailable" }, 502);
    return c.json(
      receipts.slice(0, 200).map((r) => ({
        id: r.receiptId,
        at: r.at,
        actor: r.principalId,
        action: r.action,
        scope: r.scopeId ?? r.nodeId ?? "",
        result: r.decision,
      })),
    );
  });

  v1.post("/actions", async (c) => {
    const s = sess(c);
    const body = await readObject(c);
    const nodeId = nodeIdOf(body.nodeId);
    const action = body.action as Action;
    if (typeof action !== "string" || !ACTIONS.includes(action)) throw bad("invalid_action");
    if (action === "view_structure" || action === "view_content") throw bad("not_a_mutation");
    const payload =
      body.payload && typeof body.payload === "object" && !Array.isArray(body.payload)
        ? (body.payload as Record<string, unknown>)
        : {};

    const cand = parseCandidateId(nodeId);
    const policyNode = cand ? cand.targetNodeId : nodeId;
    const view = viewOf(s);
    const vn = view.nodes.get(policyNode);
    // Re-check on the server: the UI's list of allowed actions is advice, not authority.
    const d = canDoInView(view, s.principal, policyNode, action);
    const scopeId = vn ? scopeOfNode(vn) : null;
    if (!vn || !d.allowed) {
      await audit(c, {
        action,
        nodeId,
        scopeId,
        decision: "deny",
        reason: d.reason,
        revision: null,
      });
      return forbidden(c, d.reason);
    }
    if (action === "manage_members" || action === "configure")
      return c.json({ error: "not_supported", reason: "Not available in B1" }, 501);

    if (action === "contribute") {
      return submitCandidate(c, view, {
        targetNodeId: policyNode,
        title: text(payload.title, 1, 200, "invalid_title"),
        body: optText(payload.body, MAX_BODY_TEXT, "invalid_body") ?? null,
        userValidated: parseUserValidated(payload.user_validated, s, 1),
        acknowledged: ackOf(payload.acknowledged_flags),
        releaseTarget: releaseTargetOf(payload.releaseTarget),
      });
    }

    // Validate everything before writing the receipt, so a malformed request leaves no trace.
    let revision: number | null = null;
    let commentText = "";
    let patch: { title?: string; body?: string } = {};
    let verdict = "accept";
    if (action === "comment") commentText = text(payload.text, 1, MAX_TEXT, "invalid_comment");
    if (action === "edit" || action === "review" || action === "approve_release") {
      revision = revisionOf(body.revision);
      if (!cand && !vn.leaf) throw bad("not_an_item");
    }
    if (action === "edit") {
      const title = optText(payload.title, 200, "invalid_title");
      const text2 = optText(payload.body, MAX_BODY_TEXT, "invalid_body");
      if (title === undefined && text2 === undefined) throw bad("nothing_to_edit");
      patch = {
        ...(title !== undefined ? { title } : {}),
        ...(text2 !== undefined ? { body: text2 } : {}),
      };
    }
    if (action === "review") {
      verdict = payload.verdict === undefined ? "accept" : String(payload.verdict);
      if (verdict !== "accept" && verdict !== "changes_requested") throw bad("invalid_verdict");
    }

    const receipt = await audit(c, {
      action,
      nodeId,
      scopeId,
      decision: "allow",
      reason: d.reason,
      revision,
    });
    if (!receipt.ok) return c.json({ error: "audit_unavailable" }, 503);
    const ws = wsFor(c, vn);
    const now = s.ctx.now;
    const rejected = async (f: Fail): Promise<Response> => {
      await audit(c, {
        action,
        nodeId,
        scopeId,
        decision: "rejected",
        reason: f.message,
        revision,
      });
      return failResponse(c, f);
    };

    switch (action) {
      case "comment": {
        const m = await ws.comment(nodeId, s.principal.id, commentText, now);
        return c.json({ ok: true, receiptId: receipt.receiptId, commentId: m.id });
      }
      case "edit": {
        const r = await ws.edit(nodeId, revision as number, patch, now, s.principal.id);
        return "ok" in r && r.ok
          ? c.json({
              ok: true,
              receiptId: receipt.receiptId,
              revision: r.revision,
              status: r.status,
            })
          : rejected(r as Fail);
      }
      case "review": {
        const r = await ws.review(nodeId, revision as number, s.principal.id, verdict, now);
        return r.ok
          ? c.json({ ok: true, receiptId: receipt.receiptId, revision: r.revision })
          : rejected(r);
      }
      case "approve_release": {
        const r = await ws.approve(nodeId, revision as number, s.principal.id, now);
        return r.ok
          ? c.json({
              ok: true,
              receiptId: receipt.receiptId,
              released: r.released,
              approvals: r.approvals,
              required: r.required,
              revision: r.revision,
            })
          : rejected(r);
      }
      default:
        // request_access: the receipt is the record in B1; the steward notification comes with the outbox consumer.
        return c.json({ ok: true, receiptId: receipt.receiptId });
    }
  });

  // ---- Personal Brain: owner only. The workspace is addressed by the caller's own id, never by input. ----

  const personalWs = (c: C) =>
    workspaceStub(c.env, sess(c).tenantId, `personal:${sess(c).principal.id}`);

  v1.get("/personal/items", async (c) => {
    const ws = personalWs(c);
    const rows = await ws.listByKind("personalitem", 200);
    return c.json(
      await Promise.all(rows.map(async (r) => personalView(r, await ws.contributions(r.id)))),
    );
  });

  // Where the caller may contribute, for the share sheet.
  v1.get("/personal/targets", (c) => {
    const s = sess(c);
    const view = viewOf(s);
    const targets = [...view.nodes.values()].flatMap((n) => {
      if (isPersonalKind(n.kind) || !["core", "circle", "account", "department"].includes(n.kind))
        return [];
      if (!canDoInView(view, s.principal, n.id, "contribute").allowed) return [];
      const group =
        n.kind === "circle"
          ? "Circle"
          : n.kind === "account"
            ? "Account"
            : n.kind === "core"
              ? "Company Global"
              : "Department";
      return [{ id: n.id, label: n.label, group }];
    });
    return c.json(targets);
  });

  v1.post("/personal/items", async (c) => {
    const s = sess(c);
    const body = await readObject(c);
    const title = text(body.title, 1, 200, "invalid_title");
    const itemBody = optText(body.body, MAX_BODY_TEXT, "invalid_body") ?? null;
    const kind = body.kind === undefined ? "note" : body.kind;
    if (typeof kind !== "string" || !PERSONAL_KINDS.includes(kind as PersonalKind))
      throw bad("invalid_kind");
    const made = await personalWs(c).create(
      {
        id: `pi:${hex8()}${hex8()}`,
        label: title,
        kind: "personalitem",
        plane: "PERSONAL_HOSTED",
        origin: "personal",
        status: "draft",
        authorId: s.principal.id,
        body: itemBody,
        tags: [kind],
      },
      s.ctx.now,
    );
    if ("ok" in made) return failResponse(c, made);
    return c.json(personalView(made, []), 201);
  });

  v1.post("/personal/items/:id/contribute", async (c) => {
    const s = sess(c);
    const id = c.req.param("id");
    if (!NODE_ID.test(id)) throw notFound();
    const item = await personalWs(c).get(id);
    if (item?.kind !== "personalitem") throw notFound();
    const body = await readObject(c);
    const flags: SensitivityFlag[] = detectSensitivity({ title: item.label, body: item.body });
    // Validation first: the person confirms this exact revision. The flags come back for the pre-share sheet.
    let userValidated: UserValidated;
    try {
      userValidated = parseUserValidated(body.user_validated, s, item.revision);
    } catch (e) {
      if (e instanceof HTTPException && e.status === 422)
        return c.json(
          { error: "user_validation_required", sensitivity_flags: flags, revision: item.revision },
          422,
        );
      throw e;
    }
    const res = await submitCandidate(c, viewOf(s), {
      targetNodeId: nodeIdOf(body.targetScopeId, "invalid_target"),
      title: item.label,
      body: item.body,
      userValidated,
      acknowledged: ackOf(body.acknowledged_flags),
      releaseTarget: releaseTargetOf(body.releaseTarget),
    });
    if (res.status === 201) {
      const made = (await res.clone().json()) as { candidateId: string };
      await personalWs(c).addContribution(
        item.id,
        nodeIdOf(body.targetScopeId, "invalid_target"),
        made.candidateId,
        s.ctx.now,
      );
    }
    return res;
  });

  v1.post("/genui/plan", async (c) => {
    const body = await readObject(c, { emptyOk: true });
    const prompt = optText(body.prompt, MAX_PROMPT, "invalid_prompt");
    const nodeId = body.nodeId === undefined ? undefined : nodeIdOf(body.nodeId);
    const plan = planView(viewOf(sess(c)), {
      ...(prompt !== undefined ? { prompt } : {}),
      ...(nodeId ? { nodeId } : {}),
    });
    if (!plan) throw notFound();
    return c.json(plan);
  });

  // Auditor only. Receipts hold who, what and where, never content.
  v1.get("/audit/receipts", async (c) => {
    const s = sess(c);
    requireOrg(s);
    if (!s.principal.roleIds.includes("auditor"))
      return forbidden(c, "Receipts are for the Auditor role");
    const principal = c.req.query("principal") ?? "";
    if (!/^[A-Za-z0-9_.:@-]{1,128}$/.test(principal)) throw bad("invalid_principal");
    const days = Math.min(Math.max(Number.parseInt(c.req.query("days") ?? "7", 10) || 7, 1), 30);
    const receipts = await fetchReceipts(c.env, s.tenantId, principal, days);
    if (!receipts) return c.json({ error: "audit_unavailable" }, 502);
    await audit(c, {
      action: "audit_read",
      nodeId: null,
      scopeId: null,
      decision: "allow",
      reason: "Auditor read",
      revision: null,
    });
    return c.json({ receipts });
  });

  v1.all("*", (c) => c.json({ error: "not_found" }, 404));
  return v1;
}
