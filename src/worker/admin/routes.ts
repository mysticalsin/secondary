// The governance console API: /v1/admin/*. Mounted by routes.ts with one line.
//
// Every route re-checks authority on the server and answers a refusal with `{error, reason}` so the
// console can show the reason. Every mutation writes a content-free audit receipt first (and fails
// closed if the audit service is down). Free text the user typed (reasons, notes) lives in the
// tenant's Durable Object, never in a receipt.

import {
  type AdmittedView,
  canDoInView,
  type Org,
  PERSONAS,
  type Principal,
  type Role,
} from "@secondary/policy";
import { type Context, Hono } from "hono";
import { appendReceipt, fetchReceipts, newReceiptId, type Receipt } from "../audit.ts";
import { warnAuditDenied } from "../ux/util.ts";
import { requireOrg, viewOf } from "../auth.ts";
import { tenantStub } from "../stubs.ts";
import type { AppDeps, AppEnv, Session } from "../types.ts";
import { type GovClient, govClient } from "./client.ts";
import type { AccessRequest, Change, ChangeKind, ChangeStatus, Fail } from "./store.ts";
import { MAX_NDA_MS } from "./store.ts";
import {
  type Bad,
  buildRole,
  isConfigure,
  isSensitiveEdit,
  isSteward,
  manageAuthority,
  noticeLabel,
  type RoleInput,
  type ScopeDesc,
  scopeDescOf,
  scopeKey,
} from "./validate.ts";

type C = Context<AppEnv>;

const ID = /^[A-Za-z0-9_.:@-]{1,128}$/;
const NODE_ID = /^[a-z0-9][a-z0-9_.:-]{0,127}$/;
const ACTION = /^[a-z_.]{1,40}$/;
const MAX_REASON = 200;
const MAX_NOTE = 300;

const sess = (c: C): Session => c.get("session");
/** JSON with sorted keys, so two roles compare equal whatever order their fields were written in. */
const canonical = (v: unknown): string =>
  JSON.stringify(v, (_k, x: unknown) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b)))
      : x,
  );
const isBad = (v: unknown): v is Bad => !!v && typeof v === "object" && (v as Bad).ok === false;

const refuse = (c: C, status: 400 | 403 | 404 | 409 | 422 | 503, error: string, reason: string) =>
  c.json({ error, reason }, status);
const failed = (c: C, f: Fail | Bad) =>
  refuse(c, "status" in f ? f.status : 422, f.code, f.message);

async function body(c: C): Promise<Record<string, unknown> | null> {
  const raw = await c.req.text();
  if (!raw.trim()) return {};
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Trimmed text of 1..max characters, or null. */
const text = (v: unknown, max: number): string | null =>
  typeof v === "string" && v.trim() && v.trim().length <= max ? v.trim() : null;

/**
 * Gregorian leap year. A year divisible by 4 is a leap year, except a century year,
 * unless that century is divisible by 400. 1900-02-29 is not a day. 2000-02-29 is.
 */
function gregorianLeap(year: number): boolean {
  if (year % 400 === 0) return true;
  if (year % 100 === 0) return false;
  return year % 4 === 0;
}

/**
 * A real civil day. Date.parse("2025-02-29") is the same instant as 2025-03-01.
 * packages/contracts has no calendar-day parser, so NDA expiry and the audit bounds share this one.
 * This is the only round trip for that day. The month and day have to fall on that
 * Gregorian date, so February has 29 days only in a leap year.
 */
function realCalendarDay(day: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const date = Number(match[3]);
  if (month < 1 || month > 12) return false;
  const length = [31, gregorianLeap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][
    month - 1
  ];
  return date >= 1 && date <= length;
}

/**
 * Date-only values are UTC midnight, or the end of that UTC day when `end` is set.
 * Owner decision: accept only YYYY-MM-DD and the exact YYYY-MM-DDT00:00:00Z.
 * The pattern is anchored, and it runs before Date.parse, so a numeric offset,
 * a bare Z, or any other suffix cannot store the previous UTC day.
 */
const ADMIN_DAY = /^(\d{4}-\d{2}-\d{2})$/;
const ADMIN_MIDNIGHT = /^(\d{4}-\d{2}-\d{2})T00:00:00Z$/;

function parseAdminDate(v: string, end: boolean): number | null {
  const dateOnly = ADMIN_DAY.exec(v);
  const midnight = ADMIN_MIDNIGHT.exec(v);
  if (!dateOnly && !midnight) return null;
  const day = (dateOnly ?? midnight)?.[1];
  if (!day || !realCalendarDay(day)) return null;
  const iso = dateOnly ? `${day}T${end ? "23:59:59.999" : "00:00:00"}Z` : v;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

type Intent = Omit<
  Receipt,
  "receiptId" | "at" | "tenantId" | "principalId" | "requestId" | "clientId" | "tool"
>;

async function audit(c: C, i: Intent): Promise<boolean> {
  const s = sess(c);
  return appendReceipt(c.env, {
    ...i,
    receiptId: newReceiptId(),
    at: new Date(s.ctx.now).toISOString(),
    tenantId: s.tenantId,
    principalId: s.principal.id,
    requestId: c.get("requestId") ?? null,
    clientId: s.internal?.clientId ?? null,
    tool: s.internal?.tool ?? null,
  });
}

const receipt = (
  action: string,
  decision: Intent["decision"],
  reason: string,
  scopeId: string | null = null,
  revision: number | null = null,
): Intent => ({ action, nodeId: null, scopeId, decision, reason, revision });

/** A refusal on authority: a deny receipt, then 403 with the reason. */
async function deny(c: C, action: string, reason: string, scopeId: string | null = null) {
  const wrote = await audit(c, receipt(action, "deny", reason.slice(0, 280), scopeId));
  if (!wrote) warnAuditDenied(action);
  return refuse(c, 403, "forbidden", reason);
}

/**
 * Run a mutation: allow receipt first (fail closed), then the store call. A store refusal is
 * audited as `rejected` and returned with its reason.
 */
async function mutate<T>(
  c: C,
  m: { action: string; scopeId: string | null; reason: string; revision?: number | null },
  run: () => Promise<({ ok: true } & T) | Fail>,
): Promise<Response> {
  const ok = await audit(c, receipt(m.action, "allow", m.reason, m.scopeId, m.revision ?? null));
  // Remember which address this principal id acted with, so one human holding two ids still counts once (M-08).
  const actor = sess(c);
  if (ok)
    await govClient(c.env, actor.tenantId).remember(actor.principal.id, actor.principal.email);
  if (!ok)
    return refuse(
      c,
      503,
      "audit_unavailable",
      "The audit service is not answering, so nothing was changed.",
    );
  const r = await run();
  if (!r.ok) {
    await audit(c, receipt(m.action, "rejected", r.message.slice(0, 280), m.scopeId));
    return failed(c, r);
  }
  return c.json(r);
}

/** Every circle, department, account and Contacts subspace the roles may manage. */
function manageable(org: Org, roles: readonly Role[]): ScopeDesc[] {
  const out: ScopeDesc[] = [];
  const push = (d: ScopeDesc | Bad) => {
    if (!isBad(d) && manageAuthority(roles, d)) out.push(d);
  };
  for (const n of org.nodes.values()) {
    if (n.kind !== "circle" && n.kind !== "department" && n.kind !== "account") continue;
    push(scopeDescOf(org, n.kind, n.id));
    if (n.kind === "account" && org.nodes.get(`${n.id}:con`))
      push(scopeDescOf(org, n.kind, n.id, "contacts"));
  }
  return out;
}

const descOfKey = (org: Org, key: string): ScopeDesc | null => {
  const [type, id, sub] = key.split(":");
  if (!type || !id) return null;
  const d = scopeDescOf(org, type, id, sub ?? null);
  return isBad(d) ? null : d;
};

interface Who {
  s: Session;
  view: AdmittedView;
  roles: readonly Role[];
  org: Org;
  gov: GovClient;
  admin: boolean;
  auditor: boolean;
  now: number;
}
const who = (c: C): Who => {
  const s = sess(c);
  const view = viewOf(s);
  return {
    s,
    view,
    roles: view.roles,
    org: requireOrg(s),
    gov: govClient(c.env, s.tenantId),
    admin: isConfigure(view.roles),
    auditor: s.principal.roleIds.includes("auditor"),
    now: s.ctx.now,
  };
};

const lines = (k: ChangeKind): string =>
  ({
    role_upsert: "Role edit",
    member_add: "Add member",
    member_remove: "Remove member",
    nda_grant: "NDA named grant",
    nda_revoke: "NDA revoke",
  })[k];

/** Whether `w` could decide this change, ignoring who proposed it. */
function authorityFor(w: Who, c: Change): boolean {
  if (c.kind === "role_upsert") return w.admin;
  const d = descOfKey(w.org, c.scopeKey);
  return d ? manageAuthority(w.roles, d) !== null : false;
}

export function adminRoutes(_deps: AppDeps): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  // ---- who am I here ----

  r.get("/caps", async (c) => {
    const w = who(c);
    const el = eligibility(w.roles);
    return c.json({
      principalId: w.s.principal.id,
      configure: w.admin,
      steward: isSteward(w.roles),
      auditor: w.auditor,
      elevation: el,
    });
  });

  // ---- roles and grants ----

  r.get("/roles", async (c) => {
    const w = who(c);
    if (!w.admin && !w.auditor)
      return refuse(c, 403, "forbidden", "Configuration needs the Platform admin");
    const [{ roles, versions, version }, counts] = await Promise.all([
      w.gov.listRoles(),
      tenantStub(c.env, w.s.tenantId).roleCounts(),
    ]);
    return c.json(
      roles.map((role) => ({
        ...role,
        version: versions[role.id] ?? 1,
        sensitive: isSensitiveEdit(null, role, w.org),
        members: counts[role.id] ?? 0,
        tenantRolesVersion: version,
      })),
    );
  });

  r.get("/roles/:id/history", async (c) => {
    const w = who(c);
    if (!w.admin && !w.auditor)
      return refuse(c, 403, "forbidden", "Role history needs the Platform admin or the Auditor");
    const id = c.req.param("id");
    if (!ID.test(id)) return refuse(c, 404, "not_found", "No such role");
    const h = await w.gov.roleHistory(id);
    return h.length ? c.json(h) : refuse(c, 404, "not_found", "No such role");
  });

  const roleChange = async (c: C, create: boolean): Promise<Response> => {
    const w = who(c);
    const input = await body(c);
    if (!input) return refuse(c, 400, "invalid_json", "The request body must be a JSON object");
    const id = create ? input.id : c.req.param("id");
    const action = "gov.role_upsert.propose";
    if (!w.admin)
      return deny(
        c,
        action,
        "Editing roles needs the Platform admin (configure)",
        typeof id === "string" ? `role:${id}` : null,
      );

    const { roles, versions } = await w.gov.listRoles();
    const base = create ? null : (roles.find((x) => x.id === id) ?? null);
    if (!create && !base) return refuse(c, 404, "not_found", "No such role");
    if (create && roles.some((x) => x.id === id))
      return refuse(c, 409, "role_exists", "A role with that id already exists");
    const baseVersion = base ? (versions[base.id] ?? 0) : 0;
    if (input.baseVersion !== undefined && input.baseVersion !== baseVersion)
      return refuse(
        c,
        409,
        "stale_role",
        "The role changed since you opened it. Reload and edit again",
      );

    const built = buildRole(input as RoleInput, w.org, base);
    if (!built.ok) return failed(c, built);
    if (base && canonical(base) === canonical(built.value))
      return refuse(c, 422, "no_change", "Nothing changed in this role");

    const sensitive = isSensitiveEdit(base, built.value, w.org);
    return mutate(
      c,
      {
        action,
        scopeId: `role:${built.value.id}`,
        reason: sensitive ? "Sensitive role edit: second approver required" : "Role edit",
        revision: baseVersion + 1,
      },
      () =>
        w.gov.propose(
          {
            kind: "role_upsert",
            payload: { role: built.value, create },
            scopeKey: `role:${built.value.id}`,
            scope: null,
            needsSecond: sensitive,
            proposedBy: w.s.principal.id,
            baseVersion,
            label: `Role "${built.value.label}"`,
          },
          w.now,
        ),
    );
  };
  r.post("/roles", (c) => roleChange(c, true));
  r.put("/roles/:id", (c) => roleChange(c, false));

  // ---- pending changes (roles, memberships, NDA grants) ----

  r.get("/changes", async (c) => {
    const w = who(c);
    const status = (c.req.query("status") ?? "") as ChangeStatus | "";
    if (status && !["pending", "applied", "rejected", "withdrawn", "expired"].includes(status))
      return refuse(c, 400, "invalid_status", "Unknown status");
    const keys = w.admin ? null : manageable(w.org, w.roles).map(scopeKey);
    const [changes, people] = await Promise.all([
      w.gov.listChanges(w.now, { status: status || null, scopeKeys: keys, mine: w.s.principal.id }),
      w.admin || keys?.length ? w.gov.principals() : Promise.resolve([]),
    ]);
    // Role edits belong to configure holders and their proposer only.
    const visible = changes.filter(
      (x) => x.kind !== "role_upsert" || w.admin || x.proposedBy === w.s.principal.id,
    );
    const email = new Map(people.map((p) => [p.id, p.email]));
    return c.json(
      visible.map((x) => ({
        ...x,
        title: lines(x.kind),
        targetEmail:
          typeof x.payload.principalId === "string"
            ? (email.get(x.payload.principalId) ?? null)
            : null,
        proposedByEmail: email.get(x.proposedBy) ?? null,
        canDecide:
          x.status === "pending" &&
          x.proposedBy !== w.s.principal.id &&
          x.payload.principalId !== w.s.principal.id &&
          x.requestedBy !== w.s.principal.id &&
          authorityFor(w, x),
        canWithdraw: x.status === "pending" && x.proposedBy === w.s.principal.id,
      })),
    );
  });

  const decideChange =
    (verb: "approve" | "reject") =>
    async (c: C): Promise<Response> => {
      const w = who(c);
      const id = c.req.param("id") ?? "";
      const chg = ID.test(id) ? await w.gov.change(id, w.now) : null;
      if (!chg) return refuse(c, 404, "not_found", "No such change");
      const action = `gov.${chg.kind}.${verb}`;
      if (!authorityFor(w, chg))
        return deny(
          c,
          action,
          chg.kind === "role_upsert"
            ? "Deciding role edits needs the Platform admin"
            : "Deciding this needs a steward of that space or a Platform admin",
          chg.scopeKey,
        );
      const input = await body(c);
      if (!input) return refuse(c, 400, "invalid_json", "The request body must be a JSON object");
      const note = text(input.note, MAX_NOTE);
      if (verb === "reject" && !note)
        return refuse(c, 422, "reason_required", "Give the proposer a reason for the rejection");
      if (chg.proposedBy === w.s.principal.id)
        return deny(
          c,
          action,
          "Two-person rule: you proposed this change, so someone else must decide it",
          chg.scopeKey,
        );
      if (chg.payload.principalId === w.s.principal.id || chg.requestedBy === w.s.principal.id)
        return deny(
          c,
          action,
          "Two-person rule: this change is about you or your request, so someone else must decide it",
          chg.scopeKey,
        );
      return mutate(c, { action, scopeId: chg.scopeKey, reason: `${verb} ${chg.id}` }, () =>
        w.gov.decide(id, verb === "approve", w.s.principal.id, note, w.now),
      );
    };
  r.post("/changes/:id/approve", decideChange("approve"));
  r.post("/changes/:id/reject", decideChange("reject"));

  r.post("/changes/:id/withdraw", async (c) => {
    const w = who(c);
    const id = c.req.param("id");
    const chg = ID.test(id) ? await w.gov.change(id, w.now) : null;
    if (!chg) return refuse(c, 404, "not_found", "No such change");
    if (chg.proposedBy !== w.s.principal.id) {
      const action = `gov.${chg.kind}.withdraw`;
      const wrote = await audit(
        c,
        receipt(action, "rejected", "Only the proposer can withdraw a change", chg.scopeKey),
      );
      if (!wrote)
        return refuse(
          c,
          503,
          "audit_unavailable",
          "The audit service is not answering, so nothing was changed.",
        );
      return refuse(c, 403, "not_proposer", "Only the proposer can withdraw a change");
    }
    return mutate(
      c,
      { action: `gov.${chg.kind}.withdraw`, scopeId: chg.scopeKey, reason: `withdraw ${chg.id}` },
      () => w.gov.withdraw(id, w.s.principal.id, w.now),
    );
  });

  // ---- directory and memberships ----

  r.get("/principals", async (c) => {
    const w = who(c);
    if (!w.admin && !isSteward(w.roles))
      return refuse(c, 403, "forbidden", "The directory is for stewards and Platform admins");
    return c.json(await w.gov.principals());
  });

  r.get("/scopes", (c) => {
    const w = who(c);
    return c.json(
      manageable(w.org, w.roles).map((d) => ({
        key: scopeKey(d),
        type: d.type,
        id: d.id,
        label: d.subspace ? `${d.label} / ${d.subspace}` : d.label,
        subspace: d.subspace,
        restricted: d.restricted,
        nda: d.nda,
        authority: manageAuthority(w.roles, d),
      })),
    );
  });

  r.get("/memberships", async (c) => {
    const w = who(c);
    const d = scopeDescOf(
      w.org,
      c.req.query("type") ?? "",
      c.req.query("id") ?? "",
      c.req.query("subspace") ?? null,
    );
    if (isBad(d)) return failed(c, d);
    if (!manageAuthority(w.roles, d))
      return refuse(
        c,
        403,
        "forbidden",
        `Members of ${d.label} are for its steward or a Platform admin`,
      );
    return c.json({
      scope: { key: scopeKey(d), label: d.label, restricted: d.restricted },
      members: await w.gov.members(d.type, d.id),
    });
  });

  r.post("/memberships", async (c) => {
    const w = who(c);
    const input = await body(c);
    if (!input) return refuse(c, 400, "invalid_json", "The request body must be a JSON object");
    const op = input.op;
    if (op !== "add" && op !== "remove") return refuse(c, 400, "invalid_op", "op is add or remove");
    const principalId =
      typeof input.principalId === "string" && ID.test(input.principalId)
        ? input.principalId
        : null;
    if (!principalId) return refuse(c, 400, "invalid_principal", "principalId is required");
    const sub = typeof input.subspace === "string" ? input.subspace : null;
    const d = scopeDescOf(w.org, String(input.scope_type), String(input.scope_id), sub);
    if (isBad(d)) return failed(c, d);
    const action = `gov.member_${op}.propose`;
    const auth = manageAuthority(w.roles, d);
    if (!auth)
      return deny(
        c,
        action,
        `Membership changes on ${d.label} need its steward or a Platform admin`,
        scopeKey(d),
      );
    const current = await w.gov.members(d.type, d.id);
    const isMember = current.some((m) => m.principalId === principalId);
    if (op === "add" && isMember)
      return refuse(c, 409, "already_member", "That person is already a member");
    if (op === "remove" && !isMember)
      return refuse(c, 409, "not_a_member", "That person is not a member");
    return mutate(
      c,
      {
        action,
        scopeId: scopeKey(d),
        reason: d.restricted ? "Restricted scope: second approver required" : `${auth} change`,
      },
      () =>
        w.gov.propose(
          {
            kind: op === "add" ? "member_add" : "member_remove",
            payload: { principalId, scope: { type: d.type, id: d.id }, subspace: d.subspace },
            scopeKey: scopeKey(d),
            scope: d,
            needsSecond: d.restricted,
            proposedBy: w.s.principal.id,
            label: `${op === "add" ? "Adding" : "Removing"} a member of ${noticeLabel(d)}`,
          },
          w.now,
        ),
    );
  });

  // ---- NDA named grants ----

  r.get("/nda", async (c) => {
    const w = who(c);
    const accounts = manageable(w.org, w.roles).filter((d) => d.nda && !d.subspace);
    if (!w.auditor && !accounts.length)
      return refuse(
        c,
        403,
        "forbidden",
        "NDA grants are for the account's steward, a Platform admin or the Auditor",
      );
    const only = c.req.query("account") ?? null;
    if (only !== null && !NODE_ID.test(only))
      return refuse(c, 400, "invalid_account", "Unknown account");
    const ok = new Set(accounts.map((a) => a.id));
    const grants = (await w.gov.ndaGrants(w.now, only)).filter(
      (g) => w.auditor || ok.has(g.accountId),
    );
    return c.json({
      accounts: accounts.map((a) => ({ id: a.id, label: a.label })),
      grants,
    });
  });

  r.post("/nda", async (c) => {
    const w = who(c);
    const input = await body(c);
    if (!input) return refuse(c, 400, "invalid_json", "The request body must be a JSON object");
    const principalId =
      typeof input.principalId === "string" && ID.test(input.principalId)
        ? input.principalId
        : null;
    const accountId = typeof input.accountId === "string" ? input.accountId : "";
    if (!principalId) return refuse(c, 400, "invalid_principal", "principalId is required");
    const d = scopeDescOf(w.org, "account", accountId);
    if (isBad(d)) return failed(c, d);
    if (!d.nda)
      return refuse(
        c,
        422,
        "not_nda",
        "That account is not under an NDA, so it needs no named grant",
      );
    const action = "gov.nda_grant.propose";
    if (!manageAuthority(w.roles, d))
      return deny(
        c,
        action,
        `NDA grants on ${d.label} need its steward or a Platform admin`,
        scopeKey(d),
      );
    const reason = text(input.reason, MAX_REASON);
    if (!reason) return refuse(c, 422, "reason_required", "Give a reason of up to 200 characters");
    const expiryText = typeof input.expiresAt === "string" ? input.expiresAt.trim() : "";
    if (!expiryText) return refuse(c, 422, "expiry_required", "Give an expiry date");
    const expiresAt = parseAdminDate(expiryText, false);
    if (expiresAt === null)
      return refuse(c, 422, "invalid_date", "Give a real calendar day");
    if (expiresAt <= w.now)
      return refuse(c, 422, "expiry_past", "The expiry must be in the future");
    if (expiresAt > w.now + MAX_NDA_MS)
      return refuse(c, 422, "expiry_too_far", "A named grant lasts at most one year");
    return mutate(
      c,
      { action, scopeId: scopeKey(d), reason: "NDA grants always need a second approver" },
      () =>
        w.gov.propose(
          {
            kind: "nda_grant",
            payload: { principalId, accountId, reason, expiresAt },
            scopeKey: scopeKey(d),
            scope: d,
            needsSecond: true,
            proposedBy: w.s.principal.id,
            label: `A named NDA grant on ${noticeLabel(d)}`,
          },
          w.now,
        ),
    );
  });

  r.post("/nda/revoke", async (c) => {
    const w = who(c);
    const input = await body(c);
    if (!input) return refuse(c, 400, "invalid_json", "The request body must be a JSON object");
    const principalId =
      typeof input.principalId === "string" && ID.test(input.principalId)
        ? input.principalId
        : null;
    const d = scopeDescOf(w.org, "account", String(input.accountId ?? ""));
    if (!principalId) return refuse(c, 400, "invalid_principal", "principalId is required");
    if (isBad(d)) return failed(c, d);
    const action = "gov.nda_revoke.apply";
    if (!manageAuthority(w.roles, d))
      return deny(
        c,
        action,
        `NDA grants on ${d.label} need its steward or a Platform admin`,
        scopeKey(d),
      );
    const has = (await w.gov.ndaGrants(w.now, d.id)).some((g) => g.principalId === principalId);
    if (!has)
      return refuse(c, 404, "not_found", "That person holds no named grant on this account");
    // Taking access away needs no second person: it only ever narrows what someone can see.
    return mutate(
      c,
      { action, scopeId: scopeKey(d), reason: "Revoking narrows access: one person suffices" },
      () =>
        w.gov.propose(
          {
            kind: "nda_revoke",
            payload: { principalId, accountId: d.id },
            scopeKey: scopeKey(d),
            scope: d,
            needsSecond: false,
            proposedBy: w.s.principal.id,
            label: "An NDA revoke",
          },
          w.now,
        ),
    );
  });

  // ---- elevation ----

  const eligibility = (roles: readonly Role[]) => {
    const withEl = roles.filter((x) => x.elevation);
    const best = withEl.sort((a, b) => (b.elevation?.hours ?? 0) - (a.elevation?.hours ?? 0))[0];
    return best?.elevation
      ? {
          roleId: best.id,
          actions: best.elevation.actions,
          maxHours: best.elevation.hours,
          needsApproval: !!best.elevation.approval,
        }
      : null;
  };

  r.get("/elevation", async (c) => {
    const w = who(c);
    const active = await w.gov.activeElevation(w.s.principal.id, w.now);
    const pending =
      (await w.gov.listElevations(w.now, w.s.principal.id, "pending"))[0] ?? null;
    return c.json({
      eligible: eligibility(w.roles),
      active: active
        ? {
            id: active.id,
            reason: active.reason,
            until: active.until,
            secondsLeft: Math.max(0, Math.floor(((active.until ?? 0) - w.now) / 1000)),
          }
        : null,
      pending,
    });
  });

  r.get("/elevations", async (c) => {
    const w = who(c);
    const all = await w.gov.listElevations(w.now, w.admin ? null : w.s.principal.id);
    const people = w.admin
      ? new Map((await w.gov.principals()).map((p) => [p.id, p.email]))
      : new Map<string, string>();
    return c.json(
      all.map((e) => ({
        ...e,
        email: people.get(e.principalId) ?? null,
        canDecide: e.status === "pending" && w.admin && e.principalId !== w.s.principal.id,
        canEnd: e.status === "active" && (w.admin || e.principalId === w.s.principal.id),
      })),
    );
  });

  r.post("/elevations", async (c) => {
    const w = who(c);
    const input = await body(c);
    if (!input) return refuse(c, 400, "invalid_json", "The request body must be a JSON object");
    const el = eligibility(w.roles);
    if (!el) return deny(c, "gov.elev.request", "None of your roles can be elevated");
    const reason = text(input.reason, MAX_REASON);
    if (!reason) return refuse(c, 422, "reason_required", "State why you need elevated access");
    const hours = typeof input.hours === "number" ? input.hours : Number.NaN;
    if (!Number.isInteger(hours) || hours < 1)
      return refuse(c, 422, "invalid_hours", "Ask for a whole number of hours");
    return mutate(
      c,
      {
        action: "gov.elev.request",
        scopeId: null,
        reason: el.needsApproval ? `${hours}h, approval required` : `${hours}h, starts now`,
      },
      () =>
        w.gov.requestElevation(
          {
            principalId: w.s.principal.id,
            hours,
            reason,
            maxHours: el.maxHours,
            needsApproval: el.needsApproval,
          },
          w.now,
        ),
    );
  });

  const decideElevation =
    (verb: "approve" | "deny") =>
    async (c: C): Promise<Response> => {
      const w = who(c);
      const action = `gov.elev.${verb}`;
      if (!w.admin) return deny(c, action, "Deciding elevation requests needs the Platform admin");
      const input = await body(c);
      if (!input) return refuse(c, 400, "invalid_json", "The request body must be a JSON object");
      const note = text(input.note, MAX_NOTE);
      if (verb === "deny" && !note)
        return refuse(c, 422, "reason_required", "Give the requester a reason");
      const id = c.req.param("id") ?? "";
      return mutate(c, { action, scopeId: null, reason: `${verb} ${id}`.slice(0, 280) }, () =>
        w.gov.decideElevation(id, verb === "approve", w.s.principal.id, note, w.now),
      );
    };
  r.post("/elevations/:id/approve", decideElevation("approve"));
  r.post("/elevations/:id/deny", decideElevation("deny"));

  r.post("/elevations/:id/end", async (c) => {
    const w = who(c);
    const id = c.req.param("id");
    const own = (await w.gov.listElevations(w.now, w.s.principal.id)).some((e) => e.id === id);
    if (!own && !w.admin)
      return deny(
        c,
        "gov.elev.end",
        "Only the person elevated or a Platform admin can end a window",
      );
    return mutate(
      c,
      { action: "gov.elev.end", scopeId: null, reason: `end ${id}`.slice(0, 280) },
      () => w.gov.endElevation(id, w.now),
    );
  });

  // ---- access requests ----

  r.post("/access-requests", async (c) => {
    const w = who(c);
    const input = await body(c);
    if (!input) return refuse(c, 400, "invalid_json", "The request body must be a JSON object");
    const nodeId =
      typeof input.nodeId === "string" && NODE_ID.test(input.nodeId) ? input.nodeId : null;
    if (!nodeId) return refuse(c, 400, "invalid_node", "nodeId is required");
    const reason = text(input.reason, MAX_REASON);
    if (!reason) return refuse(c, 422, "reason_required", "Say why you need access");
    const p: Principal = w.s.principal;
    const vn = w.view.nodes.get(nodeId);
    const dec = canDoInView(w.view, p, nodeId, "request_access");
    if (!vn || !dec.allowed) return deny(c, "gov.access.request", dec.reason, null);
    const type =
      vn.kind === "department"
        ? "department"
        : vn.kind === "circle"
          ? "circle"
          : vn.account
            ? "account"
            : null;
    const id = type === "department" ? vn.dept : type === "circle" ? vn.circle : vn.account;
    const d = type && id ? scopeDescOf(w.org, type, id) : null;
    if (!d || isBad(d))
      return refuse(
        c,
        422,
        "unsupported_node",
        "Access to this node is requested through its space",
      );
    return mutate(
      c,
      {
        action: "gov.access.request",
        scopeId: scopeKey(d),
        reason: "Request sent to the steward queue",
      },
      () => w.gov.createRequest({ principalId: p.id, nodeId, scope: d, reason }, w.now),
    );
  });

  const requestView = (w: Who, x: AccessRequest, people: Map<string, string>) => ({
    ...x,
    requesterEmail: people.get(x.principalId) ?? null,
    canDecide:
      x.status === "pending" &&
      x.principalId !== w.s.principal.id &&
      (() => {
        const d = descOfKey(w.org, x.scopeKey);
        return d ? manageAuthority(w.roles, d) !== null : false;
      })(),
  });

  r.get("/access-requests", async (c) => {
    const w = who(c);
    const queue = c.req.query("view") === "queue";
    const status = (c.req.query("status") ?? "") as AccessRequest["status"] | "";
    if (!queue)
      return c.json(
        (await w.gov.listRequests({ principalId: w.s.principal.id, status: status || null })).map(
          (x) => requestView(w, x, new Map()),
        ),
      );
    const keys = w.admin ? null : manageable(w.org, w.roles).map(scopeKey);
    if (keys && !keys.length)
      return refuse(c, 403, "forbidden", "The queue is for stewards of a space or Platform admins");
    const people = new Map((await w.gov.principals()).map((x) => [x.id, x.email]));
    const all = await w.gov.listRequests({ scopeKeys: keys, status: status || null });
    return c.json(all.map((x) => requestView(w, x, people)));
  });

  r.post("/access-requests/:id/approve", async (c) => {
    const w = who(c);
    const id = c.req.param("id");
    const req = ID.test(id) ? await w.gov.request(id) : null;
    if (!req) return refuse(c, 404, "not_found", "No such request");
    const d = descOfKey(w.org, req.scopeKey);
    const action = "gov.access.approve";
    if (!d || !manageAuthority(w.roles, d))
      return deny(
        c,
        action,
        `Deciding access to ${req.scopeLabel} needs its steward or a Platform admin`,
        req.scopeKey,
      );
    if (req.principalId === w.s.principal.id)
      return deny(c, action, "You cannot decide your own request", req.scopeKey);
    return mutate(
      c,
      {
        action,
        scopeId: req.scopeKey,
        reason: d.restricted
          ? "Restricted: membership needs a second approver"
          : "Membership added",
      },
      async () => {
        const marked = await w.gov.markApproved(id, w.s.principal.id, w.now);
        if (!marked.ok) return marked;
        if ((await w.gov.members(d.type, d.id)).some((m) => m.principalId === req.principalId)) {
          const reopened = await w.gov.reopenRequest(id);
          if (!reopened.ok) return reopened;
          return {
            ok: false as const,
            status: 409 as const,
            code: "already_member",
            message: "That person is already a member",
          };
        }
        const out = await w.gov.propose(
          {
            kind: "member_add",
            payload: {
              principalId: req.principalId,
              scope: { type: d.type, id: d.id },
              subspace: d.subspace,
            },
            scopeKey: req.scopeKey,
            scope: d,
            needsSecond: d.restricted,
            proposedBy: w.s.principal.id,
            requestId: id,
            label: `Access for a requester to ${noticeLabel(d)}`,
          },
          w.now,
        );
        if (!out.ok) {
          const reopened = await w.gov.reopenRequest(id);
          if (!reopened.ok) return reopened;
        }
        return out.ok
          ? {
              ok: true as const,
              request: await w.gov.request(id),
              change: out.change,
              applied: out.applied,
            }
          : out;
      },
    );
  });

  r.post("/access-requests/:id/deny", async (c) => {
    const w = who(c);
    const id = c.req.param("id");
    const req = ID.test(id) ? await w.gov.request(id) : null;
    if (!req) return refuse(c, 404, "not_found", "No such request");
    const d = descOfKey(w.org, req.scopeKey);
    const action = "gov.access.deny";
    if (!d || !manageAuthority(w.roles, d))
      return deny(
        c,
        action,
        `Deciding access to ${req.scopeLabel} needs its steward or a Platform admin`,
        req.scopeKey,
      );
    const input = await body(c);
    if (!input) return refuse(c, 400, "invalid_json", "The request body must be a JSON object");
    const note = text(input.note, MAX_NOTE);
    if (!note)
      return refuse(c, 422, "reason_required", "Give the requester a reason for the denial");
    return mutate(c, { action, scopeId: req.scopeKey, reason: `deny ${id}` }, () =>
      w.gov.denyRequest(id, w.s.principal.id, note, w.now),
    );
  });

  // ---- in-app notifications ----

  // A dev persona also reads the inbox of the seeded person it stands for (see `inbox` in the store).
  const inboxIds = (c: C): string[] => {
    const s = sess(c);
    return s.persona ? [s.principal.id, PERSONAS[s.persona].id] : [s.principal.id];
  };

  r.get("/notifications", async (c) => c.json(await who(c).gov.inbox(inboxIds(c))));

  r.post("/notifications/read", async (c) => {
    const w = who(c);
    const input = await body(c);
    if (!input) return refuse(c, 400, "invalid_json", "The request body must be a JSON object");
    const ids = input.ids;
    if (!Array.isArray(ids) || !ids.every((x) => typeof x === "number" && Number.isInteger(x)))
      return refuse(c, 400, "invalid_ids", "ids must be an array of integers");
    return c.json({ ok: true, unread: await w.gov.markRead(inboxIds(c), ids, w.now) });
  });

  // ---- audit viewer ----

  r.get("/audit", async (c) => {
    const w = who(c);
    if (!w.admin && !w.auditor)
      return refuse(c, 403, "forbidden", "Audit needs the Platform admin or the Auditor");
    const principal = c.req.query("principal") ?? null;
    if (principal !== null && !ID.test(principal))
      return refuse(c, 400, "invalid_principal", "Unknown principal id");
    const action = c.req.query("action") ?? null;
    if (action !== null && !ACTION.test(action))
      return refuse(c, 400, "invalid_action", "Unknown action filter");
    const parse = (v: string | undefined, end: boolean): number | null | "bad" => {
      if (!v) return null;
      const t = parseAdminDate(v, end);
      return t === null ? "bad" : t;
    };
    const from = parse(c.req.query("from"), false);
    const to = parse(c.req.query("to"), true);
    if (from === "bad" || to === "bad")
      return refuse(c, 400, "invalid_date", "Dates are YYYY-MM-DD");
    const days = Math.min(
      30,
      Math.max(1, from === null ? 7 : Math.ceil((w.now - from) / 86_400_000) + 1),
    );
    const limit = Math.min(
      500,
      Math.max(1, Number.parseInt(c.req.query("limit") ?? "200", 10) || 200),
    );
    const all = await fetchReceipts(c.env, w.s.tenantId, principal, days);
    if (!all) return refuse(c, 503, "audit_unavailable", "The audit service is not answering");
    const wrote = await audit(c, receipt("gov.audit.read", "allow", "Audit viewer read"));
    if (!wrote)
      return refuse(c, 503, "audit_unavailable", "The audit service is not answering");
    const rows = all
      .filter((x) => {
        const t = Date.parse(x.at);
        return (
          (from === null || t >= from) &&
          (to === null || t <= to) &&
          (action === null || x.action === action || x.action.startsWith(`${action}.`))
        );
      })
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, limit);
    return c.json(
      rows.map((x) => ({
        id: x.receiptId,
        at: x.at,
        actor: x.principalId,
        action: x.action,
        scope: x.scopeId ?? x.nodeId ?? "",
        result: x.decision,
        reason: x.reason,
        revision: x.revision,
      })),
    );
  });

  return r;
}
