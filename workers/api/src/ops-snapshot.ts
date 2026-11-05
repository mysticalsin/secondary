// Export and replace the SQL tables of a Durable Object. Table names come from a fixed list in the
// caller, never from input. Imported column names are checked against the live schema and values
// must be strings, numbers or null, so a tampered snapshot cannot reach arbitrary SQL.

export type Row = Record<string, SqlStorageValue>;
export type Snapshot = Record<string, Row[]>;

export function exportTables(sql: SqlStorage, tables: readonly string[]): Snapshot {
  const out: Snapshot = {};
  for (const t of tables) out[t] = sql.exec(`SELECT * FROM ${t}`).toArray() as Row[];
  return out;
}

const isPlain = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Replace every listed table with the snapshot. All or nothing: any invalid input throws inside the
 * transaction and nothing changes. Returns the number of rows written.
 */
export function replaceTables(
  storage: DurableObjectStorage,
  tables: readonly string[],
  data: unknown,
): number {
  if (!isPlain(data)) throw new Error("invalid_snapshot");
  for (const k of Object.keys(data)) if (!tables.includes(k)) throw new Error("invalid_snapshot");
  let written = 0;
  storage.transactionSync(() => {
    const sql = storage.sql;
    for (const t of tables) sql.exec(`DELETE FROM ${t}`);
    for (const t of tables) {
      const rows = data[t];
      if (rows === undefined) continue;
      if (!Array.isArray(rows)) throw new Error("invalid_snapshot");
      const cols = new Set(
        sql
          .exec(`PRAGMA table_info(${t})`)
          .toArray()
          .map((c) => c.name as string),
      );
      for (const row of rows) {
        if (!isPlain(row)) throw new Error("invalid_snapshot");
        const names = Object.keys(row);
        if (names.length === 0 || names.some((n) => !cols.has(n)))
          throw new Error("invalid_snapshot");
        const values = names.map((n) => row[n]);
        if (values.some((v) => v !== null && typeof v !== "string" && typeof v !== "number"))
          throw new Error("invalid_snapshot");
        sql.exec(
          `INSERT INTO ${t} (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`,
          ...(values as (string | number | null)[]),
        );
        written++;
      }
    }
  });
  return written;
}
