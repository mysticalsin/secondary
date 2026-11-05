// Shared by the UX v2 tests: SSE parsing, a minimal zip reader, an OKF validator and wiki seeding.

import { expect } from "vitest";
import { ALPHA, as, json, type Loose, wsOf } from "./helpers.ts";

export type Ev = { event: string; data: Loose };

export function parseSse(body: string): Ev[] {
  return body
    .split("\n\n")
    .filter((b) => b.trim())
    .map((block) => {
      const ev = /^event: (.+)$/m.exec(block)?.[1] ?? "";
      const data = /^data: (.*)$/m.exec(block)?.[1] ?? "null";
      return { event: ev, data: JSON.parse(data) as Loose };
    });
}

/** Reads a store-method zip through its central directory. Throws on anything malformed. */
export function unzip(bytes: Uint8Array): Map<string, string> {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= 0 && v.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0) throw new Error("no end of central directory");
  const count = v.getUint16(end + 10, true);
  let at = v.getUint32(end + 16, true);
  const out = new Map<string, string>();
  const dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (v.getUint32(at, true) !== 0x02014b50) throw new Error("bad central header");
    const size = v.getUint32(at + 24, true);
    const nameLen = v.getUint16(at + 28, true);
    const extraLen = v.getUint16(at + 30, true);
    const commentLen = v.getUint16(at + 32, true);
    const local = v.getUint32(at + 42, true);
    const name = dec.decode(bytes.subarray(at + 46, at + 46 + nameLen));
    if (v.getUint32(local, true) !== 0x04034b50) throw new Error("bad local header");
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    out.set(name, dec.decode(bytes.subarray(start, start + size)));
    at += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** Open Knowledge Format v0.2 rules the export promises: index.md and log.md per level, `type` on every page. */
export function okfProblems(files: Map<string, string>): string[] {
  const problems: string[] = [];
  const dirs = new Set<string>([""]);
  for (const path of files.keys()) {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
  }
  for (const d of dirs) {
    for (const reserved of ["index.md", "log.md"])
      if (!files.has(d ? `${d}/${reserved}` : reserved))
        problems.push(`${d || "(root)"} has no ${reserved}`);
  }
  for (const [path, text] of files) {
    if (!path.endsWith(".md")) problems.push(`${path} is not markdown`);
    const base = path.split("/").pop();
    if (base === "index.md" || base === "log.md") continue;
    const fm = /^---\n([\s\S]*?)\n---\n/.exec(text);
    if (!fm) {
      problems.push(`${path} has no frontmatter`);
      continue;
    }
    const keys = new Map(
      (fm[1] as string).split("\n").map((l) => {
        const i = l.indexOf(": ");
        return [l.slice(0, i), l.slice(i + 2)] as const;
      }),
    );
    for (const k of [
      "type",
      "title",
      "description",
      "tags",
      "sources",
      "generated",
      "verified",
      "status",
      "stale_after",
    ])
      if (!keys.has(k)) problems.push(`${path} lacks ${k}`);
    try {
      if (!JSON.parse(keys.get("type") ?? "null")) problems.push(`${path} has an empty type`);
    } catch {
      problems.push(`${path} has an unreadable type`);
    }
    // Links are root-absolute Markdown links to files in the archive.
    for (const m of text.matchAll(/\]\((\/[^)]+)\)/g)) {
      const target = (m[1] as string).slice(1);
      if (!files.has(target)) problems.push(`${path} links to missing ${target}`);
    }
  }
  return problems;
}

export const sseOf = async (r: Response): Promise<Ev[]> => {
  expect(r.status, "ask status").toBe(200);
  expect(r.headers.get("content-type")).toContain("text/event-stream");
  expect(r.headers.get("cache-control")).toBe("no-store");
  return parseSse(await r.text());
};

/** Plants a published page through a proposal that is approved at store level. */
export async function plantPage(
  scope: string,
  page: { id: string; type: string; title: string; markdown: string },
  plane = "ACCOUNT_RESTRICTED",
) {
  const ws = wsOf(ALPHA, scope);
  await ws.wikiTouch(ALPHA, scope, Date.now());
  const made = await ws.wikiPropose(
    {
      kind: "wiki_ingest",
      title: `Plant ${page.title}`,
      rationale: "test",
      origin: "human",
      pages: [
        {
          pageId: page.id,
          type: page.type,
          title: page.title,
          baseRevision: null,
          markdown: page.markdown,
        },
      ],
      facts: [],
      invalidate: [],
      confirm: [],
      archive: [],
      reingest: [],
      sources: [],
      findingKey: null,
    },
    "u_planter",
    Date.now(),
    { plane },
  );
  if (!made.ok || !made.created) throw new Error(`plant failed: ${JSON.stringify(made)}`);
  const view = await ws.wikiProposalView(made.id);
  const res = await ws.wikiDecide(made.id, "approve", "u_checker", Date.now(), {
    revisionHash: view?.revisionHash,
  });
  if (!res.ok) throw new Error(`plant approve failed: ${JSON.stringify(res)}`);
}

export const meId = async (persona: string, o: Loose = {}): Promise<string> =>
  (await json(await as(persona, "/v1/me", o))).principal.id as string;
