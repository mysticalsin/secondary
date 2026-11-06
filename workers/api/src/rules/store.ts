// Brain rules, kept inside the tenant's TenantPolicy Durable Object (same SQLite database). It holds
// rule definitions, their versions, drafts, held actions and the incident switch. No content, ever.
//
// Two-person steps (publishing a rule that can touch protected brains, every rollback, switching
// incident mode on) go through the one `requestSecond` of TenantPolicy, passed in as `second`.

import {
  diffRules,
  type RuleChange,
  type RuleDoc,
  type RuleDraft,
  type RuleStatus,
  validateRule,
} from "@secondary/policy";

export interface RulesDeps {
  sql: SqlStorage;
  tx: <T>(fn: () => T) => T;
  /** TenantPolicy.requestSecond. */
  second: (key: string, actor: string, now: number, email: string) => "first" | "same" | "second";
  /** TenantPolicy.pendingRequester. */
  pending: (key: string, now: number) => string | null;
  /** Do these two principal ids stand for one person? */
  same: (a: string, b: string) => boolean;
  /** Record the address a principal acted with, so one person holding two ids is recognised. */
  remember: (principalId: string, email: string) => void;
}

export const RULES_TABLES = ["rules", "rule_versions", "rule_drafts"] as const;
/** Not in the snapshot: a restore must never bring back an incident or a held action's approval. */
export const RULES_VOLATILE = ["rule_holds", "incident"] as const;

const INCIDENT_MAX_MS = 24 * 3_600_000;
/** However many times it is extended, an incident ends this long after it began. */
const INCIDENT_CAP_MS = 72 * 3_600_000;
const HOLD_TTL_MS = 24 * 3_600_000;
const MAX_RULES = 200;
const MAX_VERSIONS = 100;

export interface VersionRow {
  version: number;
  status: RuleStatus;
  by: string;
  byLabel: string;
  at: number;
  rolledBackFrom: number | null;
  changes: RuleChange[];
}
export interface StoredRule {
  id: string;
  createdAt: number;
  createdBy: string;
  version: number;
  seeded: boolean;
  published: RuleDraft | null;
  publishedAt: number | null;
  publishedBy: string | null;
  draft: RuleDraft | null;
  draftAt: number | null;
  draftBy: string | null;
  /** Latest edit of either kind. */
  editedAt: number;
  editedBy: string;
}
export type Pending = {
  by: string;
  at: number;
  kind: "publish" | "rollback";
  version: number;
};
export interface Incident {
  on: boolean;
  since: number | null;
  until: number | null;
  by: string | null;
}
export interface Hold {
  id: string;
  rule: string;
  action: string;
  brainId: string;
  requestedBy: string;
  requestedAt: number;
  required: number;
  group: string[];
  approvals: string[];
  status: "pending" | "approved" | "rejected";
  used: boolean;
  expiresAt: number;
  /** What the approvers were shown: a hold covers no more than this. */
  pages: number | null;
  flags: string[];
}

const hex = (n: number): string =>
  [...crypto.getRandomValues(new Uint8Array(n))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

const parse = <T>(s: unknown): T => JSON.parse(s as string) as T;
const parseOr = <T>(s: unknown, d: T): T => (typeof s === "string" ? (JSON.parse(s) as T) : d);

/** SHA-256 of a text, as hex. */
async function sha256(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A hash of a draft (SHA-256), so a second person confirms exactly the draft the first one saw. */
export const draftHash = (d: RuleDraft): Promise<string> => sha256(JSON.stringify(d));

export const RULES_METHODS = [
  "list",
  "get",
  "state",
  "history",
  "versionGet",
  "save",
  "remove",
  "publish",
  "rollback",
  "pendingOf",
  "incident",
  "incidentSet",
  "holdCreate",
  "holdList",
  "holdGet",
  "holdDecide",
  "holdUse",
  "holdRefund",
  "seed",
  "reset",
  "groupGet",
  "groupSet",
] as const;
export type RulesMethod = (typeof RULES_METHODS)[number];

type Fail = { ok: false; code: string; message: string; status: 400 | 404 | 409 | 422 };
const fail = (code: string, message: string, status: Fail["status"] = 409): Fail => ({
  ok: false,
  code,
  message,
  status,
});

export class RulesStore {
  private readonly d: RulesDeps;

  constructor(d: RulesDeps) {
    this.d = d;
    d.sql.exec(`
      CREATE TABLE IF NOT EXISTS rules (
        id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, created_by TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 0, seeded INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS rule_versions (
        rule_id TEXT NOT NULL, version INTEGER NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL,
        by_id TEXT NOT NULL, by_label TEXT NOT NULL, at INTEGER NOT NULL, rolled_back_from INTEGER,
        PRIMARY KEY (rule_id, version));
      CREATE TABLE IF NOT EXISTS rule_drafts (
        rule_id TEXT PRIMARY KEY, body TEXT NOT NULL, by_id TEXT NOT NULL, by_label TEXT NOT NULL,
        at INTEGER NOT NULL);
      -- Not in the snapshot (see RULES_VOLATILE).
      CREATE TABLE IF NOT EXISTS rule_holds (
        id TEXT PRIMARY KEY, rule TEXT NOT NULL, action TEXT NOT NULL, brain_id TEXT NOT NULL,
        requested_by TEXT NOT NULL, requested_at INTEGER NOT NULL, required INTEGER NOT NULL,
        grp TEXT NOT NULL, approvals TEXT NOT NULL, status TEXT NOT NULL,
        used INTEGER NOT NULL DEFAULT 0, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS incident (
        id INTEGER PRIMARY KEY CHECK (id = 1), on_ INTEGER NOT NULL, since INTEGER, until INTEGER, by_id TEXT);
    `);
    // Holds created before a hold carried its size and flags: add the columns once.
    for (const col of ["pages INTEGER", "flags TEXT"])
      try {
        d.sql.exec(`ALTER TABLE rule_holds ADD COLUMN ${col}`);
      } catch {
        // already there
      }
  }

  private get sql(): SqlStorage {
    return this.d.sql;
  }

  // ---- reading ----

  private versionBody(
    id: string,
    version: number,
  ): { body: RuleDraft; at: number; by: string; label: string } | null {
    const r = this.sql
      .exec(
        "SELECT body, at, by_id, by_label FROM rule_versions WHERE rule_id = ? AND version = ?",
        id,
        version,
      )
      .toArray()[0];
    return r
      ? {
          body: parse<RuleDraft>(r.body),
          at: r.at as number,
          by: r.by_id as string,
          label: r.by_label as string,
        }
      : null;
  }

  private stored(r: Record<string, SqlStorageValue>): StoredRule {
    const id = r.id as string;
    const version = r.version as number;
    const pub = version > 0 ? this.versionBody(id, version) : null;
    const dr = this.sql
      .exec("SELECT body, by_id, by_label, at FROM rule_drafts WHERE rule_id = ?", id)
      .toArray()[0];
    const draftAt = dr ? (dr.at as number) : null;
    const pubAt = pub?.at ?? null;
    const edited =
      draftAt !== null && (pubAt === null || draftAt >= pubAt)
        ? { at: draftAt, by: dr?.by_label as string }
        : { at: pubAt ?? (r.created_at as number), by: pub?.label ?? (r.created_by as string) };
    return {
      id,
      createdAt: r.created_at as number,
      createdBy: r.created_by as string,
      version,
      seeded: (r.seeded as number) === 1,
      published: pub?.body ?? null,
      publishedAt: pubAt,
      publishedBy: pub?.label ?? null,
      draft: dr ? parse<RuleDraft>(dr.body) : null,
      draftAt,
      draftBy: dr ? (dr.by_label as string) : null,
      editedAt: edited.at,
      editedBy: edited.by,
    };
  }

  /** The body of one published version (for the authority and validity checks of a rollback). */
  versionGet(id: string, version: number): RuleDraft | null {
    return this.versionBody(id, version)?.body ?? null;
  }

  list(): StoredRule[] {
    return this.sql
      .exec("SELECT * FROM rules ORDER BY created_at, id")
      .toArray()
      .map((r) => this.stored(r));
  }

  get(id: string): StoredRule | null {
    const r = this.sql.exec("SELECT * FROM rules WHERE id = ?", id).toArray()[0];
    return r ? this.stored(r) : null;
  }

  /** What the enforcement points read on every action: published rules and the incident switch. */
  state(now: number): { docs: RuleDoc[]; incident: boolean } {
    const docs: RuleDoc[] = [];
    for (const r of this.sql.exec("SELECT id, version FROM rules WHERE version > 0").toArray()) {
      const v = this.versionBody(r.id as string, r.version as number);
      if (v && v.body.status !== "draft")
        docs.push({ ...v.body, id: r.id as string, version: r.version as number });
    }
    return { docs, incident: this.incident(now).on };
  }

  history(id: string): VersionRow[] {
    const rows = this.sql
      .exec(
        "SELECT version, body, status, by_id, by_label, at, rolled_back_from FROM rule_versions WHERE rule_id = ? ORDER BY version DESC",
        id,
      )
      .toArray();
    return rows.map((r, i) => {
      const prev = rows[i + 1];
      return {
        version: r.version as number,
        status: r.status as RuleStatus,
        by: r.by_id as string,
        byLabel: r.by_label as string,
        at: r.at as number,
        rolledBackFrom: (r.rolled_back_from as number | null) ?? null,
        changes: diffRules(prev ? parse<RuleDraft>(prev.body) : null, parse<RuleDraft>(r.body)),
      };
    });
  }

  // ---- drafts ----

  /** Create (id null) or update a rule's draft. The published version keeps running. */
  save(
    id: string | null,
    body: RuleDraft,
    by: string,
    label: string,
    now: number,
  ): { ok: true; id: string } | Fail {
    return this.d.tx(() => {
      let rid = id;
      if (rid === null) {
        if ((this.sql.exec("SELECT COUNT(*) AS n FROM rules").one().n as number) >= MAX_RULES)
          return fail("too_many_rules", "The tenant has reached its limit of rules");
        rid = `r_${hex(5)}`;
        this.sql.exec(
          "INSERT INTO rules (id, created_at, created_by) VALUES (?, ?, ?)",
          rid,
          now,
          label,
        );
      } else if (!this.get(rid)) return fail("not_found", "No such rule", 404);
      this.sql.exec(
        `INSERT INTO rule_drafts (rule_id, body, by_id, by_label, at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(rule_id) DO UPDATE SET body = excluded.body, by_id = excluded.by_id,
           by_label = excluded.by_label, at = excluded.at`,
        rid,
        JSON.stringify(body),
        by,
        label,
        now,
      );
      // A new draft is a different draft: a first publish confirmation for the old one lapses.
      this.sql.exec("DELETE FROM pending_ops WHERE key LIKE ?", `rulepub:${rid}:%`);
      return { ok: true as const, id: rid };
    });
  }

  /** Only a rule that was never published can be deleted. */
  remove(id: string): { ok: true } | Fail {
    const r = this.get(id);
    if (!r) return fail("not_found", "No such rule", 404);
    if (r.version > 0)
      return fail(
        "published",
        "A published rule cannot be deleted: set it back to draft in a new version",
        409,
      );
    this.d.tx(() => {
      for (const t of ["rules", "rule_drafts"])
        this.sql.exec(`DELETE FROM ${t} WHERE ${t === "rules" ? "id" : "rule_id"} = ?`, id);
      this.sql.exec("DELETE FROM pending_ops WHERE key LIKE ?", `rulepub:${id}:%`);
    });
    return { ok: true };
  }

  // ---- publish and rollback ----

  private writeVersion(
    id: string,
    body: RuleDraft,
    by: string,
    label: string,
    now: number,
    rolledBackFrom: number | null,
  ): number {
    const cur =
      (this.sql.exec("SELECT version FROM rules WHERE id = ?", id).one().version as number) + 1;
    if (cur > MAX_VERSIONS) throw new Error("too_many_versions");
    this.sql.exec(
      "INSERT INTO rule_versions (rule_id, version, body, status, by_id, by_label, at, rolled_back_from) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      id,
      cur,
      JSON.stringify(body),
      body.status,
      by,
      label,
      now,
      rolledBackFrom,
    );
    this.sql.exec("UPDATE rules SET version = ? WHERE id = ?", cur, id);
    this.sql.exec("DELETE FROM rule_drafts WHERE rule_id = ?", id);
    return cur;
  }

  /**
   * Publish the draft as the next version with `status` (monitor or enforced). With `twoPerson` a
   * different person must repeat the call for the same draft within 24 hours. `expectedHash` is the
   * hash of the draft the caller reviewed: a draft that changed since is refused, so nobody confirms
   * a draft they did not see.
   */
  async publish(
    id: string,
    status: RuleStatus,
    a: {
      by: string;
      label: string;
      email: string;
      now: number;
      twoPerson: boolean;
      expectedHash: string;
    },
  ): Promise<
    | { ok: true; applied: true; version: number }
    | { ok: true; applied: false; sameActor: boolean }
    | Fail
  > {
    const r = this.get(id);
    if (!r) return fail("not_found", "No such rule", 404);
    if (!r.draft) return fail("no_draft", "There is no draft to publish", 409);
    if ((await draftHash(r.draft)) !== a.expectedHash)
      return fail("draft_changed", "The draft changed since you opened it. Review it again", 409);
    const body: RuleDraft = { ...r.draft, status };
    if (a.twoPerson) {
      const step = this.d.second(`rulepub:${id}:${await draftHash(body)}`, a.by, a.now, a.email);
      if (step !== "second") return { ok: true, applied: false, sameActor: step === "same" };
    }
    return this.d.tx(() => {
      const version = this.writeVersion(id, body, a.by, a.label, a.now, null);
      this.sql.exec("DELETE FROM pending_ops WHERE key LIKE ?", `rulepub:${id}:%`);
      return { ok: true as const, applied: true as const, version };
    });
  }

  /** A rollback is a new version that copies an older one. Always two people. */
  rollback(
    id: string,
    toVersion: number,
    a: { by: string; label: string; email: string; now: number },
  ):
    | { ok: true; applied: true; version: number }
    | { ok: true; applied: false; sameActor: boolean }
    | Fail {
    const r = this.get(id);
    if (!r) return fail("not_found", "No such rule", 404);
    const old = this.versionBody(id, toVersion);
    if (!old || toVersion === r.version)
      return fail("invalid_version", "Choose an older version", 400);
    // An old version may predate a validator fix: it comes back only if it is valid today.
    const again = validateRule(old.body);
    if (!again.ok)
      return fail(
        "version_not_valid",
        "That version no longer passes the rules for rules. Edit a new one instead",
        422,
      );
    const step = this.d.second(`rulerb:${id}:${toVersion}`, a.by, a.now, a.email);
    if (step !== "second") return { ok: true, applied: false, sameActor: step === "same" };
    return this.d.tx(() => {
      const version = this.writeVersion(id, again.rule, a.by, a.label, a.now, toVersion);
      this.sql.exec("DELETE FROM pending_ops WHERE key LIKE ?", `rulerb:${id}:%`);
      return { ok: true as const, applied: true as const, version };
    });
  }

  /** The two-person step waiting on this rule, if any. */
  async pendingOf(id: string, now: number): Promise<Pending | null> {
    const r = this.get(id);
    if (!r) return null;
    if (r.draft) {
      for (const status of ["draft", "monitor", "enforced"] as const) {
        const key = `rulepub:${id}:${await draftHash({ ...r.draft, status })}`;
        const by = this.d.pending(key, now);
        if (by) return { by, at: this.pendingAt(key), kind: "publish", version: r.version + 1 };
      }
    }
    for (const v of this.history(id)) {
      const by = this.d.pending(`rulerb:${id}:${v.version}`, now);
      if (by)
        return {
          by,
          at: this.pendingAt(`rulerb:${id}:${v.version}`),
          kind: "rollback",
          version: v.version,
        };
    }
    return null;
  }

  private pendingAt(key: string): number {
    const r = this.sql.exec("SELECT requested_at FROM pending_ops WHERE key = ?", key).toArray()[0];
    return (r?.requested_at as number | undefined) ?? 0;
  }

  // ---- incident mode ----

  incident(now: number): Incident {
    const r = this.sql
      .exec("SELECT on_, since, until, by_id FROM incident WHERE id = 1")
      .toArray()[0];
    if (r?.on_ !== 1) return { on: false, since: null, until: null, by: null };
    // Incident mode lapses by itself, so one forgotten switch cannot loosen rules for good.
    if ((r.until as number) <= now) return { on: false, since: null, until: null, by: null };
    return { on: true, since: r.since as number, until: r.until as number, by: r.by_id as string };
  }

  /**
   * On is two-person (the first call is recorded, a different person confirms). Calling On while it is
   * already on is an extension: also two-person, 24 hours more, and never past 72 hours after it began.
   * Off is one admin.
   */
  incidentSet(
    on: boolean,
    a: { by: string; email: string; now: number },
  ):
    | { ok: true; applied: true; incident: Incident }
    | { ok: true; applied: false; sameActor: boolean }
    | Fail {
    const cur = this.incident(a.now);
    if (!on) {
      this.sql.exec("DELETE FROM incident WHERE id = 1");
      this.sql.exec("DELETE FROM pending_ops WHERE key LIKE 'incident:%'");
      return { ok: true, applied: true, incident: this.incident(a.now) };
    }
    const extending = cur.on && cur.since !== null;
    const cap = extending ? (cur.since as number) + INCIDENT_CAP_MS : null;
    if (cap !== null && (cur.until as number) >= cap)
      return fail("incident_max", "Incident mode reached its longest duration. End it.", 409);
    const step = this.d.second(extending ? "incident:extend" : "incident:on", a.by, a.now, a.email);
    if (step !== "second") return { ok: true, applied: false, sameActor: step === "same" };
    this.sql.exec("DELETE FROM pending_ops WHERE key LIKE 'incident:%'");
    if (extending)
      this.sql.exec(
        "UPDATE incident SET until = ? WHERE id = 1",
        Math.min(a.now + INCIDENT_MAX_MS, cap as number),
      );
    else
      this.sql.exec(
        `INSERT INTO incident (id, on_, since, until, by_id) VALUES (1, 1, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET on_ = 1, since = excluded.since, until = excluded.until, by_id = excluded.by_id`,
        a.now,
        a.now + INCIDENT_MAX_MS,
        a.by,
      );
    return { ok: true, applied: true, incident: this.incident(a.now) };
  }

  // ---- held actions (export, share_view: an approval effect with no proposal to wait on) ----

  holdCreate(h: {
    rule: string;
    action: string;
    brainId: string;
    requestedBy: string;
    required: number;
    group: string[];
    pages: number | null;
    flags: string[];
    now: number;
    email?: string;
  }): string {
    if (h.email) this.d.remember(h.requestedBy, h.email);
    // The same person asking for the same thing again reuses the open hold.
    const open = this.sql
      .exec(
        "SELECT id, pages, flags, required FROM rule_holds WHERE rule = ? AND action = ? AND brain_id = ? AND requested_by = ? AND status = 'pending' AND used = 0 AND expires_at > ?",
        h.rule,
        h.action,
        h.brainId,
        h.requestedBy,
        h.now,
      )
      .toArray()
      .find(
        (r) =>
          ((r.pages as number | null) ?? null) === h.pages &&
          (r.required as number) === h.required &&
          JSON.stringify(parseOr<string[]>(r.flags, [])) === JSON.stringify(h.flags),
      );
    if (open) return open.id as string;
    const id = `h_${hex(6)}`;
    this.sql.exec(
      `INSERT INTO rule_holds (id, rule, action, brain_id, requested_by, requested_at, required, grp, approvals, status, used, expires_at, pages, flags)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', 'pending', 0, ?, ?, ?)`,
      id,
      h.rule,
      h.action,
      h.brainId,
      h.requestedBy,
      h.now,
      h.required,
      JSON.stringify(h.group),
      h.now + HOLD_TTL_MS,
      h.pages,
      JSON.stringify(h.flags),
    );
    return id;
  }

  private hold(r: Record<string, SqlStorageValue>): Hold {
    return {
      id: r.id as string,
      rule: r.rule as string,
      action: r.action as string,
      brainId: r.brain_id as string,
      requestedBy: r.requested_by as string,
      requestedAt: r.requested_at as number,
      required: r.required as number,
      group: parse<string[]>(r.grp),
      approvals: parse<string[]>(r.approvals),
      status: r.status as Hold["status"],
      used: (r.used as number) === 1,
      expiresAt: r.expires_at as number,
      pages: (r.pages as number | null) ?? null,
      flags: parseOr<string[]>(r.flags, []),
    };
  }

  holdList(now: number): Hold[] {
    return this.sql
      .exec(
        "SELECT * FROM rule_holds WHERE expires_at > ? AND used = 0 AND status = 'pending' ORDER BY requested_at",
        now,
      )
      .toArray()
      .map((r) => this.hold(r));
  }

  holdGet(id: string): Hold | null {
    const r = this.sql.exec("SELECT * FROM rule_holds WHERE id = ?", id).toArray()[0];
    return r ? this.hold(r) : null;
  }

  /** One approver's verdict. The requester can never decide their own hold. */
  holdDecide(
    id: string,
    decision: "approve" | "reject",
    by: string,
    now: number,
    email = "",
  ): { ok: true; status: Hold["status"]; approvals: number; required: number } | Fail {
    if (email) this.d.remember(by, email);
    const h = this.holdGet(id);
    if (!h || h.expiresAt <= now || h.used) return fail("not_found", "No such held action", 404);
    if (h.status !== "pending") return fail("already_decided", "This action was already decided");
    if (this.d.same(h.requestedBy, by))
      return fail(
        "self_approval",
        "You asked for this action, so a different person must decide it",
      );
    if (h.approvals.some((x) => this.d.same(x, by)))
      return fail("already_done", "You already approved this action");
    if (decision === "reject") {
      this.sql.exec("UPDATE rule_holds SET status = 'rejected' WHERE id = ?", id);
      return { ok: true, status: "rejected", approvals: h.approvals.length, required: h.required };
    }
    const approvals = [...h.approvals, by];
    const status = approvals.length >= h.required ? "approved" : "pending";
    this.sql.exec(
      "UPDATE rule_holds SET approvals = ?, status = ? WHERE id = ?",
      JSON.stringify(approvals),
      status,
      id,
    );
    return { ok: true, status, approvals: approvals.length, required: h.required };
  }

  /**
   * The requester spends an approved hold. Single use, same person, same action and brain, and only
   * for what the approvers saw: the rule in force must be the same one, asking for no more approvals
   * or groups, and the action no bigger and carrying no flag the hold did not have.
   */
  holdUse(
    id: string,
    who: string,
    action: string,
    brainId: string,
    now: number,
    cur: { rule: string; required: number; group: string[]; pages: number | null; flags: string[] },
  ): { ok: true; rule: string } | Fail {
    const h = this.holdGet(id);
    const invalid = fail("hold_invalid", "That approval is not valid", 409);
    if (!h || h.expiresAt <= now) return invalid;
    if (
      h.status !== "approved" ||
      h.used ||
      h.action !== action ||
      h.brainId !== brainId ||
      !this.d.same(h.requestedBy, who)
    )
      return invalid;
    const bigger = cur.pages !== null && (h.pages === null || cur.pages > h.pages);
    const newFlag = cur.flags.some((f) => !h.flags.includes(f));
    const newGroup = cur.group.some((g) => !h.group.includes(g));
    if (cur.rule !== h.rule || cur.required > h.required || newGroup || bigger || newFlag)
      return fail(
        "hold_changed",
        "The rules or the action changed since this was approved. Ask again",
        409,
      );
    const done = this.sql
      .exec("UPDATE rule_holds SET used = 1 WHERE id = ? AND used = 0 RETURNING 1", id)
      .toArray();
    return done.length ? { ok: true, rule: h.rule } : invalid;
  }

  /** The action failed after its approval was spent: hand the approval back. */
  holdRefund(id: string): void {
    this.sql.exec("UPDATE rule_holds SET used = 0 WHERE id = ?", id);
  }

  // ---- the privacy approver group (people an admin named; stewards come from the policy) ----

  groupGet(): string[] {
    const r = this.sql.exec("SELECT v FROM config WHERE k = 'rule_group_privacy'").toArray()[0];
    return r ? parse<string[]>(r.v) : [];
  }

  /**
   * Replace the privacy group. Group rules rest on this list, so changing it is two-person, like
   * weakening a rule: a different admin repeats the same list.
   */
  async groupSet(
    ids: string[],
    a: { by: string; email: string; now: number },
  ): Promise<{ ok: true; applied: true } | { ok: true; applied: false; sameActor: boolean }> {
    const next = [...new Set(ids)].slice(0, 100);
    const key = `rulegrp:${await sha256(JSON.stringify([...next].sort()))}`;
    const cur = this.groupGet();
    const same = cur.length === next.length && next.every((x) => cur.includes(x));
    if (!same) {
      const step = this.d.second(key, a.by, a.now, a.email);
      if (step !== "second") return { ok: true, applied: false, sameActor: step === "same" };
    }
    this.sql.exec(
      "INSERT INTO config (k, v) VALUES ('rule_group_privacy', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v",
      JSON.stringify(next),
    );
    this.sql.exec("DELETE FROM pending_ops WHERE key LIKE 'rulegrp:%'");
    return { ok: true, applied: true };
  }

  // ---- seed (dev only; the caller decides) ----

  /**
   * Insert seed rules that are missing, as published v1 by "System", once per `version`. A rule a
   * person owns is never touched. Returns how many were added.
   */
  seed(docs: { id: string; body: RuleDraft }[], now: number, version: number): number {
    const done = this.sql.exec("SELECT v FROM config WHERE k = 'rules_seed_version'").toArray()[0];
    if (done && Number(done.v) >= version) return 0;
    let added = 0;
    this.d.tx(() => {
      for (const d of docs) {
        if (this.sql.exec("SELECT 1 FROM rules WHERE id = ?", d.id).toArray().length) continue;
        this.sql.exec(
          "INSERT INTO rules (id, created_at, created_by, version, seeded) VALUES (?, ?, 'System', 1, 1)",
          d.id,
          now,
        );
        this.sql.exec(
          "INSERT INTO rule_versions (rule_id, version, body, status, by_id, by_label, at, rolled_back_from) VALUES (?, 1, ?, ?, 'system', 'System', ?, NULL)",
          d.id,
          JSON.stringify(d.body),
          d.body.status,
          now,
        );
        added++;
      }
      this.sql.exec(
        "INSERT INTO config (k, v) VALUES ('rules_seed_version', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v",
        String(version),
      );
    });
    return added;
  }

  /** A reseed empties everything. */
  reset(): void {
    for (const t of [...RULES_TABLES, ...RULES_VOLATILE]) this.sql.exec(`DELETE FROM ${t}`);
    this.sql.exec(
      "DELETE FROM pending_ops WHERE key LIKE 'rulepub:%' OR key LIKE 'rulerb:%' OR key LIKE 'incident:%' OR key LIKE 'rulegrp:%'",
    );
    this.sql.exec("DELETE FROM config WHERE k = 'rules_seed_version'");
  }
}
