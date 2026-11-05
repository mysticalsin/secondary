// Shared by the Landing Page tests: the planted brain (pages, a customer permission for the channel landing page)
// and the calls every test makes. Pages of the brain are planted through the wiki store, never read from a real vault.

import { expect } from "vitest";
import { ALPHA, as, json, type Loose, rawEnv, seed, wsOf } from "./helpers.ts";
import { plantPage } from "./uxv2-helpers.ts";

export const CLOUD_ACME = "Cloud migration at Acme Synthetic SA";
export const PERMITTED = "Acme Synthetic SA moved its stores to the cloud with us.";
export const PROSPECT = { firstName: "Jo", role: "CIO", company: "Globex Holdings" };
export const BODY = { prospect: PROSPECT, angle: "cloud migration", brand: "amaris", lang: "en" };
export const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

export const lp = (persona: string, path = "", o: Loose = {}) => as(persona, `/v1/lp${path}`, o);
export const compose = async (persona = "ceo", over: Loose = {}) => {
  const res = await lp(persona, "/compose", { body: { ...BODY, ...over } });
  expect(res.status, await res.clone().text()).toBe(201);
  return json(res);
};
export const put = (persona: string, d: Loose, patch: Loose = {}) =>
  lp(persona, `/${d.id}`, {
    method: "PUT",
    body: {
      slots: d.slots,
      references: d.references.map((r: Loose) => ({ pageId: r.pageId })),
      contact: d.contact,
      revision: d.revision,
      ...patch,
    },
  });
export const planted = async (id: string) => rawEnv.LP.get(rawEnv.LP.idFromName(ALPHA)).get(id);
export const questions = async (persona: string) =>
  json<Loose[]>(await as(persona, "/v1/questions"));

/** compose, check ok, submit: a page waiting in review. */
export async function inReview(over: Loose = {}) {
  const d = await compose("ceo", over);
  const sub = await lp("ceo", `/${d.id}/submit`, { body: {} });
  expect(sub.status, await sub.clone().text()).toBe(200);
  return json(sub);
}

export async function plantLpBrain(): Promise<void> {
  await seed();
  // The wiki schema of each workspace knows the page types a landing page may point at.
  for (const scope of ["a_acme", "a_solana", "a_calypso", "a_lumen", "global"]) {
    const ws = wsOf(ALPHA, scope);
    await ws.wikiTouch(ALPHA, scope, Date.now());
    const cur = await ws.wikiSchema();
    const types = { ...cur.types };
    for (const t of ["success_story", "project"]) types[t] = { label: t, required: ["Summary"] };
    await ws.wikiSetSchema({ ...cur, types });
  }
  const cloud = (name: string, extra = "") =>
    `## Summary\n- Cloud migration delivered with ${name}, cutting run costs by 35% in 2025. ${extra}\n- Lesson: rehearse the cut-over before the real date.\n- "We could not have done it without them", said the CIO.`;
  await plantPage("a_acme", {
    id: "cloud-at-acme",
    type: "success_story",
    title: CLOUD_ACME,
    markdown: cloud("Acme Synthetic SA"),
  });
  await plantPage("a_acme", {
    id: "data-at-acme",
    type: "success_story",
    title: "Data platform at Acme Synthetic SA",
    markdown:
      "## Summary\n- Cloud data platform for Acme Synthetic SA, 40% faster reports. Contact jane@acme.example.invalid.",
  });
  await plantPage("a_solana", {
    id: "cloud-at-solana",
    type: "project",
    title: "Cloud roll-out at Solana Demo SL",
    markdown: cloud("Solana Demo SL"),
  });
  await plantPage("a_lumen", {
    id: "cloud-at-lumen",
    type: "project",
    title: "Cloud roll-out at Lumen Fictive SAS",
    markdown: cloud("Lumen Fictive SAS"),
  });
  await plantPage("a_calypso", {
    id: "cloud-at-calypso",
    type: "success_story",
    title: "Cloud secret at Calypso Demo Srl",
    markdown: cloud("Calypso Demo Srl"),
  });
  // Company Global needs two distinct approvers.
  {
    const ws = wsOf(ALPHA, "global");
    const made = await ws.wikiPropose(
      {
        kind: "wiki_ingest",
        title: "Plant method",
        rationale: "test",
        origin: "human",
        pages: [
          {
            pageId: "cloud-method",
            type: "method",
            title: "Cloud migration method",
            baseRevision: null,
            markdown:
              "## Summary\n- Rehearse the cut-over for every cloud migration.\n## Steps\n- Name a client owner for each deliverable.",
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
      { plane: "GLOBAL_NONPERSONAL" },
    );
    if (!made.ok || !made.created) throw new Error(JSON.stringify(made));
    for (const who of ["u_checker", "u_checker2"]) {
      const v = await ws.wikiProposalView(made.id);
      const r = await ws.wikiDecide(made.id, "approve", who, Date.now(), {
        revisionHash: v?.revisionHash,
      });
      if (!r.ok) throw new Error(JSON.stringify(r));
    }
  }
  // The customer's permission for the exact external text and the channel landing page.
  await wsOf(ALPHA, "a_acme").create(
    {
      id: "rec:acme-cloud-story",
      label: "Cloud migration",
      kind: "record",
      plane: "ACCOUNT_RESTRICTED",
      origin: "record",
      status: "ready",
      authorId: "u_planter",
      tags: ["out"],
      body: JSON.stringify({
        note: "",
        ownerRole: "",
        due: null,
        story: {
          internal: "internal",
          lesson: "lesson",
          external: PERMITTED,
          permission: {
            reference: "signed-doc-1",
            by: "u_lead",
            at: "2026-01-01T00:00:00Z",
            text: PERMITTED,
            channels: ["landing page"],
          },
        },
      }),
    },
    Date.now(),
  );
}

export const publish = async (sub: Loose, body: Loose = {}, owner = "ceo"): Promise<Loose> => {
  const ok = await lp("reviewer", `/${sub.id}/approve`, {
    body: { revisionHash: sub.revisionHash },
  });
  expect(ok.status, await ok.clone().text()).toBe(200);
  const res = await lp(owner, `/${sub.id}/publish`, { body });
  expect(res.status, await res.clone().text()).toBe(200);
  const out = await json(res);
  const slug = /\/p\/([0-9a-f]{32})/.exec(out.url)?.[1] as string;
  return {
    ...out,
    slug,
    html: (await (await rawEnv.PAGES.get(`p/${slug}.html`))?.text()) as string,
  };
};

/** Edits the stored story of the Acme page and gives the original back afterwards. */
export async function withStory(change: (story: Loose) => void, run: () => Promise<void>) {
  const ws = wsOf(ALPHA, "a_acme");
  const rec = await ws.get("rec:acme-cloud-story");
  const body = JSON.parse(rec?.body ?? "{}");
  change(body.story);
  await ws.edit(
    "rec:acme-cloud-story",
    rec?.revision ?? 0,
    { body: JSON.stringify(body) },
    Date.now(),
    "u_lead",
  );
  try {
    await run();
  } finally {
    const cur = await ws.get("rec:acme-cloud-story");
    await ws.edit(
      "rec:acme-cloud-story",
      cur?.revision ?? 0,
      { body: rec?.body ?? "" },
      Date.now(),
      "u_lead",
    );
  }
}
