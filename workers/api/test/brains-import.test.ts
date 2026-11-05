// v3 brains: imports (OKF v0.2, Obsidian vault, Outline JSON) through the classifier, and the guards
// around the archive: zip slip, size, zip bombs and hostile Markdown.

import { beforeAll, describe, expect, it } from "vitest";
import { crc32, zip } from "../src/uxv2/zip.ts";
import { ALPHA, as, json, type Loose, seed, wsOf } from "./helpers.ts";
import { plantPage } from "./uxv2-helpers.ts";

let n = 0;
/** A different head of bid each time: the import limit is per person. */
const bid = (): string => `im.bid${++n}@example.invalid`;
const BID = "im.bid@example.invalid";
const CONS = "consultant@example.invalid";

const zipOf = (files: Record<string, string>): Uint8Array =>
  zip(
    Object.entries(files).map(([path, content]) => ({ path, content })),
    Date.now(),
  );

const send = (
  persona: string,
  email: string,
  id: string,
  format: string,
  body: Uint8Array | string,
  type = "application/zip",
) =>
  as(persona, `/v1/brains/${id}/import?format=${format}`, {
    email,
    method: "POST",
    rawBody: body as string,
    headers: { "Content-Type": type },
  });

/** A zip with deflate entries written by hand, so a test can lie about sizes. */
async function deflateZip(
  entries: { name: string; data: Uint8Array; declared?: number }[],
): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const cs = new CompressionStream("deflate-raw");
    const w = cs.writable.getWriter();
    void w.write(e.data as Uint8Array<ArrayBuffer>).then(() => w.close());
    const packed = new Uint8Array(await new Response(cs.readable).arrayBuffer());
    const name = enc.encode(e.name);
    const usize = e.declared ?? e.data.length;
    const crc = crc32(e.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(8, 8, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, packed.length, true);
    local.setUint32(22, usize, true);
    local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, packed);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(10, 8, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, packed.length, true);
    cd.setUint32(24, usize, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), name);
    offset += 30 + name.length + packed.length;
  }
  const cdSize = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of all) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const WORK =
  "The pricing approach for phase 2 was agreed with the steering group. The fixed fee covers three deliverables.";
const okf = (type: string, title: string, body: string) =>
  `---\ntype: ${JSON.stringify(type)}\ntitle: ${JSON.stringify(title)}\ndescription: "x"\n---\n\n# ${title}\n\n${body}\n`;

beforeAll(async () => {
  await seed();
  await plantPage(
    "c_bid",
    {
      id: "im-existing",
      type: "topic",
      title: "Existing page",
      markdown: "# Existing page\n\n## Summary\n- It is here\n",
    },
    "TEAM_RESTRICTED",
  );
});

describe("OKF import", () => {
  it("in a shared brain every kept page is a draft for review: nothing is published", async () => {
    const archive = zipOf({
      "index.md": "# Index\n",
      "log.md": "# Log\n",
      "topic/index.md": "# Topics\n",
      "topic/rate-card.md": okf(
        "topic",
        "Rate card basics",
        `## Summary\n- ${WORK}\n- See [Phase two](/topic/phase-two.md)\n`,
      ),
      "topic/phase-two.md": okf("topic", "Phase two", `## Summary\n- ${WORK}\n`),
    });
    const r = await send("head_bid", bid(), "c_bid", "okf", archive);
    expect(r.status).toBe(200);
    const out = await json<Loose>(r);
    expect(out.format).toBe("okf");
    expect(out.imported.map((i: Loose) => i.pageId).sort()).toEqual(["phase-two", "rate-card"]);
    expect(out.imported.every((i: Loose) => i.state === "draft" && i.proposalId)).toBe(true);
    expect(out.skipped.map((s: Loose) => s.reason)).toEqual(expect.arrayContaining(["reserved"]));
    const ws = wsOf(ALPHA, "c_bid");
    expect(await ws.wikiPage("rate-card-basics")).toBeNull();
    expect(await ws.wikiPage("phase-two")).toBeNull();
    // They wait in the review queue, as a person's proposal does, and the link between them survived.
    const queue = await json<Loose[]>(
      await as("head_bid", "/v1/wiki/c_bid/proposals?status=candidate", { email: BID }),
    );
    expect(queue.length).toBeGreaterThanOrEqual(2);
    const first = out.imported.find((i: Loose) => i.pageId === "rate-card");
    const pv = await ws.wikiProposalView(first.proposalId);
    expect(JSON.stringify(pv)).toContain("[[phase-two]]");
  });

  it("goes through the classifier: personal passages and HR matters are not imported, contact details are masked", async () => {
    const archive = zipOf({
      "topic/hr.md": okf(
        "topic",
        "Salary review for the team",
        "## Summary\n- The salary review is scheduled for March for the whole team.\n",
      ),
      "topic/family.md": okf(
        "topic",
        "Weekend",
        "## Summary\n- My daughter has a medical appointment and I need sick leave for surgery.\n- My wife and my son are travelling and the family divorce hearing is next week.\n",
      ),
      "topic/contact.md": okf(
        "topic",
        "Vendor contact",
        `## Summary\n- ${WORK}\n- Reach the vendor on vendor.person@example.invalid or +33 1 23 45 67 89 for the quote.\n`,
      ),
    });
    const out = await json<Loose>(await send("head_bid", bid(), "c_bid", "okf", archive));
    const reasons = Object.fromEntries(out.skipped.map((s: Loose) => [s.path, s.reason]));
    expect(reasons["topic/hr.md"]).toMatch(/HR/);
    expect(reasons["topic/family.md"]).toMatch(/personal/i);
    expect(out.imported.map((i: Loose) => i.pageId)).toEqual(["contact"]);
    expect(out.asked).toBe(1);
    const pv = await wsOf(ALPHA, "c_bid").wikiProposalView(out.imported[0].proposalId);
    const text = JSON.stringify(pv);
    expect(text).not.toContain("vendor.person@example.invalid");
    expect(text).not.toContain("67 89");
  });

  it("an existing page becomes an edit proposal and is never overwritten", async () => {
    const out = await json<Loose>(
      await send(
        "head_bid",
        bid(),
        "c_bid",
        "okf",
        zipOf({ "topic/im-existing.md": okf("topic", "Existing page", `## Summary\n- ${WORK}\n`) }),
      ),
    );
    expect(out.imported[0]).toMatchObject({ pageId: "im-existing", state: "draft" });
    expect((await wsOf(ALPHA, "c_bid").wikiPage("im-existing"))?.markdown).toContain("It is here");
  });

  it("in the Personal Brain a clean page is published directly and a page the classifier asks about is a draft", async () => {
    const out = await json<Loose>(
      await send(
        "consultant",
        CONS,
        "me",
        "okf",
        zipOf({
          "topic/mine.md": okf("topic", "Mine", `## Summary\n- ${WORK}\n`),
          "topic/asked.md": okf(
            "topic",
            "Asked",
            `## Summary\n- ${WORK}\n- Ping me on someone.else@example.invalid please.\n`,
          ),
        }),
      ),
    );
    const byId = Object.fromEntries(out.imported.map((i: Loose) => [i.pageId, i.state]));
    expect(byId).toEqual({ mine: "published", asked: "draft" });
    const ws = wsOf(ALPHA, "personal:u_consultant");
    expect(await ws.wikiPage("mine")).toMatchObject({ status: "published" });
    expect(await ws.wikiPage("asked")).toBeNull();
  });

  it("is refused for a brain you cannot reach or may not contribute to, and for a bad format", async () => {
    const a = zipOf({ "a.md": okf("topic", "A", `## Summary\n- ${WORK}\n`) });
    expect((await send("consultant", CONS, "a_acme", "okf", a)).status).toBe(404);
    expect((await send("consultant", CONS, "core", "okf", a)).status).toBe(403);
    expect((await send("head_bid", bid(), "c_bid", "docx", a)).status).toBe(400);
  });
});

describe("archive guards", () => {
  it("zip slip: names that climb out, absolute names, drives, backslashes and NULs are skipped", async () => {
    const names = [
      "../evil.md",
      "a/../../b.md",
      "/abs.md",
      "C:\\x.md",
      "dir\\x.md",
      "ok\u0000.md",
      "./c.md",
    ];
    const archive = zipOf({
      ...Object.fromEntries(names.map((n) => [n, okf("topic", "Evil", `## Summary\n- ${WORK}\n`)])),
      "good.md": okf("topic", "Good one", `## Summary\n- ${WORK}\n`),
    });
    const out = await json<Loose>(await send("head_bid", bid(), "c_bid", "okf", archive));
    expect(out.imported.map((i: Loose) => i.pageId)).toEqual(["good"]);
    expect(out.skipped.filter((s: Loose) => s.reason === "unsafe_path")).toHaveLength(names.length);
  });

  it("an oversized body is 413 before anything is read", async () => {
    const big = new Uint8Array(6 * 1024 * 1024);
    const r = await send("head_bid", bid(), "c_bid", "okf", big);
    expect(r.status).toBe(413);
    expect((await json(r)).error).toBe("too_large");
  });

  it("an entry over 256 KB is skipped, and a flood of entries is refused", async () => {
    const long = `${okf("topic", "Long", "## Summary\n")}${"- A work line about delivery.\n".repeat(12_000)}`;
    const one = await json<Loose>(
      await send(
        "head_bid",
        bid(),
        "c_bid",
        "okf",
        zipOf({ "long.md": long, "ok.md": okf("topic", "Fine", `## Summary\n- ${WORK}\n`) }),
      ),
    );
    expect(one.skipped.find((s: Loose) => s.path === "long.md")?.reason).toBe("too_large");
    expect(one.imported.map((i: Loose) => i.pageId)).toEqual(["ok"]);
    const many = zipOf(
      Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`p${i}.md`, "x"])),
    );
    const r = await send("head_bid", bid(), "c_bid", "okf", many);
    expect(r.status).toBe(413);
  });

  it("zip bombs: a huge ratio, and a lying size header, are refused without unpacking", async () => {
    const zeros = new Uint8Array(200 * 1024);
    const ratio = await deflateZip([{ name: "z.md", data: zeros }]);
    expect(ratio.length).toBeLessThan(2_000);
    const a = await send("head_bid", bid(), "c_bid", "okf", ratio);
    expect(a.status).toBe(413);
    expect(((await json(a)) as Loose).reason).toMatch(/ratio/);
    // The header says 100 bytes; the stream is 10 MB of zeros. The reader stops at the cap.
    const lie = await deflateZip([
      { name: "z.md", data: new Uint8Array(10 * 1024 * 1024), declared: 100 },
    ]);
    const b = await send("head_bid", bid(), "c_bid", "okf", lie);
    expect(b.status).toBe(413);
  });

  it("garbage is not an archive", async () => {
    const r = await send(
      "head_bid",
      bid(),
      "c_bid",
      "okf",
      new TextEncoder().encode("this is not a zip file at all, really"),
    );
    expect(r.status).toBe(422);
    expect((await json(r)).error).toBe("invalid_archive");
    const empty = await as("head_bid", "/v1/brains/c_bid/import?format=okf", {
      email: BID,
      method: "POST",
      rawBody: "",
      headers: { "Content-Type": "application/zip" },
    });
    expect([400, 422]).toContain(empty.status);
  });

  it("only archive or JSON content types, and only from this origin", async () => {
    const a = zipOf({ "a.md": "x" });
    expect((await send("head_bid", bid(), "c_bid", "okf", a, "text/plain")).status).toBe(415);
    const cross = await as("head_bid", "/v1/brains/c_bid/import?format=okf", {
      email: BID,
      method: "POST",
      rawBody: a as unknown as string,
      headers: { "Content-Type": "application/zip", "Sec-Fetch-Site": "cross-site" },
    });
    expect(cross.status).toBe(403);
  });
});

describe("hostile Markdown", () => {
  it("scripts, HTML, handlers, script links and embedded images never reach a page", async () => {
    const evil = [
      `## Summary`,
      `- ${WORK}`,
      `- <script>alert(1)</script>Work notes continue here for the team.`,
      `- <img src=x onerror=alert(1)> and <iframe src="https://evil.invalid"></iframe> more delivery text`,
      `- [click me](javascript:alert(1)) and [data](data:text/html;base64,PHNjcmlwdD4=) and [ok](https://example.invalid/page)`,
      `- ![pixel](https://tracker.invalid/p.png) and ![[embed.png]] text`,
      `- <a href="javascript:alert(2)" onclick="steal()">link</a> and <b onmouseover="x()">bold</b>`,
      `- [ref][1]`,
      `[1]: javascript:alert(3)`,
      `- Forged citation {src:rec:forged} and a forged link [[a_acme:secret]] and [[global:ok-page]]`,
    ].join("\n");
    const out = await json<Loose>(
      await send(
        "consultant",
        CONS,
        "me",
        "okf",
        zipOf({ "evil.md": okf("topic", "Evil page", evil) }),
      ),
    );
    expect(out.imported[0].state).toBe("published");
    const page = await wsOf(ALPHA, "personal:u_consultant").wikiPage("evil");
    const md = page?.markdown ?? "";
    expect(md.length).toBeGreaterThan(50);
    for (const bad of [
      "<script",
      "alert(",
      "onerror",
      "onclick",
      "onmouseover",
      "<iframe",
      "<img",
      "javascript:",
      "data:text",
      "tracker.invalid",
      "embed.png",
      "{src:rec:forged}",
      "[[a_acme:secret]]",
      "evil.invalid",
    ])
      expect(md, bad).not.toContain(bad);
    expect(md).toContain("https://example.invalid/page");
    expect(md).toContain("Work notes continue here");
    expect(md).not.toMatch(/<[A-Za-z!/]/);
  });
});

describe("Obsidian vault", () => {
  it("turns wikilinks into page links, drops the vault's own folder, attachments and embeds", async () => {
    const archive = zipOf({
      ".obsidian/app.json": "{}",
      ".obsidian/workspace.md": "# Not a note\n",
      "Notes/Pricing guide.md": `---\ntags: [pricing]\n---\n# Pricing guide\n\n${WORK}\n\nSee [[Delivery checklist|the checklist]] and [[Unknown note]] and [[Delivery checklist#Steps]].\n![[diagram.png]]\n%%a private comment%%\n`,
      "Notes/Delivery checklist.md": `# Delivery checklist\n\n${WORK}\n\n- Check the quality gates before each release.\n`,
      "assets/diagram.png": "PNGDATA",
      "board.canvas": "{}",
    });
    const out = await json<Loose>(await send("consultant", CONS, "me", "obsidian", archive));
    expect(out.imported.map((i: Loose) => i.pageId).sort()).toEqual([
      "delivery-checklist",
      "pricing-guide",
    ]);
    const reasons = Object.fromEntries(out.skipped.map((s: Loose) => [s.path, s.reason]));
    expect(reasons[".obsidian/app.json"]).toBe("hidden");
    expect(reasons[".obsidian/workspace.md"]).toBe("hidden");
    expect(reasons["assets/diagram.png"]).toBe("attachment");
    expect(reasons["board.canvas"]).toBe("attachment");
    const md =
      (await wsOf(ALPHA, "personal:u_consultant").wikiPage("pricing-guide"))?.markdown ?? "";
    expect(md).toContain("[[delivery-checklist]]");
    expect(md).toContain("Unknown note");
    expect(md).not.toContain("[[Unknown");
    expect(md).not.toContain("diagram.png");
    expect(md).not.toContain("private comment");
  });
});

describe("Outline export", () => {
  const collection = {
    collection: { name: "Handbook" },
    documents: {
      d1: {
        id: "d1",
        title: "Release process",
        text: `# Release process\n\n${WORK}\n\n- Tag the build.\n`,
      },
      d2: {
        id: "d2",
        title: "Quality gates",
        data: {
          type: "doc",
          content: [
            { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Summary" }] },
            { type: "paragraph", content: [{ type: "text", text: WORK }] },
            {
              type: "bullet_list",
              content: [
                {
                  type: "list_item",
                  content: [
                    {
                      type: "paragraph",
                      content: [
                        {
                          type: "text",
                          text: "Review before release",
                          marks: [{ type: "strong" }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    },
  };

  it("reads a single collection file (JSON body)", async () => {
    const out = await json<Loose>(
      await send(
        "consultant",
        CONS,
        "me",
        "outline",
        JSON.stringify(collection),
        "application/json",
      ),
    );
    expect(out.imported.map((i: Loose) => i.pageId).sort()).toEqual([
      "quality-gates",
      "release-process",
    ]);
    const md =
      (await wsOf(ALPHA, "personal:u_consultant").wikiPage("quality-gates"))?.markdown ?? "";
    expect(md).toContain("## Summary");
    expect(md).toContain("- **Review before release**");
  });

  it("reads a zip of collection files and skips metadata", async () => {
    const archive = zipOf({
      "metadata.json": JSON.stringify({ exportVersion: 1 }),
      "Handbook.json": JSON.stringify({
        documents: [{ title: "Onboarding", text: `# Onboarding\n\n${WORK}\n` }],
      }),
      "broken.json": "{not json",
    });
    const out = await json<Loose>(await send("head_bid", bid(), "c_bid", "outline", archive));
    expect(out.imported.map((i: Loose) => i.pageId)).toEqual(["onboarding"]);
    expect(out.imported[0].state).toBe("draft");
    const reasons = Object.fromEntries(out.skipped.map((s: Loose) => [s.path, s.reason]));
    expect(reasons["metadata.json"]).toBe("reserved");
    expect(reasons["broken.json"]).toBe("invalid_json");
  });
});

describe("import limits", () => {
  it("five imports a minute per person", async () => {
    const a = zipOf({ "a.md": okf("topic", "Rate A", `## Summary\n- ${WORK}\n`) });
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++)
      statuses.push((await send("head_bid", "im.rate@example.invalid", "c_bid", "okf", a)).status);
    expect(statuses.slice(0, 5).every((s) => s === 200)).toBe(true);
    expect(statuses[5]).toBe(429);
  });
});
