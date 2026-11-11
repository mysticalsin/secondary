/**
 * SqlStorage backed by Node's built-in SQLite. The harness has no D1 or
 * Miniflare pool, and node:sqlite is already in the runtime the tests use.
 */

import { DatabaseSync, type SQLInputValue } from "node:sqlite";

type Row = Record<string, SQLInputValue>;

export type SqlCursor = {
  toArray: () => Row[];
  one: () => Row;
  raw: () => SQLInputValue[][];
  columnNames: string[];
  rowsRead: number;
  rowsWritten: number;
};

const cursor = (rows: Row[], written = 0): SqlCursor => ({
  toArray: () => rows,
  one: () => {
    if (rows.length !== 1) throw new Error(`expected one row, got ${rows.length}`);
    return rows[0] as Row;
  },
  raw: () => rows.map((row) => Object.values(row)),
  columnNames: rows[0] ? Object.keys(rows[0]) : [],
  rowsRead: rows.length,
  rowsWritten: written,
});

const statements = (query: string): string[] =>
  query
    .split(";")
    .map((part) =>
      part
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .trim(),
    )
    .filter((part) => part.length > 0);

export function openSqlite(path: string): DatabaseSync {
  return new DatabaseSync(path, { timeout: 5_000 });
}

export function sqliteStorage(db: DatabaseSync): SqlStorage {
  return {
    exec(query: string, ...bindings: SQLInputValue[]) {
      const parts = statements(query);
      if (bindings.length === 0 && parts.length !== 1) {
        db.exec(query);
        return cursor([]);
      }
      const rows = db.prepare(parts[0] ?? query).all(...bindings) as Row[];
      return cursor(rows);
    },
  } as unknown as SqlStorage;
}
