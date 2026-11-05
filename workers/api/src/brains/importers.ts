// Parsers for the three import formats. They turn archive entries into plain Markdown documents and
// say what they skipped. Nothing here publishes anything: the route runs every document through the
// classifier and the review rules.

import { PAGE_ID, slug } from "../wiki/text.ts";
import { sanitizeMarkdown } from "./sanitize.ts";
import { isUnsafePath, type ZipEntry } from "./unzip.ts";

export type ImportFormat = "okf" | "obsidian" | "outline";
export const isImportFormat = (v: unknown): v is ImportFormat =>
  v === "okf" || v === "obsidian" || v === "outline";

export interface ImportDoc {
  path: string;
  pageId: string;
  title: string;
  /** Wanted page type (OKF `type`); the route keeps it only when the brain has that collection. */
  type: string | null;
  markdown: string;
}
export interface Skipped {
  path: string;
  reason: string;
}
export interface Parsed {
  docs: ImportDoc[];
  skipped: Skipped[];
}

export const MAX_PAGES = 200;
export const MAX_PAGE_CHARS = 20_000;
const MAX_TITLE = 120;

const LINK_OPEN = "";
const LINK_CLOSE = "";
const dec = new TextDecoder();
const textOf = (b: Uint8Array): string => dec.decode(b).replace(/^﻿/, "");

const unquote = (v: string): string => {
  const t = v.trim();
  return (t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))
    ? t.slice(1, -1)
    : t;
};

/** `---` frontmatter as flat `key: value` pairs. Anything cleverer than that is ignored on purpose. */
export function frontmatter(src: string): { meta: Record<string, string>; body: string } {
  const m = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(src);
  if (!m) return { meta: {}, body: src };
  const meta: Record<string, string> = {};
  for (const line of (m[1] as string).split("\n")) {
    const kv = /^([A-Za-z_][\w-]{0,40}):[ \t]*(.*)$/.exec(line);
    if (kv) meta[(kv[1] as string).toLowerCase()] = unquote(kv[2] as string).slice(0, 300);
  }
  return { meta, body: src.slice(m[0].length) };
}

const baseName = (path: string): string => (path.split("/").pop() ?? path).replace(/\.[^.]+$/, "");

function titleOf(meta: Record<string, string>, body: string, path: string): string {
  const h1 = /^#\s+(.+?)\s*#*\s*$/m.exec(body)?.[1];
  const t = (meta.title || h1 || baseName(path)).replace(/\s+/g, " ").replace(/[{}[\]<>]/g, "").trim();
  return t.slice(0, MAX_TITLE);
}

/** Finish a batch: unique page ids, links resolved to the ids that now exist, text sanitised. */
function finish(
  raw: { path: string; title: string; type: string | null; body: string; idHint?: string }[],
  linkKey: (s: string) => string,
): Parsed {
  const skipped: Skipped[] = [];
  const used = new Set<string>();
  const byKey = new Map<string, string>();
  const staged: { path: string; title: string; type: string | null; body: string; id: string }[] = [];
  for (const d of raw) {
    let base = slug(d.idHint && PAGE_ID.test(d.idHint) ? d.idHint : d.title);
    if (!PAGE_ID.test(base)) base = `page-${staged.length + 1}`;
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base.slice(0, 58)}-${n}`;
    used.add(id);
    byKey.set(linkKey(d.title), id);
    byKey.set(linkKey(baseName(d.path)), id);
    if (d.idHint) byKey.set(linkKey(d.idHint), id);
    staged.push({ ...d, id });
  }
  const docs: ImportDoc[] = [];
  for (const d of staged) {
    let md = sanitizeMarkdown(d.body);
    md = md.replace(new RegExp(`${LINK_OPEN}([^${LINK_CLOSE}]*)${LINK_CLOSE}`, "g"), (_m, x: string) => {
      const bar = x.indexOf("|");
      const key = bar < 0 ? x : x.slice(0, bar);
      const label = (bar < 0 ? x : x.slice(bar + 1)).replace(/[{}[\]<>]/g, "").trim();
      const to = byKey.get(linkKey(key));
      return to && to !== d.id ? `[[${to}]]` : label;
    });
    if (!md.trim()) {
      skipped.push({ path: d.path, reason: "empty" });
      continue;
    }
    if (md.length > MAX_PAGE_CHARS) {
      skipped.push({ path: d.path, reason: "too_long" });
      continue;
    }
    docs.push({ path: d.path, pageId: d.id, title: d.title, type: d.type, markdown: md });
  }
  return { docs, skipped };
}

const keyOf = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, " ");

function markdownEntries(
  entries: ZipEntry[],
  keep: (path: string) => string | null,
): { files: { path: string; text: string }[]; skipped: Skipped[] } {
  const files: { path: string; text: string }[] = [];
  const skipped: Skipped[] = [];
  for (const e of entries) {
    if (isUnsafePath(e.path)) {
      skipped.push({ path: e.path.slice(0, 120).replace(/[\u0000-\u001f]/g, "?"), reason: "unsafe_path" });
      continue;
    }
    const why = keep(e.path);
    if (why) {
      skipped.push({ path: e.path, reason: why });
      continue;
    }
    if ("skipped" in e) skipped.push({ path: e.path, reason: e.skipped });
    else files.push({ path: e.path, text: textOf(e.bytes) });
  }
  return { files, skipped };
}

// ---- OKF v0.2 ----

export function parseOkf(entries: ZipEntry[]): Parsed {
  const { files, skipped } = markdownEntries(entries, (p) => {
    const base = p.split("/").pop() ?? p;
    if (!/\.md$/i.test(p)) return "not_markdown";
    if (base === "index.md" || base === "log.md") return "reserved";
    return null;
  });
  const raw = files.slice(0, MAX_PAGES).map((f) => {
    const { meta, body } = frontmatter(f.text);
    // Root-absolute links to other concept pages become cross-links when the page is in this import.
    const linked = body.replace(/\[([^\]\n]*)\]\(\/([^)\s]+?)\.md\)/g, (_m, label: string, p: string) =>
      `${LINK_OPEN}${(p.split("/").pop() ?? p)}|${label}${LINK_CLOSE}`,
    );
    return {
      path: f.path,
      title: titleOf(meta, body, f.path),
      type: meta.type ? meta.type.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 40) : null,
      body: linked,
      idHint: baseName(f.path),
    };
  });
  for (const f of files.slice(MAX_PAGES)) skipped.push({ path: f.path, reason: "too_many_pages" });
  const out = finish(raw, keyOf);
  return { docs: out.docs, skipped: [...skipped, ...out.skipped] };
}

// ---- Obsidian vault ----

export function parseObsidian(entries: ZipEntry[]): Parsed {
  const { files, skipped } = markdownEntries(entries, (p) => {
    const parts = p.split("/");
    if (parts.some((s) => s === ".obsidian" || s === ".trash" || s.startsWith("."))) return "hidden";
    if (!/\.md$/i.test(p)) return "attachment";
    return null;
  });
  const raw = files.slice(0, MAX_PAGES).map((f) => {
    const { meta, body } = frontmatter(f.text);
    const linked = body
      .replace(/%%[\s\S]*?%%/g, "")
      .replace(/(?<!!)\[\[([^\]\n#^]*)(?:[#^][^\]\n|]*)?(?:\|([^\]\n]*))?\]\]/g, (_m, target: string, alias?: string) =>
        `${LINK_OPEN}${target.trim()}|${(alias ?? target).trim()}${LINK_CLOSE}`,
      );
    return { path: f.path, title: titleOf(meta, body, f.path), type: null, body: linked };
  });
  for (const f of files.slice(MAX_PAGES)) skipped.push({ path: f.path, reason: "too_many_pages" });
  const out = finish(raw, keyOf);
  return { docs: out.docs, skipped: [...skipped, ...out.skipped] };
}

// ---- Outline export ----

type PM = { type?: string; text?: string; content?: PM[]; attrs?: Record<string, unknown>; marks?: { type: string; attrs?: Record<string, unknown> }[] };

function pmInline(n: PM): string {
  if (n.type === "hard_break") return "\n";
  let t = typeof n.text === "string" ? n.text : (n.content ?? []).map(pmInline).join("");
  for (const m of n.marks ?? []) {
    if (m.type === "strong") t = `**${t}**`;
    else if (m.type === "em") t = `*${t}*`;
    else if (m.type === "code_inline") t = `\`${t}\``;
    else if (m.type === "link" && typeof m.attrs?.href === "string") t = `[${t}](${m.attrs.href})`;
  }
  return t;
}

function pmBlock(n: PM, depth = 0, out: string[] = []): string[] {
  const kids = n.content ?? [];
  switch (n.type) {
    case "heading": {
      const lvl = Math.min(6, Math.max(1, Number(n.attrs?.level ?? 1)));
      out.push(`${"#".repeat(lvl)} ${kids.map(pmInline).join("")}`, "");
      break;
    }
    case "paragraph":
      out.push(kids.map(pmInline).join(""), "");
      break;
    case "bullet_list":
    case "ordered_list":
    case "checkbox_list":
      kids.forEach((li, i) => {
        const text = (li.content ?? [])
          .filter((c) => c.type === "paragraph")
          .map((c) => (c.content ?? []).map(pmInline).join(""))
          .join(" ");
        const mark = n.type === "ordered_list" ? `${i + 1}.` : "-";
        out.push(`${"  ".repeat(depth)}${mark} ${text}`);
        for (const sub of li.content ?? [])
          if (sub.type?.endsWith("_list")) pmBlock(sub, depth + 1, out);
      });
      if (depth === 0) out.push("");
      break;
    case "code_block":
    case "code_fence":
      out.push("```", kids.map(pmInline).join(""), "```", "");
      break;
    case "blockquote":
      for (const c of kids) {
        const inner: string[] = [];
        pmBlock(c, 0, inner);
        out.push(...inner.filter((l) => l !== "").map((l) => `> ${l}`), "");
      }
      break;
    default:
      for (const c of kids) pmBlock(c, depth, out);
  }
  return out;
}

const pmToMarkdown = (doc: PM): string => pmBlock(doc).join("\n").trim();

function outlineDocs(json: unknown, path: string): { path: string; title: string; body: string }[] {
  const j = json as { documents?: unknown } | null;
  const list = j?.documents;
  const docs = Array.isArray(list) ? list : list && typeof list === "object" ? Object.values(list) : [];
  const out: { path: string; title: string; body: string }[] = [];
  for (const d of docs) {
    if (!d || typeof d !== "object") continue;
    const x = d as { title?: unknown; text?: unknown; data?: unknown };
    const title = typeof x.title === "string" ? x.title.replace(/[{}[\]<>]/g, "").trim().slice(0, MAX_TITLE) : "";
    const body =
      typeof x.text === "string"
        ? x.text
        : x.data && typeof x.data === "object"
          ? pmToMarkdown(x.data as PM)
          : "";
    if (title) out.push({ path: `${path}#${title}`, title, body });
  }
  return out;
}

/** An Outline export is a zip of `*.json` collection files, or one collection file on its own. */
export function parseOutline(input: { zip: ZipEntry[] } | { json: string }): Parsed {
  const skipped: Skipped[] = [];
  const sources: { path: string; text: string }[] = [];
  if ("json" in input) sources.push({ path: "collection.json", text: input.json });
  else {
    const r = markdownEntries(input.zip, (p) =>
      !/\.json$/i.test(p) ? "not_json" : /(^|\/)metadata\.json$/i.test(p) ? "reserved" : null,
    );
    skipped.push(...r.skipped);
    sources.push(...r.files);
  }
  const raw: { path: string; title: string; type: null; body: string }[] = [];
  for (const s of sources) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(s.text);
    } catch {
      skipped.push({ path: s.path, reason: "invalid_json" });
      continue;
    }
    for (const d of outlineDocs(parsed, s.path)) raw.push({ ...d, type: null });
  }
  for (const d of raw.slice(MAX_PAGES)) skipped.push({ path: d.path, reason: "too_many_pages" });
  const out = finish(raw.slice(0, MAX_PAGES), keyOf);
  return { docs: out.docs, skipped: [...skipped, ...out.skipped] };
}
