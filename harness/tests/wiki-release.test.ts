import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import { admittedView, canDoInView } from "../../packages/policy/src/engine.ts";
import { buildOrg } from "../../packages/policy/src/org.ts";
import { persona } from "../../packages/policy/src/personas.ts";

register(new URL("../runtime/register-worker-hooks.mjs", import.meta.url).href, {
  parentURL: import.meta.url,
});

const NOW = 1_700_000_000_000;

test("wiki release: an elevated CEO cannot approve or publish", async () => {
  const specifier = new URL("../../recovered-source/worker/src/wiki/review.ts", import.meta.url).href;
  const { mayDecide } = (await import(specifier)) as {
    mayDecide: (
      view: ReturnType<typeof admittedView>,
      principal: ReturnType<typeof persona>,
      nodeId: string,
    ) => { allowed: boolean };
  };
  const org = buildOrg();
  const ceo = persona("ceo");
  const view = admittedView(ceo, org, { now: NOW, elevatedUntil: NOW + 3_600_000 });
  const topic = [...view.nodes.values()].find(
    (node) => node.kind === "topic" && node.level === "content" && !!node.dept && node.access === "full",
  );
  assert.equal(topic === undefined, false);
  const nodeId = topic?.id ?? "";
  assert.equal(canDoInView(view, ceo, nodeId, "review").allowed, true);
  assert.equal(canDoInView(view, ceo, nodeId, "approve_release").allowed, false);
  assert.equal(mayDecide(view, ceo, nodeId).allowed, false);

  const reviewer = persona("reviewer");
  const reviewerView = admittedView(reviewer, org, { now: NOW });
  assert.equal(mayDecide(reviewerView, reviewer, "core").allowed, true);

  const openSpecifier = new URL("../../recovered-source/worker/src/brains/open.ts", import.meta.url).href;
  const { directPublish } = (await import(openSpecifier)) as {
    directPublish: (
      c: unknown,
      w: {
        personal: boolean;
        vn: object | null;
        stub: { brainConfig: () => Promise<unknown> };
        can: { edit: boolean; decide: boolean };
      },
    ) => Promise<boolean>;
  };
  let published: boolean | "threw" = "threw";
  try {
    published = await directPublish(
      {},
      {
        personal: false,
        vn: { kind: "circle" },
        stub: {
          brainConfig: () => Promise.reject(new Error("publish reached the store")),
        },
        can: { edit: true, decide: false },
      },
    );
  } catch {
    published = "threw";
  }
  assert.equal(published, false);
});
