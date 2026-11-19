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
  const records = read("src/worker/ux/records.ts");
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

test("workspace update rejects a status outside the allow-list", () => {
  const src = read("src/worker/workspace.ts");
  const body = between(src, "update(", "scratch(");
  assert.match(body, /commitItem/);
  assert.match(body, /invalid_status/);
  assert.doesNotMatch(body, /const status = patch\.status \?\? rec\.status/);
  assert.match(body, /SET label = \?, body = \?, status = \?/);
  assert.doesNotMatch(body, /WHERE status/);
});

test("CHARACTERIZATION: no API route can pass approved into workspace update", () => {
  const worker = path.join(root, "src/worker");
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
  assert.deepEqual(callers, ["src/worker/ux/records.ts"]);

  const records = read("src/worker/ux/records.ts");
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

test("CHARACTERIZATION: savePage does not republish an archived page", () => {
  const src = read("src/worker/wiki/store.ts");
  const save = between(src, "protected savePage(", "protected unarchivePage(");
  assert.match(save, /decodePageStatus\(cur\.status\)/);
  assert.match(save, /commitPage\(from, \{ type: "save", now \}\)/);
  assert.match(
    save,
    /SET type = \?, title = \?, markdown = \?, summary = \?, revision = \?, status = 'published', origin = \?, updated_at = \? WHERE id = \? AND status = 'published'/,
  );
  assert.doesNotMatch(save, /status = 'archived'/);

  const outcome = (
    status: "published" | "archived" | "unknown" | null,
    same: boolean,
  ): "unchanged" | "published" | "refused" => {
    if (status === "archived" || status === "unknown") return "refused";
    if (status === "published" && same) return "unchanged";
    return "published";
  };
  assert.equal(outcome("published", true), "unchanged");
  assert.equal(outcome("archived", true), "refused");
  assert.equal(outcome("archived", false), "refused");
  assert.equal(outcome("unknown", false), "refused");
  assert.equal(outcome(null, false), "published");
});

test("wikiDecide partial approval reports pending and leaves the item candidate", () => {
  const src = read("src/worker/wiki/store.ts");
  const pending = between(src, "if (!releasing)", "let applied");
  assert.match(pending, /status: "pending"/);
  assert.doesNotMatch(pending, /UPDATE items SET status/);
  const final = between(src, "let applied", "for (const src of p.reingest)");
  assert.match(final, /this\.applyProposal\(/);
  assert.match(final, /UPDATE items SET status = 'approved'/);
  assert.match(final, /AND status = 'candidate'/);
  assert.match(final, /UPDATE wiki_findings SET status = 'resolved' WHERE key = \? AND status = 'open'/);
  const reject = between(src, 'if (decision === "reject")', "if (!opts.revisionHash)");
  assert.match(reject, /UPDATE items SET status = 'rejected'/);
  assert.match(reject, /AND status = 'candidate'/);
  assert.match(reject, /UPDATE wiki_findings SET status = 'dismissed' WHERE key = \? AND status = 'open'/);
});

test("dry-run import and a personal auto-accept both stay a draft", () => {
  const data = read("src/worker/brains/data.ts");
  const propose = read("src/worker/wiki/store.ts");
  assert.match(data, /const reported = publishMode\(false\)/);
  assert.equal(data.match(/state: reported/g)?.length, 2);
  assert.doesNotMatch(data, /const publishDirect = b\.personal && verdict\.verdict === "ingest" && !cur/);
  const body = between(propose, "async wikiPropose(", "wikiSupersede(");
  assert.doesNotMatch(body, /opts\.autoAccept && m\.autoAccept && isPersonalScope\(m\.scopeId\)\) \|\| opts\.publishDirect/);
  assert.match(body, /commitImport\(decodeImportStatus\(made\.status\)/);
  assert.match(body, /AND status = 'candidate' RETURNING id/);
});

test("replay nonce source does not delete a seen key when it expires", () => {
  const src = read("src/worker/tenant-policy.ts");
  const body = between(src, "nonceFirst(", "pruneNonces(");
  assert.doesNotMatch(body, /DELETE FROM nonces/);
  assert.match(body, /INSERT OR IGNORE INTO nonces \(key, expires_at\)/);
  assert.match(body, /RETURNING key/);
});

test("OIDC callback consumes the login row before it reports failure", () => {
  const src = read("src/worker/auth/routes.ts");
  const callback = between(src, 'app.get("/callback"', 'app.post("/logout"');
  const takeAt = callback.indexOf("loginStateTake(");
  const failedAt = callback.indexOf("sign_in_failed");
  const invalidAt = callback.indexOf("invalid_state");
  assert.ok(takeAt >= 0 && failedAt > takeAt && invalidAt > takeAt);
  assert.match(callback, /commitLoginRecord/);
  assert.match(callback, /idp_error/);
  assert.match(callback, /missing_state/);
  assert.match(callback, /state_mismatch/);
  assert.match(callback, /exchange_failed/);
  assert.doesNotMatch(callback, /idp_\$\{/);

  const take = between(read("src/worker/auth/identity-store.ts"), "loginStateTake(", "private async resolveEntra");
  assert.match(take, /DELETE FROM login_state WHERE state_hash = \?/);
  assert.doesNotMatch(take, /DELETE FROM login_state WHERE state_hash = \? AND expires_at/);
  assert.match(take, /n\(r\.expires_at\) <= now\) return null/);
});
