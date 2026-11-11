import assert from "node:assert/strict";

/**
 * Assert a step was accepted, then return that branch. The throw only narrows
 * after `assert.equal`; the assertion itself always runs.
 */
export function requireOk<T extends { ok: boolean }>(step: T): Extract<T, { ok: true }> {
  assert.equal(step.ok, true);
  if (!step.ok) throw new Error("transition was rejected");
  return step as Extract<T, { ok: true }>;
}

/** Assert a step was rejected, then return that branch. */
export function requireFail<T extends { ok: boolean }>(step: T): Extract<T, { ok: false }> {
  assert.equal(step.ok, false);
  if (step.ok) throw new Error("transition was accepted");
  return step as Extract<T, { ok: false }>;
}

/** Assert a tag, then return that variant. */
export function requireTag<S extends { tag: string }, Tag extends S["tag"]>(
  state: S,
  tag: Tag,
): Extract<S, { tag: Tag }> {
  assert.equal(state.tag, tag);
  if (state.tag !== tag) throw new Error(`expected ${tag}`);
  return state as Extract<S, { tag: Tag }>;
}
