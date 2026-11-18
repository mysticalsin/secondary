// TenantPolicy: one Durable Object per tenant (SQLite). It owns who a person is inside the tenant:
// principals, role assignments, memberships, named NDA grants, time-boxed elevations, the
// revocation epoch and the per-principal request counter. It holds no organisation content.

import { DurableObject } from "cloudflare:workers";
import { ROLE_ORDER, ROLES, type ScopeType } from "@secondary/policy";
import {
  actorFromDirectory,
  type ActorIdentity,
  type DirectoryPrincipal,
  normalEmail,
  normalizedEmailSql,
  sameActor,
} from "../../../src/state/actor.ts";
import {
  decodeErasureLedger,
  encodeErasure,
  erasureWithGrant,
  ledgerVersion,
  withLedgerVersion,
} from "../../../src/state/erasure-request.ts";
import { forgetPilotMember } from "../../../src/state/pilot-member.ts";
import {
  commitQuorum,
  type QuorumResult,
  type QuorumState,
  SECOND_PERSON_TTL_MS,
} from "../../../src/state/quorum.ts";
import {
  commitWikiSeed,
  loadSeed,
  readSeedVersion,
  RESEED_NEEDED,
  type SeedEvent,
  seedWrites,
  storeSeed,
} from "../../../src/state/wiki-seed.ts";
import { effectiveStatus } from "../../../src/state/elevation.ts";
import { commit, reject } from "../../../src/state/illegal.ts";
import {
  commitSwitch,
  decodeSwitchEnabled,
  type SwitchEvent,
} from "../../../src/state/kill-switch.ts";
import { lastAcceptedMs, nonceExpiresAt } from "../../../packages/contracts/src/signed-call.ts";
import { GOV_METHODS, GovStore } from "./admin/store.ts";
import {
  type EntraSubject,
  type GroupOp,
  IdentityStore,
  principalIdFor,
  type UserChange,
} from "./auth/identity-store.ts";
import { exportTables, replaceTables, type Snapshot } from "./ops-snapshot.ts";
import { SecurityJournal } from "./security-journal.ts";
import { allOn, isSwitchName, SWITCHES, type SwitchName, type SwitchState } from "./switches.ts";

export type Membership = { scope_type: ScopeType; scope_id: string };
export type TenantConfig = { tenantId: string; seed: number; personalOwners: string[] };
export type SeedPrincipal = {
  id: string;
  email: string;
  roleIds: string[];
  memberships: Membership[];
};
export type ActAs = { id: string; roleIds: string[]; memberships: Membership[] };
export type SessionInput = {
  email: string;
  actAs: ActAs | null;
  now: number;
  limit: number;
  /** Which identity source signed the request in. */
  via?: "entra" | "access" | "internal";
  /** A directory (SCIM) manages this tenant: an unknown principal is not active (H-02). */
  managed?: boolean;
  /** This email is explicitly linked to its Access identity (ACCESS_LINKED_EMAILS). */
  accessLinked?: boolean;
};
export type Session = {
  limited: boolean;
  /** Seconds until the request window resets (set when limited). */
  retryAfter: number;
  principal: { id: string; email: string; roleIds: string[]; memberships: Membership[] };
  ndaGrants: string[];
  /** Node ids opened to Everyone at Mantu (reader or contributor). The engine lifts reading only. */
  openBrains: string[];
  elevatedUntil: number | null;
  epoch: number;
  config: TenantConfig | null;
  switches: SwitchState;
  /** False once the directory (SCIM) has deprovisioned the principal: the API refuses every source of identity. */
  active: boolean;
  /** Changes whenever a role is edited. The API refetches the role table only when it moves. */
  rolesVersion: number;
};

const WINDOW_MS = 60_000;
const MAX_ELEVATION_HOURS = 24;
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
  "gov_meta",
  "gov_roles",
  "gov_role_history",
  "gov_changes",
  "gov_elevations",
  "gov_access_requests",
  "gov_identity",
  "gov_notifications",
  "pilot_cohorts",
  "open_brains",
] as const;

/** Features a pilot cohort can switch on. A key no cohort mentions is on for everyone. */
export const FLAG_KEYS = ["brains_v3", "imports", "coach", "batch_review", "journal"] as const;
export type FlagKey = (typeof FLAG_KEYS)[number];
export type Cohort = {
  id: string;
  name: string;
  members: string[];
  flags: Record<string, boolean>;
  createdAt: number;
};
export type AgentRow = {
  grantId: string;
  clientId: string;
  host: string;
  scopes: string[];
  firstAt: number;
  lastAt: number;
  lastTool: string;
  calls: number;
  revoked: boolean;
};
const seenUnknownSwitch = new Set<string>();
const MAX_COHORTS = 20;
const MAX_COHORT_MEMBERS = 500;
const MAX_GRANTS_PER_PERSON = 50;

export class TenantPolicy extends DurableObject<Env> {
  private readonly sql: SqlStorage;
  private readonly identity: IdentityStore;
  private readonly journal: SecurityJournal;
  private govStore!: GovStore;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.journal = new SecurityJournal(this.sql);
    this.identity = new IdentityStore(this.sql, ctx.storage, () => this.bump(), this.journal);
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
        CREATE TABLE IF NOT EXISTS nonces (key TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
        -- Not in SNAPSHOT_TABLES on purpose: a restore replaces the listed tables only, so this list
        -- survives it and is applied again afterwards (M-03). It is never exported or backed up.
        -- Everyone at Mantu per brain node (the one place the engine reads it from). In SNAPSHOT_TABLES:
        -- it is tenant security state, and a restore must not leave a brain wider or narrower than saved.
        CREATE TABLE IF NOT EXISTS open_brains (
          node_id TEXT PRIMARY KEY, level TEXT NOT NULL CHECK (level IN ('reader', 'contributor')));
        CREATE TABLE IF NOT EXISTS pilot_cohorts (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, members TEXT NOT NULL, flags TEXT NOT NULL,
          created_at INTEGER NOT NULL);
        -- Agent connections (one row per OAuth grant that called). Not in SNAPSHOT_TABLES on purpose:
        -- a restore must never bring back a connection that was revoked. Content-free: ids, host, scopes.
        CREATE TABLE IF NOT EXISTS agent_grants (
          principal_id TEXT NOT NULL, grant_id TEXT NOT NULL, client_id TEXT NOT NULL, host TEXT NOT NULL,
          scopes TEXT NOT NULL, first_at INTEGER NOT NULL, last_at INTEGER NOT NULL,
          last_tool TEXT NOT NULL, calls INTEGER NOT NULL, revoked_at INTEGER,
          PRIMARY KEY (principal_id, grant_id));
        CREATE TABLE IF NOT EXISTS erasure_tombstones (
          principal_id TEXT PRIMARY KEY, pseudonym TEXT NOT NULL, aliases TEXT NOT NULL,
          erased_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
        -- One erasure request per subject. Not in SNAPSHOT_TABLES: a restore must not roll
        -- the ledger back. Re-apply reopens the steps that snapshot brought back.
        CREATE TABLE IF NOT EXISTS erasure_requests (
          principal_id TEXT PRIMARY KEY, status TEXT NOT NULL, ledger TEXT NOT NULL,
          updated_at INTEGER NOT NULL);
      `);
      this.journal.init();
      this.identity.init();
      // Governance console state (roles as data, changes, elevations, requests, inbox).
      this.govStore = new GovStore(
        {
          sql: this.sql,
          tx: (fn) => ctx.storage.transactionSync(fn),
          bump: () => this.bump(),
          journal: this.journal,
        },
        ROLE_ORDER.map((r) => ROLES[r]),
      );
    });
  }

  /** Single entry point for admin/store.ts, so this class stays small. Typed by admin/client.ts. */
  gov(method: string, args: unknown[]): unknown {
    if (!(GOV_METHODS as readonly string[]).includes(method))
      return {
        ok: false,
        code: "unknown_gov_method",
        message: "Not a governance method",
        status: 400,
      };
    const fn = (this.govStore as unknown as Record<string, (...a: unknown[]) => unknown>)[method];
    return (fn as (...a: unknown[]) => unknown).apply(this.govStore, args);
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
        "erasure_tombstones",
        "erasure_requests",
        "open_brains",
      ])
        this.sql.exec(`DELETE FROM ${t}`);
      this.govStore.reset(now);
      this.journal.clear();
      // The workspaces are emptied by a reseed, so the wiki seed starts over too.
      this.applySeed({ type: "reset" });
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
          normalEmail(p.email) ?? p.email,
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
   * The version of the dev wiki seed this tenant has completed (0 when none).
   * A corrupt cell is `reseed needed`. The log names the key and not the cell.
   */
  seedVersion(): number | typeof RESEED_NEEDED {
    const read = readSeedVersion(this.seedCell("seed_version"), this.seedCell("seed_claim"));
    if (read.keys.length) console.warn(JSON.stringify({ at: "wiki_seed_unreadable", keys: read.keys }));
    return read.completed;
  }

  /**
   * Dev wiki seed: take the right to run version `version`. Returns the owner token the
   * completer must present, or null when the claim is refused. An unexpired claim blocks
   * every version. A corrupt cell refuses the claim.
   */
  seedClaim(version: number, now: number, leaseMs = 120_000): string | null {
    const owner = crypto.randomUUID();
    return this.applySeed({ type: "claim", version, now, leaseMs, owner }) ? owner : null;
  }

  /** The same owner finishes the claim. A different owner, or no claim, is refused. */
  seedDone(version: number, owner: string): boolean {
    return this.applySeed({ type: "complete", version, owner }) !== null;
  }

  private seedCell(key: string): string | null {
    const row = this.sql.exec("SELECT v FROM config WHERE k = ?", key).toArray()[0];
    return row ? String(row.v) : null;
  }

  private applySeed(event: SeedEvent): ReturnType<typeof loadSeed> | null {
    const next = commitWikiSeed(
      loadSeed(this.seedCell("seed_version"), this.seedCell("seed_claim")),
      event,
    );
    if (!next.ok) return null;
    if (!seedWrites(next.effects)) return next.state;
    const cells = storeSeed(next.state);
    for (const [key, value] of [
      ["seed_version", cells.version],
      ["seed_claim", cells.claim],
    ] as const) {
      if (value === null) this.sql.exec("DELETE FROM config WHERE k = ?", key);
      else {
        this.sql.exec(
          "INSERT INTO config (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v",
          key,
          value,
        );
      }
    }
    return next.state;
  }

  /** Ids whose stored email normalises to `email`. Blank is not an identity. Stored text is not rewritten. */
  private principalIdsForEmail(email: string): string[] {
    const normalized = normalEmail(email);
    if (!normalized) return [];
    return this.sql
      .exec(
        `SELECT id FROM principals WHERE ${normalizedEmailSql("email")} = ? ORDER BY id`,
        normalized,
      )
      .toArray()
      .map((r) => r.id as string);
  }

  /**
   * Resolve the caller for one request: identity, roles, grants, elevation and the request counter.
   * `actAs` (dev personas only, decided by the API) replaces stored roles and memberships.
   */
  async session(input: SessionInput): Promise<Session> {
    const email = normalEmail(input.email) ?? "";
    const matches = this.principalIdsForEmail(email);
    if (matches.length > 1 && !input.actAs) {
      console.warn(JSON.stringify({ at: "identity", reason: "ambiguous_principal", ids: matches }));
      return {
        limited: false,
        retryAfter: 1,
        principal: { id: "", email, roleIds: [], memberships: [] },
        ndaGrants: [],
        openBrains: [],
        elevatedUntil: null,
        epoch: this.epoch(),
        config: this.getConfig(),
        switches: this.switchState(),
        active: false,
        rolesVersion: this.govStore.rolesVersion(),
      };
    }
    const rowId = matches.length === 1 ? matches[0] : undefined;
    const identityId = rowId ?? (await principalIdFor(email));

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
      // Memberships granted through the console add to the persona's own (dev only).
      const stored = this.sql
        .exec("SELECT scope_type, scope_id FROM memberships WHERE principal_id = ?", id)
        .toArray()
        .map((r) => ({ scope_type: r.scope_type as ScopeType, scope_id: r.scope_id as string }));
      memberships = [
        ...memberships,
        ...stored.filter(
          (m) =>
            !memberships.some((x) => x.scope_type === m.scope_type && x.scope_id === m.scope_id),
        ),
      ];
    } else if (rowId) {
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
    // Grants and elevations load only for a principal that exists (M-10): a renamed or unknown email
    // falls back to a derived id and must not inherit what an earlier holder of that id was given.
    const known = !!rowId || !!input.actAs;
    const ndaGrants = known
      ? this.sql
          .exec(
            "SELECT account_id FROM nda_grants WHERE principal_id = ? AND (expires_at IS NULL OR expires_at > ?) ORDER BY 1",
            id,
            input.now,
          )
          .toArray()
          .map((r) => r.account_id as string)
      : [];
    const openUntil = known
      ? this.sql
          .exec("SELECT until FROM elevations WHERE principal_id = ?", id)
          .toArray()
          .map((r) => r.until as number)
          .filter(
            (until) =>
              effectiveStatus({ status: "active", lapsesAt: 0, until }, input.now).tag === "active",
          )
      : [];
    const until = openUntil.length ? Math.max(...openUntil) : null;
    // H-01: an Entra-bound principal is not reachable through another identity source by email alone.
    const hijack =
      !input.actAs &&
      input.via !== undefined &&
      input.via !== "entra" &&
      !input.accessLinked &&
      this.identity.subjectOfEmail(email) !== null;

    return {
      limited: count > input.limit,
      retryAfter: Math.max(1, Math.ceil(((window + 1) * WINDOW_MS - input.now) / 1000)),
      principal: { id, email, roleIds, memberships },
      ndaGrants,
      openBrains: this.sql
        .exec("SELECT node_id FROM open_brains ORDER BY 1")
        .toArray()
        .map((r) => r.node_id as string),
      elevatedUntil: until,
      epoch: this.epoch(),
      config: this.getConfig(),
      switches: this.switchState(),
      active: !hijack && this.identity.isEmailActive(email, input.managed === true),
      rolesVersion: this.govStore.rolesVersion(),
    };
  }

  // ---- agent connections (docs/API-CONTRACT.md "Agent connections") ----

  /**
   * Record one MCP call by grant, or learn that the grant was revoked. A revoked grant is never
   * updated again and the caller must refuse the call. Ids, host, scopes and the tool name only.
   */
  agentSeen(a: {
    principalId: string;
    grantId: string;
    clientId: string;
    host: string;
    scopes: string[];
    tool: string;
    now: number;
  }): { revoked: boolean } {
    const row = this.sql
      .exec(
        "SELECT revoked_at FROM agent_grants WHERE principal_id = ? AND grant_id = ?",
        a.principalId,
        a.grantId,
      )
      .toArray()[0];
    if (row?.revoked_at != null) return { revoked: true };
    this.sql.exec(
      `INSERT INTO agent_grants (principal_id, grant_id, client_id, host, scopes, first_at, last_at, last_tool, calls)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
       ON CONFLICT(principal_id, grant_id) DO UPDATE SET last_at = excluded.last_at,
         last_tool = excluded.last_tool, scopes = excluded.scopes, host = excluded.host, calls = calls + 1`,
      a.principalId,
      a.grantId,
      a.clientId,
      a.host,
      JSON.stringify(a.scopes.slice(0, 10)),
      a.now,
      a.now,
      a.tool.slice(0, 60),
    );
    // Keep the newest rows only; a revoked one is kept as long as it is among them.
    this.sql.exec(
      `DELETE FROM agent_grants WHERE principal_id = ? AND grant_id NOT IN
         (SELECT grant_id FROM agent_grants WHERE principal_id = ? ORDER BY last_at DESC LIMIT ?)`,
      a.principalId,
      a.principalId,
      MAX_GRANTS_PER_PERSON,
    );
    return { revoked: false };
  }

  agentList(principalId: string): AgentRow[] {
    return this.sql
      .exec("SELECT * FROM agent_grants WHERE principal_id = ? ORDER BY last_at DESC", principalId)
      .toArray()
      .map((r) => ({
        grantId: r.grant_id as string,
        clientId: r.client_id as string,
        host: r.host as string,
        scopes: JSON.parse(r.scopes as string) as string[],
        firstAt: r.first_at as number,
        lastAt: r.last_at as number,
        lastTool: r.last_tool as string,
        calls: r.calls as number,
        revoked: r.revoked_at != null,
      }));
  }

  /** Revoke the caller's own grants, one by id or every grant of a host. Returns the grants revoked. */
  agentRevoke(
    principalId: string,
    by: { grantId: string } | { host: string } | { all: true },
    now: number,
  ): { grantId: string; clientId: string }[] {
    const hit =
      "all" in by
        ? this.sql
            .exec(
              "UPDATE agent_grants SET revoked_at = ? WHERE principal_id = ? AND revoked_at IS NULL RETURNING grant_id, client_id",
              now,
              principalId,
            )
            .toArray()
        : "grantId" in by
          ? this.sql
              .exec(
                "UPDATE agent_grants SET revoked_at = ? WHERE principal_id = ? AND grant_id = ? AND revoked_at IS NULL RETURNING grant_id, client_id",
                now,
                principalId,
                by.grantId,
              )
              .toArray()
          : this.sql
              .exec(
                "UPDATE agent_grants SET revoked_at = ? WHERE principal_id = ? AND host = ? AND revoked_at IS NULL RETURNING grant_id, client_id",
                now,
                principalId,
                by.host,
              )
              .toArray();
    return hit.map((r) => ({ grantId: r.grant_id as string, clientId: r.client_id as string }));
  }

  // ---- Everyone at Mantu (brain access) ----

  /** Open a brain node to Everyone at Mantu, or close it ("none"). The API has bounded it by type. */
  openBrainSet(nodeId: string, level: "none" | "reader" | "contributor"): void {
    if (level === "none") this.sql.exec("DELETE FROM open_brains WHERE node_id = ?", nodeId);
    else
      this.sql.exec(
        "INSERT INTO open_brains (node_id, level) VALUES (?, ?) ON CONFLICT(node_id) DO UPDATE SET level = excluded.level",
        nodeId,
        level,
      );
    // Sessions and views are rebuilt from the table on every request; the epoch keeps caches honest.
    this.bump();
  }

  // ---- pilot cohorts ----

  pilotList(): Cohort[] {
    return this.sql
      .exec("SELECT * FROM pilot_cohorts ORDER BY created_at, id")
      .toArray()
      .map((r) => ({
        id: r.id as string,
        name: r.name as string,
        members: JSON.parse(r.members as string) as string[],
        flags: JSON.parse(r.flags as string) as Record<string, boolean>,
        createdAt: r.created_at as number,
      }));
  }

  pilotSave(
    c: { id: string; name: string; members: string[]; flags: Record<string, boolean> },
    create: boolean,
    now: number,
  ): "ok" | "not_found" | "too_many" {
    const exists =
      this.sql.exec("SELECT 1 FROM pilot_cohorts WHERE id = ?", c.id).toArray().length > 0;
    if (
      create &&
      (this.sql.exec("SELECT COUNT(*) AS n FROM pilot_cohorts").one().n as number) >= MAX_COHORTS
    )
      return "too_many";
    if (!create && !exists) return "not_found";
    const members = [...new Set(c.members.map((m) => m.trim().toLowerCase()))].slice(
      0,
      MAX_COHORT_MEMBERS,
    );
    this.sql.exec(
      `INSERT INTO pilot_cohorts (id, name, members, flags, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, members = excluded.members, flags = excluded.flags`,
      c.id,
      c.name,
      JSON.stringify(members),
      JSON.stringify(c.flags),
      now,
    );
    return "ok";
  }

  pilotDelete(id: string): boolean {
    return (
      this.sql.exec("DELETE FROM pilot_cohorts WHERE id = ? RETURNING 1", id).toArray().length > 0
    );
  }

  /** A person's name leaves every invite list (erasure). */
  private pilotForget(email: string): void {
    for (const row of this.sql.exec("SELECT id, members FROM pilot_cohorts").toArray()) {
      const decision = forgetPilotMember(row.members, email);
      if (decision.tag === "keep") continue;
      const members = decision.tag === "write" ? JSON.stringify(decision.members) : "[]";
      this.sql.exec("UPDATE pilot_cohorts SET members = ? WHERE id = ?", members, row.id as string);
    }
  }

  /** Flags for one address: a key is managed once any cohort sets it, and is then on only for its members. */
  flagsFor(email: string): Record<FlagKey, boolean> {
    const e = email.trim().toLowerCase();
    const cohorts = this.pilotList();
    const out = {} as Record<FlagKey, boolean>;
    for (const k of FLAG_KEYS) {
      const setBy = cohorts.filter((c) => Object.hasOwn(c.flags, k));
      out[k] =
        setBy.length === 0 || setBy.some((c) => c.flags[k] === true && c.members.includes(e));
    }
    return out;
  }

  /**
   * Replay guard for the signed service calls. True only the first time a key is stored.
   * A stored key stays refused after expires_at: deleting the row would accept it again.
   * When `bound` is set, expires_at comes from the token time and the verifier's acceptance
   * window, not from this call's receive time. It must be strictly after the last millisecond
   * that window still accepts. An unsafe bound is refused and not inserted. This method does not delete rows.
   */
  nonceFirst(
    key: string,
    now: number,
    ttlMs: number,
    bound?: { tokenExpMs: number; maxSkewMs: number },
  ): boolean {
    let expiresAt = now + ttlMs;
    if (bound) {
      const last = lastAcceptedMs(bound.tokenExpMs, bound.maxSkewMs);
      expiresAt = nonceExpiresAt(bound.tokenExpMs, bound.maxSkewMs);
      if (
        !Number.isSafeInteger(bound.tokenExpMs) ||
        !Number.isSafeInteger(bound.maxSkewMs) ||
        bound.maxSkewMs < 0 ||
        !Number.isSafeInteger(expiresAt) ||
        !(expiresAt > last)
      ) {
        console.warn(JSON.stringify({ at: "nonce_window_short" }));
        return false;
      }
    }
    return (
      this.sql
        .exec(
          "INSERT OR IGNORE INTO nonces (key, expires_at) VALUES (?, ?) RETURNING key",
          key,
          expiresAt,
        )
        .toArray().length === 1
    );
  }

  /**
   * Drop nonce rows whose stored window is already over. Not part of accepting a key:
   * callers run this on a schedule, or beside the guard, never inside `nonceFirst`.
   * A row is removed only when `expires_at < now`.
   */
  pruneNonces(now: number): number {
    return this.sql
      .exec("DELETE FROM nonces WHERE expires_at < ? RETURNING key", now)
      .toArray().length;
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
      this.journal.roles(principalId, roleIds, Date.now());
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
    this.journal.member(principalId, m.scope_type, m.scope_id, true, Date.now());
    return this.bump();
  }

  grantNda(principalId: string, accountId: string): number {
    this.sql.exec(
      "INSERT OR IGNORE INTO nda_grants (principal_id, account_id) VALUES (?, ?)",
      principalId,
      accountId,
    );
    this.journal.nda(principalId, accountId, true, Date.now());
    return this.bump();
  }

  revokeNda(principalId: string, accountId: string): number {
    this.sql.exec(
      "DELETE FROM nda_grants WHERE principal_id = ? AND account_id = ?",
      principalId,
      accountId,
    );
    this.journal.nda(principalId, accountId, false, Date.now());
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
      this.journal.revokeAll(principalId, Date.now());
    });
    return this.bump();
  }

  // ---- operations: kill switches, two-person steps, snapshots, rights ----

  private switchState(): SwitchState {
    const out = allOn();
    for (const r of this.sql.exec("SELECT name, enabled FROM switches").toArray()) {
      if (!isSwitchName(r.name)) {
        const key = typeof r.name === "string" ? r.name : "";
        if (!seenUnknownSwitch.has(key)) {
          seenUnknownSwitch.add(key);
          commit(reject("kill_switch", "unreadable", "read", "unknown_name"));
        }
        continue;
      }
      const flag = decodeSwitchEnabled(r.enabled);
      if (flag.tag === "corrupt") {
        commit(reject("kill_switch", "corrupt", "read", "corrupt_value"));
        out[r.name] = false;
        continue;
      }
      out[r.name] = flag.tag === "on";
    }
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
      .flatMap((r) => {
        const name = (r.key as string).slice("switch:".length);
        return isSwitchName(name) ? [{ switch: name, requestedAt: r.requested_at as number }] : [];
      });
    return { switches, pending };
  }

  /**
   * Turning a switch off is always one person. Turning it back on needs a second, different person
   * when `twoPerson` is set (prod): the first request is recorded and expires after 24 hours.
   */
  setSwitch(
    name: string,
    enabled: boolean,
    actor: string,
    now: number,
    twoPerson: boolean,
    email = "",
  ): { status: "applied" | "pending" | "replay" | "refused"; sameActor?: boolean } {
    const turn = enabled === true ? "turn_on" : "turn_off";
    if (!isSwitchName(name)) {
      commit(reject("kill_switch", "unreadable", turn, "unknown_name"));
      return { status: "refused" };
    }
    if (typeof enabled !== "boolean") {
      commit(reject("kill_switch", "unreadable", "turn", "enabled_unreadable"));
      return { status: "refused" };
    }
    const stored = this.sql.exec("SELECT enabled FROM switches WHERE name = ?", name).toArray()[0];
    const flag = stored === undefined ? { tag: "on" as const } : decodeSwitchEnabled(stored.enabled);
    let event: SwitchEvent;
    if (!enabled) event = { type: "turn_off", now };
    else if (twoPerson && flag.tag === "off" && Number.isSafeInteger(now)) {
      event = {
        type: "turn_on",
        now,
        twoPerson: true,
        quorum: this.requestSecond(`switch:${name}`, actor, now, email),
      };
    } else event = { type: "turn_on", now, twoPerson: false };
    const step = commitSwitch(flag, event);
    if (flag.tag === "corrupt" && step.ok) {
      commit(reject("kill_switch", "corrupt", event.type, "corrupt_value"));
    }
    if (!step.ok) return { status: "refused" };
    for (const effect of step.effects) {
      if (effect.type === "write") {
        this.sql.exec(
          `INSERT INTO switches (name, enabled, changed_by, changed_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(name) DO UPDATE SET enabled = excluded.enabled, changed_by = excluded.changed_by,
             changed_at = excluded.changed_at`,
          name,
          effect.enabled ? 1 : 0,
          actor,
          now,
        );
        // Kept outside the snapshot, so a restore cannot turn a kill switch back on (N-02).
        this.journal.switchSet(name, effect.enabled, now);
      } else {
        this.sql.exec("DELETE FROM pending_ops WHERE key = ?", `switch:${name}`);
      }
    }
    if (step.status === "pending") return { status: "pending", sameActor: step.sameActor === true };
    if (step.status === "replay" || step.status === "refused") return { status: step.status };
    return { status: "applied" };
  }

  /**
   * Two-person rule. The decision is `transitionQuorum`. `recorded` stores the ask.
   * `same_actor` changes nothing. `confirmed` deletes that ask. `replay` means the
   * delete matched no row, so the caller must not apply. `email` is the sign-in
   * address. One human under two ids is one person when a normalised address matches (N-01).
   */
  requestSecond(
    key: string,
    actor: string,
    now: number,
    email = "",
    approvedSteps?: readonly string[],
  ): QuorumResult {
    this.rememberAddress(actor, email);
    const row = this.sql
      .exec("SELECT requested_by, requested_at FROM pending_ops WHERE key = ?", key)
      .toArray()[0];
    const state: QuorumState = row
      ? {
          tag: "waiting",
          requester: this.actorIdentity(row.requested_by as string),
          requestedAt: row.requested_at as number,
        }
      : { tag: "empty" };
    const step = commitQuorum(state, { type: "ask", actor: this.actorIdentity(actor), now });
    if (!step.ok) return { tag: "refused" };
    for (const effect of step.effects) {
      if (effect.type === "upsert") {
        this.sql.exec(
          `INSERT INTO pending_ops (key, requested_by, requested_at) VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET requested_by = excluded.requested_by, requested_at = excluded.requested_at`,
          key,
          effect.requesterId,
          effect.requestedAt,
        );
      } else if (effect.type === "delete") {
        const writeGrant =
          key.startsWith("erase:") && approvedSteps !== undefined && effect.requesterId !== actor;
        let deleted = false;
        const apply = () => {
          const gone = this.sql
            .exec(
              "DELETE FROM pending_ops WHERE key = ? AND requested_by = ? AND requested_at = ? RETURNING key",
              key,
              effect.requesterId,
              effect.requestedAt,
            )
            .toArray();
          if (gone.length === 0) return;
          deleted = true;
          if (writeGrant && approvedSteps)
            this.recordErasureGrant(
              key.slice("erase:".length),
              effect.requesterId,
              actor,
              approvedSteps,
              now,
            );
        };
        if (writeGrant) this.ctx.storage.transactionSync(apply);
        else apply();
        if (!deleted) {
          console.warn(JSON.stringify({ at: "quorum", reason: "replay" }));
          return { tag: "replay" };
        }
      }
    }
    return { tag: step.decision };
  }

  /** Who asked first for a pending two-person step, or null when none is waiting. */
  pendingRequester(key: string, now: number): string | null {
    const row = this.sql
      .exec("SELECT requested_by, requested_at FROM pending_ops WHERE key = ?", key)
      .toArray()[0];
    return row && (row.requested_at as number) > now - SECOND_PERSON_TTL_MS
      ? (row.requested_by as string)
      : null;
  }

  /** Directory rows for `actorFromDirectory`. Stored text is not rewritten. */
  private directoryRows(): DirectoryPrincipal[] {
    return this.sql
      .exec("SELECT id, subject, email FROM principals")
      .toArray()
      .map((r) => ({
        id: r.id as string,
        subject: (r.subject as string | null | undefined) ?? null,
        email: (r.email as string | null | undefined) ?? null,
      }));
  }

  private signInOf(principalId: string): string | null {
    return (
      (this.sql.exec("SELECT email FROM gov_identity WHERE principal_id = ?", principalId).toArray()[0]
        ?.email as string | undefined) ?? null
    );
  }

  /** Identity for quorum and humanIds. The rule is `actorFromDirectory` / `sameActor`. */
  private actorIdentity(principalId: string): ActorIdentity {
    return actorFromDirectory(principalId, this.signInOf(principalId), this.directoryRows());
  }

  /** Remember which address a principal id acted with, so one human holding two ids is recognised (N-01). */
  private rememberAddress(principalId: string, email: string): void {
    const e = email.trim().toLowerCase();
    if (!e.includes("@")) return;
    this.sql.exec(
      "INSERT INTO gov_identity (principal_id, email) VALUES (?, ?) ON CONFLICT(principal_id) DO UPDATE SET email = excluded.email",
      principalId,
      e,
    );
  }

  /** Every principal id of the same human as `principalId`, itself included (N-01). */
  humanIds(principalId: string, email = ""): string[] {
    this.rememberAddress(principalId, email);
    const rows = this.directoryRows();
    const self = actorFromDirectory(principalId, this.signInOf(principalId), rows);
    const ids = new Set([principalId]);
    const seen = new Set(rows.map((r) => r.id));
    for (const r of this.sql.exec("SELECT principal_id AS id FROM gov_identity").toArray())
      seen.add(r.id as string);
    for (const id of seen)
      if (sameActor(self, actorFromDirectory(id, this.signInOf(id), rows))) ids.add(id);
    return [...ids];
  }

  /** Id of the principal behind an email, or the stable anonymous id when the email is not in the directory. */
  async resolvePrincipalId(email: string): Promise<string> {
    const matches = this.principalIdsForEmail(email);
    if (matches.length > 1) {
      console.warn(JSON.stringify({ at: "identity", reason: "ambiguous_principal", ids: matches }));
      throw new Error("ambiguous_principal");
    }
    return matches[0] ?? (await principalIdFor(normalEmail(email) ?? ""));
  }

  /** The address behind a principal id, for erasure (it may be typed into wiki text). */
  emailOfPrincipal(principalId: string): string | null {
    const row = this.sql
      .exec("SELECT email FROM principals WHERE id = ?", principalId)
      .toArray()[0];
    return (row?.email as string | undefined) ?? null;
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
  async erasePrincipal(principalId: string, pseudonym: string): Promise<number> {
    const erasedEmail =
      (this.sql
        .exec("SELECT lower(email) AS e FROM principals WHERE id = ?", principalId)
        .toArray()[0]?.e as string | undefined) ??
      (this.sql
        .exec("SELECT email AS e FROM gov_identity WHERE principal_id = ?", principalId)
        .toArray()[0]?.e as string | undefined);
    this.ctx.storage.transactionSync(() => {
      // Before the principals row goes: the address is looked up through it.
      this.sql.exec(
        "DELETE FROM gov_identity WHERE principal_id = ?1 OR email = (SELECT lower(email) FROM principals WHERE id = ?1)",
        principalId,
      );
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
      this.sql.exec("DELETE FROM agent_grants WHERE principal_id = ?", principalId);
      if (erasedEmail) this.pilotForget(erasedEmail);
      this.journal.forget(principalId, pseudonym);
    });
    return this.bump();
  }

  /**
   * Remember an erasure so a restore can be undone by applying it again. `aliases` are the person's
   * addresses as typed into text. The row lives until the last backup that could hold the person has expired.
   */
  /** The stored erasure request, or null when this subject has none. */
  erasureLoad(principalId: string): { status: string; ledger: string } | null {
    const row = this.sql
      .exec("SELECT status, ledger FROM erasure_requests WHERE principal_id = ?", principalId)
      .toArray()[0];
    if (!row) return null;
    return { status: row.status as string, ledger: row.ledger as string };
  }

  /**
   * Write the confirmed grant on this subject's erasure row. Called inside the
   * same transaction as the pending_ops delete. A one-person ask never reaches it.
   */
  private recordErasureGrant(
    subject: string,
    requester: string,
    confirmer: string,
    steps: readonly string[],
    now: number,
  ): void {
    const loaded = this.erasureLoad(subject);
    const existing = decodeErasureLedger(loaded, subject);
    const next = erasureWithGrant(existing, { subject, requester, confirmer, steps: [...steps] });
    if (next === existing) return;
    const stored = encodeErasure(next);
    this.erasureSave(
      subject,
      stored.status,
      withLedgerVersion(stored.ledger, ledgerVersion(loaded?.ledger) + 1),
      now,
    );
  }

  /**
   * Save an erasure row and its receipt cursor in one transaction.
   * The clock is `updatedAt`, supplied by the caller.
   */
  erasureSaveAtomic(principalId: string, status: string, ledger: string, updatedAt: number): void {
    this.ctx.storage.transactionSync(() => {
      this.erasureSave(principalId, status, ledger, updatedAt);
    });
  }

  /** Replace the erasure request for one subject. The caller supplies the clock. */
  erasureSave(principalId: string, status: string, ledger: string, updatedAt: number): void {
    this.sql.exec(
      `INSERT INTO erasure_requests (principal_id, status, ledger, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(principal_id) DO UPDATE SET status = excluded.status, ledger = excluded.ledger,
         updated_at = excluded.updated_at
       WHERE COALESCE(json_extract(excluded.ledger, '$.v'), 0) > COALESCE(json_extract(erasure_requests.ledger, '$.v'), 0)`,
      principalId,
      status,
      ledger,
      updatedAt,
    );
  }

  /**
   * Remember an erasure until the backup window ends. One statement.
   * A live row (expires_at > now) is left alone. An expired row takes the new
   * expiry and keeps every other column. `now` is the caller's clock.
   */
  tombstoneAdd(
    principalId: string,
    pseudonym: string,
    aliases: string[],
    now: number,
    expiresAt: number,
  ): void {
    this.sql.exec(
      `INSERT INTO erasure_tombstones (principal_id, pseudonym, aliases, erased_at, expires_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(principal_id) DO UPDATE SET expires_at = excluded.expires_at
       WHERE erasure_tombstones.expires_at <= ?`,
      principalId,
      pseudonym,
      JSON.stringify(aliases),
      now,
      expiresAt,
      now,
    );
  }

  tombstoneList(now: number): { principalId: string; pseudonym: string; aliases: string[] }[] {
    return this.sql
      .exec(
        "SELECT principal_id, pseudonym, aliases FROM erasure_tombstones WHERE expires_at > ?",
        now,
      )
      .toArray()
      .map((r) => ({
        principalId: r.principal_id as string,
        pseudonym: r.pseudonym as string,
        aliases: JSON.parse(r.aliases as string) as string[],
      }));
  }

  /** Drops tombstones whose time is up. Returns how many. */
  tombstonePurge(now: number): number {
    return this.sql
      .exec("DELETE FROM erasure_tombstones WHERE expires_at <= ? RETURNING principal_id", now)
      .toArray().length;
  }

  exportAll(): Snapshot {
    return exportTables(this.sql, SNAPSHOT_TABLES);
  }

  /** Replace this tenant's directory from a snapshot and bump the epoch so every session is re-checked. */
  importAll(data: unknown): number {
    // The counter never goes back to a snapshot's lower value (N-02).
    const live = this.epoch();
    const rows = replaceTables(this.ctx.storage, SNAPSHOT_TABLES, data);
    this.sql.exec("INSERT OR IGNORE INTO revocation (id, epoch) VALUES (1, 0)");
    this.sql.exec("UPDATE revocation SET epoch = MAX(epoch, ?) WHERE id = 1", live);
    // Leavers, revoked grants and memberships and kill switches since the snapshot are applied again.
    this.ctx.storage.transactionSync(() => this.journal.replay());
    this.bump();
    return rows;
  }

  // ---- identity: sessions, Entra group map, SCIM (see auth/identity-store.ts) ----

  loginStatePut(
    h: string,
    nonce: string,
    verifier: string,
    returnTo: string | null,
    now: number,
    ipHash = "",
  ) {
    this.identity.loginStatePut(h, nonce, verifier, returnTo, now, ipHash);
  }
  loginStateTake(h: string, now: number) {
    return this.identity.loginStateTake(h, now);
  }
  sessionCreate(
    idHash: string,
    who: EntraSubject,
    groups: string[],
    now: number,
    managed: boolean,
  ) {
    return this.identity.sessionCreate(idHash, who, groups, now, managed);
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
