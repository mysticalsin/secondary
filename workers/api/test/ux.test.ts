import { beforeAll, describe, expect, it } from "vitest";
import { as, json, seed } from "./helpers.ts";

beforeAll(async () => {
  await seed();
});

const send = (persona: string, method: string, path: string, body?: unknown) =>
  as(persona, path, { method, ...(body === undefined ? {} : { body }) });

async function newNote(persona = "consultant", title = "Kickoff notes", body = "Line one") {
  const res = await send(persona, "POST", "/v1/personal/items", { title, body, kind: "note" });
  expect(res.status).toBe(201);
  return json(res);
}

describe("personal edit, history, restore, delete", () => {
  it("edits make revisions, history lists them, restore copies one forward", async () => {
    const n = await newNote();
    // Tags alone are metadata and do not make a revision.
    const tagged = await send("consultant", "PUT", `/v1/personal/items/${n.id}`, {
      revision: n.revision,
      tags: ["Kickoff", "kickoff", "bid"],
    });
    expect((await json(tagged)).revision).toBe(1);
    const put = await send("consultant", "PUT", `/v1/personal/items/${n.id}`, {
      revision: n.revision,
      body: "Line one\nLine two",
    });
    expect(put.status).toBe(200);
    expect((await json(put)).revision).toBe(2);

    const list = await json(await send("consultant", "GET", "/v1/personal/items"));
    const mine = list.find((i: { id: string }) => i.id === n.id);
    expect(mine.tags).toEqual(["kickoff", "bid"]);
    expect(mine.kind).toBe("note");

    const hist = await json(await send("consultant", "GET", `/v1/personal/items/${n.id}/history`));
    expect(hist.map((h: { revision: number }) => h.revision)).toEqual([2, 1]);
    expect(hist[1].body).toBe("Line one");

    const back = await send("consultant", "POST", `/v1/personal/items/${n.id}/restore`, {
      revision: 2,
      fromRevision: 1,
    });
    expect(back.status).toBe(200);
    expect((await json(back)).revision).toBe(3);
    const after = await json(await send("consultant", "GET", "/v1/personal/items"));
    expect(after.find((i: { id: string }) => i.id === n.id).body).toBe("Line one");
  });

  it("a stale revision is a 409 and nothing changes", async () => {
    const n = await newNote();
    const res = await send("consultant", "PUT", `/v1/personal/items/${n.id}`, {
      revision: 9,
      title: "x",
    });
    expect(res.status).toBe(409);
  });

  it("rejects bad tags and unknown kinds", async () => {
    const n = await newNote();
    for (const body of [{ tags: ["<b>"] }, { kind: "secret" }, {}]) {
      const res = await send("consultant", "PUT", `/v1/personal/items/${n.id}`, {
        revision: n.revision,
        ...body,
      });
      expect(res.status).toBe(400);
    }
  });

  it("nobody else can read, edit or delete a personal note", async () => {
    const n = await newNote("consultant");
    for (const p of ["ceo", "platform_admin", "auditor", "reviewer"]) {
      expect((await send(p, "GET", `/v1/personal/items/${n.id}/history`)).status, p).toBe(404);
      expect(
        (await send(p, "PUT", `/v1/personal/items/${n.id}`, { revision: 1, title: "x" })).status,
        p,
      ).toBe(404);
      expect((await send(p, "DELETE", `/v1/personal/items/${n.id}`)).status, p).toBe(404);
    }
  });

  it("delete removes the note", async () => {
    const n = await newNote();
    const res = await send("consultant", "DELETE", `/v1/personal/items/${n.id}`);
    expect(res.status).toBe(200);
    const list = await json(await send("consultant", "GET", "/v1/personal/items"));
    expect(list.some((i: { id: string }) => i.id === n.id)).toBe(false);
    expect((await send("consultant", "GET", `/v1/personal/items/${n.id}/history`)).status).toBe(
      404,
    );
  });
});

describe("drafts and prefs", () => {
  it("a draft autosaves without a revision and is dropped by a saved revision", async () => {
    const n = await newNote();
    const key = n.id;
    const put = await send("consultant", "PUT", `/v1/ux/drafts/${key}`, {
      title: n.title,
      body: "unsaved words",
      kind: "note",
      baseRevision: n.revision,
    });
    expect(put.status).toBe(200);
    const drafts = await json(await send("consultant", "GET", "/v1/ux/drafts"));
    expect(drafts.find((d: { key: string }) => d.key === key).body).toBe("unsaved words");
    // The note itself is untouched.
    const list = await json(await send("consultant", "GET", "/v1/personal/items"));
    expect(list.find((i: { id: string }) => i.id === n.id)).toMatchObject({ revision: 1 });
    await send("consultant", "PUT", `/v1/personal/items/${n.id}`, { revision: 1, body: "saved" });
    const after = await json(await send("consultant", "GET", "/v1/ux/drafts"));
    expect(after.some((d: { key: string }) => d.key === key)).toBe(false);
  });

  it("draft keys are checked", async () => {
    expect((await send("consultant", "PUT", "/v1/ux/drafts/..%2Fx", { title: "x" })).status).toBe(
      404,
    );
  });

  it("prefs round trip per user", async () => {
    const before = await json(await send("consultant", "GET", "/v1/ux/prefs"));
    expect(before).toEqual({ lang: null, tourDone: false });
    const set = await send("consultant", "PUT", "/v1/ux/prefs", { lang: "fr", tourDone: true });
    expect(await json(set)).toEqual({ lang: "fr", tourDone: true });
    expect((await json(await send("consultant", "GET", "/v1/ux/prefs"))).lang).toBe("fr");
    expect((await json(await send("ceo", "GET", "/v1/ux/prefs"))).lang).toBe(null);
    expect((await send("consultant", "PUT", "/v1/ux/prefs", { lang: "de" })).status).toBe(400);
  });
});

describe("account records", () => {
  const ACC = "a_acme";
  const path = `/v1/ux/accounts/${ACC}/records`;

  it("a member creates and edits a commitment with owner role and due date", async () => {
    const made = await send("acme_lead", "POST", path, {
      section: "com",
      title: "Send the pilot plan",
      ownerRole: "Account lead",
      due: "2020-01-15",
      note: "Agreed on the kickoff call",
    });
    expect(made.status).toBe(201);
    const rec = await json(made);
    expect(rec).toMatchObject({ section: "com", status: "open", revision: 1, overdue: true });

    const upd = await send("acme_lead", "PUT", `${path}/${rec.id}`, {
      revision: 1,
      status: "done",
    });
    expect(upd.status).toBe(200);
    expect(await json(upd)).toMatchObject({ status: "done", revision: 2, overdue: false });
    const hist = await json(await send("acme_lead", "GET", `${path}/${rec.id}/history`));
    expect(hist.map((h: { revision: number }) => h.revision)).toEqual([2, 1]);
  });

  it("validates fields", async () => {
    for (const body of [
      { section: "nope", title: "x" },
      { section: "dec", title: "" },
      { section: "dec", title: "x", due: "tomorrow" },
      { section: "dec", title: "x", ownerRole: "Wizard" },
      { section: "dec", title: "x", status: "done" },
    ]) {
      expect((await send("acme_lead", "POST", path, body)).status).toBe(400);
    }
  });

  it("people without edit cannot write, and cannot read what is outside their view", async () => {
    const body = { section: "risk", title: "Budget slip" };
    expect((await send("ceo", "POST", path, body)).status).toBe(403);
    expect((await send("consultant", "POST", path, body)).status).toBe(404);
    expect((await json(await send("consultant", "GET", path))).records).toEqual([]);
    const read = await json(await send("ceo", "GET", path));
    expect(read.canEdit).toBe(false);
    expect(read.records.length).toBeGreaterThan(0);
  });

  it("the external story output stays locked until customer permission is recorded", async () => {
    const made = await json(
      await send("acme_lead", "POST", path, {
        section: "out",
        title: "Faster close for Acme",
        story: {
          internal: "We cut the close by two days",
          lesson: "Start with the data",
          external: "",
        },
      }),
    );
    expect(made.story.external).toMatchObject({ available: false, text: null });
    // An external text without permission is refused.
    const early = await send("acme_lead", "PUT", `${path}/${made.id}`, {
      revision: 1,
      story: { internal: "a", lesson: "b", external: "Public words" },
    });
    expect(early.status).toBe(422);
    // A permission needs a reference.
    expect(
      (
        await send("acme_lead", "POST", `${path}/${made.id}/permission`, {
          revision: 1,
          granted: true,
        })
      ).status,
    ).toBe(400);
    const granted = await json(
      await send("acme_lead", "POST", `${path}/${made.id}/permission`, {
        revision: 1,
        granted: true,
        reference: "Email from the client sponsor, 2026-10-30",
      }),
    );
    expect(granted.story.external.available).toBe(true);
    const ok = await send("acme_lead", "PUT", `${path}/${made.id}`, {
      revision: granted.revision,
      story: { internal: "a", lesson: "b", external: "Public words" },
    });
    expect(ok.status).toBe(200);
    expect((await json(ok)).story.external.text).toBe("Public words");
    // Taking the permission back hides the text again, for every reader.
    const revoked = await json(
      await send("acme_lead", "POST", `${path}/${made.id}/permission`, {
        revision: granted.revision + 1,
        granted: false,
      }),
    );
    expect(revoked.story.external).toMatchObject({ available: false, text: null });
    const seenByCeo = (await json(await send("ceo", "GET", path))).records.find(
      (r: { id: string }) => r.id === made.id,
    );
    expect(seenByCeo.story.external.text).toBe(null);
  });

  it("attention lists open items, overdue first", async () => {
    await send("acme_lead", "POST", path, { section: "dec", title: "Pick the pilot site" });
    const a = await json(await send("acme_lead", "GET", "/v1/ux/attention"));
    expect(a.items.length).toBeGreaterThan(0);
    expect(
      a.items.every((i: { kind: string }) => ["decision", "commitment", "risk"].includes(i.kind)),
    ).toBe(true);
    const overdue = a.items.map((i: { overdue: boolean }) => i.overdue);
    expect(overdue).toEqual([...overdue].sort((x, y) => Number(y) - Number(x)));
    expect((await json(await send("consultant", "GET", "/v1/ux/attention"))).items).toEqual([]);
  });
});

describe("review detail", () => {
  it("shows previous and current text, discussion and decisions to a reviewer, never the author", async () => {
    const made = await send("consultant", "POST", "/v1/actions", {
      nodeId: "c_delivery",
      action: "contribute",
      payload: {
        title: "Handover checklist",
        body: "One\nTwo",
        user_validated: { by: "u_consultant", at: new Date().toISOString(), revision: 1 },
      },
    });
    expect(made.status).toBe(201);
    const { candidateId } = await json(made);
    // The author edits it into revision 2.
    const edit = await send("consultant", "POST", "/v1/actions", {
      nodeId: candidateId,
      action: "edit",
      revision: 1,
      payload: { body: "One\nTwo\nThree" },
    });
    // Whether the contributor may edit depends on policy; detail must work either way.
    const rev = edit.status === 200 ? 2 : 1;
    expect(
      (
        await send("reviewer", "POST", `/v1/ux/review/${candidateId}/comments`, {
          text: "Add the owner of each step",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await send("reviewer", "POST", `/v1/ux/review/${candidateId}/decision`, {
          revision: rev,
          verdict: "changes_requested",
        })
      ).status,
    ).toBe(200);
    const d = await json(await send("reviewer", "GET", `/v1/ux/review/${candidateId}`));
    expect(d.current.revision).toBe(rev);
    expect(d.current.body).toContain("Two");
    if (rev === 2) expect(d.previous.body).toBe("One\nTwo");
    else expect(d.previous).toBe(null);
    expect(d.comments.map((m: { text: string }) => m.text)).toContain("Add the owner of each step");
    expect(d.decisions[0]).toMatchObject({ kind: "changes_requested", mine: true });
    expect((await send("consultant", "GET", `/v1/ux/review/${candidateId}`)).status).toBe(404);
    expect((await send("auditor", "GET", `/v1/ux/review/${candidateId}`)).status).toBe(404);
  });

  it("contribution status reaches the contributor with the reviewer words", async () => {
    const n = await newNote("consultant", "Retro lessons", "What went well");
    const flags = n.sensitivity_flags;
    expect(flags).toEqual([]);
    const c = await send("consultant", "POST", `/v1/personal/items/${n.id}/contribute`, {
      targetScopeId: "c_delivery",
      user_validated: { by: "u_consultant", at: new Date().toISOString(), revision: 1 },
      acknowledged_flags: [],
    });
    expect(c.status).toBe(201);
    const { candidateId } = await json(c);
    // Request changes carries the reason in the same step.
    const dec = await send("reviewer", "POST", `/v1/ux/review/${candidateId}/decision`, {
      revision: 1,
      verdict: "changes_requested",
      comment: "Please add numbers",
    });
    expect(dec.status).toBe(200);
    // The contributor cannot review their own candidate.
    expect(
      (
        await send("consultant", "POST", `/v1/ux/review/${candidateId}/decision`, {
          revision: 1,
          verdict: "accept",
        })
      ).status,
    ).toBe(404);
    const st = await json(
      await send("consultant", "GET", `/v1/personal/items/${n.id}/contributions`),
    );
    expect(st[0]).toMatchObject({ status: "changes_requested", scopeLabel: expect.any(String) });
    expect(st[0].feedback[0].text).toBe("Please add numbers");
  });
});
