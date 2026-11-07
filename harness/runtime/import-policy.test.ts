import assert from "node:assert/strict";
import { test } from "node:test";
import { matchReceipt, sha256Hex, validateImport, visibleText, storedBody } from "../../reconstruction/import/policy.mjs";

test("import policy accepts text and markdown and rejects the rest", async () => {
  const paste = validateImport({ source: "paste", externalId: "note-1", version: 1, text: "Hello brain" });
  assert.equal(paste.ok, true);
  const file = validateImport({
    source: "file",
    externalId: "doc-1",
    version: 2,
    filename: "notes.md",
    text: "# Title",
  });
  assert.equal(file.ok, true);
  assert.equal(validateImport({ source: "file", externalId: "doc-1", version: 1, filename: "../x.md", text: "a" }).error, "invalid_filename");
  assert.equal(validateImport({ source: "file", externalId: "doc-1", version: 1, filename: "run.exe", text: "a" }).error, "unsupported_type");
  assert.equal(validateImport({ source: "paste", externalId: "doc-1", version: 1, text: "<script>alert(1)</script>" }).error, "unsupported_content");
  assert.equal(validateImport({ source: "paste", externalId: "doc-1", version: 1, text: "ok", url: "https://example.invalid" }).error, "url_import_refused");
  assert.equal(validateImport({ source: "paste", externalId: "doc-1", version: 1, text: "" }).error, "invalid_text");
  const hash = await sha256Hex("Hello brain");
  const body = storedBody({ import: 1, source: "paste", externalId: "note-1", version: 1, contentSha256: hash }, "Hello brain");
  assert.equal(visibleText(body), "Hello brain");
  assert.equal(visibleText("hello\n\nworld"), "hello\n\nworld");
  const items = [{ id: "pi:1", body }];
  assert.equal(matchReceipt(items, { source: "paste", externalId: "note-1", version: 1, contentSha256: hash }).same?.id, "pi:1");
  assert.equal(matchReceipt(items, { source: "paste", externalId: "note-1", version: 1, contentSha256: "other" }).conflict?.id, "pi:1");
});
