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
 * NOT CONNECTED. Knowledge-gap review (v8/review) will call this when it closes gaps in a brain. Until that
 * branch is merged it does nothing, so the Pulse "gaps closed" line stays at 0. To connect it, write one
 * `gap.closed` line per closed gap (`stub.wikiLogAppend("review", "gap.closed", { count: 1 }, now)`) and the
 * journal and the pulse dots pick it up; see brainJournalRun.
 */
export async function recordGapsClosedNotConnected(_stub: Stub, _count: number): Promise<void> {}
