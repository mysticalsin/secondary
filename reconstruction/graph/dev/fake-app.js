// SYNTHETIC stand-in for the live app module, for local preview and tests only.
// Same response shapes as recovered /v1/brain/tree and /v1/wiki/:ws/pages/:pid. Invented content.

const FOLDERS = {
  me: {
    label: "Personal Brain",
    folders: {
      Person: ["Ana Ribeiro", "Marc Dupont", "Lea Martin", "Sam Okafor", "Priya Nair"],
      Project: ["Second Brain rebuild", "Client onboarding", "Q1 hiring plan", "Pricing review"],
      Meeting: ["Weekly sync 3 Nov", "Kickoff with Acme", "1:1 with Ana", "Board prep"],
      Idea: ["Graph view", "Weekly digest", "Auto-tagging", "Meeting notes import"],
      Topic: ["Knowledge management", "Obsidian", "Delivery risk", "Retention"],
    },
  },
  "acct-acme": {
    label: "Acme account",
    folders: {
      Account: ["Acme overview", "Acme contacts", "Acme contract"],
      Decision: ["Renewal terms", "Pilot scope"],
      Risk: ["Budget freeze", "Champion leaving"],
    },
  },
};

const LINKS = {
  "Second Brain rebuild": ["Graph view", "Obsidian", "Knowledge management", "Ana Ribeiro", "Weekly sync 3 Nov", "Missing spec"],
  "Graph view": ["Obsidian", "Second Brain rebuild", "Knowledge management"],
  "Weekly sync 3 Nov": ["Ana Ribeiro", "Marc Dupont", "Second Brain rebuild", "Q1 hiring plan"],
  "Kickoff with Acme": ["Acme overview", "Lea Martin", "Client onboarding"],
  "1:1 with Ana": ["Ana Ribeiro", "Retention", "Q1 hiring plan"],
  "Board prep": ["Pricing review", "Delivery risk", "Q1 hiring plan", "Budget freeze"],
  "Client onboarding": ["Lea Martin", "Sam Okafor", "Meeting notes import"],
  "Pricing review": ["Priya Nair", "Retention", "Renewal terms"],
  "Weekly digest": ["Auto-tagging", "Knowledge management"],
  "Auto-tagging": ["Knowledge management", "Obsidian"],
  "Meeting notes import": ["Weekly digest", "Unwritten template"],
  "Delivery risk": ["Champion leaving", "Budget freeze"],
  "Ana Ribeiro": ["Second Brain rebuild"],
  "Acme overview": ["Acme contacts", "Acme contract", "Pilot scope", "Renewal terms"],
  "Acme contract": ["Renewal terms"],
  "Pilot scope": ["Acme contacts", "Champion leaving"],
  "Budget freeze": ["Acme overview"],
};

const slug = (title) => title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function pagesOf(ws) {
  const out = [];
  for (const [type, titles] of Object.entries(FOLDERS[ws].folders)) {
    for (const title of titles) out.push({ id: slug(title), title, type });
  }
  return out;
}

function tree() {
  const roots = Object.entries(FOLDERS).map(([ws, def]) => {
    const children = Object.entries(def.folders).map(([type, titles]) => ({
      id: `${ws}#${type}`,
      label: type,
      kind: "folder",
      access: "full",
      count: titles.length,
      children: titles.map((t) => ({ id: `${ws}/${slug(t)}`, label: t, kind: "page", access: "full" })),
    }));
    return { id: ws, label: def.label, kind: "workspace", access: "full", count: children.reduce((n, f) => n + f.count, 0), children };
  });
  roots.push({ id: "node-locked", label: "Board brain", kind: "workspace", access: "locked" });
  return { roots };
}

function page(ws, pid) {
  if (!FOLDERS[ws]) return null;
  const all = pagesOf(ws);
  const p = all.find((x) => x.id === pid);
  if (!p) return null;
  const known = new Map(Object.keys(FOLDERS).flatMap((w) => pagesOf(w).map((x) => [x.title, { ws: w, id: x.id }])));
  const targets = LINKS[p.title] ?? [];
  const links = targets.map((title) => {
    const hit = known.get(title);
    if (!hit) return { id: slug(title), title: slug(title), local: true, broken: true };
    if (hit.ws !== ws) return { id: `global:${hit.id}`, title: hit.id, local: false };
    return { id: hit.id, title, local: true };
  });
  const body = targets.length
    ? `${p.title} connects to ${targets.map((t) => `[[${known.get(t)?.id ?? slug(t)}]]`).join(", ")}. {src:synthetic-1}`
    : `${p.title}. No links yet. {src:synthetic-1}`;
  return {
    id: p.id,
    type: p.type,
    title: p.title,
    revision: 1,
    current: true,
    markdown: `# ${p.title}\n\nSYNTHETIC page for the graph preview.\n\n${body}`,
    summary: `SYNTHETIC page for the graph preview.`,
    origin: "seed",
    citations: {},
    restricted: 0,
    links,
    uncited: 0,
    updatedAt: "2026-11-07T12:00:00.000Z",
    fields: [],
  };
}

const json = (value, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });

export class TenantPolicy {}
export class Workspace {}
export function createApp() {
  return app;
}

const SPA = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Second Brain</title></head>
<body><main><h1>Second Brain</h1><p>SYNTHETIC stand-in for the live single-page app.</p></main></body></html>`;

const app = {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/v1/brain/tree") return json(tree());
    const m = url.pathname.match(/^\/v1\/wiki\/([^/]+)\/pages\/([^/]+)$/);
    if (m) {
      const p = page(decodeURIComponent(m[1]), decodeURIComponent(m[2]));
      return p ? json(p) : json({ error: "not_found" }, 404);
    }
    if (url.pathname.startsWith("/v1/")) return json({ error: "not_found" }, 404);
    if (request.method === "GET") return new Response(SPA, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    return json({ error: "method_not_allowed" }, 405);
  },
};

export default app;
