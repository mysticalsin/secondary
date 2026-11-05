// B2 security review L-08: Personal Brain metadata writes leave a receipt, and drafts are bound to a
// note that exists (so they cannot be created without limit).

import { beforeAll, describe, expect, it } from "vitest";
import { as, json, type Loose, seed } from "./helpers.ts";

beforeAll(async () => {
  await seed();
});

const send = (persona: string, method: string, path: string, body?: unknown, email?: string) =>
  as(persona, path, {
    method,
    ...(body === undefined ? {} : { body }),
    ...(email ? { email } : {}),
  });

const receipts = async (principal: string): Promise<Loose[]> =>
  (await json(await as("auditor", `/v1/audit/receipts?principal=${principal}`))).receipts;

describe("L-08: personal metadata writes leave a receipt", () => {
  const who = "pers8-a@example.invalid";

  it("retag, prefs and the first save and delete of a draft are on the record", async () => {
    const made = await json(
      await send(
        "consultant",
        "POST",
        "/v1/personal/items",
        { title: "n", body: "b", kind: "note" },
        who,
      ),
    );
    expect(
      (
        await send(
          "consultant",
          "PUT",
          `/v1/personal/items/${made.id}`,
          { revision: 1, tags: ["x"] },
          who,
        )
      ).status,
    ).toBe(200);
    expect((await send("consultant", "PUT", "/v1/ux/prefs", { lang: "fr" }, who)).status).toBe(200);
    for (let i = 0; i < 3; i++)
      expect(
        (
          await send(
            "consultant",
            "PUT",
            `/v1/ux/drafts/${made.id}`,
            { title: "t", body: `w${i}` },
            who,
          )
        ).status,
      ).toBe(200);
    expect(
      (await send("consultant", "DELETE", `/v1/ux/drafts/${made.id}`, undefined, who)).status,
    ).toBe(200);
    // Deleting a draft that is not there leaves nothing to record.
    expect(
      (await send("consultant", "DELETE", `/v1/ux/drafts/${made.id}`, undefined, who)).status,
    ).toBe(200);

    const me = (await json(await send("consultant", "GET", "/v1/me", undefined, who))).principal.id;
    const mine = (await receipts(me)).map((r) => r.action);
    const count = (a: string) => mine.filter((x) => x === a).length;
    expect(count("personal.retag")).toBe(1);
    expect(count("personal.prefs")).toBe(1);
    // Three autosaves, one receipt.
    expect(count("personal.draft")).toBe(1);
    expect(count("personal.draft_delete")).toBe(1);
  });
});

describe("L-08: a draft belongs to a note that exists", () => {
  const who = "pers8-b@example.invalid";

  it("a key for no note is refused and stores nothing; the new-note draft and real notes work", async () => {
    const before = await json<Loose[]>(
      await send("consultant", "GET", "/v1/ux/drafts", undefined, who),
    );
    for (let i = 0; i < 20; i++) {
      const key = `pi:${i.toString(16).padStart(16, "0")}`;
      expect(
        (await send("consultant", "PUT", `/v1/ux/drafts/${key}`, { title: "x", body: "y" }, who))
          .status,
      ).toBe(404);
    }
    const after = await json<Loose[]>(
      await send("consultant", "GET", "/v1/ux/drafts", undefined, who),
    );
    expect(after).toHaveLength(before.length);
    expect(
      (await send("consultant", "PUT", "/v1/ux/drafts/new", { title: "x", body: "y" }, who)).status,
    ).toBe(200);
    const note = await json(
      await send(
        "consultant",
        "POST",
        "/v1/personal/items",
        { title: "n", body: "b", kind: "note" },
        who,
      ),
    );
    expect(
      (await send("consultant", "PUT", `/v1/ux/drafts/${note.id}`, { title: "x", body: "y" }, who))
        .status,
    ).toBe(200);
    // Another person cannot attach a draft to this note.
    expect(
      (
        await send(
          "ceo",
          "PUT",
          `/v1/ux/drafts/${note.id}`,
          { title: "x", body: "y" },
          "pers8-c@example.invalid",
        )
      ).status,
    ).toBe(404);
  });
});
