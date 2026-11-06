// Starting a draft from a gap proposes a page, so a rule on propose_page reaches it (integration of
// v8/review with v7/rules): blocked with the rule named, and the gap is left as it was.

import { beforeAll, describe, expect, it } from "vitest";
import { as, json, type Loose, seed } from "./helpers.ts";
import { sseOf } from "./uxv2-helpers.ts";

const STEWARD = "v8gr.steward@example.invalid";
const ADMIN = "v8gr.admin@example.invalid";
const ADMIN2 = "v8gr.admin2@example.invalid";

const rules = (email: string, path: string, o: Loose = {}) =>
  as("platform_admin", `/v1/rules${path}`, { email, ...o });

beforeAll(async () => {
  await seed();
});

describe("gap start and brain rules", () => {
  it("a block rule on propose_page refuses the draft and names the rule", async () => {
    await sseOf(
      await as("head_bid", "/v1/ask", {
        email: STEWARD,
        body: { q: "What is our flurbix escalation path?", scope: "c_bid" },
      }),
    );
    const list = await json<Loose>(
      await as("head_bid", "/v1/brains/c_bid/gaps", { email: STEWARD }),
    );
    const gap = (list.gaps as Loose[]).find((g) => g.text.toLowerCase().includes("flurbix"));
    expect(gap).toBeTruthy();
    const start = () =>
      as("head_bid", `/v1/brains/c_bid/gaps/${encodeURIComponent(gap?.id)}/start`, {
        email: STEWARD,
        body: {},
      });

    const made = await json<Loose>(
      await rules(ADMIN, "", {
        method: "POST",
        body: {
          name: "Pause pages in bid",
          scope: { kind: "brains", ids: ["c_bid"] },
          when: [{ field: "action", op: "is_any_of", values: ["propose_page"] }],
          then: { effect: "block", message: "Paused today." },
          except: { incident: false },
          status: "enforced",
        },
      }),
    );
    const hash = async (email: string) =>
      (await json<Loose>(await rules(email, `/${made.id}`))).draftHash as string;
    let pub = await rules(ADMIN, `/${made.id}/publish`, {
      method: "POST",
      body: { expectedHash: await hash(ADMIN) },
    });
    if (pub.status === 202)
      pub = await rules(ADMIN2, `/${made.id}/publish`, {
        method: "POST",
        body: { expectedHash: await hash(ADMIN2) },
      });
    expect(pub.status).toBe(200);

    const res = await start();
    expect(res.status).toBe(403);
    expect(await json<Loose>(res)).toMatchObject({ error: "blocked_by_rule" });
    const after = await json<Loose>(
      await as("head_bid", "/v1/brains/c_bid/gaps", { email: STEWARD }),
    );
    expect((after.gaps as Loose[]).find((g) => g.id === gap?.id)?.status).toBe("open");
  });
});
