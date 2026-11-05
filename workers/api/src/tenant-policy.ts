// TenantPolicy: one Durable Object per tenant (SQLite). It owns who a person is inside the tenant:
// principals, role assignments, memberships, named NDA grants, time-boxed elevations, the
// revocation epoch and the per-principal request counter. It holds no organisation content.

import { DurableObject } from "cloudflare:workers";
import type { ScopeType } from "@secondary/policy";
import { exportTables, replaceTables, type Snapshot } from "./ops-snapshot.ts";
import { allOn, isSwitchName, SWITCHES, type SwitchName, type SwitchState } from "./switches.ts";
import {
  type GroupOp,
  IdentityStore,
  principalIdFor,
  type UserChange,
} from "./auth/identity-store.ts";

export type Membership = { scope_type: ScopeType; scope_id: string };
export type TenantConfig = { tenantId: string; seed: number; personalOwners: string[] };
export type SeedPrincipal = {
  id: string;
  email: string;
  roleIds: string[];
  memberships: Membership[];
};
export type ActAs = { id: string; roleIds: string[]; memberships: Membership[] };
export type SessionInput = { email: string; actAs: ActAs | null; now: number; limit: number };
export type Session = {
  limited: boolean;
  /** Seconds until the request window resets (set when limited). */
  retryAfter: number;
  principal: { id: string; email: string; roleIds: string[]; memberships: Membership[] };
  ndaGrants: string[];
  elevatedUntil: number | null;
  epoch: number;
  config: TenantConfig | null;
  switches: SwitchState;
  /** False once the directory (SCIM) has deprovisioned the principal: the API refuses every source of identity. */
  active: boolean;
};

const WINDOW_MS = 60_000;
const MAX_ELEVATION_HOURS = 24;
/** A first approval waits this long for the second person. */
const SECOND_PERSON_TTL_MS = 24 * 3_600_000;
/** Tables that make up a TenantPolicy snapshot. The request counter is not part of it. */
const SNAPSHOT_TABLES = [
  "config",
  "principals",
  "role_assignments",
  "memberships",
  "nda_grants",
  "elevations",
  "revocation",
  "switches",
  "pending_ops",
  "principal_status",
  "group_role_map",
  "scim_users",
  "scim_groups",
  "scim_group_members",
] as const;

export class TenantPolicy extends DurableObject<Env> {
  private readonly sql: SqlStorage;
  private readonly identity: IdentityStore;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.identity = new IdentityStore(this.sql, ctx.storage, () => this.bump());
    ctx.blockConcurrencyWhile(async () => {
      this.sql.exec(`
        CREATE TABLE IF NOT EXISTS config (k TEXT PRIMARY KEY, v TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS principals (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE);
        CREATE TABLE IF NOT EXISTS role_assignments (
          principal_id TEXT NOT NULL, role_id TEXT NOT NULL, PRIMARY KEY (principal_id, role_id));
        CREATE TABLE IF NOT EXISTS memberships (
          principal_id TEXT NOT NULL, scope_type TEXT NOT NULL, scope_id TEXT NOT NULL,
          PRIMARY KEY (principal_id, scope_type, scope_id));
        CREATE TABLE IF NOT EXISTS nda_grants (
          principal_id TEXT NOT NULL, account_id TEXT NOT NULL, PRIMARY KEY (principal_id, account_id));
        CREATE TABLE IF NOT EXISTS elevations (
          id INTEGER PRIMARY KEY AUTOINCREMENT, principal_id TEXT NOT NULL,
          until INTEGER NOT NULL, reason TEXT NOT NULL, created_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS revocation (id INTEGER PRIMARY KEY CHECK (id = 1), epoch INTEGER NOT NULL);
        INSERT OR IGNORE INTO revocation (id, epoch) VALUES (1, 0);
        CREATE TABLE IF NOT EXISTS rate (
          principal_id TEXT PRIMARY KEY, window INTEGER NOT NULL, count INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS switches (
          name TEXT PRIMARY KEY, enabled INTEGER NOT NULL, changed_by TEXT NOT NULL, changed_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS pending_ops (
          key TEXT PRIMARY KEY, requested_by TEXT NOT NULL, requested_at INTEGER NOT NULL);
      `);
      this.identity.init();
    });
  }

  private bump(): number {
    return this.sql
      .exec("UPDATE revocation SET epoch = epoch + 1 WHERE id = 1 RETURNING epoch")
      .one().epoch as number;
  }

  epoch(): number {
    return this.sql.exec("SELECT epoch FROM revocation WHERE id = 1").one().epoch as number;
  }

  getConfig(): TenantConfig | null {
    const row = this.sql.exec("SELECT v FROM config WHERE k = 'tenant'").toArray()[0];
    return row ? (JSON.parse(row.v as string) as TenantConfig) : null;
  }

  /** Replace the tenant's directory. Dev seed only. Resets grants, elevations and counters. */
  seed(config: TenantConfig, principals: SeedPrincipal[], now: number = Date.now()): number {
    this.ctx.storage.transactionSync(() => {
      for (const t of [
        "principals",
        "role_assignments",
        "memberships",
        "nda_grants",
        "elevations",
        "rate",
      ])
        this.sql.exec(`DELETE FROM ${t}`);
      this.sql.exec(
        "INSERT INTO config (k, v) VALUES ('tenant', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v",
        JSON.stringify(config),
      );
      this.sql.exec(
        "INSERT INTO config (k, v) VALUES ('seeded_at', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v",
        String(now),
      );
      for (const p of principals) {
        this.sql.exec(
          "INSERT INTO principals (id, email) VALUES (?, ?)",
          p.id,
          p.email.toLowerCase(),
        );
        for (const r of p.roleIds)
          this.sql.exec(
            "INSERT INTO role_assignments (principal_id, role_id) VALUES (?, ?)",
            p.id,
            r,
          );
        for (const m of p.memberships)
          this.sql.exec(
            "INSERT INTO memberships (principal_id, scope_type, scope_id) VALUES (?, ?, ?)",
            p.id,
            m.scope_type,
            m.scope_id,
          );
      }
    });
    return this.bump();
  }

  /**
   * Dev auto-seed guard: seed only when no `seeded_at` row exists, so concurrent first requests seed once.
   * Returns the new epoch, or null when the tenant was already seeded.
   */
  seedOnce(config: TenantConfig, principals: SeedPrincipal[], now: number): number | null {
    const done = this.sql.exec("SELECT 1 FROM config WHERE k = 'seeded_at'").toArray().length > 0;
    return done ? null : this.seed(config, principals, now);
  }

  /**
   * Resolve the caller for one request: identity, roles, grants, elevation and the request counter.
   * `actAs` (dev personas only, decided by the API) replaces stored roles and memberships.
   */
  async session(input: SessionInput): Promise<Session> {
    const email = input.email.trim().toLowerCase();
    const row = this.sql.exec("SELECT id FROM principals WHERE email = ?", email).toArray()[0];
    const identityId = (row?.id as string | undefined) ?? (await principalIdFor(email));

    const window = Math.floor(input.now / WINDOW_MS);
    const count = this.sql
      .exec(
        `INSERT INTO rate (principal_id, window, count) VALUES (?, ?, 1)
         ON CONFLICT(principal_id) DO UPDATE SET
           window = excluded.window,
           count = CASE WHEN rate.window = excluded.window THEN rate.count + 1 ELSE 1 END
         RETURNING count`,
        identityId,
        window,
      )
      .one().count as number;

    let id = identityId;
    let roleIds: string[] = [];
    let memberships: Membership[] = [];
    if (input.actAs) {
      ({ id, roleIds, memberships } = input.actAs);
    } else if (row) {
      roleIds = this.sql
        .exec("SELECT role_id FROM role_assignments WHERE principal_id = ? ORDER BY role_id", id)
        .toArray()
        .map((r) => r.role_id as string);
      roleIds = [...new Set([...roleIds, ...this.identity.mappedRoles(id)])].sort();
      memberships = this.sql
        .exec(
          "SELECT scope_type, scope_id FROM memberships WHERE principal_id = ? ORDER BY 1, 2",
          id,
        )
        .toArray()
        .map((r) => ({ scope_type: r.scope_type as ScopeType, scope_id: r.scope_id as string }));
    }
    const ndaGrants = this.sql
      .exec("SELECT account_id FROM nda_grants WHERE principal_id = ? ORDER BY 1", id)
      .toArray()
      .map((r) => r.account_id as string);
    const until = this.sql
      .exec(
        "SELECT MAX(until) AS u FROM elevations WHERE principal_id = ? AND until > ?",
        id,
        input.now,
      )
      .one().u as number | null;

    return {
      limited: count > input.limit,
      retryAfter: Math.max(1, Math.ceil(((window + 1) * WINDOW_MS - input.now) / 1000)),
      principal: { id, email, roleIds, memberships },
      ndaGrants,
      elevatedUntil: until,
      epoch: this.epoch(),
      config: this.getConfig(),
      switches: this.switchState(),
      active: this.identity.isEmailActive(email),
    };
  }

  /** Fixed one-minute window counter for sensitive low-volume routes such as seeding. */
  hit(key: string, now: number, limit: number): { limited: boolean; retryAfter: number } {
    const window = Math.floor(now / WINDOW_MS);
    const count = this.sql
      .exec(
        `INSERT INTO rate (principal_id, window, count) VALUES (?, ?, 1)
         ON CONFLICT(principal_id) DO UPDATE SET
           window = excluded.window,
           count = CASE WHEN rate.window = excluded.window THEN rate.count + 1 ELSE 1 END
         RETURNING count`,
        key,
        window,
      )
      .one().count as number;
    return {
      limited: count > limit,
      retryAfter: Math.max(1, Math.ceil(((window + 1) * WINDOW_MS - now) / 1000)),
    };
  }

  /** Members per role, for the admin role list. */
  roleCounts(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const r of this.sql
      .exec("SELECT role_id, COUNT(*) AS n FROM role_assignments GROUP BY role_id")
      .toArray())
      out[r.role_id as string] = r.n as number;
    return out;
  }

  // ---- directory changes: each one bumps the revocation epoch ----

  setRoles(principalId: string, roleIds: string[]): number {
    this.ctx.storage.transactionSync(() => {
      this.sql.exec("DELETE FROM role_assignments WHERE principal_id = ?", principalId);
      for (const r of roleIds)
        this.sql.exec(
          "INSERT INTO role_assignments (principal_id, role_id) VALUES (?, ?)",
          principalId,
          r,
        );
    });
    return this.bump();
  }

  addMembership(principalId: string, m: Membership): number {
    this.sql.exec(
      "INSERT OR IGNORE INTO memberships (principal_id, scope_type, scope_id) VALUES (?, ?, ?)",
      principalId,
      m.scope_type,
      m.scope_id,
    );
    return this.bump();
  }

  grantNda(principalId: string, accountId: string): number {
    this.sql.exec(
      "INSERT OR IGNORE INTO nda_grants (principal_id, account_id) VALUES (?, ?)",
      principalId,
      accountId,
    );
    return this.bump();
  }

  revokeNda(principalId: string, accountId: string): number {
    this.sql.exec(
      "DELETE FROM nda_grants WHERE principal_id = ? AND account_id = ?",
      principalId,
      accountId,
    );
    return this.bump();
  }

  /** Time-boxed elevation with a stated reason. Capped at 24 hours; the policy engine applies the role's own limit. */
  elevate(principalId: string, hours: number, reason: string, now: number): number | null {
    if (!reason.trim()) return null; // an elevation without a stated reason is refused
    const h = Math.min(Math.max(hours, 0), MAX_ELEVATION_HOURS);
    this.sql.exec(
      "INSERT INTO elevations (principal_id, until, reason, created_at) VALUES (?, ?, ?, ?)",
      principalId,
      now + h * 3_600_000,
      reason.slice(0, 200),
      now,
    );
    return this.bump();
  }

  /** Remove every role, membership, NDA grant and elevation of a principal. */
  revokeAll(principalId: string): number {
    this.ctx.storage.transactionSync(() => {
      for (const t of ["role_assignments", "memberships", "nda_grants", "elevations"])
        this.sql.exec(`DELETE FROM ${t} WHERE principal_id = ?`, principalId);
    });
    return this.bump();
  }

  // ---- operations: kill switches, two-person steps, snapshots, rights ----

  private switchState(): SwitchState {
    const out = allOn();
    for (const r of this.sql.exec("SELECT name, enabled FROM switches").toArray())
      if (isSwitchName(r.name)) out[r.name] = r.enabled === 1;
    return out;
  }

  /** Current state with who changed it and when, plus the re-enable requests waiting for a second person. */
  switchStatus(now: number): {
    switches: Record<SwitchName, { enabled: boolean; changedAt: number | null }>;
    pending: { switch: SwitchName; requestedAt: number }[];
  } {
    const state = this.switchState();
    const at = new Map(
      this.sql
        .exec("SELECT name, changed_at FROM switches")
        .toArray()
        .map((r) => [r.name as string, r.changed_at as number]),
    );
    const switches = Object.fromEntries(
      SWITCHES.map((n) => [n, { enabled: state[n], changedAt: at.get(n) ?? null }]),
    ) as Record<SwitchName, { enabled: boolean; changedAt: number | null }>;
    const pending = this.sql
      .exec(
        "SELECT key, requested_at FROM pending_ops WHERE key LIKE 'switch:%' AND requested_at > ?",
        now - SECOND_PERSON_TTL_MS,
      )
      .toArray()
      .map((r) => ({
        switch: (r.key as string).slice(7) as SwitchName,
        requestedAt: r.requested_at as number,
      }));
    return { switches, pending };
  }

  /**
   * Turning a switch off is always one person. Turning it back on needs a second, different person
   * when `twoPerson` is set (prod): the first request is recorded and expires after 24 hours.
   */
  setSwitch(
    name: SwitchName,
    enabled: boolean,
    actor: string,
    now: number,
    twoPerson: boolean,
  ): { status: "applied" | "pending"; sameActor?: boolean } {
    const apply = () =>
      this.sql.exec(
        `INSERT INTO switches (name, enabled, changed_by, changed_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET enabled = excluded.enabled, changed_by = excluded.changed_by,
           changed_at = excluded.changed_at`,
        name,
        enabled ? 1 : 0,
        actor,
        now,
      );
    if (!enabled) {
      apply();
      this.sql.exec("DELETE FROM pending_ops WHERE key = ?", `switch:${name}`);
      return { status: "applied" };
    }
    if (this.switchState()[name]) return { status: "applied" };
    if (twoPerson) {
      const r = this.requestSecond(`switch:${name}`, actor, now);
      if (r !== "second") return { status: "pending", sameActor: r === "same" };
    }
    apply();
    return { status: "applied" };
  }

  /**
   * Two-person rule. "first": recorded. "same": the same person asked again, nothing changes.
   * "second": a different person confirmed within 24 hours, so the caller may proceed.
   */
  requestSecond(key: string, actor: string, now: number): "first" | "same" | "second" {
    const row = this.sql
      .exec("SELECT requested_by, requested_at FROM pending_ops WHERE key = ?", key)
      .toArray()[0];
    if (!row || (row.requested_at as number) <= now - SECOND_PERSON_TTL_MS) {
      this.sql.exec(
        `INSERT INTO pending_ops (key, requested_by, requested_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET requested_by = excluded.requested_by, requested_at = excluded.requested_at`,
        key,
        actor,
        now,
      );
      return "first";
    }
    if (row.requested_by === actor) return "same";
    this.sql.exec("DELETE FROM pending_ops WHERE key = ?", key);
    return "second";
  }

  /** Id of the principal behind an email, or the stable anonymous id when the email is not in the directory. */
  async resolvePrincipalId(email: string): Promise<string> {
    const e = email.trim().toLowerCase();
    const row = this.sql.exec("SELECT id FROM principals WHERE email = ?", e).toArray()[0];
    return (row?.id as string | undefined) ?? (await principalIdFor(e));
  }

  listPrincipalIds(): string[] {
    const ids = new Set(
      this.sql
        .exec("SELECT id FROM principals ORDER BY id")
        .toArray()
        .map((r) => r.id as string),
    );
    for (const id of this.getConfig()?.personalOwners ?? []) ids.add(id);
    return [...ids].sort();
  }

  /** Right to erasure for the directory: identity, roles, memberships, grants, elevations, counters. */
  erasePrincipal(principalId: string): number {
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(
        "DELETE FROM scim_group_members WHERE user_id IN (SELECT id FROM scim_users WHERE principal_id = ?)",
        principalId,
      );
      for (const t of [
        "principal_status",
        "oidc_groups",
        "scim_users",
        "auth_sessions",
        "principals",
        "role_assignments",
        "memberships",
        "nda_grants",
        "elevations",
        "rate",
      ])
        this.sql.exec(
          `DELETE FROM ${t} WHERE ${t === "principals" ? "id" : "principal_id"} = ?`,
          principalId,
        );
      this.sql.exec("DELETE FROM pending_ops WHERE requested_by = ?", principalId);
    });
    return this.bump();
  }

  exportAll(): Snapshot {
    return exportTables(this.sql, SNAPSHOT_TABLES);
  }

  /** Replace this tenant's directory from a snapshot and bump the epoch so every session is re-checked. */
  importAll(data: unknown): number {
    const rows = replaceTables(this.ctx.storage, SNAPSHOT_TABLES, data);
    this.sql.exec("INSERT OR IGNORE INTO revocation (id, epoch) VALUES (1, 0)");
    this.bump();
    return rows;
  // ---- identity: sessions, Entra group map, SCIM (see auth/identity-store.ts) ----

  loginStatePut(h: string, nonce: string, verifier: string, returnTo: string | null, now: number) {
    this.identity.loginStatePut(h, nonce, verifier, returnTo, now);
  }
  loginStateTake(h: string, now: number) {
    return this.identity.loginStateTake(h, now);
  }
  sessionCreate(idHash: string, email: string, groups: string[], now: number) {
    return this.identity.sessionCreate(idHash, email.trim().toLowerCase(), groups, now);
  }
  sessionValidate(idHash: string, now: number) {
    return this.identity.sessionValidate(idHash, now);
  }
  sessionDelete(idHash: string) {
    this.identity.sessionDelete(idHash);
  }
  sessionCount(principalId: string) {
    return this.identity.sessionCount(principalId);
  }
  groupMapList() {
    return this.identity.groupMapList();
  }
  groupMapSet(groupId: string, roleId: string) {
    return this.identity.groupMapSet(groupId, roleId);
  }
  groupMapDelete(groupId: string) {
    return this.identity.groupMapDelete(groupId);
  }
  scimUserGet(id: string) {
    return this.identity.scimUserGet(id);
  }
  scimUserList(f: { userName?: string; externalId?: string; id?: string }, s: number, c: number) {
    return this.identity.scimUserList(f, s, c);
  }
  scimUserCreate(input: Parameters<IdentityStore["scimUserCreate"]>[0], now: number) {
    return this.identity.scimUserCreate(input, now);
  }
  scimUserPatch(id: string, change: UserChange, now: number) {
    return this.identity.scimUserPatch(id, change, now);
  }
  scimUserDelete(id: string, now: number) {
    return this.identity.scimUserDelete(id, now);
  }
  scimGroupGet(id: string) {
    return this.identity.scimGroupGet(id);
  }
  scimGroupList(f: { displayName?: string; externalId?: string }, s: number, c: number) {
    return this.identity.scimGroupList(f, s, c);
  }
  scimGroupCreate(input: Parameters<IdentityStore["scimGroupCreate"]>[0], now: number) {
    return this.identity.scimGroupCreate(input, now);
  }
  scimGroupApply(id: string, ops: GroupOp[], now: number) {
    return this.identity.scimGroupApply(id, ops, now);
  }
  scimGroupDelete(id: string) {
    return this.identity.scimGroupDelete(id);
  }
}
