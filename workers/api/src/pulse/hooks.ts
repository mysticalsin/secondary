// What the Pulse journal learns from other parts of the platform. The journal (brains/store.ts,
// brainJournalRun) counts two kinds of log line and writes them as `N rules triggered` and `N gaps closed`;
// parse.ts reads those counts back for the pulse dots. Ids and counts only, never content.

import type { workspaceStub } from "../stubs.ts";

type Stub = Pick<ReturnType<typeof workspaceStub>, "wikiLogAppend">;

const ID = /^[A-Za-z0-9_.:-]{1,64}$/;

/** The rules gate calls this when an enforced rule decided an action: one line, the rule id and version. */
export async function recordRuleTriggered(
  stub: Stub,
  ruleId: string,
  version: number,
  now: number,
): Promise<void> {
  if (!ID.test(ruleId) || !Number.isInteger(version)) return;
  try {
    await stub.wikiLogAppend("rules", "rule.triggered", { rule: ruleId, version }, now);
  } catch {
    // The journal is a summary; an action never fails because a line could not be written.
  }
}

/**
 * Knowledge-gap review calls this when a gap leaves the open list: its draft was published (`closed`) or a
 * steward dismissed it (`dismissed`). One id-free line with a count; the journal turns the day's lines into
 * `N gaps closed` and the pulse dots read that.
 */
export async function recordGapsClosed(
  stub: Stub,
  count: number,
  how: "closed" | "dismissed",
  at: number,
): Promise<void> {
  if (!Number.isInteger(count) || count < 1) return;
  try {
    await stub.wikiLogAppend("review", "gap.closed", { count, how }, at);
  } catch {
    // The journal is a summary; closing a gap never fails because a line could not be written.
  }
}
