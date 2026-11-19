# Synthetic import samples

Three formats, from `recovered-source/worker/src/brains/importers.ts`: `okf`, `obsidian`, `outline`.

Route: `POST /v1/brains/:id/import?format=<format>`. Body limit `IMPORT_BODY_BYTES` is 5_242_880. A real import writes one `wiki_ingest` proposal per kept page and does not publish (`publishMode(false)` so `state` is `draft`). It does not insert a wiki page by itself. A dry run (`dryRun=1`) writes no proposal and no `brain.import` receipt.

The valid texts are longer than 20 characters and contain none of the classifier's HR, contact, or newsletter markers, so `classify` returns `ingest` when the AI gate is closed. A page that already exists is not overwritten: the proposal carries `baseRevision`, and a dry run sets `replaces: true`.

## okf

Zip of markdown. `index.md` and `log.md` are `reserved`. Other non-markdown is `not_markdown`.

| Case | Input | Expected records |
|---|---|---|
| Valid | `notes/method.md` whose body is `# Synthetic method\n\nA fictional method card for the Acme Synthetic workspace. No contact is written here.` | 200 `{ ok: true, format: "okf", imported: [{ pageId, title: "Synthetic method", state: "draft", proposalId }], skipped: [], asked: 0 }`. One proposal titled `Import: Synthetic method`. No published page. |
| Malformed | The bytes `not-a-zip` | 422 `{ error: "invalid_archive", reason }`. No proposal. |
| Oversized | Body length greater than 5_242_880, or `Content-Length` above that | 413 `{ error: "too_large", reason: "The archive is larger than 5 MB" }`. No proposal. A single page whose sanitized markdown is longer than 20_000 characters is not this status: the request is 200 and that path is in `skipped` with `too_long`. |
| Duplicate | Two markdown files whose titles both slug to the same page id, or a second import of a page id that already exists | Inside one archive, `finish` keeps both documents and suffixes the second id (`-2`). A page id that already exists becomes an edit proposal (`baseRevision` set). Dry run: `replaces: true`, `state: "draft"`. The stored page body is not replaced by the import. |

## obsidian

Zip of markdown. A path segment `.obsidian`, `.trash`, or a dot-folder is `hidden`. A non-markdown file is `attachment`.

| Case | Input | Expected records |
|---|---|---|
| Valid | `Synthetic card.md` with the same method paragraph as the okf valid case, and no `[[` link | Same 200 shape with `format: "obsidian"`. One draft proposal. `type` on the parsed doc is null, so the route uses the brain's `topic` type when that collection exists, otherwise the first non-generated, non-journal type. |
| Malformed | The bytes `not-a-zip` | 422 `invalid_archive`. No proposal. |
| Oversized | Same 5_242_880 byte rule as okf | 413 `too_large`. No proposal. Page text over 20_000 characters is `skipped` / `too_long` on a 200. |
| Duplicate | Same title twice in one zip, or a page id that already exists | Same as okf: `-2` inside one archive; an existing page is an edit proposal, not an overwrite. |

## outline

Either `Content-Type: application/json` with one collection, or a zip of `*.json`. `metadata.json` is `reserved`. A non-json zip entry is `not_json`.

| Case | Input | Expected records |
|---|---|---|
| Valid | JSON `{ "documents": [{ "title": "Synthetic outline", "text": "A fictional outline card for the Acme Synthetic workspace. It states a method and nothing personal." }] }` with `Content-Type: application/json` | 200 `{ ok: true, format: "outline", imported: [{ title: "Synthetic outline", state: "draft", proposalId, pageId }], skipped: [], asked: 0 }`. |
| Malformed | `Content-Type: application/json` and the bytes `{` | 200 `{ ok: true, format: "outline", imported: [], skipped: [{ path: "collection.json", reason: "invalid_json" }], asked: 0 }`. No proposal. This is not a 422. A zip that is not a zip is 422 `invalid_archive`, same as the other formats. |
| Oversized | Body longer than 5_242_880 bytes | 413 `too_large` before parse. No proposal. |
| Duplicate | Two documents in one collection with the same title, or a title whose slug is an existing page id | `finish` gives the second document a suffixed page id. An existing page id is an edit proposal. The page row is not overwritten. |

Empty body, any format: 422 `{ error: "invalid_archive", reason: "Empty body" }`.

`format` other than `okf`, `obsidian`, or `outline`: 400 `invalid_format`.
