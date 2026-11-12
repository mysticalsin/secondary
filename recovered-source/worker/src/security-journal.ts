// Security-event journal of a tenant (N-02). A restore replaces the directory tables with an older
// snapshot, which would bring back a leaver, a revoked grant or membership and a kill switch that was
// thrown since. This journal is NOT in TenantPolicy's SNAPSHOT_TABLES, so a restore leaves it alone,
// and `replay` applies it again afterwards. Entries hold ids and names only. They expire after
// JOURNAL_DAYS, which must stay above the backup retention (the oldest snapshot a restore can use).

import { forgetJournalEntry } from "../../../src/state/journal-forget.ts";

export const JOURNAL_DAYS = 90;
const DAY_MS = 86_400_000;

type Kind = "status" | "switch" | "nda" | "member" | "roles" | "revoke_all";

export class SecurityJournal {
  private readonly sql: SqlStorage;

  constructor(sql: SqlStorage) {
    this.sql = sql;
  }

  init(): void {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS security_journal (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, kind TEXT NOT NULL,
        a TEXT NOT NULL, b TEXT NOT NULL DEFAULT '', c TEXT NOT NULL DEFAULT '', v INTEGER NOT NULL DEFAULT 0);
    `);
  }

  private add(at: number, kind: Kind, a: string, b = "", c = "", v = 0): void {
    this.sql.exec(
      "INSERT INTO security_journal (at, kind, a, b, c, v) VALUES (?, ?, ?, ?, ?, ?)",
      at,
      kind,
      a,
      b,
      c,
      v,
    );
    this.sql.exec("DELETE FROM security_journal WHERE at < ?", at - JOURNAL_DAYS * DAY_MS);
  }

  status(principalId: string, active: boolean, at: number): void {
    this.add(at, "status", principalId, "", "", active ? 1 : 0);
  }
  switchSet(name: string, enabled: boolean, at: number): void {
    this.add(at, "switch", name, "", "", enabled ? 1 : 0);
  }
  /** `detail` carries the columns of a grant made through the console (reason, expiry, who granted and approved). */
  nda(
    principalId: string,
    accountId: string,
    granted: boolean,
    at: number,
    detail?: {
      reason: string;
      expiresAt: number | null;
      grantedBy: string;
      approvedBy: string | null;
      grantedAt: number;
    },
  ): void {
    this.add(
      at,
      "nda",
      principalId,
      accountId,
      detail ? JSON.stringify(detail) : "",
      granted ? 1 : 0,
    );
  }
  member(principalId: string, scopeType: string, scopeId: string, added: boolean, at: number) {
    this.add(at, "member", principalId, scopeType, scopeId, added ? 1 : 0);
  }
  roles(principalId: string, roleIds: string[], at: number): void {
    this.add(at, "roles", principalId, JSON.stringify(roleIds));
  }
  revokeAll(principalId: string, at: number): void {
    this.add(at, "revoke_all", principalId);
  }

  /** An erased person leaves no entries behind (the tombstone covers a restore). */
  forget(principalId: string): void {
    for (const row of this.sql.exec("SELECT seq, kind, a, b, c FROM security_journal").toArray()) {
      const decision = forgetJournalEntry(
        {
          kind: String(row.kind ?? ""),
          a: String(row.a ?? ""),
          b: String(row.b ?? ""),
          c: String(row.c ?? ""),
        },
        principalId,
      );
      if (decision.tag === "keep") continue;
      if (decision.tag === "delete")
        this.sql.exec("DELETE FROM security_journal WHERE seq = ?", row.seq as number);
      else this.sql.exec("UPDATE security_journal SET c = ? WHERE seq = ?", decision.c, row.seq as number);
    }
  }

  clear(): void {
    this.sql.exec("DELETE FROM security_journal");
  }

  /**
   * Apply every entry again, oldest first, so the end state is what the tenant had before the restore.
   */
  replay(): number {
    const rows = this.sql.exec("SELECT * FROM security_journal ORDER BY seq").toArray();
    for (const r of rows) {
      const a = r.a as string;
      const b = r.b as string;
      const c = r.c as string;
      const on = r.v === 1;
      switch (r.kind) {
        case "status":
          this.sql.exec(
            `INSERT INTO principal_status (principal_id, active, changed_at) VALUES (?, ?, ?)
             ON CONFLICT(principal_id) DO UPDATE SET active = excluded.active, changed_at = excluded.changed_at`,
            a,
            on ? 1 : 0,
            r.at as number,
          );
          break;
        case "switch":
          this.sql.exec(
            `INSERT INTO switches (name, enabled, changed_by, changed_at) VALUES (?, ?, 'journal', ?)
             ON CONFLICT(name) DO UPDATE SET enabled = excluded.enabled, changed_by = 'journal',
               changed_at = excluded.changed_at`,
            a,
            on ? 1 : 0,
            r.at as number,
          );
          // An off entry is a kill. Drop the pending re-enable so a restored ask cannot confirm it back on.
          if (!on) this.sql.exec("DELETE FROM pending_ops WHERE key = ?", `switch:${a}`);
          break;
        case "nda":
          if (!on)
            this.sql.exec("DELETE FROM nda_grants WHERE principal_id = ? AND account_id = ?", a, b);
          else if (c) {
            const d = JSON.parse(c) as {
              reason: string;
              expiresAt: number | null;
              grantedBy: string;
              approvedBy: string | null;
              grantedAt: number;
            };
            this.sql.exec(
              `INSERT OR REPLACE INTO nda_grants (principal_id, account_id, reason, expires_at, granted_by, approved_by, granted_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
              a,
              b,
              d.reason,
              d.expiresAt,
              d.grantedBy,
              d.approvedBy,
              d.grantedAt,
            );
          } else
            this.sql.exec(
              "INSERT OR IGNORE INTO nda_grants (principal_id, account_id) VALUES (?, ?)",
              a,
              b,
            );
          break;
        case "member":
          if (on)
            this.sql.exec(
              "INSERT OR IGNORE INTO memberships (principal_id, scope_type, scope_id) VALUES (?, ?, ?)",
              a,
              b,
              c,
            );
          else
            this.sql.exec(
              "DELETE FROM memberships WHERE principal_id = ? AND scope_type = ? AND scope_id = ?",
              a,
              b,
              c,
            );
          break;
        case "roles":
          this.sql.exec("DELETE FROM role_assignments WHERE principal_id = ?", a);
          for (const role of JSON.parse(b) as string[])
            this.sql.exec(
              "INSERT OR IGNORE INTO role_assignments (principal_id, role_id) VALUES (?, ?)",
              a,
              role,
            );
          break;
        case "revoke_all":
          for (const t of ["role_assignments", "memberships", "nda_grants", "elevations"])
            this.sql.exec(`DELETE FROM ${t} WHERE principal_id = ?`, a);
          break;
      }
    }
    return rows.length;
  }
}
