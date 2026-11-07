/**
 * NEW RECONSTRUCTION ledger. Sqlite on the local API worker.
 * Import identity is principal + validated client + source + external id + version.
 * The caller does not choose that client. Text is not stored in this index.
 */
import { decideAppend, summarize } from "./policy.mjs";

/**
 * @typedef {import("./policy.mjs").UsageEvent} UsageEvent
 */

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {value is unknown[]}
 */
function isUnknownArray(value) {
  return Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {value is UsageEvent}
 */
function isUsageEvent(value) {
  return isRecord(value) && typeof value.eventId === "string" && typeof value.principalId === "string";
}

/**
 * @param {SqlStorageValue | undefined} value
 * @returns {string | null}
 */
function cellText(value) {
  return typeof value === "string" ? value : null;
}

/**
 * @param {unknown} body
 * @param {number} [status]
 * @returns {Response}
 */
function json(body, status = 200) {
  return Response.json(body, { status });
}

/**
 * @param {unknown} value
 * @param {number} min
 * @param {number} max
 * @param {number} fallback
 * @returns {number}
 */
function clamp(value, min, max, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export class UsageLedger {
  /**
   * @param {DurableObjectState} state
   */
  constructor(state) {
    /** @type {DurableObjectState} */
    this.state = state;
    /** @type {SqlStorage} */
    this.sql = state.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS events (
      event_id TEXT PRIMARY KEY,
      principal_id TEXT NOT NULL,
      provider_request_id TEXT,
      payload_hash TEXT NOT NULL,
      body TEXT NOT NULL
    )`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS events_principal ON events (principal_id)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS activity_records (
      principal_id TEXT NOT NULL,
      record_id TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      body TEXT NOT NULL,
      PRIMARY KEY (principal_id, record_id)
    )`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS activity_meta (
      principal_id TEXT PRIMARY KEY,
      ledger_sha256 TEXT NOT NULL,
      incomplete INTEGER NOT NULL,
      read_at TEXT NOT NULL,
      byte_length INTEGER NOT NULL
    )`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS imports (
      principal_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      source TEXT NOT NULL,
      external_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      item_id TEXT,
      request_id TEXT,
      previous_id TEXT,
      pending INTEGER NOT NULL,
      PRIMARY KEY (principal_id, client_id, source, external_id, version)
    )`);
  }

  /**
   * @param {Request} request
   * @returns {Promise<Response>}
   */
  async fetch(request) {
    const url = new URL(request.url);
    const body = request.method === "POST" ? await request.json() : null;
    return this.state.blockConcurrencyWhile(async () => this.route(url.pathname, body));
  }

  /**
   * @param {string} pathname
   * @param {unknown} body
   * @returns {Response}
   */
  route(pathname, body) {
    if (pathname === "/append") return this.append(body);
    if (pathname === "/query") return this.query(body);
    if (pathname === "/import/begin") return this.beginImport(body);
    if (pathname === "/import/finish") return this.finishImport(body);
    if (pathname === "/import/abort") return this.abortImport(body);
    if (pathname === "/import/list") return this.listImports(body);
    if (pathname === "/activity/apply") return this.applyActivity(body);
    if (pathname === "/activity/list") return this.listActivity(body);
    return json({ error: "not_found" }, 404);
  }

  /**
   * @param {string} eventId
   * @returns {UsageEvent | null}
   */
  row(eventId) {
    const found = this.sql.exec("SELECT body FROM events WHERE event_id = ?", eventId).toArray()[0];
    const text = found ? cellText(found.body) : null;
    if (!text) return null;
    const parsed = JSON.parse(text);
    return isUsageEvent(parsed) ? parsed : null;
  }

  /**
   * @param {string} principalId
   * @param {string} providerRequestId
   * @returns {UsageEvent | null}
   */
  streamRow(principalId, providerRequestId) {
    const found = this.sql
      .exec(
        "SELECT body FROM events WHERE principal_id = ? AND provider_request_id = ?",
        principalId,
        providerRequestId,
      )
      .toArray()[0];
    const text = found ? cellText(found.body) : null;
    if (!text) return null;
    const parsed = JSON.parse(text);
    return isUsageEvent(parsed) ? parsed : null;
  }

  /**
   * @param {UsageEvent} event
   */
  save(event) {
    const body = JSON.stringify(event);
    const existing = this.row(event.eventId);
    if (existing) {
      this.sql.exec(
        "UPDATE events SET payload_hash = ?, provider_request_id = ?, body = ? WHERE event_id = ?",
        event.payloadHash,
        event.providerRequestId,
        body,
        event.eventId,
      );
      return;
    }
    this.sql.exec(
      "INSERT INTO events (event_id, principal_id, provider_request_id, payload_hash, body) VALUES (?, ?, ?, ?, ?)",
      event.eventId,
      event.principalId,
      event.providerRequestId,
      event.payloadHash,
      body,
    );
  }

  /**
   * @param {{ principalId: string, clientId: string, source: string, externalId: string, version: unknown }} key
   */
  importRow(key) {
    return this.sql
      .exec(
        `SELECT content_hash, item_id, request_id, previous_id, pending FROM imports
         WHERE principal_id = ? AND client_id = ? AND source = ? AND external_id = ? AND version = ?`,
        key.principalId,
        key.clientId,
        key.source,
        key.externalId,
        key.version,
      )
      .toArray()[0];
  }

  /**
   * @param {unknown} key
   * @returns {Response}
   */
  beginImport(key) {
    if (!isRecord(key) || typeof key.principalId !== "string" || !key.principalId || typeof key.clientId !== "string" || !key.clientId || typeof key.source !== "string" || !key.source || typeof key.externalId !== "string" || !key.externalId || typeof key.hash !== "string" || !key.hash) {
      return json({ error: "invalid_import", reason: "invalid_import" }, 400);
    }
    const row = this.importRow({
      principalId: key.principalId,
      clientId: key.clientId,
      source: key.source,
      externalId: key.externalId,
      version: key.version,
    });
    if (row?.item_id) {
      if (row.content_hash === key.hash) {
        return json({
          outcome: "duplicate",
          id: row.item_id,
          requestId: row.request_id,
          previousId: row.previous_id,
          contentHash: row.content_hash,
        });
      }
      return json({ error: "version_conflict", reason: "version_conflict", outcome: "rejected" }, 409);
    }
    if (row?.pending) {
      if (row.content_hash === key.hash) return json({ outcome: "in_flight" }, 200);
      return json({ error: "version_conflict", reason: "version_conflict", outcome: "rejected" }, 409);
    }
    const previous = this.sql
      .exec(
        `SELECT item_id FROM imports
         WHERE principal_id = ? AND client_id = ? AND source = ? AND external_id = ? AND version < ? AND item_id IS NOT NULL
         ORDER BY version DESC LIMIT 1`,
        key.principalId,
        key.clientId,
        key.source,
        key.externalId,
        key.version,
      )
      .toArray()[0];
    this.sql.exec(
      `INSERT INTO imports (principal_id, client_id, source, external_id, version, content_hash, item_id, request_id, previous_id, pending)
       VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, 1)`,
      key.principalId,
      key.clientId,
      key.source,
      key.externalId,
      key.version,
      key.hash,
      previous?.item_id ?? null,
    );
    return json({ outcome: "claim", previousId: previous?.item_id ?? null });
  }

  /**
   * @param {unknown} key
   * @returns {Response}
   */
  finishImport(key) {
    if (!isRecord(key) || typeof key.principalId !== "string" || typeof key.clientId !== "string" || typeof key.source !== "string" || typeof key.externalId !== "string" || typeof key.hash !== "string") {
      return json({ error: "invalid_import", reason: "invalid_import" }, 400);
    }
    const row = this.importRow({
      principalId: key.principalId,
      clientId: key.clientId,
      source: key.source,
      externalId: key.externalId,
      version: key.version,
    });
    if (!row || row.content_hash !== key.hash) return json({ error: "conflict", reason: "conflict" }, 409);
    if (row.item_id) {
      return json({ outcome: "duplicate", id: row.item_id, requestId: row.request_id, previousId: row.previous_id });
    }
    this.sql.exec(
      `UPDATE imports SET item_id = ?, request_id = ?, pending = 0
       WHERE principal_id = ? AND client_id = ? AND source = ? AND external_id = ? AND version = ?`,
      key.itemId,
      key.requestId,
      key.principalId,
      key.clientId,
      key.source,
      key.externalId,
      key.version,
    );
    return json({ outcome: "finished", previousId: row.previous_id });
  }

  /**
   * @param {unknown} key
   * @returns {Response}
   */
  abortImport(key) {
    if (!isRecord(key) || typeof key.principalId !== "string" || typeof key.clientId !== "string" || typeof key.source !== "string" || typeof key.externalId !== "string") {
      return json({ error: "invalid_import", reason: "invalid_import" }, 400);
    }
    this.sql.exec(
      `DELETE FROM imports
       WHERE principal_id = ? AND client_id = ? AND source = ? AND external_id = ? AND version = ? AND pending = 1 AND item_id IS NULL`,
      key.principalId,
      key.clientId,
      key.source,
      key.externalId,
      key.version,
    );
    return json({ outcome: "aborted" });
  }

  /**
   * @param {unknown} filter
   * @returns {Response}
   */
  listImports(filter) {
    if (!isRecord(filter) || typeof filter.principalId !== "string") return json({ error: "invalid_query", reason: "invalid_query" }, 400);
    const limit = clamp(filter.limit, 1, 50, 20);
    const offset = clamp(filter.cursor, 0, 100000, 0);
    const query = typeof filter.q === "string" ? filter.q : "";
    const tokens = query
      ? query.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 2)
      : [];
    if (query && tokens.length === 0) {
      return json({ error: "invalid_query", reason: "invalid_query" }, 400);
    }
    const all = this.sql
      .exec(
        `SELECT client_id, source, external_id, version, content_hash, item_id, request_id, previous_id
         FROM imports WHERE principal_id = ? AND item_id IS NOT NULL ORDER BY rowid ASC`,
        filter.principalId,
      )
      .toArray()
      .filter((row) => tokens.length === 0 || tokens.every((token) => String(row.external_id).toLowerCase().includes(token)));
    const total = all.length;
    const rows = all.slice(offset, offset + limit);
    const complete = offset + rows.length >= total;
    const storeTotal = Number(
      this.sql.exec(
        "SELECT COUNT(*) AS n FROM imports WHERE principal_id = ? AND item_id IS NOT NULL",
        filter.principalId,
      ).one().n,
    );
    return json({
      items: rows.map((row) => ({
        id: row.item_id,
        clientId: row.client_id,
        source: row.source,
        externalId: row.external_id,
        version: row.version,
        contentSha256: row.content_hash,
        requestId: row.request_id,
        previous: row.previous_id,
      })),
      total,
      storeTotal,
      complete,
      coverage: complete ? "full" : "partial",
      nextCursor: complete ? null : String(offset + rows.length),
    });
  }

  /**
   * @param {unknown} event
   * @returns {Response}
   */
  append(event) {
    if (!isUsageEvent(event)) {
      return json({ error: "invalid_event", reason: "invalid_event" }, 400);
    }
    const byId = this.row(event.eventId);
    if (byId && byId.principalId !== event.principalId) {
      return json({ error: "foreign_request", reason: "foreign_request" }, 403);
    }
    if (byId && byId.clientId && event.clientId && byId.clientId !== event.clientId) {
      return json({ error: "foreign_client", reason: "foreign_client" }, 403);
    }
    const stream = event.providerRequestId ? this.streamRow(event.principalId, event.providerRequestId) : null;
    if (stream && stream.clientId && event.clientId && stream.clientId !== event.clientId) {
      return json({ error: "foreign_client", reason: "foreign_client" }, 403);
    }
    const decision = decideAppend(byId, stream, event);
    if (decision.action === "conflict") return json({ error: "conflict", reason: "conflict" }, 409);
    if (decision.action === "idempotent") return json({ outcome: "idempotent", event: decision.event }, 200);
    if (decision.action === "replace") {
      this.save(decision.event);
      return json({ outcome: "replaced", event: decision.event }, 200);
    }
    this.save(event);
    return json({ outcome: "stored", event }, 201);
  }

  /**
   * @param {unknown} filter
   * @returns {Response}
   */
  query(filter) {
    if (!isRecord(filter) || typeof filter.principalId !== "string") return json({ error: "invalid_query" }, 400);
    const principalId = filter.principalId;
    const rows = this.sql.exec("SELECT body FROM events WHERE principal_id = ? ORDER BY event_id", principalId).toArray();
    /** @type {UsageEvent[]} */
    const events = [];
    for (const row of rows) {
      const text = cellText(row.body);
      if (!text) continue;
      const parsed = JSON.parse(text);
      if (isUsageEvent(parsed)) events.push(parsed);
    }
    let matched = events;
    if (typeof filter.clientId === "string" && filter.clientId) matched = matched.filter((event) => event.clientId === filter.clientId);
    if (typeof filter.operation === "string" && filter.operation) matched = matched.filter((event) => event.operation === filter.operation);
    if (typeof filter.trust === "string" && filter.trust) matched = matched.filter((event) => event.trust === filter.trust);
    if (typeof filter.brainId === "string" && filter.brainId) matched = matched.filter((event) => event.brainId === filter.brainId);
    if (typeof filter.requestId === "string" && filter.requestId) {
      const requestId = filter.requestId;
      matched = matched.filter((event) =>
        event.requestId === requestId ||
        event.eventId === requestId ||
        event.providerRequestId === requestId,
      );
      if (matched.length === 0) return json({ error: "not_found", reason: "not_found" }, 404);
    }
    const summary = summarize(matched);
    const limit = clamp(filter.limit, 1, 50, 20);
    const offset = clamp(filter.cursor, 0, 100000, 0);
    const page = matched.slice(offset, offset + limit);
    const complete = offset + page.length >= matched.length;
    return json({
      events: page,
      summary,
      total: matched.length,
      complete,
      coverage: complete ? "full" : "partial",
      nextCursor: complete ? null : String(offset + page.length),
      usage: "mixed",
    }, 200);
  }

  /**
   * @param {unknown} body
   * @returns {Response}
   */
  applyActivity(body) {
    if (!isRecord(body) || typeof body.principalId !== "string" || !isUnknownArray(body.records)) {
      return json({ error: "invalid_import", reason: "invalid_import" }, 400);
    }
    const principalId = body.principalId;
    const records = body.records;
    const existing = new Map(
      this.sql.exec("SELECT record_id, content_hash, body FROM activity_records WHERE principal_id = ?", principalId).toArray()
        .map((row) => [row.record_id, row]),
    );
    const next = new Map();
    for (const record of records) {
      if (!isRecord(record) || typeof record.record_id !== "string" || typeof record.hash !== "string" || typeof record.body !== "string") {
        return json({ error: "invalid_import", reason: "invalid_import" }, 400);
      }
      const prior = next.get(record.record_id) ?? existing.get(record.record_id);
      if (prior && prior.content_hash !== record.hash && prior.hash !== record.hash) {
        return json({ error: "conflict", reason: "conflicting_duplicate" }, 409);
      }
      next.set(record.record_id, record);
    }
    for (const record of next.values()) {
      const stored = existing.get(record.record_id);
      if (stored && stored.content_hash === record.hash) continue;
      this.sql.exec(
        "INSERT INTO activity_records (principal_id, record_id, content_hash, body) VALUES (?, ?, ?, ?)",
        principalId,
        record.record_id,
        record.hash,
        record.body,
      );
    }
    this.sql.exec(
      `INSERT INTO activity_meta (principal_id, ledger_sha256, incomplete, read_at, byte_length) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(principal_id) DO UPDATE SET ledger_sha256 = excluded.ledger_sha256, incomplete = excluded.incomplete, read_at = excluded.read_at, byte_length = excluded.byte_length`,
      principalId,
      String(body.ledgerSha256 ?? ""),
      body.incomplete ? 1 : 0,
      String(body.readAt ?? ""),
      Number(body.byteLength ?? 0),
    );
    return json({ outcome: "stored", count: next.size }, 200);
  }

  /**
   * @param {unknown} body
   * @returns {Response}
   */
  listActivity(body) {
    if (!isRecord(body) || typeof body.principalId !== "string") return json({ error: "invalid_query" }, 400);
    const principalId = body.principalId;
    const rows = this.sql.exec(
      "SELECT record_id, content_hash, body FROM activity_records WHERE principal_id = ? ORDER BY record_id",
      principalId,
    ).toArray();
    const meta = this.sql.exec("SELECT ledger_sha256, incomplete, read_at, byte_length FROM activity_meta WHERE principal_id = ?", principalId).toArray()[0];
    const records = rows.map((row) => ({ record_id: row.record_id, hash: row.content_hash, body: row.body }));
    if (meta && ((meta.incomplete !== 0 && meta.incomplete !== 1) || typeof meta.read_at !== "string" || typeof meta.ledger_sha256 !== "string")) {
      return json({ error: "stored_meta_invalid", reason: "stored_meta_invalid" }, 500);
    }
    return json({
      records,
      meta: meta ? {
        ledgerSha256: meta.ledger_sha256,
        incomplete: meta.incomplete === 1,
        readAt: meta.read_at,
        byteLength: meta.byte_length,
      } : null,
    }, 200);
  }
}
