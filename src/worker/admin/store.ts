// Governance state, kept inside the tenant's TenantPolicy Durable Object (same SQLite database, so
// a role or membership change and the revocation epoch bump are one atomic step). It holds no
// organisation content: roles as data, pending changes, elevations, access requests, an inbox.
//
// Two-person rule, enforced here as the last line of defence: the person who proposes a change can
// never be the one who approves it, whatever the route above decided.

import type { Role } from "@secondary/policy";
import { actorFromDirectory, type DirectoryPrincipal, normalEmail, sameActor } from "../../state/actor.ts";
import {
  claimAccessRequest,
  commitAccessRequest,
  decodeAccessRequest,
} from "../../state/access-request.ts";
import {
  claimElevation,
  commitElevation,
  decodeElevation,
  effectiveStatus,
  type ElevationState,
} from "../../state/elevation.ts";
import { claimGovernance, commitGovernance, readGovernance } from "../../state/governance.ts";
import type { SecurityJournal } from "../security-journal.ts";
import { manageAuthority, noticeLabel, type ScopeDesc } from "./validate.ts";

export type ChangeKind =
  | "role_upsert"
  | "member_add"
  | "member_remove"
  | "nda_grant"
  | "nda_revoke";
export type ChangeStatus = "pending" | "applied" | "rejected" | "withdrawn" | "expired" | "unknown";

export interface Change {
  id: string;
  kind: ChangeKind;
  status: ChangeStatus;
  payload: Record<string, unknown>;
  scopeKey: string;
  needsSecond: boolean;
  proposedBy: string;
  proposedAt: number;
  expiresAt: number;
  decidedBy: string | null;
  decidedAt: number | null;
  note: string | null;
  baseVersion: number | null;
  /** The requester of the access request this change fulfils, if any. */
  requestedBy?: string | null;
}

export type ElevationStatus = "pending" | "active" | "denied" | "ended" | "expired";
export interface ElevationRequest {
  id: string;
  principalId: string;
  hours: number;
  reason: string;
  status: ElevationStatus;
  requestedAt: number;
  /** A pending request lapses at this time. */
  lapsesAt: number;
  decidedBy: string | null;
  decidedAt: number | null;
  note: string | null;
  /** Start of the active window is decidedAt (or requestedAt). The window ends here. */
  until: number | null;
}

export type RequestStatus = "pending" | "approved" | "granted" | "denied";
export interface AccessRequest {
  id: string;
  principalId: string;
  nodeId: string;
  scopeKey: string;
  scope: { type: ScopeDesc["type"]; id: string; subspace: string | null };
  scopeLabel: string;
  reason: string;
  status: RequestStatus;
  createdAt: number;
  decidedBy: string | null;
  decidedAt: number | null;
  note: string | null;
  changeId: string | null;
}

export interface Notification {
  id: number;
  kind: string;
  title: string;
  ref: string | null;
  at: number;
  read: boolean;
}

export type Fail = {
  ok: false;
  code: string;
  message: string;
  status: 400 | 403 | 404 | 409 | 422;
};
const fail = (status: Fail["status"], code: string, message: string): Fail => ({
  ok: false,
  code,
  message,
  status,
});

/**
 * One page: the filter is in the WHERE clause, then the limit. A limit taken first
 * drops an older row that still matches.
 */
function page(
  sql: SqlStorage,
  table: string,
  where: readonly string[],
  args: readonly SqlStorageValue[],
  order: string,
  limit: number,
): Row[] {
  const clause = where.length ? ` WHERE ${where.join(" AND ")}` : "";
  return sql
    .exec(`SELECT * FROM ${table}${clause} ORDER BY ${order} LIMIT ?`, ...args, limit)
    .toArray() as Row[];
}

/** Effective governance status. A pending row at or past its expiry reads as expired. */
function changeStatusSql(status: string, now: number): { sql: string; args: SqlStorageValue[] } {
  if (status === "pending") return { sql: "status = 'pending' AND expires_at > ?", args: [now] };
  if (status === "expired")
    return {
      sql: "(status = 'expired' OR (status = 'pending' AND expires_at <= ?))",
      args: [now],
    };
  if (status === "unknown")
    return {
      sql: "status NOT IN ('pending', 'applied', 'rejected', 'withdrawn', 'expired')",
      args: [],
    };
  return { sql: "status = ?", args: [status] };
}

/** Effective elevation status. An active row with no end, or an end already reached, reads as expired. */
function elevationStatusSql(status: string, now: number): { sql: string; args: SqlStorageValue[] } {
  if (status === "active")
    return { sql: "status = 'active' AND until IS NOT NULL AND until > ?", args: [now] };
  if (status === "pending") return { sql: "status = 'pending' AND lapses_at > ?", args: [now] };
  if (status === "expired")
    return {
      sql: `(status = 'expired'
        OR (status = 'pending' AND lapses_at <= ?)
        OR (status = 'active' AND (until IS NULL OR until <= ?))
        OR status NOT IN ('pending', 'active', 'denied', 'ended', 'expired'))`,
      args: [now, now],
    };
  return { sql: "status = ?", args: [status] };
}

export const CHANGE_TTL_MS = 72 * 3_600_000;
export const ELEVATION_REQUEST_TTL_MS = 24 * 3_600_000;
export const MAX_NDA_MS = 365 * 24 * 3_600_000;
const HOUR = 3_600_000;

type Row = Record<string, SqlStorageValue>;
const s = (v: SqlStorageValue | undefined): string =>
  v === null || v === undefined ? "" : String(v);
const n = (v: SqlStorageValue | undefined): number => Number(v ?? 0);
const sn = (v: SqlStorageValue | undefined): string | null =>
  v === null || v === undefined ? null : String(v);
const nn = (v: SqlStorageValue | undefined): number | null =>
  v === null || v === undefined ? null : Number(v);
const newId = (p: string): string => `${p}_${crypto.randomUUID().slice(0, 8)}`;

const toChange = (r: Row, now: number): Change => {
  const read = readGovernance(r.status, n(r.expires_at), now);
  return {
    id: s(r.id),
    kind: s(r.kind) as ChangeKind,
    status: read.tag,
    payload: JSON.parse(s(r.payload)) as Record<string, unknown>,
    scopeKey: s(r.scope_key),
    needsSecond: n(r.needs_second) === 1,
    proposedBy: s(r.proposed_by),
    proposedAt: n(r.proposed_at),
    expiresAt: n(r.expires_at),
    decidedBy: sn(r.decided_by),
    decidedAt: nn(r.decided_at),
    note: sn(r.note),
    baseVersion: nn(r.base_version),
  };
};

const toElevation = (r: Row, now: number): ElevationRequest => {
  const until = nn(r.until);
  const read = effectiveStatus({ status: s(r.status), lapsesAt: n(r.lapses_at), until }, now);
  const status = (read.tag === "unknown" ? s(r.status) : read.tag) as ElevationStatus;
  return {
    id: s(r.id),
    principalId: s(r.principal_id),
    hours: n(r.hours),
    reason: s(r.reason),
    status,
    requestedAt: n(r.requested_at),
    lapsesAt: n(r.lapses_at),
    decidedBy: sn(r.decided_by),
    decidedAt: nn(r.decided_at),
    note: sn(r.note),
    until,
  };
};

const toRequest = (r: Row): AccessRequest => ({
  id: s(r.id),
  principalId: s(r.principal_id),
  nodeId: s(r.node_id),
  scopeKey: s(r.scope_key),
  scope: JSON.parse(s(r.scope)) as AccessRequest["scope"],
  scopeLabel: s(r.scope_label),
  reason: s(r.reason),
  status: s(r.status) as RequestStatus,
  createdAt: n(r.created_at),
  decidedBy: sn(r.decided_by),
  decidedAt: nn(r.decided_at),
  note: sn(r.note),
  changeId: sn(r.change_id),
});

export interface StoreHost {
  sql: SqlStorage;
  tx: <T>(fn: () => T) => T;
  /** Bumps the revocation epoch so every session re-resolves. */
  bump: () => number;
  /** Security events kept outside the snapshot, so a restore cannot undo a revocation (N-02). */
  journal?: SecurityJournal;
}

export class GovStore {
  private readonly sql: SqlStorage;
  private readonly tx: StoreHost["tx"];
  private readonly bump: () => number;
  private readonly journal: SecurityJournal | undefined;

  private readonly defaults: readonly Role[];

  constructor(host: StoreHost, defaults: readonly Role[]) {
    this.defaults = defaults;
    this.sql = host.sql;
    this.tx = host.tx;
    this.bump = host.bump;
    this.journal = host.journal;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS gov_meta (k TEXT PRIMARY KEY, v INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS gov_roles (
        role_id TEXT PRIMARY KEY, version INTEGER NOT NULL, body TEXT NOT NULL,
        updated_at INTEGER NOT NULL, updated_by TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS gov_role_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT, role_id TEXT NOT NULL, version INTEGER NOT NULL,
        body TEXT NOT NULL, at INTEGER NOT NULL, proposed_by TEXT NOT NULL,
        approved_by TEXT, change_id TEXT);
      CREATE TABLE IF NOT EXISTS gov_changes (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL,
        scope_key TEXT NOT NULL, needs_second INTEGER NOT NULL, proposed_by TEXT NOT NULL,
        proposed_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, decided_by TEXT,
        decided_at INTEGER, note TEXT, base_version INTEGER, claim_key TEXT);
      CREATE TABLE IF NOT EXISTS gov_elevations (
        id TEXT PRIMARY KEY, principal_id TEXT NOT NULL, hours INTEGER NOT NULL, reason TEXT NOT NULL,
        status TEXT NOT NULL, requested_at INTEGER NOT NULL, lapses_at INTEGER NOT NULL,
        decided_by TEXT, decided_at INTEGER, note TEXT, until INTEGER);
      CREATE TABLE IF NOT EXISTS gov_access_requests (
        id TEXT PRIMARY KEY, principal_id TEXT NOT NULL, node_id TEXT NOT NULL, scope_key TEXT NOT NULL,
        scope TEXT NOT NULL, scope_label TEXT NOT NULL, reason TEXT NOT NULL, status TEXT NOT NULL,
        created_at INTEGER NOT NULL, decided_by TEXT, decided_at INTEGER, note TEXT, change_id TEXT);
      CREATE TABLE IF NOT EXISTS gov_identity (principal_id TEXT PRIMARY KEY, email TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS gov_notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT, principal_id TEXT NOT NULL, kind TEXT NOT NULL,
        title TEXT NOT NULL, ref TEXT, at INTEGER NOT NULL, read_at INTEGER);
    `);
    // Named NDA grants gain a reason and an expiry. Older databases get the columns added once.
    const cols = new Set(
      this.sql
        .exec("PRAGMA table_info(nda_grants)")
        .toArray()
        .map((r) => s(r.name)),
    );
    for (const [c, t] of [
      ["reason", "TEXT"],
      ["expires_at", "INTEGER"],
      ["granted_by", "TEXT"],
      ["approved_by", "TEXT"],
      ["granted_at", "INTEGER"],
    ] as const)
      if (!cols.has(c)) this.sql.exec(`ALTER TABLE nda_grants ADD COLUMN ${c} ${t}`);
    const changeCols = new Set(
      this.sql
        .exec("PRAGMA table_info(gov_changes)")
        .toArray()
        .map((r) => s(r.name)),
    );
    if (!changeCols.has("claim_key")) this.sql.exec("ALTER TABLE gov_changes ADD COLUMN claim_key TEXT");
    this.sql.exec("CREATE UNIQUE INDEX IF NOT EXISTS gov_changes_claim_key ON gov_changes (claim_key)");
    this.tx(() => this.seedRoles(0));
  }

  /** Roles are data. The first time a tenant is seen, the policy package's roles become version 1. */
  private seedRoles(now: number): void {
    if (this.sql.exec("SELECT 1 FROM gov_roles LIMIT 1").toArray().length) return;
    for (const r of this.defaults) {
      this.sql.exec(
        "INSERT INTO gov_roles (role_id, version, body, updated_at, updated_by) VALUES (?, 1, ?, ?, 'system')",
        r.id,
        JSON.stringify(r),
        now,
      );
      this.sql.exec(
        "INSERT INTO gov_role_history (role_id, version, body, at, proposed_by) VALUES (?, 1, ?, ?, 'system')",
        r.id,
        JSON.stringify(r),
        now,
      );
    }
    this.sql.exec(
      "INSERT INTO gov_meta (k, v) VALUES ('roles_v', 1) ON CONFLICT(k) DO UPDATE SET v = v + 1",
    );
  }

  /** Dev reseed: governance state returns to the policy package's defaults. */
  reset(now: number): void {
    for (const t of [
      "gov_roles",
      "gov_role_history",
      "gov_changes",
      "gov_elevations",
      "gov_access_requests",
      "gov_notifications",
      "gov_identity",
    ])
      this.sql.exec(`DELETE FROM ${t}`);
    this.seedRoles(now);
  }

  // ---- one human, several principal ids (M-08) ----

  /** Records the address a principal id acted with. A dev persona has an id per persona, so ids alone cannot tell two roles of one tester apart. */
  remember(principalId: string, email: string): void {
    const e = normalEmail(email);
    if (!e) return;
    this.sql.exec(
      "INSERT INTO gov_identity (principal_id, email) VALUES (?, ?) ON CONFLICT(principal_id) DO UPDATE SET email = excluded.email",
      principalId,
      e,
    );
  }

  private directoryRows(): DirectoryPrincipal[] {
    return this.sql
      .exec("SELECT id, subject, email FROM principals")
      .toArray()
      .map((r) => ({
        id: s(r.id),
        subject: sn(r.subject),
        email: sn(r.email),
      }));
  }

  private signInOf(principalId: string): string | null {
    const row = this.sql
      .exec("SELECT email FROM gov_identity WHERE principal_id = ?", principalId)
      .toArray()[0];
    return row ? sn(row.email) : null;
  }

  /** The same actor as quorum and humanIds. A display name is not an identity. */
  private sameHuman(a: string, b: string): boolean {
    const rows = this.directoryRows();
    return sameActor(
      actorFromDirectory(a, this.signInOf(a), rows),
      actorFromDirectory(b, this.signInOf(b), rows),
    );
  }

  // ---- roles ----

  rolesVersion(): number {
    const r = this.sql.exec("SELECT v FROM gov_meta WHERE k = 'roles_v'").toArray()[0];
    return r ? n(r.v) : 0;
  }

  listRoles(): { version: number; roles: Role[]; versions: Record<string, number> } {
    const rows = this.sql
      .exec("SELECT role_id, version, body FROM gov_roles ORDER BY role_id")
      .toArray();
    const versions: Record<string, number> = {};
    for (const r of rows) versions[s(r.role_id)] = n(r.version);
    // Keep the policy package's display order for the seeded roles, then new roles by id.
    const order = new Map(this.defaults.map((d, i) => [d.id, i]));
    const roles = rows
      .map((r) => JSON.parse(s(r.body)) as Role)
      .sort(
        (a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99) || a.id.localeCompare(b.id),
      );
    return { version: this.rolesVersion(), roles, versions };
  }

  roleHistory(roleId: string): {
    version: number;
    at: number;
    proposedBy: string;
    approvedBy: string | null;
    changeId: string | null;
    role: Role;
  }[] {
    return this.sql
      .exec(
        "SELECT version, body, at, proposed_by, approved_by, change_id FROM gov_role_history WHERE role_id = ? ORDER BY version DESC",
        roleId,
      )
      .toArray()
      .map((r) => ({
        version: n(r.version),
        at: n(r.at),
        proposedBy: s(r.proposed_by),
        approvedBy: sn(r.approved_by),
        changeId: sn(r.change_id),
        role: JSON.parse(s(r.body)) as Role,
      }));
  }

  // ---- directory reads ----

  principals(): { id: string; email: string; roleIds: string[] }[] {
    const roles = new Map<string, string[]>();
    for (const r of this.sql
      .exec("SELECT principal_id, role_id FROM role_assignments ORDER BY 2")
      .toArray())
      roles.set(s(r.principal_id), [...(roles.get(s(r.principal_id)) ?? []), s(r.role_id)]);
    return this.sql
      .exec("SELECT id, email FROM principals ORDER BY email")
      .toArray()
      .map((r) => ({ id: s(r.id), email: s(r.email), roleIds: roles.get(s(r.id)) ?? [] }));
  }

  /**
   * A person who asked for access through the console has a signed-in identity even when the
   * directory does not list it (a dev persona under a non-seeded address). Their own request is the
   * proof, so approving it may add the membership. Nobody else is accepted this way.
   */
  private hasRequester(id: string): boolean {
    return (
      this.sql
        .exec(
          "SELECT 1 FROM gov_access_requests WHERE principal_id = ? AND status IN ('pending', 'approved') LIMIT 1",
          id,
        )
        .toArray().length > 0
    );
  }

  private hasPrincipal(id: string): boolean {
    return this.sql.exec("SELECT 1 FROM principals WHERE id = ?", id).toArray().length > 0;
  }

  members(scopeType: string, scopeId: string): { principalId: string; email: string }[] {
    return this.sql
      .exec(
        `SELECT m.principal_id AS id, p.email AS email FROM memberships m
         JOIN principals p ON p.id = m.principal_id
         WHERE m.scope_type = ? AND m.scope_id = ? ORDER BY p.email`,
        scopeType,
        scopeId,
      )
      .toArray()
      .map((r) => ({ principalId: s(r.id), email: s(r.email) }));
  }

  ndaGrants(
    now: number,
    accountId: string | null,
  ): {
    principalId: string;
    email: string;
    accountId: string;
    reason: string | null;
    expiresAt: number | null;
    grantedBy: string | null;
    approvedBy: string | null;
    grantedAt: number | null;
    active: boolean;
  }[] {
    const rows = this.sql
      .exec(
        `SELECT g.*, p.email AS email FROM nda_grants g LEFT JOIN principals p ON p.id = g.principal_id
         WHERE (? IS NULL OR g.account_id = ?) ORDER BY g.account_id, p.email`,
        accountId,
        accountId,
      )
      .toArray();
    return rows.map((r) => {
      const exp = nn(r.expires_at);
      return {
        principalId: s(r.principal_id),
        email: s(r.email),
        accountId: s(r.account_id),
        reason: sn(r.reason),
        expiresAt: exp,
        grantedBy: sn(r.granted_by),
        approvedBy: sn(r.approved_by),
        grantedAt: nn(r.granted_at),
        active: exp === null || exp > now,
      };
    });
  }

  /** Principals who could decide a change on `scope` (null: configure holders only), minus `except`. */
  approvers(scope: ScopeDesc | null, except: string): string[] {
    const { roles } = this.listRoles();
    const byId = new Map(roles.map((r) => [r.id, r]));
    const out: string[] = [];
    for (const p of this.principals()) {
      if (p.id === except) continue;
      const mine = p.roleIds.flatMap((id) => byId.get(id) ?? []);
      const how = scope
        ? manageAuthority(mine, scope)
        : mine.some((r) => r.grants.some((g) => g.actions.includes("configure")))
          ? "admin"
          : null;
      if (how) out.push(p.id);
    }
    return out;
  }

  // ---- notifications ----

  private notify(
    principalId: string,
    kind: string,
    title: string,
    ref: string | null,
    now: number,
  ): void {
    this.sql.exec(
      "INSERT INTO gov_notifications (principal_id, kind, title, ref, at) VALUES (?, ?, ?, ?, ?)",
      principalId,
      kind,
      title.slice(0, 120),
      ref,
      now,
    );
  }

  private notifyAll(
    ids: readonly string[],
    kind: string,
    title: string,
    ref: string | null,
    now: number,
  ): void {
    for (const id of new Set(ids)) this.notify(id, kind, title, ref, now);
  }

  /**
   * `principalIds` is the session's own id, and in dev also the seeded person the persona stands for:
   * a persona signs in under its own address (a distinct human for the two-person rules), but the
   * directory, and so every delivery, knows the seeded principal.
   */
  inbox(principalIds: string | readonly string[]): { unread: number; items: Notification[] } {
    const ids = [...new Set([principalIds].flat())];
    const marks = ids.map(() => "?").join(", ");
    const who = `principal_id IN (${marks})`;
    const unread = n(
      this.sql
        .exec(
          `SELECT COUNT(*) AS c FROM gov_notifications WHERE ${who} AND read_at IS NULL`,
          ...ids,
        )
        .one().c,
    );
    const toItem = (r: Row): Notification => ({
      id: n(r.id),
      kind: s(r.kind),
      title: s(r.title),
      ref: sn(r.ref),
      at: n(r.at),
      read: r.read_at !== null,
    });
    // The newest 50, plus any older unread row the badge still counts.
    const recent = page(this.sql, "gov_notifications", [who], ids, "id DESC", 50);
    const unseen = page(
      this.sql,
      "gov_notifications",
      [who, "read_at IS NULL"],
      ids,
      "id DESC",
      Math.max(unread, 1),
    );
    const byId = new Map<number, Notification>();
    for (const row of [...unseen, ...recent]) byId.set(n(row.id), toItem(row));
    const items = [...byId.values()].sort((a, b) => b.id - a.id);
    return { unread, items };
  }

  markRead(principalIds: string | readonly string[], ids: number[] | null, now: number): number {
    const who = [...new Set([principalIds].flat())];
    const marks = who.map(() => "?").join(", ");
    if (ids === null)
      this.sql.exec(
        `UPDATE gov_notifications SET read_at = ? WHERE principal_id IN (${marks}) AND read_at IS NULL`,
        now,
        ...who,
      );
    else
      for (const id of ids)
        this.sql.exec(
          `UPDATE gov_notifications SET read_at = ? WHERE principal_id IN (${marks}) AND id = ? AND read_at IS NULL`,
          now,
          ...who,
          id,
        );
    return this.inbox(who).unread;
  }

  /** Other modules (for example the review queue) deliver a notice through the same inbox. */
  deliver(
    principalIds: string[],
    kind: string,
    title: string,
    ref: string | null,
    now: number,
  ): number {
    this.notifyAll(principalIds, kind, title, ref, now);
    return new Set(principalIds).size;
  }

  // ---- changes: roles, memberships, NDA grants ----

  private getChange(id: string, now: number): Change | null {
    const r = this.sql.exec("SELECT * FROM gov_changes WHERE id = ?", id).toArray()[0];
    if (!r) return null;
    const q = this.sql
      .exec("SELECT principal_id FROM gov_access_requests WHERE change_id = ?", id)
      .toArray()[0];
    return { ...toChange(r, now), requestedBy: q ? s(q.principal_id) : null };
  }

  change(id: string, now: number): Change | null {
    return this.getChange(id, now);
  }

  /** The governance row for a claim key. A null or unknown key matches nothing, including legacy rows. */
  changeByKey(key: string, now: number): Change | null {
    if (!key) return null;
    const row = this.sql.exec("SELECT id FROM gov_changes WHERE claim_key = ?", key).toArray()[0];
    if (!row) return null;
    return this.getChange(s(row.id), now);
  }

  listChanges(
    now: number,
    f: {
      status?: ChangeStatus | null;
      scopeKeys?: string[] | null;
      kinds?: ChangeKind[] | null;
      mine?: string | null;
    },
  ): Change[] {
    const where: string[] = [];
    const args: SqlStorageValue[] = [];
    if (f.status) {
      const clause = changeStatusSql(f.status, now);
      where.push(clause.sql);
      args.push(...clause.args);
    }
    if (f.kinds) {
      if (f.kinds.length === 0) where.push("0");
      else {
        where.push(`kind IN (${f.kinds.map(() => "?").join(", ")})`);
        args.push(...f.kinds);
      }
    }
    if (f.scopeKeys !== undefined && f.scopeKeys !== null) {
      const mine = f.mine !== undefined && f.mine !== null ? f.mine : null;
      if (f.scopeKeys.length === 0 && mine === null) where.push("0");
      else if (f.scopeKeys.length === 0) {
        where.push("proposed_by = ?");
        args.push(mine);
      } else if (mine !== null) {
        where.push(`(scope_key IN (${f.scopeKeys.map(() => "?").join(", ")}) OR proposed_by = ?)`);
        args.push(...f.scopeKeys, mine);
      } else {
        where.push(`scope_key IN (${f.scopeKeys.map(() => "?").join(", ")})`);
        args.push(...f.scopeKeys);
      }
    }
    const rows = page(this.sql, "gov_changes", where, args, "proposed_at DESC, id DESC", 300);
    const requester = new Map(
      this.sql
        .exec("SELECT change_id, principal_id FROM gov_access_requests WHERE change_id IS NOT NULL")
        .toArray()
        .map((r) => [s(r.change_id), s(r.principal_id)] as const),
    );
    return rows.map((r) => ({ ...toChange(r, now), requestedBy: requester.get(s(r.id)) ?? null }));
  }

  /**
   * Record a change. When it needs no second person it applies in the same step. Otherwise it waits,
   * and everyone who could decide it (except the proposer) gets a notice.
   */
  propose(
    a: {
      kind: ChangeKind;
      payload: Record<string, unknown>;
      scopeKey: string;
      scope: ScopeDesc | null;
      needsSecond: boolean;
      proposedBy: string;
      baseVersion?: number | null;
      /** An access request this change fulfils. */
      requestId?: string | null;
      label: string;
      /** When set, a second propose with this key returns the change already stored. */
      claimKey?: string | null;
    },
    now: number,
  ): { ok: true; change: Change; applied: boolean } | Fail {
    const target = typeof a.payload.principalId === "string" ? a.payload.principalId : null;
    if (
      a.kind !== "role_upsert" &&
      (!target ||
        !(this.hasPrincipal(target) || (a.kind === "member_add" && this.hasRequester(target))))
    )
      return fail(404, "unknown_principal", "That person is not in this tenant's directory");
    if (a.claimKey) {
      const same = this.storedByClaimKey(a.claimKey, now);
      if (same) return same;
    }
    const dup = this.sql
      .exec(
        "SELECT id FROM gov_changes WHERE status = 'pending' AND expires_at > ? AND kind = ? AND scope_key = ? AND payload = ?",
        now,
        a.kind,
        a.scopeKey,
        JSON.stringify(a.payload),
      )
      .toArray()[0];
    if (dup) return fail(409, "duplicate", "The same change is already waiting for approval");

    const id = newId("chg");
    const result = this.tx((): Fail | { applied: boolean } | { existing: string } => {
      if (a.claimKey) {
        const again = this.sql.exec("SELECT id FROM gov_changes WHERE claim_key = ?", a.claimKey).toArray()[0];
        if (again) return { existing: s(again.id) };
      }
      this.sql.exec(
        `INSERT INTO gov_changes (id, kind, status, payload, scope_key, needs_second, proposed_by, proposed_at, expires_at, base_version, claim_key)
         VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        a.kind,
        JSON.stringify(a.payload),
        a.scopeKey,
        a.needsSecond ? 1 : 0,
        a.proposedBy,
        now,
        now + CHANGE_TTL_MS,
        a.baseVersion ?? null,
        a.claimKey ?? null,
      );
      if (a.requestId)
        this.sql.exec("UPDATE gov_access_requests SET change_id = ? WHERE id = ?", id, a.requestId);
      if (a.needsSecond) {
        this.notifyAll(
          this.approvers(a.scope, a.proposedBy),
          "approval_needed",
          `${a.label} is waiting for a second approver`,
          id,
          now,
        );
        return { applied: false };
      }
      const err = this.applyChange(this.getChange(id, now) as Change, a.proposedBy, null, now);
      if (err) {
        // Nothing half-applied: the failed apply leaves no change behind.
        this.sql.exec("DELETE FROM gov_changes WHERE id = ?", id);
        this.sql.exec("UPDATE gov_access_requests SET change_id = NULL WHERE change_id = ?", id);
        return err;
      }
      const matched = this.sql
        .exec(
          `UPDATE gov_changes SET status = 'applied', decided_by = ?, decided_at = ?
           WHERE id = ? AND status = 'pending' RETURNING id`,
          a.proposedBy,
          now,
          id,
        )
        .toArray().length;
      if (claimGovernance(matched).tag !== "applied") {
        console.warn(JSON.stringify({ at: "governance", reason: "replay" }));
        this.sql.exec("DELETE FROM gov_changes WHERE id = ?", id);
        this.sql.exec("UPDATE gov_access_requests SET change_id = NULL WHERE change_id = ?", id);
        return fail(409, "not_pending", "This change is no longer pending");
      }
      this.afterDecision(this.getChange(id, now) as Change, true, now);
      return { applied: true };
    });
    if ("existing" in result) {
      const change = this.getChange(result.existing, now) as Change;
      return { ok: true, change, applied: change.status === "applied" };
    }
    if ("ok" in result) return result;
    return { ok: true, change: this.getChange(id, now) as Change, applied: result.applied };
  }

  /** The change already stored for this correlation key, if any. A null key matches nothing. */
  private storedByClaimKey(key: string, now: number): { ok: true; change: Change; applied: boolean } | null {
    const row = this.sql.exec("SELECT id FROM gov_changes WHERE claim_key = ?", key).toArray()[0];
    if (!row) return null;
    const change = this.getChange(s(row.id), now);
    if (!change) return null;
    return { ok: true, change, applied: change.status === "applied" };
  }

  /** Approve or reject a pending change. The proposer is refused here regardless of the caller. */
  decide(
    id: string,
    approve: boolean,
    deciderId: string,
    note: string | null,
    now: number,
  ): { ok: true; change: Change } | Fail {
    const c = this.getChange(id, now);
    if (!c) return fail(404, "not_found", "No such change");
    const step = commitGovernance(
      { tag: c.status },
      { type: approve ? "approve" : "reject", now },
    );
    if (!step.ok) {
      if (step.reason === "expired")
        return fail(409, "expired", "This change lapsed after 72 hours. Propose it again");
      if (step.reason === "state_unreadable" || step.reason === "clock_unreadable")
        return fail(409, step.reason, "This change cannot be decided");
      return fail(409, "not_pending", `This change is already ${c.status}`);
    }
    if (this.sameHuman(c.proposedBy, deciderId))
      return fail(
        403,
        "self_approval",
        "Two-person rule: you proposed this change, so someone else must decide it",
      );
    // The person the change benefits, or who asked for it, never casts a deciding vote (H-04).
    if (this.isBeneficiary(c, deciderId))
      return fail(
        403,
        "beneficiary_decision",
        "Two-person rule: this change is about you or your request, so someone else must decide it",
      );
    const r = this.tx((): Fail | null => {
      const matched = this.sql
        .exec(
          `UPDATE gov_changes SET status = ?, decided_by = ?, decided_at = ?, note = ?
           WHERE id = ? AND status = 'pending' RETURNING id`,
          approve ? "applied" : "rejected",
          deciderId,
          now,
          note,
          id,
        )
        .toArray().length;
      if (claimGovernance(matched).tag !== "applied") {
        console.warn(JSON.stringify({ at: "governance", reason: "replay" }));
        return fail(409, "not_pending", "This change is no longer pending");
      }
      if (approve) {
        const err = this.applyChange(c, c.proposedBy, deciderId, now);
        if (err) {
          this.sql.exec(
            `UPDATE gov_changes SET status = 'pending', decided_by = NULL, decided_at = NULL, note = NULL
             WHERE id = ? AND status = 'applied'`,
            id,
          );
          return err;
        }
      }
      this.afterDecision(this.getChange(id, now) as Change, approve, now);
      return null;
    });
    return r ?? { ok: true, change: this.getChange(id, now) as Change };
  }

  /** True when `who` is the subject of the change (payload.principalId) or requested it. */
  isBeneficiary(c: Change, who: string): boolean {
    const subject = typeof c.payload.principalId === "string" ? c.payload.principalId : null;
    return (
      (subject !== null && this.sameHuman(subject, who)) ||
      (!!c.requestedBy && this.sameHuman(c.requestedBy, who))
    );
  }

  withdraw(id: string, by: string, now: number): { ok: true; change: Change } | Fail {
    const c = this.getChange(id, now);
    if (!c) return fail(404, "not_found", "No such change");
    if (c.proposedBy !== by)
      return fail(403, "not_proposer", "Only the proposer can withdraw a change");
    const step = commitGovernance({ tag: c.status }, { type: "withdraw", now });
    if (!step.ok) {
      if (step.reason === "state_unreadable" || step.reason === "clock_unreadable")
        return fail(409, step.reason, "This change cannot be withdrawn");
      return fail(409, "not_pending", `This change is already ${c.status}`);
    }
    let refused = false;
    this.tx(() => {
      const matched = this.sql
        .exec(
          `UPDATE gov_changes SET status = 'withdrawn', decided_by = ?, decided_at = ?
           WHERE id = ? AND status = 'pending' RETURNING id`,
          by,
          now,
          id,
        )
        .toArray().length;
      if (claimGovernance(matched).tag !== "applied") {
        console.warn(JSON.stringify({ at: "governance", reason: "replay" }));
        refused = true;
        return;
      }
      this.afterDecision(this.getChange(id, now) as Change, false, now);
    });
    if (refused) return fail(409, "not_pending", "This change is no longer pending");
    return { ok: true, change: this.getChange(id, now) as Change };
  }

  /** Writes the change into the directory. Returns a refusal, or null when applied. Runs in a transaction. */
  private applyChange(
    c: Change,
    proposer: string,
    approver: string | null,
    now: number,
  ): Fail | null {
    const p = c.payload;
    switch (c.kind) {
      case "role_upsert": {
        const role = p.role as Role;
        const cur = this.sql
          .exec("SELECT version FROM gov_roles WHERE role_id = ?", role.id)
          .toArray()[0];
        const version = cur ? n(cur.version) : 0;
        if (version !== (c.baseVersion ?? 0))
          return fail(
            409,
            "stale_role",
            "The role changed since this edit was proposed. Reload and propose again",
          );
        // Never leave the tenant without a role that can configure it, held by someone.
        const others = this.listRoles().roles.filter((r) => r.id !== role.id);
        const admins = [...others, role]
          .filter((r) => r.grants.some((g) => g.actions.includes("configure")))
          .map((r) => r.id);
        const held = admins.length
          ? n(
              this.sql
                .exec(
                  // Only holders who can still sign in count: a deprovisioned admin is no admin (L-06).
                  // Group-mapped roles cannot be admin roles (identity-store PRIVILEGED_ROLES), so they add nothing.
                  `SELECT COUNT(*) AS c FROM role_assignments ra WHERE ra.role_id IN (${admins.map(() => "?").join(",")})
                     AND COALESCE((SELECT active FROM principal_status ps WHERE ps.principal_id = ra.principal_id), 1) = 1`,
                  ...admins,
                )
                .one().c,
            )
          : 0;
        if (!held)
          return fail(422, "last_admin", "This would leave nobody able to configure the tenant");
        this.sql.exec(
          `INSERT INTO gov_roles (role_id, version, body, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(role_id) DO UPDATE SET version = excluded.version, body = excluded.body,
             updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
          role.id,
          version + 1,
          JSON.stringify(role),
          now,
          proposer,
        );
        this.sql.exec(
          "INSERT INTO gov_role_history (role_id, version, body, at, proposed_by, approved_by, change_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
          role.id,
          version + 1,
          JSON.stringify(role),
          now,
          proposer,
          approver,
          c.id,
        );
        this.sql.exec("UPDATE gov_meta SET v = v + 1 WHERE k = 'roles_v'");
        break;
      }
      case "member_add":
      case "member_remove": {
        const sc = p.scope as { type: string; id: string };
        if (
          !(
            this.hasPrincipal(p.principalId as string) ||
            (c.kind === "member_add" && this.hasRequester(p.principalId as string))
          )
        )
          return fail(404, "unknown_principal", "That person is no longer in the directory");
        this.journal?.member(p.principalId as string, sc.type, sc.id, c.kind === "member_add", now);
        if (c.kind === "member_add")
          this.sql.exec(
            "INSERT OR IGNORE INTO memberships (principal_id, scope_type, scope_id) VALUES (?, ?, ?)",
            p.principalId as string,
            sc.type,
            sc.id,
          );
        else
          this.sql.exec(
            "DELETE FROM memberships WHERE principal_id = ? AND scope_type = ? AND scope_id = ?",
            p.principalId as string,
            sc.type,
            sc.id,
          );
        break;
      }
      case "nda_grant": {
        const exp = p.expiresAt as number;
        if (exp <= now) return fail(409, "expired", "The expiry date has already passed");
        if (!this.hasPrincipal(p.principalId as string))
          return fail(404, "unknown_principal", "That person is no longer in the directory");
        this.journal?.nda(p.principalId as string, p.accountId as string, true, now, {
          reason: p.reason as string,
          expiresAt: exp,
          grantedBy: proposer,
          approvedBy: approver,
          grantedAt: now,
        });
        this.sql.exec(
          `INSERT OR REPLACE INTO nda_grants (principal_id, account_id, reason, expires_at, granted_by, approved_by, granted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          p.principalId as string,
          p.accountId as string,
          p.reason as string,
          exp,
          proposer,
          approver,
          now,
        );
        break;
      }
      case "nda_revoke":
        this.journal?.nda(p.principalId as string, p.accountId as string, false, now);
        this.sql.exec(
          "DELETE FROM nda_grants WHERE principal_id = ? AND account_id = ?",
          p.principalId as string,
          p.accountId as string,
        );
        break;
    }
    this.bump();
    return null;
  }

  /** Notices after a change is decided, and the access request it may fulfil. */
  private afterDecision(c: Change, applied: boolean, now: number): void {
    const verb = applied
      ? "approved and applied"
      : c.status === "withdrawn"
        ? "withdrawn"
        : "rejected";
    if (c.decidedBy && c.decidedBy !== c.proposedBy)
      this.notify(
        c.proposedBy,
        "change_decided",
        `Your ${labelOf(c.kind)} change was ${verb}`,
        c.id,
        now,
      );
    const target = typeof c.payload.principalId === "string" ? c.payload.principalId : null;
    if (
      applied &&
      target &&
      target !== c.proposedBy &&
      c.kind !== "member_remove" &&
      c.kind !== "nda_revoke"
    )
      this.notify(
        target,
        "access_granted",
        c.kind === "nda_grant" ? "You were given a named NDA grant" : "You were added to a space",
        c.id,
        now,
      );
    const req = this.sql
      .exec("SELECT id, principal_id, status FROM gov_access_requests WHERE change_id = ?", c.id)
      .toArray()[0];
    if (req) {
      const step = commitAccessRequest(decodeAccessRequest(s(req.status)), {
        type: applied ? "grant" : "reject",
        now,
      });
      if (step.ok) {
        const matched = this.sql
          .exec(
            `UPDATE gov_access_requests SET status = ? WHERE id = ? AND status IN ('pending', 'approved') RETURNING id`,
            applied ? "granted" : "denied",
            s(req.id),
          )
          .toArray().length;
        if (claimAccessRequest(matched).tag !== "applied") {
          console.warn(JSON.stringify({ at: "access_request", reason: "replay" }));
        } else {
          this.notify(
            s(req.principal_id),
            applied ? "request_granted" : "request_denied",
            applied ? "Your access request was granted" : "Your access request was not granted",
            s(req.id),
            now,
          );
        }
      }
    }
  }

  // ---- elevation ----

  /**
   * Time-boxed elevation. `maxHours` is the caller's role limit (the API reads it from the roles).
   * Without approval the window starts now. With approval it waits for a configure holder.
   */
  requestElevation(
    a: {
      principalId: string;
      hours: number;
      reason: string;
      maxHours: number;
      needsApproval: boolean;
    },
    now: number,
  ): { ok: true; elevation: ElevationRequest } | Fail {
    const reason = a.reason.trim();
    if (!reason) return fail(422, "reason_required", "State why you need elevated access");
    if (!Number.isInteger(a.hours) || a.hours < 1)
      return fail(422, "invalid_hours", "Ask for a whole number of hours");
    if (a.hours > a.maxHours)
      return fail(
        422,
        "hours_exceed_role_max",
        `Your role allows at most ${a.maxHours} hours at a time`,
      );
    const open = this.sql
      .exec("SELECT status, lapses_at, until FROM gov_elevations WHERE principal_id = ?", a.principalId)
      .toArray()
      .some((r) => {
        const tag = effectiveStatus(
          { status: s(r.status), lapsesAt: n(r.lapses_at), until: nn(r.until) },
          now,
        ).tag;
        return tag === "pending" || tag === "active";
      });
    if (open)
      return fail(
        409,
        "already_open",
        "You already have an open elevation request or an active window",
      );
    const id = newId("elv");
    let started = true;
    this.tx(() => {
      this.sql.exec(
        `INSERT INTO gov_elevations (id, principal_id, hours, reason, status, requested_at, lapses_at)
         VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
        id,
        a.principalId,
        a.hours,
        reason.slice(0, 200),
        now,
        now + ELEVATION_REQUEST_TTL_MS,
      );
      if (a.needsApproval)
        this.notifyAll(
          this.approvers(null, a.principalId),
          "elevation_needed",
          "An elevation request is waiting for your decision",
          id,
          now,
        );
      else started = this.startElevation(id, a.principalId, "system", now);
    });
    if (!started)
      return fail(409, "not_startable", "This elevation cannot be started");
    return { ok: true, elevation: this.getElevation(id, now) as ElevationRequest };
  }

  private elevationState(id: string, now: number): ElevationState | null {
    const r = this.sql
      .exec("SELECT status, lapses_at, until FROM gov_elevations WHERE id = ?", id)
      .toArray()[0];
    return r ? decodeElevation(s(r.status), now, n(r.lapses_at), nn(r.until)) : null;
  }

  private startElevation(id: string, principalId: string, decidedBy: string, now: number): boolean {
    const r = this.sql
      .exec("SELECT hours, reason, status, lapses_at, until FROM gov_elevations WHERE id = ?", id)
      .toArray()[0];
    if (!r) return false;
    const step = commitElevation(
      decodeElevation(s(r.status), now, n(r.lapses_at), nn(r.until)),
      { type: "start", now },
    );
    if (!step.ok) return false;
    const until = now + n(r.hours) * HOUR;
    const matched = this.sql
      .exec(
        `UPDATE gov_elevations SET status = 'active', decided_by = ?, decided_at = ?, until = ?
         WHERE id = ? AND status = 'pending' RETURNING id`,
        decidedBy,
        now,
        until,
        id,
      )
      .toArray().length;
    if (claimElevation(matched).tag !== "applied") {
      console.warn(JSON.stringify({ at: "elevation", reason: "replay" }));
      return false;
    }
    // The engine reads this table: one row per window, the latest end wins.
    this.sql.exec(
      "INSERT INTO elevations (principal_id, until, reason, created_at) VALUES (?, ?, ?, ?)",
      principalId,
      until,
      s(r.reason),
      now,
    );
    this.bump();
    return true;
  }

  private denyElevation(id: string, deciderId: string, note: string | null, now: number): boolean {
    const state = this.elevationState(id, now);
    if (!state) return false;
    const step = commitElevation(state, { type: "deny", now });
    if (!step.ok) return false;
    const matched = this.sql
      .exec(
        `UPDATE gov_elevations SET status = 'denied', decided_by = ?, decided_at = ?, note = ?
         WHERE id = ? AND status = 'pending' RETURNING id`,
        deciderId,
        now,
        note,
        id,
      )
      .toArray().length;
    if (claimElevation(matched).tag !== "applied") {
      console.warn(JSON.stringify({ at: "elevation", reason: "replay" }));
      return false;
    }
    return true;
  }

  private getElevation(id: string, now: number): ElevationRequest | null {
    const r = this.sql.exec("SELECT * FROM gov_elevations WHERE id = ?", id).toArray()[0];
    return r ? toElevation(r, now) : null;
  }

  decideElevation(
    id: string,
    approve: boolean,
    deciderId: string,
    note: string | null,
    now: number,
  ): { ok: true; elevation: ElevationRequest } | Fail {
    const e = this.getElevation(id, now);
    if (!e) return fail(404, "not_found", "No such elevation request");
    if (e.status === "expired") return fail(409, "expired", "This request lapsed. Ask again");
    if (e.status !== "pending")
      return fail(409, "not_pending", `This request is already ${e.status}`);
    if (this.sameHuman(e.principalId, deciderId))
      return fail(
        403,
        "self_approval",
        "Nobody approves their own elevation: a second admin must decide",
      );
    let refused = false;
    this.tx(() => {
      const applied = approve
        ? this.startElevation(id, e.principalId, deciderId, now)
        : this.denyElevation(id, deciderId, note, now);
      if (!applied) {
        refused = true;
        return;
      }
      this.notify(
        e.principalId,
        approve ? "elevation_approved" : "elevation_denied",
        approve ? "Your elevation was approved and is active" : "Your elevation request was denied",
        id,
        now,
      );
    });
    if (refused)
      return fail(
        409,
        approve ? "not_startable" : "not_pending",
        approve ? "This elevation cannot be started" : "This request is no longer pending",
      );
    return { ok: true, elevation: this.getElevation(id, now) as ElevationRequest };
  }

  /** End a window early. The requester or a configure holder (checked by the API) may do it. */
  endElevation(id: string, now: number): { ok: true; elevation: ElevationRequest } | Fail {
    const e = this.getElevation(id, now);
    if (!e) return fail(404, "not_found", "No such elevation request");
    const step = commitElevation({ tag: e.status }, { type: "end", now });
    if (!step.ok) return fail(409, "not_active", "This elevation is not active");
    let refused = false;
    this.tx(() => {
      const matched = this.sql
        .exec(
          "UPDATE gov_elevations SET status = 'ended', until = ? WHERE id = ? AND status = 'active' RETURNING id",
          now,
          id,
        )
        .toArray().length;
      if (claimElevation(matched).tag !== "applied") {
        console.warn(JSON.stringify({ at: "elevation", reason: "replay" }));
        refused = true;
        return;
      }
      // The engine table has one row per window. Close the row this elevation opened, and no other.
      if (e.until !== null && e.decidedAt !== null)
        this.sql.exec(
          `UPDATE elevations SET until = ? WHERE id = (
             SELECT id FROM elevations
             WHERE principal_id = ? AND reason = ? AND until = ? AND created_at = ?
             ORDER BY id LIMIT 1
           )`,
          now,
          e.principalId,
          e.reason,
          e.until,
          e.decidedAt,
        );
      this.bump();
    });
    if (refused) return fail(409, "not_active", "This elevation is not active");
    return { ok: true, elevation: this.getElevation(id, now) as ElevationRequest };
  }

  listElevations(
    now: number,
    principalId: string | null,
    status: ElevationStatus | null = null,
  ): ElevationRequest[] {
    const where: string[] = [];
    const args: SqlStorageValue[] = [];
    if (principalId !== null) {
      where.push("principal_id = ?");
      args.push(principalId);
    }
    if (status) {
      const clause = elevationStatusSql(status, now);
      where.push(clause.sql);
      args.push(...clause.args);
    }
    const limit = principalId === null ? 200 : 50;
    return page(this.sql, "gov_elevations", where, args, "requested_at DESC", limit).map((r) =>
      toElevation(r, now),
    );
  }

  activeElevation(principalId: string, now: number): ElevationRequest | null {
    return this.listElevations(now, principalId, "active")[0] ?? null;
  }

  // ---- access requests ----

  createRequest(
    a: { principalId: string; nodeId: string; scope: ScopeDesc; reason: string },
    now: number,
  ): { ok: true; request: AccessRequest } | Fail {
    const reason = a.reason.trim();
    if (!reason) return fail(422, "reason_required", "Say why you need access");
    const key = scopeKeyOf(a.scope);
    const dup = this.sql
      .exec(
        "SELECT id FROM gov_access_requests WHERE principal_id = ? AND scope_key = ? AND status IN ('pending', 'approved')",
        a.principalId,
        key,
      )
      .toArray()[0];
    if (dup) return fail(409, "duplicate", "You already have a request open for this space");
    const id = newId("req");
    this.tx(() => {
      this.sql.exec(
        `INSERT INTO gov_access_requests (id, principal_id, node_id, scope_key, scope, scope_label, reason, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
        id,
        a.principalId,
        a.nodeId,
        key,
        JSON.stringify({ type: a.scope.type, id: a.scope.id, subspace: a.scope.subspace }),
        a.scope.label,
        reason.slice(0, 300),
        now,
      );
      this.notifyAll(
        this.approvers(a.scope, a.principalId),
        "access_request",
        `Access request for ${noticeLabel(a.scope)} is in your queue`,
        id,
        now,
      );
    });
    return {
      ok: true,
      request: toRequest(this.sql.exec("SELECT * FROM gov_access_requests WHERE id = ?", id).one()),
    };
  }

  request(id: string): AccessRequest | null {
    const r = this.sql.exec("SELECT * FROM gov_access_requests WHERE id = ?", id).toArray()[0];
    return r ? toRequest(r) : null;
  }

  listRequests(f: {
    principalId?: string | null;
    scopeKeys?: string[] | null;
    status?: RequestStatus | null;
  }): AccessRequest[] {
    const where: string[] = [];
    const args: SqlStorageValue[] = [];
    if (f.principalId) {
      where.push("principal_id = ?");
      args.push(f.principalId);
    }
    if (f.scopeKeys) {
      if (f.scopeKeys.length === 0) where.push("0");
      else {
        where.push(`scope_key IN (${f.scopeKeys.map(() => "?").join(", ")})`);
        args.push(...f.scopeKeys);
      }
    }
    if (f.status) {
      where.push("status = ?");
      args.push(f.status);
    }
    return page(this.sql, "gov_access_requests", where, args, "created_at DESC, id DESC", 300).map(
      toRequest,
    );
  }

  /** Deny with a reason, or note a decision made elsewhere. Approval goes through approveRequest. */
  denyRequest(
    id: string,
    deciderId: string,
    note: string,
    now: number,
  ): { ok: true; request: AccessRequest } | Fail {
    const r = this.request(id);
    if (!r) return fail(404, "not_found", "No such request");
    const step = commitAccessRequest(decodeAccessRequest(r.status), { type: "deny", now });
    if (!step.ok) return fail(409, step.reason, `This request is already ${r.status}`);
    if (this.sameHuman(r.principalId, deciderId))
      return fail(403, "self_approval", "You cannot decide your own request");
    if (!note.trim())
      return fail(422, "reason_required", "Give the requester a reason for the denial");
    let refused = false;
    this.tx(() => {
      const matched = this.sql
        .exec(
          `UPDATE gov_access_requests SET status = 'denied', decided_by = ?, decided_at = ?, note = ?
           WHERE id = ? AND status = 'pending' RETURNING id`,
          deciderId,
          now,
          note.trim().slice(0, 300),
          id,
        )
        .toArray().length;
      if (claimAccessRequest(matched).tag !== "applied") {
        console.warn(JSON.stringify({ at: "access_request", reason: "replay" }));
        refused = true;
        return;
      }
      this.notify(r.principalId, "request_denied", "Your access request was denied", id, now);
    });
    if (refused) return fail(409, "not_pending", "This request is no longer pending");
    return { ok: true, request: this.request(id) as AccessRequest };
  }

  /** Marks a request approved by a steward. The membership itself comes from `propose`. */
  markApproved(
    id: string,
    deciderId: string,
    now: number,
  ): { ok: true; request: AccessRequest } | Fail {
    const r = this.request(id);
    if (!r) return fail(404, "not_found", "No such request");
    const step = commitAccessRequest(decodeAccessRequest(r.status), { type: "approve", now });
    if (!step.ok) return fail(409, step.reason, `This request is already ${r.status}`);
    if (this.sameHuman(r.principalId, deciderId))
      return fail(403, "self_approval", "You cannot decide your own request");
    const matched = this.sql
      .exec(
        `UPDATE gov_access_requests SET status = 'approved', decided_by = ?, decided_at = ?
         WHERE id = ? AND status = 'pending' RETURNING id`,
        deciderId,
        now,
        id,
      )
      .toArray().length;
    if (claimAccessRequest(matched).tag !== "applied") {
      console.warn(JSON.stringify({ at: "access_request", reason: "replay" }));
      return fail(409, "not_pending", "This request is no longer pending");
    }
    return { ok: true, request: this.request(id) as AccessRequest };
  }

  /** A change that fulfils a request failed to apply: an approved request goes back to the queue. */
  reopenRequest(id: string): { ok: true } | Fail {
    const r = this.request(id);
    if (!r) return fail(404, "not_found", "No such request");
    const step = commitAccessRequest(decodeAccessRequest(r.status), { type: "reopen" });
    if (!step.ok) return fail(409, step.reason, "This request cannot be reopened");
    const matched = this.sql
      .exec(
        `UPDATE gov_access_requests SET status = 'pending', decided_by = NULL, decided_at = NULL, change_id = NULL
         WHERE id = ? AND status = 'approved' RETURNING id`,
        id,
      )
      .toArray().length;
    if (claimAccessRequest(matched).tag !== "applied") {
      console.warn(JSON.stringify({ at: "access_request", reason: "replay" }));
      return fail(409, "not_approved", "This request cannot be reopened");
    }
    return { ok: true };
  }
}

const scopeKeyOf = (s: Pick<ScopeDesc, "type" | "id" | "subspace">): string =>
  s.subspace ? `${s.type}:${s.id}:${s.subspace}` : `${s.type}:${s.id}`;

const labelOf = (k: ChangeKind): string =>
  k === "role_upsert" ? "role" : k.startsWith("member") ? "membership" : "NDA grant";

/** The methods the API may call through TenantPolicy.gov. Anything else is refused. */
export const GOV_METHODS = [
  "rolesVersion",
  "listRoles",
  "roleHistory",
  "principals",
  "members",
  "ndaGrants",
  "approvers",
  "inbox",
  "markRead",
  "deliver",
  "change",
  "changeByKey",
  "listChanges",
  "propose",
  "decide",
  "withdraw",
  "requestElevation",
  "decideElevation",
  "endElevation",
  "listElevations",
  "activeElevation",
  "remember",
  "createRequest",
  "request",
  "listRequests",
  "denyRequest",
  "markApproved",
  "reopenRequest",
] as const satisfies readonly (keyof GovStore)[];
export type GovMethod = (typeof GOV_METHODS)[number];
