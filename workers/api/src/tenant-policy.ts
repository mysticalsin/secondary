// TenantPolicy: one Durable Object per tenant (SQLite). It owns who a person is inside the tenant:
// principals, role assignments, memberships, named NDA grants, time-boxed elevations, the
// revocation epoch and the per-principal request counter. It holds no organisation content.

import { DurableObject } from "cloudflare:workers";
import type { ScopeType } from "@secondary/policy";

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
};

const WINDOW_MS = 60_000;
const MAX_ELEVATION_HOURS = 24;

const toHex = (buf: ArrayBuffer): string =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** Stable id for an email that is not in the principal table. Not stored: unknown means no roles. */
async function anonymousId(email: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email));
  return `u_${toHex(d).slice(0, 16)}`;
}

export class TenantPolicy extends DurableObject<Env> {
  private readonly sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
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
      `);
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
  seed(config: TenantConfig, principals: SeedPrincipal[]): number {
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
   * Resolve the caller for one request: identity, roles, grants, elevation and the request counter.
   * `actAs` (dev personas only, decided by the API) replaces stored roles and memberships.
   */
  async session(input: SessionInput): Promise<Session> {
    const email = input.email.trim().toLowerCase();
    const row = this.sql.exec("SELECT id FROM principals WHERE email = ?", email).toArray()[0];
    const identityId = (row?.id as string | undefined) ?? (await anonymousId(email));

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
}
