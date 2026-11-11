/**
 * Pins the current behaviour of the High-risk machines Devin asked us not to
 * change yet. Where that behaviour is the one he flagged, the test says so.
 * These tests do not call the Worker.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../..");

const read = (rel: string): string => readFileSync(path.join(root, rel), "utf8");

const between = (src: string, start: string, end: string): string => {
  const at = src.indexOf(start);
  assert.notEqual(at, -1, start);
  const to = src.indexOf(end, at + start.length);
  assert.notEqual(to, -1, end);
  return src.slice(at, to);
};

const walk = (dir: string): string[] => {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (name.endsWith(".ts")) out.push(full);
  }
  return out;
};

test("STATUSES contains no approval word, so a record update cannot release an item", () => {
  const records = read("recovered-source/worker/src/ux/records.ts");
  const statuses = between(records, "const STATUSES", "const SETTLED");
  for (const word of [
    "approved",
    "released",
    "confirmed",
    "accepted",
    "published",
    "approval",
    "verified",
  ]) {
    assert.equal(statuses.toLowerCase().includes(word), false, word);
  }
});

test("CHARACTERIZATION: workspace update stores whatever status the caller sends", () => {
  const src = read("recovered-source/worker/src/workspace.ts");
  const body = between(src, "update(", "scratch(");
  assert.match(body, /const status = patch\.status \?\? rec\.status/);
  assert.match(body, /SET label = \?, body = \?, status = \?/);
  assert.doesNotMatch(body, /WHERE status/);
});

test("CHARACTERIZATION: no API route can pass approved into workspace update", () => {
  const worker = path.join(root, "recovered-source/worker/src");
  const callers: string[] = [];
  for (const file of walk(worker)) {
    const text = readFileSync(file, "utf8");
    const rel = path.relative(root, file);
    let from = 0;
    while (from < text.length) {
      const at = text.indexOf(".update(", from);
      if (at < 0) break;
      const call = text.slice(at, at + 500);
      if (/\bstatus\s*:/.test(call)) callers.push(rel);
      from = at + ".update(".length;
    }
  }
  assert.deepEqual(callers, ["recovered-source/worker/src/ux/records.ts"]);

  const records = read("recovered-source/worker/src/ux/records.ts");
  const statuses = between(records, "const STATUSES", "const SETTLED");
  assert.equal(statuses.includes("approved"), false);
  assert.match(records, /!STATUSES\[section\]\.includes\(b\.status\)/);
  assert.match(records, /f\.status !== undefined \? \{ status: f\.status \}/);

  // CHARACTERIZATION: current behaviour, flagged. The method would store
  // "approved". The only route that supplies a status refuses that word first.
  for (const word of ["approved", "candidate", "published"]) {
    assert.equal(statuses.includes(`"${word}"`), false, word);
  }
});

test("CHARACTERIZATION: savePage republishes an archived page", () => {
  const src = read("recovered-source/worker/src/wiki/store.ts");
  const body = between(src, "protected savePage(", "wikiFacts(");
  // CHARACTERIZATION: current behaviour, flagged. The skip requires published.
  // The UPDATE forces published and has no status predicate.
  assert.match(body, /cur\.status === "published" && cur\.markdown === md && cur\.title === p\.title/);
  assert.match(body, /SET type = \?, title = \?, markdown = \?, summary = \?, revision = \?, status = 'published'/);
  assert.doesNotMatch(body, /AND status = 'archived'/);

  const outcome = (status: "published" | "archived" | null, same: boolean): "unchanged" | "published" =>
    status === "published" && same ? "unchanged" : "published";
  assert.equal(outcome("published", true), "unchanged");
  assert.equal(outcome("archived", true), "published");
  assert.equal(outcome("archived", false), "published");
  assert.equal(outcome(null, false), "published");
});

test("CHARACTERIZATION: wikiDecide apply reports pending before the row is approved", () => {
  const src = read("recovered-source/worker/src/wiki/store.ts");
  const partial = between(src, "if (approvals < required)", "let applied");
  // CHARACTERIZATION: current behaviour, flagged. The response says pending.
  // The item row is not updated in this branch, so it stays candidate.
  assert.match(partial, /status: "pending"/);
  assert.doesNotMatch(partial, /UPDATE items SET status/);
  const final = between(src, "let applied", "for (const src of p.reingest)");
  assert.match(final, /this\.applyProposal\(/);
  assert.match(final, /UPDATE items SET status = 'approved'/);
  assert.match(final, /UPDATE wiki_findings SET status = 'resolved'/);
  const reject = between(src, 'if (decision === "reject")', "if (!opts.revisionHash)");
  assert.match(reject, /UPDATE items SET status = 'rejected'/);
  assert.match(reject, /UPDATE wiki_findings SET status = 'dismissed'/);
});

test("CHARACTERIZATION: dry-run import state and the real auto-accept are different formulas", () => {
  const data = read("recovered-source/worker/src/brains/data.ts");
  const propose = read("recovered-source/worker/src/wiki/store.ts");
  assert.match(
    data,
    /const publishDirect = b\.personal && verdict\.verdict === "ingest" && !cur/,
  );
  assert.match(data, /state: publishDirect \? "published" : "draft"/);
  assert.match(data, /state: res\.autoAccepted \? "published" : "draft"/);
  assert.match(
    propose,
    /\(\(opts\.autoAccept && m\.autoAccept && isPersonalScope\(m\.scopeId\)\) \|\| opts\.publishDirect\)/,
  );

  const dry = (personal: boolean, verdict: "ingest" | "ask", hasPage: boolean): "published" | "draft" =>
    personal && verdict === "ingest" && !hasPage ? "published" : "draft";
  const real = (
    personal: boolean,
    autoAccept: boolean,
    personalScope: boolean,
    publishDirect: boolean,
  ): "published" | "draft" =>
    (autoAccept && personal && personalScope) || publishDirect ? "published" : "draft";

  // CHARACTERIZATION: current behaviour, flagged. These two publish while the dry run says draft.
  assert.equal(dry(true, "ask", false), "draft");
  assert.equal(real(true, true, true, false), "published");
  assert.equal(dry(true, "ingest", true), "draft");
  assert.equal(real(true, true, true, false), "published");
  assert.equal(dry(true, "ingest", false), real(true, true, true, true));
  assert.equal(dry(false, "ingest", false), "draft");
  assert.equal(real(false, true, false, false), "draft");
});

test("CHARACTERIZATION: a replay nonce is accepted once until it expires", () => {
  const src = read("recovered-source/worker/src/tenant-policy.ts");
  const body = between(src, "nonceFirst(", "hit(");
  assert.match(body, /DELETE FROM nonces WHERE expires_at <= \?/);
  assert.match(body, /INSERT OR IGNORE INTO nonces \(key, expires_at\)/);
  assert.match(body, /RETURNING key/);

  const seen = new Map<string, number>();
  const first = (key: string, now: number, ttlMs: number): boolean => {
    for (const [k, exp] of [...seen]) if (exp <= now) seen.delete(k);
    if (seen.has(key)) return false;
    seen.set(key, now + ttlMs);
    return true;
  };
  assert.equal(first("n", 1_000, 100), true);
  assert.equal(first("n", 1_050, 100), false);
  assert.equal(first("n", 1_100, 100), true);
});

test("CHARACTERIZATION: an OIDC callback can fail after clearing the cookie and leave the login record", () => {
  const src = read("recovered-source/worker/src/auth/routes.ts");
  const callback = between(src, 'app.get("/callback"', 'app.post("/logout"');
  const clearAt = callback.indexOf("clearLoginCookie(c)");
  const errorAt = callback.indexOf('c.req.query("error")');
  const stateAt = callback.indexOf("invalid_state");
  const takeAt = callback.indexOf("loginStateTake(");
  assert.ok(clearAt >= 0 && errorAt > clearAt && stateAt > errorAt && takeAt > stateAt);
  // CHARACTERIZATION: current behaviour, flagged. Both returns above happen
  // before loginStateTake, so the stored login record stays until its TTL.
  const beforeTake = callback.slice(0, takeAt);
  assert.match(beforeTake, /sign_in_failed/);
  assert.match(beforeTake, /invalid_state/);
  assert.doesNotMatch(beforeTake, /loginStateTake/);

  const take = between(read("recovered-source/worker/src/auth/identity-store.ts"), "loginStateTake(", "private async resolveEntra");
  assert.match(take, /DELETE FROM login_state WHERE state_hash = \?/);
  assert.doesNotMatch(take, /DELETE FROM login_state WHERE state_hash = \? AND expires_at/);
  assert.match(take, /n\(r\.expires_at\) <= now\) return null/);
});
