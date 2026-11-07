/**
 * NEW RECONSTRUCTION ledger. Sqlite on the local API worker.
 * The harness derives tenant and principal before calling this object.
 * Rows never store import text, prompts, or credentials.
 */
import { decideAppend, summarize } from "./policy.mjs";

function json(body, status) {
  return Response.json(body, { status });
}

export class UsageLedger {
  constructor(state) {
    this.sql = state.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS events (
      event_id TEXT PRIMARY KEY,
      principal_id TEXT NOT NULL,
      provider_request_id TEXT,
      payload_hash TEXT NOT NULL,
      body TEXT NOT NULL
    )`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS events_principal ON events (principal_id)`);
  }

  row(eventId) {
    const found = this.sql.exec("SELECT body FROM events WHERE event_id = ?", eventId).toArray()[0];
    return found ? JSON.parse(found.body) : null;
  }

  streamRow(principalId, providerRequestId) {
    const found = this.sql
      .exec(
        "SELECT body FROM events WHERE principal_id = ? AND provider_request_id = ?",
        principalId,
        providerRequestId,
      )
      .toArray()[0];
    return found ? JSON.parse(found.body) : null;
  }

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

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/append") return this.append(await request.json());
    if (request.method === "POST" && url.pathname === "/query") return this.query(await request.json());
    return json({ error: "not_found" }, 404);
  }

  append(event) {
    if (!event || typeof event.eventId !== "string" || typeof event.principalId !== "string") {
      return json({ error: "invalid_event", reason: "invalid_event" }, 400);
    }
    const byId = this.row(event.eventId);
    if (byId && byId.principalId !== event.principalId) {
      return json({ error: "foreign_request", reason: "foreign_request" }, 403);
    }
    const stream = event.providerRequestId ? this.streamRow(event.principalId, event.providerRequestId) : null;
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

  query(filter) {
    const principalId = filter?.principalId;
    if (typeof principalId !== "string") return json({ error: "invalid_query" }, 400);
    const rows = this.sql.exec("SELECT body FROM events WHERE principal_id = ? ORDER BY event_id", principalId).toArray();
    let events = rows.map((row) => JSON.parse(row.body));
    if (filter.operation) events = events.filter((event) => event.operation === filter.operation);
    if (filter.trust) events = events.filter((event) => event.trust === filter.trust);
    if (filter.brainId) events = events.filter((event) => event.brainId === filter.brainId);
    if (filter.requestId) {
      events = events.filter((event) => event.requestId === filter.requestId || event.eventId === filter.requestId);
      if (events.length === 0) return json({ error: "not_found", reason: "not_found" }, 404);
    }
    return json({ events: events.slice(0, 50), summary: summarize(events), usage: "mixed" }, 200);
  }
}
