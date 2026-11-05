// v3 brains: business fields, hidden versions, the journal, the guide and the Structure Coach.

import { beforeAll, describe, expect, it } from "vitest";
import { signInternalRequest } from "../src/internal-auth.ts";
import { get, post, put } from "./brains-helpers.ts";
import { ALPHA, as, call, json, type Loose, rawEnv, seed, wsOf } from "./helpers.ts";
import { plantPage, unzip } from "./uxv2-helpers.ts";

const BID = "bd.bid@example.invalid";
const CEO = "bd.ceo@example.invalid";
const CONS = "bd.cons@example.invalid";
const LEAD = "bd.lead@example.invalid";
const KEY = (rawEnv as unknown as Env).INTERNAL_HMAC_KEY as string;

const FIELDS = [
  {
    key: "deal_size",
    label: "Deal size",
    type: "number",
    sensitivity: "none",
    retentionDays: null,
    appliesTo: [],
  },
  {
    key: "stage",
    label: "Stage",
    type: "select",
    options: ["lead", "won"],
    sensitivity: "none",
    retentionDays: null,
    appliesTo: [],
  },
  {
    key: "note",
    label: "Note",
    type: "text",
    sensitivity: "none",
    retentionDays: null,
    appliesTo: [],
  },
  {
    key: "contact_email",
    label: "Contact",
    type: "email",
    sensitivity: "confidential",
    retentionDays: null,
    appliesTo: [],
  },
  {
    key: "private_view",
    label: "Private view",
    type: "text",
    sensitivity: "personal",
    retentionDays: null,
    appliesTo: [],
  },
  {
    key: "short_lived",
    label: "Short lived",
    type: "text",
    sensitivity: "none",
    retentionDays: 1,
    appliesTo: [],
  },
];

const fieldsOf = (r: Loose, key: string) => r.fields.find((f: Loose) => f.key === key);

beforeAll(async () => {
  await seed();
  await plantPage(
    "c_bid",
    {
      id: "bd-pricing",
      type: "topic",
      title: "Pricing basics",
      markdown: "# Pricing basics\n\n## Summary\n- Fixed fee for phase 2 is agreed\n",
    },
    "TEAM_RESTRICTED",
  );
});

describe("business fields", () => {
  it("only a manager sets the schema, and it is validated", async () => {
    expect((await put("ceo", CEO, "/c_bid/fields", { fields: FIELDS })).status).toBe(403);
    for (const bad of [
      [{ ...FIELDS[0], key: "Bad Key" }],
      [{ ...FIELDS[0] }, { ...FIELDS[0] }],
      [{ ...FIELDS[1], options: [] }],
      [{ ...FIELDS[0], sensitivity: "secret" }],
      [{ ...FIELDS[0], retentionDays: 0 }],
      Array.from({ length: 31 }, (_, i) => ({ ...FIELDS[0], key: `f${i}` })),
    ])
      expect((await put("head_bid", BID, "/c_bid/fields", { fields: bad })).status).toBe(400);
    const ok = await put("head_bid", BID, "/c_bid/fields", { fields: FIELDS });
    expect(ok.status).toBe(200);
    const read = await get<Loose>("ceo", CEO, "/c_bid/fields");
    expect(read.fields.map((f: Loose) => f.key)).toEqual(FIELDS.map((f) => f.key));
    expect(read.sensitivities).toEqual(["none", "confidential", "personal"]);
  });

  it("values are typed, and a reader cannot write", async () => {
    const path = "/c_bid/pages/bd-pricing/fields";
    expect((await put("ceo", CEO, path, { values: { deal_size: "5" } })).status).toBe(403);
    const bad = await put("head_bid", BID, path, { values: { deal_size: "lots" } });
    expect(bad.status).toBe(422);
    expect(await json(bad)).toMatchObject({ error: "invalid_value", key: "deal_size" });
    expect((await put("head_bid", BID, path, { values: { stage: "maybe" } })).status).toBe(422);
    expect((await put("head_bid", BID, path, { values: { nope: "x" } })).status).toBe(422);
    const ok = await put("head_bid", BID, path, { values: { deal_size: "120000", stage: "lead" } });
    expect(ok.status).toBe(200);
    expect(fieldsOf(await json(ok), "deal_size")).toMatchObject({ value: "120000", masked: false });
  });

  it("the detectors run on every value: a none field refuses contact details, a confidential one needs an acknowledgement", async () => {
    const path = "/c_bid/pages/bd-pricing/fields";
    const r = await put("head_bid", BID, path, {
      values: { note: "call pat.example@example.invalid" },
    });
    expect(r.status).toBe(422);
    const body = await json<Loose>(r);
    expect(body.error).toBe("sensitive_value");
    expect(body.flags[0]).toMatchObject({ key: "note", type: "email" });
    // Even an acknowledgement does not let a none field carry contact details.
    expect(
      (
        await put("head_bid", BID, path, {
          values: { note: "pat.example@example.invalid" },
          acknowledgedFlags: [body.flags[0].id],
        })
      ).status,
    ).toBe(422);
    // A confidential field holds one only when each flag is acknowledged.
    const need = await put("head_bid", BID, path, {
      values: { contact_email: "pat.example@example.invalid" },
    });
    expect(need.status).toBe(422);
    const flags = (await json<Loose>(need)).flags;
    expect(flags[0]).toMatchObject({ key: "contact_email", type: "email" });
    const ok = await put("head_bid", BID, path, {
      values: { contact_email: "pat.example@example.invalid" },
      acknowledgedFlags: flags.map((f: Loose) => f.id),
    });
    expect(ok.status).toBe(200);
    // HR wording in a plain field is caught too.
    expect(
      (await put("head_bid", BID, path, { values: { note: "salary review next week" } })).status,
    ).toBe(422);
  });

  it("masks by sensitivity: confidential is for editors, personal never in a shared brain", async () => {
    const path = "/c_bid/pages/bd-pricing/fields";
    const editor = await get<Loose>("head_bid", BID, path);
    expect(fieldsOf(editor, "contact_email")).toMatchObject({
      value: "pat.example@example.invalid",
      masked: false,
    });
    const reader = await get<Loose>("ceo", CEO, path);
    expect(fieldsOf(reader, "deal_size")).toMatchObject({ value: "120000", masked: false });
    expect(fieldsOf(reader, "contact_email")).toMatchObject({ value: null, masked: true });
    expect(JSON.stringify(reader)).not.toContain("pat.example");
    // Personal data about people never goes into a shared brain.
    const p = await put("head_bid", BID, path, { values: { private_view: "my own view" } });
    expect(p.status).toBe(422);
    expect(await json(p)).toMatchObject({ error: "personal_field_shared_brain" });
    // The same list rides on the wiki page read, masked the same way.
    const page = await json<Loose>(
      await as("ceo", "/v1/wiki/c_bid/pages/bd-pricing", { email: CEO }),
    );
    expect(fieldsOf(page, "contact_email")).toMatchObject({ value: null, masked: true });
    expect(fieldsOf(page, "deal_size").value).toBe("120000");
  });

  it("a personal field holds a value only in a Personal Brain, and only its writer reads it", async () => {
    await plantPage(
      "personal:u_consultant",
      {
        id: "bd-mine",
        type: "topic",
        title: "My note",
        markdown: "# My note\n\n## Summary\n- Private work note\n",
      },
      "PERSONAL_HOSTED",
    );
    expect(
      (await put("consultant", "consultant@example.invalid", "/me/fields", { fields: FIELDS }))
        .status,
    ).toBe(200);
    const w = await put("consultant", "consultant@example.invalid", "/me/pages/bd-mine/fields", {
      values: { private_view: "my own view" },
    });
    expect(w.status).toBe(200);
    expect(fieldsOf(await json(w), "private_view")).toMatchObject({
      value: "my own view",
      masked: false,
    });
    // Another person's `me` is their own brain: this page does not exist there.
    expect(
      (
        await as("consultant", "/v1/brains/me/pages/bd-mine/fields", {
          email: "other.person@example.invalid",
        })
      ).status,
    ).toBe(404);
    // Nobody reaches the Personal Brain by its node id either.
    expect(
      (await as("ceo", "/v1/brains/pb:u_consultant/pages/bd-mine/fields", { email: CEO })).status,
    ).toBe(404);
  });

  it("the export carries only the none fields", async () => {
    const res = await as("head_bid", "/v1/brain/export?workspaceId=c_bid", { email: BID });
    expect(res.status).toBe(200);
    const files = unzip(new Uint8Array(await res.arrayBuffer()));
    const text = [...files.values()].join("\n");
    const page = [...files.entries()].find(([p]) => p.endsWith("bd-pricing.md"))?.[1] ?? "";
    expect(page).toContain("properties:");
    expect(page).toContain("deal_size");
    expect(text).not.toContain("pat.example");
    expect(text).not.toContain("contact_email");
    expect(text).not.toContain("my own view");
  });

  it("the AI gate: an agent session sees none fields only", async () => {
    const path = "/v1/wiki/c_bid/pages/bd-pricing";
    const url = `https://secondary.example.test${path}`;
    const headers = await signInternalRequest({
      secret: KEY,
      method: "GET",
      url,
      principal: {
        v: 1,
        iss: "secondary-mcp",
        grant_id: "g_test",
        aud: "secondary-api",
        sub: "sub-bd",
        email: BID,
        persona: "head_bid",
        client_id: "claude.ai",
        scope: ["secondary.read"],
        tool: "wiki_read",
      },
      now: Math.floor(Date.now() / 1000),
    });
    const res = await call(path, { token: null, headers });
    expect(res.status).toBe(200);
    const page = await json<Loose>(res);
    expect(fieldsOf(page, "deal_size").value).toBe("120000");
    // The same editor sees the confidential value in the web app, an agent does not.
    expect(fieldsOf(page, "contact_email")).toMatchObject({ value: null, masked: true });
    expect(JSON.stringify(page)).not.toContain("pat.example");
  });

  it("values past their retention are deleted by the daily job", async () => {
    const path = "/c_bid/pages/bd-pricing/fields";
    const w = await put("head_bid", BID, path, { values: { short_lived: "temporary" } });
    expect(fieldsOf(await json(w), "short_lived").value).toBe("temporary");
    const n = await wsOf(ALPHA, "c_bid").brainPurgeFields(Date.now() + 2 * 86_400_000);
    expect(n).toBeGreaterThanOrEqual(1);
    expect(fieldsOf(await get<Loose>("head_bid", BID, path), "short_lived").value).toBeNull();
    expect(fieldsOf(await get<Loose>("head_bid", BID, path), "deal_size").value).toBe("120000");
  });
});

describe("hidden versions", () => {
  const LINE = "SECRETLINE-ONE-xyzzy";

  beforeAll(async () => {
    expect((await put("head_bid", BID, "/c_bid/access", { publication: "direct" })).status).toBe(
      200,
    );
    const propose = (md: string) =>
      as("head_bid", "/v1/wiki/c_bid/propose", {
        email: BID,
        body: { title: "Versioned page", pageId: "bd-versioned", markdown: md },
      });
    expect((await propose(`# Versioned page\n\n## Summary\n- ${LINE}\n`)).status).toBe(201);
    expect((await propose("# Versioned page\n\n## Summary\n- Second text\n")).status).toBe(201);
    expect((await propose("# Versioned page\n\n## Summary\n- Third text\n")).status).toBe(201);
    expect((await put("head_bid", BID, "/c_bid/access", { publication: "review" })).status).toBe(
      200,
    );
  });

  const base = "/c_bid/pages/bd-versioned/versions";

  it("hiding needs the edit right, a reason, and never covers the current version", async () => {
    expect((await post("ceo", CEO, `${base}/1/hide`, { reason: "x" })).status).toBe(403);
    expect((await post("head_bid", BID, `${base}/1/hide`, {})).status).toBe(400);
    const cur = await post("head_bid", BID, `${base}/3/hide`, { reason: "no" });
    expect(cur.status).toBe(422);
    expect(await json(cur)).toMatchObject({ error: "current_revision" });
    expect((await post("head_bid", BID, `${base}/9/hide`, { reason: "no" })).status).toBe(404);
  });

  it("a hidden version is gone for readers everywhere, and visible to editors", async () => {
    const hid = await post("head_bid", BID, `${base}/1/hide`, {
      reason: "Contains a private remark",
    });
    expect(hid.status).toBe(200);
    expect((await post("head_bid", BID, `${base}/1/hide`, { reason: "again" })).status).toBe(409);

    const reader = await get<Loose>("ceo", CEO, base);
    expect(reader.versions.find((v: Loose) => v.revision === 1)).toEqual({
      revision: 1,
      at: expect.any(String),
      hidden: true,
    });
    const editor = await get<Loose>("head_bid", BID, base);
    expect(editor.versions.find((v: Loose) => v.revision === 1)).toMatchObject({
      hidden: true,
      reason: "Contains a private remark",
    });

    const hist = await json<Loose[]>(
      await as("ceo", "/v1/wiki/c_bid/pages/bd-versioned/history", { email: CEO }),
    );
    const r1 = hist.find((h) => h.revision === 1) as Loose;
    expect(r1).toMatchObject({ hidden: true, diff: [] });
    const r2 = hist.find((h) => h.revision === 2) as Loose;
    expect(r2.diff.some((d: Loose) => d.type === "del")).toBe(false);
    expect(JSON.stringify(hist)).not.toContain(LINE);
    expect(
      (await as("ceo", "/v1/wiki/c_bid/pages/bd-versioned?rev=1", { email: CEO })).status,
    ).toBe(404);

    const edHist = await json<Loose[]>(
      await as("head_bid", "/v1/wiki/c_bid/pages/bd-versioned/history", { email: BID }),
    );
    expect(JSON.stringify(edHist)).toContain(LINE);
    expect(
      (await as("head_bid", "/v1/wiki/c_bid/pages/bd-versioned?rev=1", { email: BID })).status,
    ).toBe(200);
  });

  it("restoring brings it back, and both steps are logged", async () => {
    expect((await post("ceo", CEO, `${base}/1/restore`)).status).toBe(403);
    expect((await post("head_bid", BID, `${base}/1/restore`)).status).toBe(200);
    expect((await post("head_bid", BID, `${base}/1/restore`)).status).toBe(409);
    expect(
      (await as("ceo", "/v1/wiki/c_bid/pages/bd-versioned?rev=1", { email: CEO })).status,
    ).toBe(200);
    const log = (await wsOf(ALPHA, "c_bid").wikiLog(100)).map((l) => l.kind);
    expect(log).toContain("version.hidden");
    expect(log).toContain("version.restored");
  });
});

describe("journal", () => {
  const today = new Date().toISOString().slice(0, 10);

  beforeAll(async () => {
    await plantPage("a_acme", {
      id: "bd-zebra",
      type: "topic",
      title: "ZEBRA-CANARY title",
      markdown: "# ZEBRA-CANARY title\n\n## Summary\n- Zebra canary fact\n",
    });
  });

  it("is built from the brain's own log: counts and links, no titles, nothing from another brain", async () => {
    const r = await post("head_bid", BID, "/c_bid/journal/run", { date: today });
    expect(r.status).toBe(200);
    const out = await json<Loose>(r);
    expect(out).toMatchObject({ ok: true, pageId: `journal-${today}`, created: true });
    const page = await json<Loose>(
      await as("head_bid", `/v1/wiki/c_bid/pages/journal-${today}`, { email: BID }),
    );
    expect(page.type).toBe("journal");
    expect(page.markdown).toMatch(/## Ingested/);
    expect(page.markdown).toMatch(/## Contradicted/);
    expect(page.markdown).toContain("[[bd-versioned]]");
    expect(page.markdown).not.toContain("ZEBRA");
    expect(page.markdown).not.toContain("Versioned page");
    expect(page.markdown).not.toContain("Pricing basics");
    // Another brain's journal holds only its own pages.
    const acme = await post("acme_lead", LEAD, "/a_acme/journal/run", { date: today });
    const acmePage = await json<Loose>(
      await as("acme_lead", `/v1/wiki/a_acme/pages/${(await json<Loose>(acme)).pageId}`, {
        email: LEAD,
      }),
    );
    expect(acmePage.markdown).toContain("[[bd-zebra]]");
    expect(acmePage.markdown).not.toContain("bd-versioned");
    expect(acmePage.markdown).not.toContain("bd-pricing");
    // The days list shows it, and rerunning the same day changes nothing (deterministic).
    const days = await get<Loose>("head_bid", BID, "/c_bid/journal");
    expect(days.days[0]).toEqual({ date: today, pageId: `journal-${today}` });
    const again = await json<Loose>(
      await post("head_bid", BID, "/c_bid/journal/run", { date: today }),
    );
    expect(again.created).toBe(false);
    const page2 = await json<Loose>(
      await as("head_bid", `/v1/wiki/c_bid/pages/journal-${today}`, { email: BID }),
    );
    expect(page2.markdown).toBe(page.markdown);
  });

  it("needs edit rights, refuses the future, and a quiet day has no page", async () => {
    expect((await post("ceo", CEO, "/c_bid/journal/run", { date: today })).status).toBe(403);
    expect((await post("head_bid", BID, "/c_bid/journal/run", { date: "2999-01-01" })).status).toBe(
      400,
    );
    expect((await post("head_bid", BID, "/c_bid/journal/run", { date: "yesterday" })).status).toBe(
      400,
    );
    expect((await post("head_bid", BID, "/c_bid/journal/run", { date: "2026-02-30" })).status).toBe(
      400,
    );
    const quiet = await json<Loose>(
      await post("head_bid", BID, "/c_bid/journal/run", { date: "2021-03-04" }),
    );
    expect(quiet).toMatchObject({ ok: true, pageId: null, created: false });
  });

  it("the nightly job writes yesterday's page and lint leaves journal pages alone", async () => {
    const ws = wsOf(ALPHA, "c_bid");
    await ws.brainDaily(Date.now() + 86_400_000);
    const days = (await ws.brainJournalDays(60)).map((d) => d.date);
    expect(days).toContain(today);
    await as("head_bid", "/v1/wiki/c_bid/run", { email: BID, body: { jobs: ["lint"] } });
    const proposals = await json<Loose[]>(
      await as("head_bid", "/v1/wiki/c_bid/proposals?status=candidate", { email: BID }),
    );
    expect(JSON.stringify(proposals)).not.toMatch(/Journal 20/);
  });
});

describe("guide and Structure Coach", () => {
  it("the guide is structure, never content or values", async () => {
    const g = await get<Loose>("ceo", CEO, "/c_bid/guide");
    expect(g.brain).toMatchObject({ id: "c_bid", type: "team" });
    expect(g.collections.find((c: Loose) => c.type === "topic")).toMatchObject({
      required: ["Summary"],
    });
    expect(g.fields.map((f: Loose) => f.key)).toContain("deal_size");
    const text = JSON.stringify(g);
    expect(text).not.toContain("Fixed fee");
    expect(text).not.toContain("120000");
    expect(text).not.toContain("pat.example");
    expect((await as("consultant", "/v1/brains/a_acme/guide", { email: CONS })).status).toBe(404);
  });

  it("only a manager of the brain can use the coach", async () => {
    for (const [method, path, body] of [
      ["GET", "/c_bid/coach", undefined],
      ["POST", "/c_bid/coach/propose", { answers: {} }],
      ["POST", "/c_bid/coach/apply", { proposalId: "coach-x", hash: "y" }],
    ] as const) {
      const r = await as("ceo", `/v1/brains${path}`, {
        email: CEO,
        method,
        ...(body ? { body } : {}),
      });
      expect(r.status, `${method} ${path}`).toBe(403);
    }
    // A member of another circle who cannot manage this one, and an unknown brain.
    expect(
      (await post("consultant", CONS, "/c_delivery/coach/propose", { answers: {} })).status,
    ).toBe(403);
    expect((await post("consultant", CONS, "/a_acme/coach/propose", { answers: {} })).status).toBe(
      404,
    );
  });

  it("interview, proposal, apply: collections only, and a stale or wrong proposal is refused", async () => {
    const q = await get<Loose>("head_bid", BID, "/c_bid/coach");
    expect(q.questions.map((x: Loose) => x.id)).toEqual(["role", "accounts", "recurring", "goal"]);
    expect(q.templates.map((t: Loose) => t.id)).toContain("bid");
    expect(
      (await post("head_bid", BID, "/c_bid/coach/propose", { answers: { template: "nope" } }))
        .status,
    ).toBe(400);

    const pagesBefore = (await wsOf(ALPHA, "c_bid").wikiPages()).length;
    const prop = await post("head_bid", BID, "/c_bid/coach/propose", {
      answers: { role: "Bid manager", accounts: ["Acme"], recurring: ["Weekly review"] },
    });
    expect(prop.status).toBe(200);
    const p = await json<Loose>(prop);
    expect(p.template).toBe("bid");
    expect(p.collections.find((c: Loose) => c.type === "weekly_review")).toMatchObject({
      action: "add",
    });
    expect(
      p.collections.find((c: Loose) => c.type === "topic" || c.type === "method")?.action ?? "keep",
    ).toBeTruthy();
    // Proposing changed nothing.
    expect(
      (await get<Loose>("head_bid", BID, "/c_bid")).collections.map((c: Loose) => c.type),
    ).not.toContain("weekly_review");

    expect(
      (
        await post("head_bid", BID, "/c_bid/coach/apply", {
          proposalId: p.proposalId,
          hash: "wrong",
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await post("head_bid", BID, "/c_bid/coach/apply", {
          proposalId: "coach-unknown",
          hash: p.hash,
        })
      ).status,
    ).toBe(404);
    const done = await post("head_bid", BID, "/c_bid/coach/apply", {
      proposalId: p.proposalId,
      hash: p.hash,
    });
    expect(done.status).toBe(200);
    expect((await json<Loose>(done)).created).toContain("weekly_review");
    expect(
      (
        await post("head_bid", BID, "/c_bid/coach/apply", {
          proposalId: p.proposalId,
          hash: p.hash,
        })
      ).status,
    ).toBe(404);
    const home = await get<Loose>("head_bid", BID, "/c_bid");
    expect(home.template).toBe("bid");
    expect(home.collections.map((c: Loose) => c.type)).toContain("weekly_review");
    // No page and no member was created.
    expect((await wsOf(ALPHA, "c_bid").wikiPages()).length).toBe(pagesBefore);
  });
});
