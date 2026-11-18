// The identity half of TenantPolicy: browser sessions, login state, the Entra group to role table
// and the SCIM directory. It is plain SQL over the Durable Object's own storage. TenantPolicy
// constructs one and exposes thin RPC methods. Nothing here holds organisation content.

import { ROLE_ORDER, ROLES } from "@secondary/policy";
import { normalEmail, normalizedEmailSql } from "../../../../src/state/actor.ts";
import type { SecurityJournal } from "../security-journal.ts";
import {
  ABSOLUTE_MS,
  IDLE_MS,
  LOGIN_STATE_MS,
  MAX_LOGIN_STATES,
  MAX_LOGIN_STATES_PER_IP,
  MAX_SESSIONS_PER_PRINCIPAL,
} from "./limits.ts";

const toHex = (buf: ArrayBuffer): string =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** Stable id for an email. The same value is used for a principal that is not in the seed. */
export async function principalIdFor(email: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email));
  return `u_${toHex(d).slice(0, 16)}`;
}

/** Roles that can configure the tenant. A directory group never confers them (M-11): they need the console. */
const PRIVILEGED_ROLES: ReadonlySet<string> = new Set(
  ROLE_ORDER.filter((r) => ROLES[r].grants.some((g) => g.actions.includes("configure"))),
);

/** Group ids are Entra object ids (GUIDs). They compare case-insensitively. */
export const groupKey = (s: string): string => s.trim().toLowerCase();

const GROUP_KEY = /^[a-z0-9][a-z0-9_.:-]{0,63}$/;
const MAX_OIDC_GROUPS = 500;
const MAX_FIELD = 256;
const MAX_JSON = 4_096;

export type Email = { value: string; type?: string; primary?: boolean };
/** Plain string maps and typed lists only: Durable Object RPC cannot type `unknown`. */
export type NameRec = Record<string, string>;

export type ScimUserRec = {
  id: string;
  userName: string;
  externalId: string | null;
  displayName: string | null;
  name: NameRec | null;
  emails: Email[] | null;
  active: boolean;
  created: number;
  modified: number;
};
export type ScimGroupRec = {
  id: string;
  displayName: string;
  externalId: string | null;
  memberIds: string[];
  created: number;
  modified: number;
};
export type UserChange = {
  userName?: string;
  externalId?: string | null;
  displayName?: string | null;
  name?: NameRec | null;
  emails?: Email[] | null;
  active?: boolean;
};
export type GroupOp =
  | { kind: "name"; value: string }
  | { kind: "externalId"; value: string | null }
  | { kind: "add" | "remove" | "replace"; ids: string[] };
/** What Entra says about the person. `tid:oid` is the key; the email is an attribute. */
export type EntraSubject = {
  tid: string;
  oid: string;
  email: string;
  emailIsUpn: boolean;
  guest: boolean;
};
export type SignInFail = "not_provisioned" | "identity_conflict";
export type Fail = { ok: false; code: "not_found" | "uniqueness" | "invalid" | "ambiguous" };
export type Ok<T> = { ok: true } & T;

const fail = (code: Fail["code"]): Fail => ({ ok: false, code });
const s = (v: unknown): string => v as string;
const n = (v: unknown): number => v as number;

/** Thrown inside a storage transaction so the insert rolls back. */
class AmbiguousPrincipal extends Error {
  constructor() {
    super("ambiguous_principal");
    this.name = "AmbiguousPrincipal";
  }
}

export class IdentityStore {
  private readonly sql: SqlStorage;
  private readonly storage: DurableObjectStorage;
  /** Bumps the tenant's revocation epoch. */
  private readonly bump: () => number;
  private readonly journal: SecurityJournal | undefined;

  constructor(
    sql: SqlStorage,
    storage: DurableObjectStorage,
    bump: () => number,
    journal?: SecurityJournal,
  ) {
    this.sql = sql;
    this.storage = storage;
    this.bump = bump;
    this.journal = journal;
  }

  init(): void {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS principal_status (
        principal_id TEXT PRIMARY KEY, active INTEGER NOT NULL, changed_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS auth_sessions (
        id_hash TEXT PRIMARY KEY, principal_id TEXT NOT NULL, email TEXT NOT NULL,
        created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL, expires_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS auth_sessions_principal ON auth_sessions (principal_id);
      CREATE TABLE IF NOT EXISTS login_state (
        state_hash TEXT PRIMARY KEY, nonce TEXT NOT NULL, verifier TEXT NOT NULL,
        return_to TEXT, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS group_role_map (group_id TEXT PRIMARY KEY, role_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS oidc_groups (
        principal_id TEXT NOT NULL, group_id TEXT NOT NULL, PRIMARY KEY (principal_id, group_id));
      CREATE TABLE IF NOT EXISTS scim_users (
        id TEXT PRIMARY KEY, principal_id TEXT NOT NULL, user_name TEXT NOT NULL UNIQUE,
        external_id TEXT, display_name TEXT, name TEXT, emails TEXT,
        created_at INTEGER NOT NULL, modified_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS scim_users_principal ON scim_users (principal_id);
      CREATE TABLE IF NOT EXISTS scim_groups (
        id TEXT PRIMARY KEY, display_name TEXT NOT NULL, external_id TEXT,
        created_at INTEGER NOT NULL, modified_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS scim_group_members (
        group_id TEXT NOT NULL, user_id TEXT NOT NULL, PRIMARY KEY (group_id, user_id));
    `);
    // L-07: each pending sign-in remembers a hash of the address that started it.
    try {
      this.sql.exec("ALTER TABLE login_state ADD COLUMN ip_hash TEXT NOT NULL DEFAULT ''");
    } catch {
      // The column exists already.
    }
    // H-01: an Entra principal is keyed by `tid:oid`. The email column is an attribute.
    try {
      this.sql.exec("ALTER TABLE principals ADD COLUMN subject TEXT");
    } catch {
      // The column exists already.
    }
    this.sql.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS principals_subject ON principals (subject) WHERE subject IS NOT NULL",
    );
  }

  // ---- principals ----

  /** Principal rows whose stored email folds to `email`. Blank matches nothing. The column is not rewritten. */
  /** True when another SCIM row already folds to this user name. The stored bytes are not rewritten. */
  private userNameTaken(userName: string, exceptId?: string): boolean {
    const folded = normalEmail(userName);
    if (!folded) return false;
    const sql = exceptId
      ? `SELECT 1 FROM scim_users WHERE ${normalizedEmailSql("user_name")} = ? AND id <> ?`
      : `SELECT 1 FROM scim_users WHERE ${normalizedEmailSql("user_name")} = ?`;
    const args: SqlStorageValue[] = exceptId ? [folded, exceptId] : [folded];
    return this.sql.exec(sql, ...args).toArray().length > 0;
  }

  private emailRows(email: string): { id: string; subject: string | null }[] {
    const normalized = normalEmail(email);
    if (!normalized) return [];
    return this.sql
      .exec(
        `SELECT id, subject FROM principals WHERE ${normalizedEmailSql("email")} = ? ORDER BY id`,
        normalized,
      )
      .toArray()
      .map((r) => ({ id: s(r.id), subject: (r.subject as string | null) ?? null }));
  }

  private warnAmbiguous(ids: string[]): void {
    console.warn(JSON.stringify({ at: "identity", reason: "ambiguous_principal", ids }));
  }

  private async ensurePrincipal(email: string): Promise<string | Fail> {
    const normalized = normalEmail(email);
    if (!normalized) return fail("invalid");
    const ids = (): string[] => this.emailRows(normalized).map((row) => row.id);
    const have = ids();
    if (have.length > 1) {
      this.warnAmbiguous(have);
      return fail("ambiguous");
    }
    if (have.length === 1) return have[0] as string;
    const id = await principalIdFor(normalized);
    try {
      return this.storage.transactionSync(() => {
        this.sql.exec("INSERT OR IGNORE INTO principals (id, email) VALUES (?, ?)", id, normalized);
        const again = ids();
        const others = again.filter((found) => found !== id);
        if (others.length > 0) {
          this.warnAmbiguous(others);
          throw new AmbiguousPrincipal();
        }
        return again[0] ?? id;
      });
    } catch (err) {
      if (err instanceof AmbiguousPrincipal) return fail("ambiguous");
      throw err;
    }
  }

  isActive(principalId: string): boolean {
    const r = this.sql
      .exec("SELECT active FROM principal_status WHERE principal_id = ?", principalId)
      .toArray()[0];
    return r === undefined || r.active === 1;
  }

  /** True when a directory (SCIM) manages this tenant: the token is set, or SCIM has provisioned anyone. */
  isManaged(configured: boolean): boolean {
    return configured || this.sql.exec("SELECT 1 FROM scim_users LIMIT 1").toArray().length > 0;
  }

  /**
   * Active unless the directory (SCIM) says otherwise. An email that is not a principal is active
   * only while no directory manages the tenant: under SCIM an unknown principal is not active (H-02).
   */
  isEmailActive(email: string, managed: boolean): boolean {
    const rows = this.emailRows(email);
    if (rows.length > 1) {
      this.warnAmbiguous(rows.map((row) => row.id));
      return false;
    }
    return rows.length === 0 ? !managed : this.isActive(rows[0].id);
  }

  /** The Entra subject (`tid:oid`) a principal is bound to, or null for an email-keyed principal. */
  subjectOfEmail(email: string): string | null {
    const rows = this.emailRows(email);
    if (rows.length > 1) {
      this.warnAmbiguous(rows.map((row) => row.id));
      return null;
    }
    return rows[0]?.subject ?? null;
  }

  private setStatus(principalId: string, active: boolean, now: number): void {
    this.sql.exec(
      `INSERT INTO principal_status (principal_id, active, changed_at) VALUES (?, ?, ?)
       ON CONFLICT(principal_id) DO UPDATE SET active = excluded.active, changed_at = excluded.changed_at`,
      principalId,
      active ? 1 : 0,
      now,
    );
    // Outside the snapshot, so a restore cannot bring a leaver back (N-02).
    this.journal?.status(principalId, active, now);
  }

  /** Deactivate and kill every session of the principal, then bump the revocation epoch. */
  deprovision(principalId: string, now: number): number {
    this.storage.transactionSync(() => {
      this.setStatus(principalId, false, now);
      this.sql.exec("DELETE FROM auth_sessions WHERE principal_id = ?", principalId);
    });
    return this.bump();
  }

  // ---- role mapping ----

  /**
   * Roles from Entra groups. A principal provisioned through SCIM takes its groups from SCIM only
   * (so a removal applies at once). Anyone else takes the groups claim stored at their last login.
   * A SCIM group is matched by its externalId (the Entra object id) and falls back to its own id.
   */
  mappedRoles(principalId: string): string[] {
    return this.mappedRolesRaw(principalId).filter((r) => !PRIVILEGED_ROLES.has(r));
  }

  private mappedRolesRaw(principalId: string): string[] {
    return this.sql
      .exec(
        `SELECT DISTINCT role_id FROM group_role_map WHERE group_id IN (
           SELECT group_id FROM oidc_groups
             WHERE principal_id = ?1
               AND NOT EXISTS (SELECT 1 FROM scim_users WHERE principal_id = ?1)
           UNION
           SELECT lower(COALESCE(NULLIF(g.external_id, ''), g.id))
             FROM scim_group_members gm
             JOIN scim_groups g ON g.id = gm.group_id
             JOIN scim_users u ON u.id = gm.user_id
            WHERE u.principal_id = ?1)
         ORDER BY role_id`,
        principalId,
      )
      .toArray()
      .map((r) => s(r.role_id));
  }

  groupMapList(): { groupId: string; roleId: string }[] {
    return this.sql
      .exec("SELECT group_id, role_id FROM group_role_map ORDER BY group_id")
      .toArray()
      .map((r) => ({ groupId: s(r.group_id), roleId: s(r.role_id) }));
  }

  groupMapSet(groupId: string, roleId: string): number | null {
    const g = groupKey(groupId);
    if (!GROUP_KEY.test(g) || !(ROLE_ORDER as readonly string[]).includes(roleId)) return null;
    if (PRIVILEGED_ROLES.has(roleId)) return null;
    this.sql.exec(
      `INSERT INTO group_role_map (group_id, role_id) VALUES (?, ?)
       ON CONFLICT(group_id) DO UPDATE SET role_id = excluded.role_id`,
      g,
      roleId,
    );
    return this.bump();
  }

  groupMapDelete(groupId: string): number {
    this.sql.exec("DELETE FROM group_role_map WHERE group_id = ?", groupKey(groupId));
    return this.bump();
  }

  // ---- login state (single use) ----

  loginStatePut(
    stateHash: string,
    nonce: string,
    verifier: string,
    returnTo: string | null,
    now: number,
    ipHash = "",
  ): void {
    this.sql.exec("DELETE FROM login_state WHERE expires_at <= ?", now);
    // L-07: one address cannot push other people's pending sign-ins out. Its own oldest states go
    // first, and when the table is full the rows of the busiest addresses go before anyone else's.
    this.sql.exec(
      `DELETE FROM login_state WHERE state_hash IN (
         SELECT state_hash FROM (
           SELECT state_hash, row_number() OVER (PARTITION BY ip_hash ORDER BY created_at DESC, rowid DESC) AS rk
             FROM login_state WHERE ip_hash = ?) WHERE rk > ?)`,
      ipHash,
      MAX_LOGIN_STATES_PER_IP - 1,
    );
    this.sql.exec(
      `DELETE FROM login_state WHERE state_hash IN (
         SELECT state_hash FROM (
           SELECT state_hash,
                  row_number() OVER (PARTITION BY ip_hash ORDER BY created_at DESC, rowid DESC) AS rk,
                  created_at
             FROM login_state)
         ORDER BY rk DESC, created_at ASC LIMIT max(0, (SELECT COUNT(*) FROM login_state) - ?))`,
      MAX_LOGIN_STATES - 1,
    );
    this.sql.exec(
      "INSERT INTO login_state (state_hash, nonce, verifier, return_to, created_at, expires_at, ip_hash) VALUES (?, ?, ?, ?, ?, ?, ?)",
      stateHash,
      nonce,
      verifier,
      returnTo,
      now,
      now + LOGIN_STATE_MS,
      ipHash,
    );
  }

  /** Consumes the record: a second call with the same state returns null. */
  loginStateTake(
    stateHash: string,
    now: number,
  ): { nonce: string; verifier: string; returnTo: string | null } | null {
    const r = this.sql
      .exec(
        "DELETE FROM login_state WHERE state_hash = ? RETURNING nonce, verifier, return_to, expires_at",
        stateHash,
      )
      .toArray()[0];
    if (!r || n(r.expires_at) <= now) return null;
    return {
      nonce: s(r.nonce),
      verifier: s(r.verifier),
      returnTo: (r.return_to as string | null) ?? null,
    };
  }

  // ---- sessions ----

  /**
   * Resolves an Entra sign-in to a principal (H-01, H-02). The key is `tid:oid`, never the email.
   *  1. A principal already bound to this subject wins.
   *  2. Under a SCIM-managed tenant the user must be provisioned: SCIM `externalId` = oid. A SCIM
   *     record without an externalId matches on its userName = UPN, then binds. Nobody else gets in.
   *  3. Otherwise a new principal is made, or an email-keyed one is bound, but only for a member
   *     whose UPN equals the stored email. A guest, or an `email` claim, never takes over a principal.
   */
  private async resolveEntra(w: EntraSubject, managed: boolean): Promise<string | SignInFail> {
    const subject = `${w.tid}:${w.oid}`;
    const bound = this.sql
      .exec("SELECT id, email FROM principals WHERE subject = ?", subject)
      .toArray()[0];
    if (bound) {
      const id = s(bound.id);
      // The email is an attribute: follow a UPN change when the new one is free.
      // Case and padding are the same address, so they do not rewrite the stored text.
      const next = normalEmail(w.email);
      if (normalEmail(s(bound.email)) !== next && w.emailIsUpn && !w.guest && next) {
        const taken = this.emailRows(next).filter((row) => row.id !== id);
        if (taken.length > 1) this.warnAmbiguous(taken.map((row) => row.id));
        if (taken.length === 0) this.sql.exec("UPDATE principals SET email = ? WHERE id = ?", w.email, id);
      }
      return id;
    }
    if (managed) {
      const viaOid = this.sql
        .exec("SELECT principal_id FROM scim_users WHERE lower(external_id) = ?", w.oid)
        .toArray()[0];
      const foldedName = normalEmail(w.email);
      const viaName =
        viaOid || w.guest || !w.emailIsUpn || !foldedName
          ? undefined
          : this.sql
              .exec(
                `SELECT principal_id FROM scim_users WHERE external_id IS NULL AND ${normalizedEmailSql("user_name")} = ?`,
                foldedName,
              )
              .toArray()[0];
      const row = viaOid ?? viaName;
      if (!row) return "not_provisioned";
      const id = s(row.principal_id);
      const cur = this.sql.exec("SELECT subject FROM principals WHERE id = ?", id).toArray()[0];
      if (cur && cur.subject !== null) return "identity_conflict";
      this.sql.exec("UPDATE principals SET subject = ? WHERE id = ?", subject, id);
      return id;
    }
    const matches = this.emailRows(w.email);
    if (matches.length > 1) {
      this.warnAmbiguous(matches.map((row) => row.id));
      return "identity_conflict";
    }
    const byEmail = matches[0];
    if (!byEmail) {
      if (!normalEmail(w.email)) return "identity_conflict";
      const id = await principalIdFor(subject);
      this.sql.exec(
        "INSERT INTO principals (id, email, subject) VALUES (?, ?, ?)",
        id,
        w.email,
        subject,
      );
      return id;
    }
    if (byEmail.subject !== null || w.guest || !w.emailIsUpn) return "identity_conflict";
    this.sql.exec("UPDATE principals SET subject = ? WHERE id = ?", subject, byEmail.id);
    return byEmail.id;
  }

  async sessionCreate(
    idHash: string,
    who: EntraSubject,
    groups: string[],
    now: number,
    managedConfigured: boolean,
  ): Promise<{ ok: true; principalId: string } | { ok: false; reason: SignInFail | "inactive" }> {
    const resolved = await this.resolveEntra(who, this.isManaged(managedConfigured));
    if (resolved === "not_provisioned" || resolved === "identity_conflict")
      return { ok: false, reason: resolved };
    const principalId = resolved;
    if (!this.isActive(principalId)) return { ok: false, reason: "inactive" };
    const email = s(
      this.sql.exec("SELECT email FROM principals WHERE id = ?", principalId).one().email,
    );
    const keys = [...new Set(groups.map(groupKey).filter((g) => GROUP_KEY.test(g)))].slice(
      0,
      MAX_OIDC_GROUPS,
    );
    this.storage.transactionSync(() => {
      this.sql.exec("DELETE FROM oidc_groups WHERE principal_id = ?", principalId);
      for (const g of keys)
        this.sql.exec(
          "INSERT INTO oidc_groups (principal_id, group_id) VALUES (?, ?)",
          principalId,
          g,
        );
      this.sql.exec("DELETE FROM auth_sessions WHERE expires_at <= ?", now);
      this.sql.exec(
        `DELETE FROM auth_sessions WHERE principal_id = ?1 AND id_hash IN (
           SELECT id_hash FROM auth_sessions WHERE principal_id = ?1
           ORDER BY created_at DESC LIMIT -1 OFFSET ?2)`,
        principalId,
        MAX_SESSIONS_PER_PRINCIPAL - 1,
      );
      this.sql.exec(
        `INSERT INTO auth_sessions (id_hash, principal_id, email, created_at, last_seen, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        idHash,
        principalId,
        email,
        now,
        now,
        now + ABSOLUTE_MS,
      );
    });
    return { ok: true, principalId };
  }

  /**
   * The signed-in email for a session id hash, or null. Refuses an expired or idle session, and a
   * session whose principal is gone or deactivated. Status is read on every request, which is
   * stricter than the five-minute re-check the plan asks for.
   */
  sessionValidate(idHash: string, now: number): { email: string; principalId: string } | null {
    const r = this.sql
      .exec(
        "SELECT principal_id, email, last_seen, expires_at FROM auth_sessions WHERE id_hash = ?",
        idHash,
      )
      .toArray()[0];
    if (!r) return null;
    const principalId = s(r.principal_id);
    const gone =
      now >= n(r.expires_at) ||
      now - n(r.last_seen) >= IDLE_MS ||
      !this.isActive(principalId) ||
      this.sql.exec("SELECT 1 FROM principals WHERE id = ?", principalId).toArray().length === 0;
    if (gone) {
      this.sql.exec("DELETE FROM auth_sessions WHERE id_hash = ?", idHash);
      return null;
    }
    this.sql.exec("UPDATE auth_sessions SET last_seen = ? WHERE id_hash = ?", now, idHash);
    // The principal's current email, not the one stored at login: a rename or UPN change follows (M-10).
    const cur = this.sql.exec("SELECT email FROM principals WHERE id = ?", principalId).one();
    return { email: s(cur.email), principalId };
  }

  sessionDelete(idHash: string): void {
    this.sql.exec("DELETE FROM auth_sessions WHERE id_hash = ?", idHash);
  }

  sessionCount(principalId: string): number {
    return n(
      this.sql
        .exec("SELECT COUNT(*) AS c FROM auth_sessions WHERE principal_id = ?", principalId)
        .one().c,
    );
  }

  // ---- SCIM users ----

  private userRow(r: Record<string, SqlStorageValue>): ScimUserRec {
    return {
      id: s(r.id),
      userName: s(r.user_name),
      externalId: (r.external_id as string | null) ?? null,
      displayName: (r.display_name as string | null) ?? null,
      name: r.name ? (JSON.parse(s(r.name)) as NameRec) : null,
      emails: r.emails ? (JSON.parse(s(r.emails)) as Email[]) : null,
      active: r.active === 1,
      created: n(r.created_at),
      modified: n(r.modified_at),
    };
  }

  private static readonly USER_SELECT = `
    SELECT u.id, u.principal_id, u.user_name, u.external_id, u.display_name, u.name, u.emails,
           u.created_at, u.modified_at, COALESCE(ps.active, 1) AS active
      FROM scim_users u LEFT JOIN principal_status ps ON ps.principal_id = u.principal_id`;

  scimUserGet(id: string): ScimUserRec | null {
    const r = this.sql.exec(`${IdentityStore.USER_SELECT} WHERE u.id = ?`, id).toArray()[0];
    return r ? this.userRow(r) : null;
  }

  scimUserList(
    f: { userName?: string; externalId?: string; id?: string },
    start: number,
    count: number,
  ): { total: number; users: ScimUserRec[] } {
    const where: string[] = [];
    const args: SqlStorageValue[] = [];
    if (f.userName !== undefined) {
      where.push(`${normalizedEmailSql("u.user_name")} = ?`);
      args.push(normalEmail(f.userName) ?? "");
    }
    if (f.externalId !== undefined) {
      where.push("u.external_id = ?");
      args.push(f.externalId);
    }
    if (f.id !== undefined) {
      where.push("u.id = ?");
      args.push(f.id);
    }
    const w = where.length ? ` WHERE ${where.join(" AND ")}` : "";
    const total = n(this.sql.exec(`SELECT COUNT(*) AS c FROM scim_users u${w}`, ...args).one().c);
    const users = this.sql
      .exec(
        `${IdentityStore.USER_SELECT}${w} ORDER BY u.created_at, u.id LIMIT ? OFFSET ?`,
        ...args,
        count,
        Math.max(start - 1, 0),
      )
      .toArray()
      .map((r) => this.userRow(r));
    return { total, users };
  }

  async scimUserCreate(
    input: {
      userName: string;
      externalId?: string | null;
      displayName?: string | null;
      name?: NameRec | null;
      emails?: Email[] | null;
      active: boolean;
    },
    now: number,
  ): Promise<Ok<{ user: ScimUserRec }> | Fail> {
    const userName = input.userName.trim().toLowerCase();
    if (!userName.includes("@") || userName.length > 254 || !normalEmail(userName)) return fail("invalid");
    if (this.userNameTaken(userName)) return fail("uniqueness");
    const principalId = await this.ensurePrincipal(userName);
    if (typeof principalId !== "string") return principalId;
    // One SCIM record per principal: a second userName cannot claim the same login.
    if (
      this.sql.exec("SELECT 1 FROM scim_users WHERE principal_id = ?", principalId).toArray().length
    )
      return fail("uniqueness");
    const id = crypto.randomUUID();
    this.storage.transactionSync(() => {
      this.sql.exec(
        `INSERT INTO scim_users (id, principal_id, user_name, external_id, display_name, name, emails, created_at, modified_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        principalId,
        userName,
        clip(input.externalId),
        clip(input.displayName),
        json(input.name),
        json(input.emails),
        now,
        now,
      );
    });
    if (input.active) this.setStatus(principalId, true, now);
    else this.deprovision(principalId, now);
    return { ok: true, user: this.scimUserGet(id) as ScimUserRec };
  }

  async scimUserPatch(
    id: string,
    c: UserChange,
    now: number,
  ): Promise<Ok<{ user: ScimUserRec }> | Fail> {
    const row = this.sql
      .exec("SELECT principal_id, user_name FROM scim_users WHERE id = ?", id)
      .toArray()[0];
    if (!row) return fail("not_found");
    const principalId = s(row.principal_id);
    let renamed = false;
    if (c.userName !== undefined) {
      const userName = c.userName.trim().toLowerCase();
      if (!userName.includes("@") || userName.length > 254) return fail("invalid");
      if (userName !== row.user_name) {
        const twins = this.emailRows(userName).filter((row) => row.id !== principalId);
        if (twins.length > 1) this.warnAmbiguous(twins.map((row) => row.id));
        const taken = this.userNameTaken(userName, id) || twins.length > 0;
        if (taken) return fail("uniqueness");
        this.storage.transactionSync(() => {
          this.sql.exec(
            "UPDATE scim_users SET user_name = ?, modified_at = ? WHERE id = ?",
            userName,
            now,
            id,
          );
          this.sql.exec("UPDATE principals SET email = ? WHERE id = ?", userName, principalId);
        });
        renamed = true;
      }
    }
    const sets: string[] = [];
    const args: SqlStorageValue[] = [];
    const put = (col: string, v: SqlStorageValue) => {
      sets.push(`${col} = ?`);
      args.push(v);
    };
    if (c.externalId !== undefined) put("external_id", clip(c.externalId));
    if (c.displayName !== undefined) put("display_name", clip(c.displayName));
    if (c.name !== undefined) {
      // A partial name (name.givenName alone) merges into what is stored; null clears it.
      const cur = this.sql.exec("SELECT name FROM scim_users WHERE id = ?", id).one().name;
      const merged = c.name === null ? null : { ...(cur ? JSON.parse(s(cur)) : {}), ...c.name };
      put("name", json(merged));
    }
    if (c.emails !== undefined) put("emails", json(c.emails));
    if (sets.length || c.active !== undefined)
      this.sql.exec(
        `UPDATE scim_users SET ${[...sets, "modified_at = ?"].join(", ")} WHERE id = ?`,
        ...args,
        now,
        id,
      );
    if (c.active === false) this.deprovision(principalId, now);
    else if (c.active === true && !this.isActive(principalId)) {
      this.setStatus(principalId, true, now);
      this.bump();
    }
    // A new login name is a new identity at the IdP: sign the old one out.
    if (renamed) {
      this.sql.exec("DELETE FROM auth_sessions WHERE principal_id = ?", principalId);
      this.bump();
    }
    return { ok: true, user: this.scimUserGet(id) as ScimUserRec };
  }

  scimUserDelete(id: string, now: number): boolean {
    const row = this.sql.exec("SELECT principal_id FROM scim_users WHERE id = ?", id).toArray()[0];
    if (!row) return false;
    this.deprovision(s(row.principal_id), now);
    this.storage.transactionSync(() => {
      this.sql.exec("DELETE FROM scim_group_members WHERE user_id = ?", id);
      this.sql.exec("DELETE FROM scim_users WHERE id = ?", id);
    });
    return true;
  }

  // ---- SCIM groups ----

  private groupRow(r: Record<string, SqlStorageValue>): ScimGroupRec {
    return {
      id: s(r.id),
      displayName: s(r.display_name),
      externalId: (r.external_id as string | null) ?? null,
      memberIds: this.sql
        .exec("SELECT user_id FROM scim_group_members WHERE group_id = ? ORDER BY user_id", s(r.id))
        .toArray()
        .map((m) => s(m.user_id)),
      created: n(r.created_at),
      modified: n(r.modified_at),
    };
  }

  scimGroupGet(id: string): ScimGroupRec | null {
    const r = this.sql.exec("SELECT * FROM scim_groups WHERE id = ?", id).toArray()[0];
    return r ? this.groupRow(r) : null;
  }

  scimGroupList(
    f: { displayName?: string; externalId?: string },
    start: number,
    count: number,
  ): { total: number; groups: ScimGroupRec[] } {
    const where: string[] = [];
    const args: SqlStorageValue[] = [];
    if (f.displayName !== undefined) {
      where.push("display_name = ? COLLATE NOCASE");
      args.push(f.displayName);
    }
    if (f.externalId !== undefined) {
      where.push("external_id = ?");
      args.push(f.externalId);
    }
    const w = where.length ? ` WHERE ${where.join(" AND ")}` : "";
    const total = n(this.sql.exec(`SELECT COUNT(*) AS c FROM scim_groups${w}`, ...args).one().c);
    const groups = this.sql
      .exec(
        `SELECT * FROM scim_groups${w} ORDER BY created_at, id LIMIT ? OFFSET ?`,
        ...args,
        count,
        Math.max(start - 1, 0),
      )
      .toArray()
      .map((r) => this.groupRow(r));
    return { total, groups };
  }

  scimGroupCreate(
    input: { displayName: string; externalId?: string | null; memberIds: string[] },
    now: number,
  ): Ok<{ group: ScimGroupRec }> | Fail {
    const displayName = input.displayName.trim();
    if (!displayName || displayName.length > MAX_FIELD) return fail("invalid");
    if (
      this.sql
        .exec("SELECT 1 FROM scim_groups WHERE display_name = ? COLLATE NOCASE", displayName)
        .toArray().length
    )
      return fail("uniqueness");
    if (!this.allUsers(input.memberIds)) return fail("invalid");
    const id = crypto.randomUUID();
    this.storage.transactionSync(() => {
      this.sql.exec(
        "INSERT INTO scim_groups (id, display_name, external_id, created_at, modified_at) VALUES (?, ?, ?, ?, ?)",
        id,
        displayName,
        clip(input.externalId),
        now,
        now,
      );
      for (const u of new Set(input.memberIds))
        this.sql.exec("INSERT INTO scim_group_members (group_id, user_id) VALUES (?, ?)", id, u);
    });
    this.bump();
    return { ok: true, group: this.scimGroupGet(id) as ScimGroupRec };
  }

  private allUsers(ids: string[]): boolean {
    return ids.every(
      (u) => this.sql.exec("SELECT 1 FROM scim_users WHERE id = ?", u).toArray().length > 0,
    );
  }

  /** Applies the operations in order, all or nothing. Every group change bumps the epoch. */
  scimGroupApply(id: string, ops: GroupOp[], now: number): Ok<{ group: ScimGroupRec }> | Fail {
    if (!this.scimGroupGet(id)) return fail("not_found");
    for (const op of ops) {
      if (op.kind === "name") {
        const v = op.value.trim();
        if (!v || v.length > MAX_FIELD) return fail("invalid");
        if (
          this.sql
            .exec(
              "SELECT 1 FROM scim_groups WHERE display_name = ? COLLATE NOCASE AND id <> ?",
              v,
              id,
            )
            .toArray().length
        )
          return fail("uniqueness");
      } else if (op.kind === "add" || op.kind === "replace") {
        if (!this.allUsers(op.ids)) return fail("invalid");
      }
    }
    this.storage.transactionSync(() => {
      for (const op of ops) {
        if (op.kind === "name")
          this.sql.exec(
            "UPDATE scim_groups SET display_name = ? WHERE id = ?",
            op.value.trim(),
            id,
          );
        else if (op.kind === "externalId")
          this.sql.exec("UPDATE scim_groups SET external_id = ? WHERE id = ?", clip(op.value), id);
        else if (op.kind === "replace") {
          this.sql.exec("DELETE FROM scim_group_members WHERE group_id = ?", id);
          for (const u of new Set(op.ids))
            this.sql.exec(
              "INSERT INTO scim_group_members (group_id, user_id) VALUES (?, ?)",
              id,
              u,
            );
        } else if (op.kind === "add")
          for (const u of op.ids)
            this.sql.exec(
              "INSERT OR IGNORE INTO scim_group_members (group_id, user_id) VALUES (?, ?)",
              id,
              u,
            );
        else
          for (const u of op.ids)
            this.sql.exec(
              "DELETE FROM scim_group_members WHERE group_id = ? AND user_id = ?",
              id,
              u,
            );
      }
      this.sql.exec("UPDATE scim_groups SET modified_at = ? WHERE id = ?", now, id);
    });
    this.bump();
    return { ok: true, group: this.scimGroupGet(id) as ScimGroupRec };
  }

  scimGroupDelete(id: string): boolean {
    if (!this.scimGroupGet(id)) return false;
    this.storage.transactionSync(() => {
      this.sql.exec("DELETE FROM scim_group_members WHERE group_id = ?", id);
      this.sql.exec("DELETE FROM scim_groups WHERE id = ?", id);
    });
    this.bump();
    return true;
  }
}

const clip = (v: string | null | undefined): string | null =>
  v === undefined || v === null ? null : v.slice(0, MAX_FIELD);
const json = (v: unknown): string | null => {
  if (v === undefined || v === null) return null;
  const t = JSON.stringify(v);
  return t.length <= MAX_JSON ? t : null;
};
