/**
 * Quorum reducer. No HTTP and no SQLite.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { requireFail, requireOk } from "./require-ok.ts";
import {
  commitQuorum,
  sameActor,
  SECOND_PERSON_TTL_MS,
  type ActorIdentity,
  type QuorumEvent,
  type QuorumState,
  transitionQuorum,
} from "../../src/state/quorum.ts";

const ada: ActorIdentity = { id: "p1", subject: null, email: "ada@example.invalid" };
const adaOtherId: ActorIdentity = { id: "p2", subject: null, email: "ada@example.invalid" };
const bea: ActorIdentity = { id: "p3", subject: null, email: "bea@example.invalid" };
const adaSubject: ActorIdentity = { id: "p1", subject: "tid:ada", email: "ada@a.example" };
const adaSubjectOther: ActorIdentity = { id: "p2", subject: "tid:ada", email: "ada@b.example" };
const beaSubject: ActorIdentity = { id: "p3", subject: "tid:bea", email: "ada@example.invalid" };

const NOW = 1_700_000_000_000;

const waiting = (requester: ActorIdentity, requestedAt = NOW): QuorumState => ({
  tag: "waiting",
  requester,
  requestedAt,
});

const ask = (actor: ActorIdentity, now = NOW): QuorumEvent => ({ type: "ask", actor, now });

test("quorum: an empty ask is recorded and does not confirm", () => {
  const step = requireOk(transitionQuorum({ tag: "empty" }, ask(ada)));
  assert.equal(step.decision, "recorded");
  assert.deepEqual(step.state, waiting(ada));
  assert.deepEqual(step.effects, [{ type: "upsert", requesterId: "p1", requestedAt: NOW }]);
});

test("quorum: the requester cannot confirm, including under another id or the same subject", () => {
  for (const actor of [ada, adaOtherId, adaSubjectOther]) {
    const step = requireOk(transitionQuorum(waiting(actor === adaSubjectOther ? adaSubject : ada), ask(actor, NOW + 5)));
    assert.equal(step.decision, "same_actor");
    assert.deepEqual(step.effects, [{ type: "none" }]);
    assert.equal(step.state.tag === "waiting" ? step.state.requestedAt : 0, NOW);
  }
  assert.equal(sameActor(ada, { id: "Ada", subject: null, email: null }), false);
  assert.equal(sameActor(adaSubject, beaSubject), false);
});

test("quorum: a different person confirms, and the delete names the stored ask", () => {
  const step = requireOk(transitionQuorum(waiting(ada), ask(bea, NOW + 5)));
  assert.equal(step.decision, "confirmed");
  assert.deepEqual(step.state, { tag: "empty" });
  assert.deepEqual(step.effects, [{ type: "delete", requesterId: "p1", requestedAt: NOW }]);
  const again = requireOk(transitionQuorum(step.state, ask(bea, NOW + 6)));
  assert.equal(again.decision, "recorded");
});

test("quorum: the window ends at requestedAt + TTL, and the same person does not extend it", () => {
  const still = requireOk(
    transitionQuorum(waiting(ada), ask(bea, NOW + SECOND_PERSON_TTL_MS - 1)),
  );
  assert.equal(still.decision, "confirmed");
  const expired = requireOk(transitionQuorum(waiting(ada), ask(bea, NOW + SECOND_PERSON_TTL_MS)));
  assert.equal(expired.decision, "recorded");
  assert.equal(expired.state.tag === "waiting" ? expired.state.requestedAt : 0, NOW + SECOND_PERSON_TTL_MS);
  const held = requireOk(transitionQuorum(waiting(ada), ask(ada, NOW + 1_000)));
  assert.equal(held.state.tag === "waiting" ? held.state.requestedAt : 0, NOW);
});

test("quorum: a bad clock or a missing actor is refused and the log has no identity", () => {
  const lines: string[] = [];
  const warn = console.warn;
  console.warn = (line?: unknown) => {
    lines.push(String(line));
  };
  try {
    const clock = requireFail(commitQuorum({ tag: "empty" }, ask(ada, Number.NaN)));
    const who = requireFail(
      commitQuorum(waiting(ada), { type: "ask", actor: { id: "  ", subject: null, email: ada.email }, now: NOW }),
    );
    assert.equal(clock.reason, "clock_unreadable");
    assert.equal(who.reason, "actor_required");
    assert.equal(lines.length, 2);
    for (const line of lines) {
      assert.equal(line.includes("ada@"), false);
      assert.equal(line.includes("p1"), false);
      const parsed = JSON.parse(line) as { at: string; reason: string };
      assert.equal(parsed.at, "illegal_transition");
      assert.equal(typeof parsed.reason, "string");
    }
  } finally {
    console.warn = warn;
  }
});
