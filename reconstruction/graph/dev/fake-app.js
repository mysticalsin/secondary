// SYNTHETIC stand-in for the live app module, for local preview and tests only.
// Same response shapes as recovered /v1/brain/tree and /v1/wiki/:ws/pages/:pid. Invented content.

const FOLDERS = {
  me: {
    label: "Personal Brain",
    folders: {
      Project: ["Second Brain rebuild", "Client onboarding", "Q1 hiring plan", "Pricing review"],
      Meeting: ["Weekly sync 3 Nov", "Kickoff with Acme", "1:1 with Ana", "Board prep"],
      Idea: ["Graph view", "Weekly digest", "Auto-tagging", "Meeting notes import"],
      Topic: ["Knowledge management", "Obsidian", "Delivery risk", "Retention"],
    },
  },
  "acct-acme": {
    label: "Acme account",
    folders: {
      Account: ["Acme overview", "Acme contacts", "Acme contract", "Globex opportunity"],
      Decision: ["Renewal terms", "Pilot scope"],
      Risk: ["Budget freeze", "Champion leaving"],
      Finance: ["Acme P&L 2026", "Q4 forecast"],
    },
  },
  "team-delivery": {
    label: "Delivery team",
    folders: {
      Consultant: ["Ana Ribeiro", "Marc Dupont", "Lea Martin", "Sam Okafor", "Priya Nair"],
      Mission: ["Acme data platform", "Globex audit", "Initech migration"],
      Feedback: ["Client feedback Q3", "Manager review notes"],
    },
  },
};

const BODY = {
  "Second Brain rebuild": "We decided to rebuild the Second Brain with a graph view. Go-live target 15 Dec 2026. Budget EUR 40k approved.",
  "Q1 hiring plan": "Hire two consultants in Q1 2026. Salary budget €180k. Ana Ribeiro will mentor the new joiners.",
  "Pricing review": "Daily rate (TJM) moves from €650 to €720 in Jan 2027. Margin target 32%.",
  "Board prep": "Revenue Q3 2026 was €1.2M, up 14% growth. Costs €0.8M. Present on 2 Dec 2026.",
  "Weekly sync 3 Nov": "Marc Dupont flagged a delay on Initech migration. Ana Ribeiro delivered the Acme dashboard ahead of plan, great work.",
  "Acme overview": "Acme is our largest client. Contract value €850k per year. Renewal in negotiation, decision due 20 Jan 2027.",
  "Acme contract": "Signed in Mar 2025 for €850k. Renewal negotiation started; Acme asks for a 5% discount.",
  "Globex opportunity": "Proposal sent for an audit worth $240k. Lead from a partner. Decision expected Feb 2027.",
  "Renewal terms": "We agreed to offer a two year renewal at €820k per year.",
  "Pilot scope": "Pilot approved for the data platform, budget €60k.",
  "Budget freeze": "Risk: Acme announced a budget freeze for Q1 2027. Escalated to the account director.",
  "Champion leaving": "Risk: our sponsor at Acme is leaving in Dec 2026. Concern about the renewal.",
  "Acme P&L 2026": "Revenue Jan 2026 €80k. Revenue Apr 2026 €95k. Revenue Jul 2026 €110k. Revenue Oct 2026 €120k. Costs Jan 2026 €60k. Costs Apr 2026 €64k. Costs Jul 2026 €70k. Costs Oct 2026 €72k.",
  "Q4 forecast": "Forecast revenue Q4 2026 €360k with costs of €230k. Margin around 36%.",
  "Ana Ribeiro": "Senior consultant on Acme data platform. Utilization 92%. Rating 4.6/5 from the client. Proactive and reliable.",
  "Marc Dupont": "Consultant on Initech migration. Utilization 78%. Rating 3.4/5. Some concern about missed deadlines.",
  "Lea Martin": "Consultant on Globex audit. Utilization 85%. Rating 4.2/5. Strong client relationship.",
  "Sam Okafor": "Junior consultant, on bench since Oct 2026. Utilization 40%. Completed cloud certification.",
  "Priya Nair": "Manager. Utilization 70%. Rating 4.8/5. Excellent mentoring, praised by the team.",
  "Acme data platform": "Mission led by Ana Ribeiro. On track. Daily rate €750. Next milestone 10 Dec 2026.",
  "Globex audit": "Mission led by Lea Martin. Delivered phase one, completed on time.",
  "Initech migration": "Mission with Marc Dupont. At risk: delayed by two weeks, blocked on client access.",
  "Client feedback Q3": "Acme said Ana Ribeiro was outstanding. Globex was happy with Lea Martin. Initech complained that Marc Dupont was late twice.",
  "Manager review notes": "Priya Nair: Sam Okafor needs a mission soon. Lea Martin is ready for promotion. Marc Dupont needs support, an issue with planning.",
};

const LINKS = {
  "Second Brain rebuild": ["Graph view", "Obsidian", "Knowledge management", "Ana Ribeiro", "Weekly sync 3 Nov", "Missing spec"],
  "Graph view": ["Obsidian", "Second Brain rebuild", "Knowledge management"],
  "Weekly sync 3 Nov": ["Ana Ribeiro", "Marc Dupont", "Second Brain rebuild", "Q1 hiring plan", "Initech migration"],
  "Kickoff with Acme": ["Acme overview", "Lea Martin", "Client onboarding"],
  "1:1 with Ana": ["Ana Ribeiro", "Retention", "Q1 hiring plan"],
  "Board prep": ["Pricing review", "Delivery risk", "Q1 hiring plan", "Budget freeze", "Acme P&L 2026"],
  "Client onboarding": ["Lea Martin", "Sam Okafor", "Meeting notes import"],
  "Pricing review": ["Priya Nair", "Retention", "Renewal terms"],
  "Weekly digest": ["Auto-tagging", "Knowledge management"],
  "Auto-tagging": ["Knowledge management", "Obsidian"],
  "Meeting notes import": ["Weekly digest", "Unwritten template"],
  "Delivery risk": ["Champion leaving", "Budget freeze", "Initech migration"],
  "Acme overview": ["Acme contacts", "Acme contract", "Pilot scope", "Renewal terms", "Budget freeze", "Champion leaving", "Acme P&L 2026"],
  "Acme contract": ["Renewal terms", "Acme overview"],
  "Globex opportunity": ["Globex audit", "Lea Martin"],
  "Pilot scope": ["Acme contacts", "Acme data platform"],
  "Budget freeze": ["Acme overview"],
  "Q4 forecast": ["Acme P&L 2026"],
  "Ana Ribeiro": ["Acme data platform"],
  "Marc Dupont": ["Initech migration"],
  "Lea Martin": ["Globex audit"],
  "Priya Nair": ["Manager review notes"],
  "Acme data platform": ["Ana Ribeiro", "Acme overview"],
  "Globex audit": ["Lea Martin", "Globex opportunity"],
  "Initech migration": ["Marc Dupont"],
  "Client feedback Q3": ["Ana Ribeiro", "Lea Martin", "Marc Dupont"],
  "Manager review notes": ["Priya Nair", "Sam Okafor", "Lea Martin", "Marc Dupont"],
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
  const related = targets.length ? `Related: ${targets.map((t) => `[[${known.get(t)?.id ?? slug(t)}]]`).join(", ")}.` : "";
  const body = `${BODY[p.title] ?? `${p.title}.`} {src:synthetic-1}\n\n${related}`;
  return {
    id: p.id,
    type: p.type,
    title: p.title,
    revision: 1,
    current: true,
    markdown: `# ${p.title}\n\n${body}`,
    summary: `SYNTHETIC page for the graph preview.`,
    origin: "seed",
    citations: {},
    restricted: 0,
    links,
    uncited: 0,
    updatedAt: new Date(Date.UTC(2026, 10, 7) - (p.title.length % 9) * 86400000 * 4).toISOString(),
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
