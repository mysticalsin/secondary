import { describe, expect, it } from "vitest";
import { itemKey } from "../src/ids.ts";
import { syncSource } from "../src/sync.ts";
import {
  DELTA,
  DRIVE,
  deleted,
  fakeWorkspace,
  file,
  folder,
  freshTenant,
  graphMock,
  link,
  page,
  sourceDef,
  storeOf,
  text,
} from "./helpers.ts";

const DELTA_2 = link("root/delta?token=T2");
const PAGE_2 = link("root/delta?$skiptoken=P2");

async function setup(over = {}) {
  const tenant = freshTenant();
  const store = storeOf(tenant);
  const src = sourceDef(over);
  await store.putSource(src);
  const g = graphMock();
  const ws = fakeWorkspace();
  const deps = { store, graph: g.graph, api: ws.sink, now: () => 1_700_000_000_000 };
  return { tenant, store, src, g, ws, run: () => syncSource(deps, tenant, src.id) };
}
const key = (id: string) => itemKey("srcbid01", DRIVE, id);

describe("delta sync", () => {
  it("pages through delta, stores a delta link, and only reads text and Markdown", async () => {
    const { g, ws, store, run, tenant } = await setup();
    g.on(
      DELTA,
      page([file("A", "notes.md", "e1"), file("B", "deck.pptx", "e1")], { next: PAGE_2 }),
    );
    g.on(
      PAGE_2,
      page([file("C", "spec.pdf", "e1"), file("D", "plain.txt", "e1"), folder("F1")], {
        delta: DELTA_2,
      }),
    );
    g.on("https://download.example.invalid/A", text("# Notes\nhello"));
    g.on("https://download.example.invalid/D", text("plain text"));

    const out = await run();
    expect(out).toMatchObject({ status: "done", pages: 2, upserted: 4, deleted: 0 });

    // Binary types: metadata only. Never downloaded, never stored.
    expect(g.downloads().sort()).toEqual([
      "https://download.example.invalid/A",
      "https://download.example.invalid/D",
    ]);
    const stored = [...ws.items.values()];
    expect(stored).toHaveLength(4);
    for (const n of ["B", "C"]) {
      const it = ws.items.get(await key(n));
      expect(it?.body).toBeNull();
      expect(it?.webUrl).toContain("contoso.example.invalid");
    }
    expect(ws.items.get(await key("A"))?.body).toBe("# Notes\nhello");
    expect(ws.items.get(await key("D"))?.body).toBe("plain text");

    const cursor = await store.getCursor("srcbid01");
    expect(cursor).toMatchObject({ deltaLink: DELTA_2, nextLink: null, full: false });
    const rec = await store.getRecord(await key("B"));
    expect(rec).toMatchObject({
      hasText: false,
      eTag: "e1",
      cTag: "c-e1",
      aclState: "unknown",
      aclCheckedAt: null,
    });
    expect(tenant).toBeTruthy();
  });

  it("a text file that is not valid UTF-8 or is too large stays metadata only", async () => {
    const { g, ws, run } = await setup();
    g.on(
      DELTA,
      page([file("A", "bad.md", "e1"), file("B", "huge.md", "e1", { size: 300_000 })], {
        delta: DELTA_2,
      }),
    );
    g.on(
      "https://download.example.invalid/A",
      () => new Response(new Uint8Array([0xff, 0xfe, 0x41, 0xc3, 0x28])),
    );
    await run();
    expect(ws.items.get(await key("A"))?.body).toBeNull();
    expect(ws.items.get(await key("B"))?.body).toBeNull();
    expect(g.downloads()).toEqual(["https://download.example.invalid/A"]);
  });

  it("resumes from the stored delta link: changes update, unchanged items do nothing, deletions propagate", async () => {
    const { g, ws, store, run } = await setup();
    g.on(DELTA, page([file("A", "a.md", "e1"), file("B", "b.md", "e1")], { delta: DELTA_2 }));
    g.on("https://download.example.invalid/A", text("A v1"));
    g.on("https://download.example.invalid/B", text("B v1"));
    await run();
    expect(ws.items.size).toBe(2);

    const DELTA_3 = link("root/delta?token=T3");
    g.on(DELTA_2, page([file("A", "a.md", "e2"), file("B", "b.md", "e1")], { delta: DELTA_3 }));
    g.on("https://download.example.invalid/A", text("A v2"));
    await run();
    expect(ws.items.get(await key("A"))?.body).toBe("A v2");
    expect((await store.getRecord(await key("A")))?.revision).toBe(2);
    expect((await store.getRecord(await key("B")))?.revision).toBe(1);

    const DELTA_4 = link("root/delta?token=T4");
    g.on(DELTA_3, page([deleted("A")], { delta: DELTA_4 }));
    const out = await run();
    expect(out).toMatchObject({ status: "done", deleted: 1 });
    expect(ws.items.has(await key("A"))).toBe(false);
    expect(ws.items.has(await key("B"))).toBe(true);
    expect(await store.getRecord(await key("A"))).toBeNull();
    expect((await store.getCursor("srcbid01")).deltaLink).toBe(DELTA_4);
  });

  it("a deleted folder removes the files below it, including nested ones", async () => {
    const { g, ws, run } = await setup();
    g.on(
      DELTA,
      page(
        [
          folder("F1"),
          folder("F2", "F1", `/drives/${DRIVE}/root:/F1`),
          file("A", "a.md", "e1", {
            parentReference: { id: "F2", path: `/drives/${DRIVE}/root:/F1/F2` },
          }),
          file("B", "b.md", "e1", {
            parentReference: { id: "root-id", path: `/drives/${DRIVE}/root:` },
          }),
        ],
        { delta: DELTA_2 },
      ),
    );
    g.on("https://download.example.invalid/A", text("a"));
    g.on("https://download.example.invalid/B", text("b"));
    await run();
    expect(ws.items.size).toBe(2);
    g.on(DELTA_2, page([deleted("F1")], { delta: link("root/delta?token=T3") }));
    await run();
    expect([...ws.items.keys()]).toEqual([await key("B")]);
  });

  it("maps only the configured folder; a file moved out of it is removed", async () => {
    const { g, ws, run } = await setup({ folderPath: "/Docs/Bids" });
    const inside = { parentReference: { id: "x", path: `/drives/${DRIVE}/root:/Docs/Bids/2026` } };
    const outside = { parentReference: { id: "y", path: `/drives/${DRIVE}/root:/Docs/Other` } };
    g.on(
      DELTA,
      page([file("A", "a.md", "e1", inside), file("B", "b.md", "e1", outside)], { delta: DELTA_2 }),
    );
    g.on("https://download.example.invalid/A", text("a"));
    await run();
    expect([...ws.items.keys()]).toEqual([await key("A")]);
    g.on(DELTA_2, page([file("A", "a.md", "e2", outside)], { delta: link("root/delta?token=T3") }));
    await run();
    expect(ws.items.size).toBe(0);
  });

  it("410 on the delta link triggers a full resync; files missing from it are removed", async () => {
    const { g, ws, store, run } = await setup();
    g.on(DELTA, page([file("A", "a.md", "e1"), file("B", "b.md", "e1")], { delta: DELTA_2 }));
    g.on("https://download.example.invalid/A", text("a"));
    g.on("https://download.example.invalid/B", text("b"));
    await run();
    const genBefore = (await store.getCursor("srcbid01")).gen;

    // The token expired. The fresh enumeration no longer lists B, and A did not change.
    const DELTA_NEW = link("root/delta?token=NEW");
    g.on(DELTA_2, new Response("", { status: 410 }));
    g.on(DELTA, page([file("A", "a.md", "e1")], { delta: DELTA_NEW }));
    const downloadsBefore = g.downloads().length;
    const out = await run();
    expect(out).toMatchObject({ status: "done", resynced: true, upserted: 0, deleted: 1 });
    expect([...ws.items.keys()]).toEqual([await key("A")]);
    expect(await store.getRecord(await key("B"))).toBeNull();
    expect(g.downloads().length).toBe(downloadsBefore); // unchanged eTag: not fetched again
    const c = await store.getCursor("srcbid01");
    expect(c).toMatchObject({ deltaLink: DELTA_NEW, full: false });
    expect(c.gen).toBe(genBefore + 1);
  });

  it("backs off on 429 using Retry-After, then succeeds", async () => {
    const { g, ws, run } = await setup();
    g.on(
      DELTA,
      new Response("", { status: 429, headers: { "Retry-After": "2" } }),
      page([file("A", "a.md", "e1")], { delta: DELTA_2 }),
    );
    g.on("https://download.example.invalid/A", text("a"));
    const out = await run();
    expect(out.status).toBe("done");
    expect(g.sleeps).toEqual([2000]);
    expect(ws.items.size).toBe(1);
  });

  it("a long Retry-After is reported, the place is kept, and the next run resumes there", async () => {
    const { g, ws, store, run } = await setup();
    g.on(DELTA, page([file("A", "a.md", "e1")], { next: PAGE_2 }));
    g.on("https://download.example.invalid/A", text("a"));
    g.on(PAGE_2, new Response("", { status: 429, headers: { "Retry-After": "120" } }));
    const out = await run();
    expect(out).toEqual({ status: "throttled", retryAfterSeconds: 120, pages: 1 });
    expect(g.sleeps).toEqual([]);
    expect(ws.items.size).toBe(1);
    expect((await store.getCursor("srcbid01")).nextLink).toBe(PAGE_2);

    g.on(PAGE_2, page([file("B", "b.md", "e1")], { delta: DELTA_2 }));
    g.on("https://download.example.invalid/B", text("b"));
    const again = await run();
    expect(again).toMatchObject({ status: "done", pages: 1, upserted: 1 });
    // The first page was not fetched again.
    expect(g.log.filter((u) => u === DELTA)).toHaveLength(1);
    expect(ws.items.size).toBe(2);
  });

  it("does not advance the cursor when the Workspace write fails; replay is idempotent", async () => {
    const { g, ws, store, run } = await setup();
    g.on(DELTA, page([file("A", "a.md", "e1")], { delta: DELTA_2 }));
    g.on("https://download.example.invalid/A", text("a"));
    ws.state.fail = true;
    const bad = await run();
    expect(bad).toMatchObject({ status: "error", error: "api_503" });
    expect((await store.getCursor("srcbid01")).deltaLink).toBeNull();
    expect(await store.getRecord(await key("A"))).toBeNull();
    ws.state.fail = false;
    expect((await run()).status).toBe("done");
    expect(ws.items.size).toBe(1);
    // Replaying the same page after it was applied changes nothing.
    g.on(DELTA_2, page([file("A", "a.md", "e1")], { delta: link("root/delta?token=T3") }));
    expect(await run()).toMatchObject({ status: "done", upserted: 0 });
    expect(ws.items.size).toBe(1);
  });

  it("caps pages per run and reports `more`", async () => {
    const tenant = freshTenant();
    const store = storeOf(tenant);
    await store.putSource(sourceDef());
    const g = graphMock();
    const ws = fakeWorkspace();
    g.on(DELTA, page([], { next: PAGE_2 }));
    g.on(PAGE_2, page([], { delta: DELTA_2 }));
    const out = await syncSource(
      { store, graph: g.graph, api: ws.sink, now: () => 1, maxPages: 1 },
      tenant,
      "srcbid01",
    );
    expect(out).toMatchObject({ status: "more", pages: 1 });
    expect((await store.getCursor("srcbid01")).nextLink).toBe(PAGE_2);
  });

  it("skips unknown and disabled sources", async () => {
    const { run, store, src, tenant } = await setup({ enabled: false });
    expect(await run()).toEqual({ status: "skipped", reason: "disabled" });
    const g = graphMock();
    expect(
      await syncSource(
        { store, graph: g.graph, api: fakeWorkspace().sink, now: () => 1 },
        tenant,
        "srcnone1",
      ),
    ).toEqual({ status: "skipped", reason: "not_found" });
    expect(src.enabled).toBe(false);
    expect(g.log).toEqual([]);
  });
});
