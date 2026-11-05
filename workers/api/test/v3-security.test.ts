// Security review V3 (2026-11-05): regression tests for H-2 and the M findings of the brains side.
// Each test failed on the code before the fix.

import { beforeAll, describe, expect, it } from "vitest";
import { idOf, put } from "./brains-helpers.ts";
import { ALPHA, as, json, type Loose, seed, seenOf, wsOf } from "./helpers.ts";

const AUTHOR = "sec.author@example.invalid";
const STEW = "sec.steward@example.invalid";
const WORK =
  "The delivery gates are reviewed before each release and the owner signs the checklist.";

const propose = (title: string, o: Loose = {}) =>
  as("head_bid", "/v1/wiki/c_bid/propose", {
    email: AUTHOR,
    body: { title, markdown: `# ${title}\n\n## Summary\n- ${WORK}\n`, ...o },
  });
const list = async (email: string) =>
  json<Loose[]>(await as("head_bid", "/v1/questions?brain=c_bid", { email }));

beforeAll(async () => {
  await seed();
});

describe("H-2: a stored brain role narrows the Questions routes and hidden versions", () => {
  it("a demoted steward no longer sees, decides or batch-approves items, and gets them back with the role", async () => {
    expect((await propose("Role page one")).status).toBe(201);
    expect((await propose("Role page two")).status).toBe(201);
    const before = await list(STEW);
    const one = before.find((q) => q.title.includes("Role page one")) as Loose;
    const two = before.find((q) => q.title.includes("Role page two")) as Loose;
    expect(one && two).toBeTruthy();

    const id = await idOf("head_bid", STEW);
    const ws = wsOf(ALPHA, "c_bid");
    await ws.brainMemberSet(id, "reader", "active", "test", Date.now());

    // Listing: nothing to decide any more.
    expect((await list(STEW)).some((q) => q.title.includes("Role page"))).toBe(false);
    // Single decision: refused.
    const single = await as("head_bid", `/v1/questions/${encodeURIComponent(one.id)}`, {
      email: STEW,
      body: { action: "approve", revisionHash: one.detail.revisionHash, seenChanges: seenOf(one) },
    });
    expect(single.status).toBe(403);
    // Batch: refused for the item, nothing applied.
    const batch = await json<Loose>(
      await as("head_bid", "/v1/questions/batch", {
        email: STEW,
        body: {
          items: [
            {
              id: two.id,
              action: "approve",
              revisionHash: two.detail.revisionHash,
              seenChanges: seenOf(two),
            },
          ],
        },
      }),
    );
    expect(batch.ok).toBe(0);
    expect(batch.results[0].status).toBe(403);
    expect(await ws.wikiPage("role-page-two")).toBeNull();

    // Role removed: the same person decides again (so the cap was the reason).
    await ws.brainMemberRemove(id, "test", Date.now());
    const back = await as("head_bid", `/v1/questions/${encodeURIComponent(one.id)}`, {
      email: STEW,
      body: { action: "approve", revisionHash: one.detail.revisionHash, seenChanges: seenOf(one) },
    });
    expect(back.status).toBe(200);
  });

  it("a demoted editor no longer reads a hidden version", async () => {
    await put("head_bid", STEW, "/c_bid/access", { publication: "direct" });
    const send = (md: string) =>
      as("head_bid", "/v1/wiki/c_bid/propose", {
        email: STEW,
        body: { title: "Hidden role page", pageId: "sec-hidden", markdown: md },
      });
    expect((await send(`# Hidden role page\n\n## Summary\n- First text\n`)).status).toBe(201);
    expect((await send(`# Hidden role page\n\n## Summary\n- Second text\n`)).status).toBe(201);
    await put("head_bid", STEW, "/c_bid/access", { publication: "review" });
    expect(
      (
        await as("head_bid", "/v1/brains/c_bid/pages/sec-hidden/versions/1/hide", {
          email: STEW,
          body: { reason: "private remark" },
        })
      ).status,
    ).toBe(200);
    const read = () => as("head_bid", "/v1/wiki/c_bid/pages/sec-hidden?rev=1", { email: STEW });
    expect((await read()).status).toBe(200);
    const id = await idOf("head_bid", STEW);
    const ws = wsOf(ALPHA, "c_bid");
    await ws.brainMemberSet(id, "reader", "active", "test", Date.now());
    expect((await read()).status).toBe(404);
    await ws.brainMemberRemove(id, "test", Date.now());
    expect((await read()).status).toBe(200);
  });
});

describe("M-4: making a sensitive field more visible takes two people", () => {
  const A = "sec.mgr1@example.invalid";
  const B = "sec.mgr2@example.invalid";
  const def = (sensitivity: string, key = "contract_value") => ({
    key,
    label: "Contract value",
    type: "text",
    sensitivity,
    retentionDays: 365,
    appliesTo: [],
  });
  const set = (email: string, fields: Loose[]) =>
    put("head_bid", email, "/c_bid/fields", { fields });
  const current = async () =>
    (await json<Loose>(await as("head_bid", "/v1/brains/c_bid/fields", { email: A }))).fields.map(
      (f: Loose) => `${f.key}:${f.sensitivity}`,
    );

  it("stricter changes apply at once; a downgrade waits for a second person bound to that exact schema", async () => {
    expect((await set(A, [def("none")])).status).toBe(200);
    expect((await set(A, [def("confidential")])).status).toBe(200); // stricter: one person is enough
    expect(await current()).toEqual(["contract_value:confidential"]);

    const first = await set(A, [def("none")]);
    expect(first.status).toBe(202);
    expect(await json<Loose>(first)).toMatchObject({
      status: "pending",
      fields: ["contract_value"],
    });
    expect(await current()).toEqual(["contract_value:confidential"]);
    // The same person again does not count; neither does a different schema from another person.
    expect((await set(A, [def("none")])).status).toBe(409);
    expect((await set(B, [def("none", "other_key")])).status).toBe(202);
    expect(await current()).toEqual(["contract_value:confidential"]);
    // A different person confirming the same schema applies it.
    const done = await set(B, [def("none")]);
    expect(done.status).toBe(200);
    expect(await current()).toEqual(["contract_value:none"]);
  });

  it("dropping a sensitive field is a downgrade too, so it cannot be recreated as visible alone", async () => {
    expect((await set(A, [def("personal")])).status).toBe(200); // stricter: one person
    expect(await current()).toEqual(["contract_value:personal"]);
    const drop = await set(A, []);
    expect(drop.status).toBe(202);
    expect(await current()).toEqual(["contract_value:personal"]);
  });
});

describe("M-5: an agent's proposal always goes to review, even in a direct-publishing brain", () => {
  it("the same person publishes at once from the app and waits for review through MCP", async () => {
    const { signInternalRequest } = await import("../src/internal-auth.ts");
    const { call, rawEnv } = await import("./helpers.ts");
    const email = "sec.agent@example.invalid";
    expect((await put("head_bid", email, "/c_bid/access", { publication: "direct" })).status).toBe(
      200,
    );
    const body = (t: string) => ({ title: t, markdown: `# ${t}\n\n## Summary\n- ${WORK}\n` });
    // From the web app: live at once.
    const app = await as("head_bid", "/v1/wiki/c_bid/propose", {
      email,
      body: body("App direct page"),
    });
    expect(await json<Loose>(app)).toMatchObject({ status: "published" });
    // From an MCP host, same person: a candidate, nothing is live.
    const url = "https://secondary.example.test/v1/wiki/c_bid/propose";
    const json_ = JSON.stringify(body("Agent page"));
    const headers = await signInternalRequest({
      secret: (rawEnv as unknown as Env).INTERNAL_HMAC_KEY as string,
      method: "POST",
      url,
      body: json_,
      principal: {
        v: 1,
        iss: "secondary-mcp",
        aud: "secondary-api",
        sub: "sub-agent",
        email,
        persona: "head_bid",
        client_id: "claude.ai",
        grant_id: "g_agent",
        scope: ["secondary.read", "secondary.contribute"],
        tool: "wiki_propose",
      },
      now: Math.floor(Date.now() / 1000),
    });
    const res = await call("/v1/wiki/c_bid/propose", {
      token: null,
      headers: { ...headers, "Content-Type": "application/json" },
      method: "POST",
      rawBody: json_,
    });
    expect(res.status, await res.clone().text()).toBe(201);
    expect(await json<Loose>(res)).toMatchObject({ status: "candidate" });
    expect(await wsOf(ALPHA, "c_bid").wikiPage("agent-page")).toBeNull();
    await put("head_bid", email, "/c_bid/access", { publication: "review" });
  });
});

describe("M-7: the unpacked size is counted on the real bytes, entries may not share or rename bytes", () => {
  const noise = (n: number) => {
    const out = new Uint8Array(n);
    for (let at = 0; at < n; at += 65_536)
      crypto.getRandomValues(out.subarray(at, Math.min(n, at + 65_536)));
    return out;
  };
  const text = (s: string) => new TextEncoder().encode(s);

  it("headers that declare small sizes cannot smuggle a large archive past the total", async () => {
    const { unzipGuarded, IMPORT_LIMITS } = await import("../src/brains/unzip.ts");
    const { craftZip } = await import("./zip-craft.ts");
    // Three entries of 120 KB, each declaring 100 bytes. Under the old code the total was 300 bytes.
    const lying = await craftZip(
      [1, 2, 3].map((i) => ({ name: `p${i}.md`, data: noise(120_000), declared: 100 })),
    );
    await expect(
      unzipGuarded(lying, { ...IMPORT_LIMITS, maxTotalBytes: 300_000 }),
    ).rejects.toMatchObject({ code: "too_large" });
    // The same entries, honestly declared, stay under a generous limit.
    const honest = await craftZip([1, 2].map((i) => ({ name: `p${i}.md`, data: noise(1_000) })));
    expect(await unzipGuarded(honest)).toHaveLength(2);
  });

  it("many central entries pointing at one local entry (an overlapping bomb) are refused", async () => {
    const { unzipGuarded } = await import("../src/brains/unzip.ts");
    const { craftZip } = await import("./zip-craft.ts");
    const bomb = await craftZip([
      { name: "a.md", data: noise(5_000), declared: 10 },
      ...Array.from({ length: 20 }, (_, i) => ({
        name: `copy${i}.md`,
        data: noise(5_000),
        declared: 10,
        reuse: 0,
      })),
    ]);
    await expect(unzipGuarded(bomb)).rejects.toMatchObject({ code: "invalid_archive" });
  });

  it("a local header that names another file than the central directory is refused", async () => {
    const { unzipGuarded } = await import("../src/brains/unzip.ts");
    const { craftZip } = await import("./zip-craft.ts");
    const odd = await craftZip([{ name: "a.md", localName: "b.md", data: text("hello world") }]);
    await expect(unzipGuarded(odd)).rejects.toMatchObject({ code: "invalid_archive" });
  });

  it("through the API: the bomb is a 422, not a crash", async () => {
    const { craftZip } = await import("./zip-craft.ts");
    const bomb = await craftZip([
      { name: "a.md", data: noise(5_000), declared: 10 },
      { name: "b.md", data: noise(5_000), declared: 10, reuse: 0 },
    ]);
    const res = await as("head_bid", "/v1/brains/c_bid/import?format=okf", {
      email: "sec.zip@example.invalid",
      method: "POST",
      rawBody: bomb as unknown as string,
      headers: { "Content-Type": "application/zip" },
    });
    expect(res.status).toBe(422);
    expect(await json<Loose>(res)).toMatchObject({ error: "invalid_archive" });
  });
});
